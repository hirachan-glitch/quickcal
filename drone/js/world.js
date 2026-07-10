/* ==========================================================================
 * DRONE.World — static level geometry + dynamic environment state
 * --------------------------------------------------------------------------
 * Classic script, no modules. Attaches to window.DRONE.World.
 *
 * Pure data + update logic. NO rendering, NO DOM access.
 *
 * Coordinate system (shared contract): right-handed, y = UP (m),
 * x = right, z = forward (north). Ground plane at y = 0.
 *
 * Public API:
 *   DRONE.World.create()                  -> world
 *   DRONE.World.update(world, state, dt)  // mutates world in place
 *
 * world = {
 *   groundSize,                // meters, square ground spans [-S/2, S/2]
 *   obstacles: [{x,z,w,d,h,color}, ...],       // buildings/boxes/poles
 *   landmarks: [{x,z,type,scale}, ...],        // trees / pads (visual only)
 *   gates: [{x,y,z,radius,yaw,passed,index}],  // ordered race course
 *   wind: {x,y,z},             // current gust vector, m/s
 *   nextGate: 0,                // index of the next ungated gate (or -1 when
 *                                // the whole course is complete)
 *   lap: 0,                     // completed laps around the gate course
 *   score: 0,                   // total gates passed, all-time
 *   justPassedGate: false       // true for exactly one update() call after
 *                                // a gate is passed; main.js can read this
 *                                // for one-shot fx (sound/flash) then it
 *                                // resets to false automatically next frame
 * }
 * ========================================================================== */
(function () {
  'use strict';
  window.DRONE = window.DRONE || {};

  /* ------------------------------ Tuning ---------------------------------- */

  var GROUND_SIZE = 400;          // meters, square

  // Wind: smooth low-frequency gusts built from a handful of summed sine
  // waves with slowly drifting random phase/frequency ("pseudo Perlin"),
  // clamped to a bounded magnitude with occasional stronger gust events.
  var WIND_BASE_MAX   = 4.0;      // m/s, normal bounded gust magnitude
  var WIND_GUST_MAX   = 7.5;      // m/s, occasional stronger gust ceiling
  var WIND_GUST_CHANCE = 0.02;    // probability per second of starting a gust
  var WIND_GUST_DURATION = [2.5, 5.5]; // seconds, random range

  var GATE_RADIUS = 6;            // meters, ring/square gate opening half-size

  /* ------------------------------ Helpers --------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  // Smooth pseudo-noise in [-1, 1]: sum of a few sines whose frequencies and
  // phases are fixed per-axis-per-octave (deterministic given elapsed time),
  // producing continuous, band-limited wandering without relying on
  // frame-rate-dependent randomness.
  function noise1(t, seed) {
    var a = Math.sin(t * 0.13 + seed * 1.7) * 0.5;
    var b = Math.sin(t * 0.29 + seed * 3.1 + 1.3) * 0.3;
    var c = Math.sin(t * 0.071 + seed * 5.9 + 2.6) * 0.2;
    return a + b + c; // range approx [-1, 1]
  }

  /* ------------------------------- create ---------------------------------- */

  function makeObstacles() {
    var o = [];
    // A small cluster of "buildings" (boxes) off to one side of the course.
    o.push({ x: -60, z: 40,  w: 14, d: 14, h: 22, color: '#8892a0' });
    o.push({ x: -40, z: 55,  w: 10, d: 10, h: 34, color: '#7c8794' });
    o.push({ x: -75, z: 10,  w: 18, d: 12, h: 16, color: '#95a0ac' });
    o.push({ x: 55,  z: -50, w: 16, d: 16, h: 28, color: '#899', });
    o.push({ x: 78,  z: -30, w: 12, d: 12, h: 18, color: '#7d8894' });

    // Tall thin poles (comms towers) scattered as hazards near the course.
    o.push({ x: 20,  z: 70,  w: 1.2, d: 1.2, h: 40, color: '#c0392b' });
    o.push({ x: -20, z: -60, w: 1.2, d: 1.2, h: 46, color: '#c0392b' });
    o.push({ x: 90,  z: 20,  w: 1.5, d: 1.5, h: 30, color: '#b33' });
    o.push({ x: -95, z: -20, w: 1.5, d: 1.5, h: 36, color: '#b33' });

    return o;
  }

  function makeLandmarks() {
    var l = [];
    // Ring of trees around the perimeter for visual reference / parallax.
    var ringR = 150;
    var count = 24;
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2;
      l.push({
        x: Math.cos(a) * ringR + rand(-8, 8),
        z: Math.sin(a) * ringR + rand(-8, 8),
        type: 'tree',
        scale: rand(0.8, 1.4)
      });
    }
    // Scattered inner trees for midground detail.
    var innerSpots = [
      [30, 30], [-30, 20], [45, -10], [-50, -30], [10, -70],
      [65, 55], [-65, 45], [0, 90], [-15, -95], [100, -5]
    ];
    for (var j = 0; j < innerSpots.length; j++) {
      l.push({ x: innerSpots[j][0], z: innerSpots[j][1], type: 'tree', scale: rand(0.7, 1.2) });
    }
    // Home / landing pad at spawn.
    l.push({ x: 0, z: 0, type: 'pad', scale: 1 });
    // A couple of extra pads around the course as visual waypoints.
    l.push({ x: 40, z: 0, type: 'pad', scale: 0.8 });
    l.push({ x: -20, z: -40, type: 'pad', scale: 0.8 });

    return l;
  }

  function makeGates() {
    // An ordered loop of ~5 gates the player flies through in sequence,
    // varying altitude and heading so it reads as a fun 3D circuit rather
    // than a flat lap. `yaw` is the gate's facing direction (radians,
    // same convention as euler.yaw) — the normal the player should fly
    // through along.
    var g = [];
    g.push({ x: 40,  y: 8,  z: 0,   radius: GATE_RADIUS, yaw: Math.PI / 2,      passed: false, index: 0 });
    g.push({ x: 40,  y: 14, z: -45, radius: GATE_RADIUS, yaw: Math.PI,          passed: false, index: 1 });
    g.push({ x: -10, y: 20, z: -60, radius: GATE_RADIUS, yaw: Math.PI * 1.35,   passed: false, index: 2 });
    g.push({ x: -45, y: 12, z: -25, radius: GATE_RADIUS, yaw: Math.PI * 1.85,   passed: false, index: 3 });
    g.push({ x: -20, y: 6,  z: 15,  radius: GATE_RADIUS, yaw: Math.PI * 0.15,   passed: false, index: 4 });
    return g;
  }

  function create() {
    var world = {
      groundSize: GROUND_SIZE,
      obstacles: makeObstacles(),
      landmarks: makeLandmarks(),
      gates: makeGates(),
      wind: { x: 0, y: 0, z: 0 },
      nextGate: 0,
      lap: 0,
      score: 0,
      justPassedGate: false,
      // internal wind-gust state (safe for others to ignore)
      _windT: 0,
      _windSeedX: rand(0, 1000),
      _windSeedY: rand(0, 1000),
      _windSeedZ: rand(0, 1000),
      _gustActive: false,
      _gustTimer: 0,
      _gustStrength: 1
    };
    return world;
  }

  /* ------------------------------ wind update ------------------------------ */

  function updateWind(world, dt) {
    world._windT += dt;
    var t = world._windT;

    // Base bounded wandering gust from summed sines per axis.
    var bx = noise1(t, world._windSeedX);
    var by = noise1(t * 0.7, world._windSeedY) * 0.35; // vertical gusts gentler
    var bz = noise1(t, world._windSeedZ);

    // Occasional stronger gust event: random chance to start, ramps in/out
    // with a smoothstep-ish envelope while active.
    if (!world._gustActive) {
      if (Math.random() < WIND_GUST_CHANCE * dt) {
        world._gustActive = true;
        world._gustTimer = rand(WIND_GUST_DURATION[0], WIND_GUST_DURATION[1]);
        world._gustStrength = rand(1.3, WIND_GUST_MAX / WIND_BASE_MAX);
      }
    } else {
      world._gustTimer -= dt;
      if (world._gustTimer <= 0) {
        world._gustActive = false;
        world._gustStrength = 1;
      }
    }
    // Smooth envelope toward current target strength (avoids snapping).
    var targetStrength = world._gustActive ? world._gustStrength : 1;
    world._windStrength = world._windStrength === undefined ? 1 : world._windStrength;
    world._windStrength += (targetStrength - world._windStrength) * clamp(dt * 0.8, 0, 1);

    var mag = WIND_BASE_MAX * world._windStrength;
    var wx = clamp(bx * mag, -WIND_GUST_MAX, WIND_GUST_MAX);
    var wy = clamp(by * mag, -WIND_GUST_MAX * 0.35, WIND_GUST_MAX * 0.35);
    var wz = clamp(bz * mag, -WIND_GUST_MAX, WIND_GUST_MAX);

    // Light smoothing toward new target so wind doesn't jitter frame to frame.
    var k = clamp(dt * 1.5, 0, 1);
    world.wind.x += (wx - world.wind.x) * k;
    world.wind.y += (wy - world.wind.y) * k;
    world.wind.z += (wz - world.wind.z) * k;
  }

  /* ------------------------------ gate update ------------------------------- */

  function updateGates(world, state, dt) {
    world.justPassedGate = false;

    if (world.nextGate < 0 || world.nextGate >= world.gates.length) return;

    var gate = world.gates[world.nextGate];
    var dx = state.pos.x - gate.x;
    var dy = state.pos.y - gate.y;
    var dz = state.pos.z - gate.z;

    // Distance from gate plane along its facing normal, and radial distance
    // within that plane (so passing through the ring/frame counts, not just
    // being near the gate's center point in 3-space).
    var nx = Math.sin(gate.yaw), nz = Math.cos(gate.yaw); // gate facing normal (xz)
    var along = dx * nx + dz * nz;              // signed distance along normal
    var lateralX = dx - along * nx;
    var lateralZ = dz - along * nz;
    var radial = Math.sqrt(lateralX * lateralX + lateralZ * lateralZ + dy * dy);

    // Track sign of `along` so we can detect crossing the plane this frame.
    if (gate._prevAlong === undefined) gate._prevAlong = along;
    var crossedPlane = (gate._prevAlong < 0 && along >= 0) || (gate._prevAlong > 0 && along <= 0) || Math.abs(along) < 0.5;
    var withinRing = radial <= gate.radius;

    if (!gate.passed && withinRing && crossedPlane) {
      gate.passed = true;
      world.justPassedGate = true;
      world.score += 1;
      world.nextGate += 1;
      if (world.nextGate >= world.gates.length) {
        world.lap += 1;
        // Loop the course: reopen all gates for another lap.
        world.nextGate = 0;
        for (var i = 0; i < world.gates.length; i++) {
          world.gates[i].passed = false;
          world.gates[i]._prevAlong = undefined;
        }
        return;
      }
    }

    gate._prevAlong = along;
  }

  /* -------------------------------- update ---------------------------------- */

  function update(world, state, dt) {
    if (!(dt > 0)) return;
    if (dt > 0.25) dt = 0.25; // guard against huge tab-switch jumps

    updateWind(world, dt);
    updateGates(world, state, dt);
  }

  /* -------------------------------- exports ---------------------------------- */

  window.DRONE.World = {
    create: create,
    update: update
  };
})();
