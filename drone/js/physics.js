/* ==========================================================================
 * DRONE.Physics — rigid-body quadcopter flight dynamics
 * --------------------------------------------------------------------------
 * Classic script, no modules. Attaches to window.DRONE.Physics.
 *
 * Coordinate system (shared contract): right-handed, y = UP (m),
 * x = right, z = forward (north). Ground plane at y = 0.
 * euler.yaw about +y, euler.pitch about +x (nose up = +),
 * euler.roll about +z (right wing down = +). All angles radians.
 *
 * Public API:
 *   DRONE.Physics.create()                       -> state
 *   DRONE.Physics.step(state, input, dt, wind)   // wind optional {x,y,z} m/s
 *                                                //  (extends the contract's
 *                                                //   4-arg signature; main.js
 *                                                //   passes world.wind)
 *   DRONE.Physics.reset(state)                   // back to spawn, keeps mode+battery
 *   DRONE.Physics.setMode(state, 'angle'|'acro')
 * ========================================================================== */
(function () {
  'use strict';
  window.DRONE = window.DRONE || {};

  /* ---------------------------- Tuning constants ------------------------- */
  var MASS        = 0.9;               // kg
  var G           = 9.81;              // m/s^2
  var TWR         = 2.2;               // thrust-to-weight ratio
  var MAX_THRUST  = TWR * MASS * G;    // ~19.4 N  => hover throttle ~ 1/TWR ~ 0.45

  // Quadratic aero drag: F = -k * |v| * v  (per axis, world frame).
  // Horizontal drag a bit higher than vertical (frame + props present more
  // area sideways). Tuned so top speed ~ 18-20 m/s at full-tilt full-throttle
  // and the craft coasts noticeably when the stick is released.
  var DRAG_H      = 0.045;             // kg/m horizontal (x,z)
  var DRAG_V      = 0.030;             // kg/m vertical   (y)

  // ANGLE mode: sticks command target tilt, attitude follows through a
  // critically-damped 2nd-order system:  a'' = w^2*(target-a) - 2*w*a'
  var MAX_TILT    = 35 * Math.PI / 180;   // max commanded tilt (rad)
  var ATT_TAU     = 0.12;                 // attitude time constant (s)
  var ATT_W       = 1 / ATT_TAU;          // natural frequency (rad/s)

  // Yaw in angle mode: stick commands a yaw RATE with first-order spin-up lag.
  var MAX_YAW_RATE  = 180 * Math.PI / 180; // rad/s
  var YAW_LAG_TAU   = 0.10;                // s

  // ACRO mode: sticks command body rates directly, with a short lag so the
  // craft still has rotational "weight". No self-levelling.
  var ACRO_MAX_RATE = 360 * Math.PI / 180; // rad/s all axes
  var ACRO_LAG_TAU  = 0.07;                // s

  // Motor spool: commanded throttle -> actual thrust fraction (1st order lag).
  var MOTOR_TAU   = 0.09;              // s

  // Ground interaction
  var CRASH_VSPEED  = -4.0;            // m/s: landing harder than this = crash
  var CRASH_TILT    = 60 * Math.PI / 180; // touching down more tilted = crash
  var GROUND_FRICTION = 6.0;           // 1/s horizontal decel factor on ground

  // Battery: ~7 min (420 s) hovering at ~0.45 throttle to empty.
  //   drain %/s = throttle * BATT_RATE ; 100 / (0.45 * 420) ~= 0.53
  var BATT_RATE   = 0.53;              // %/s per unit throttle
  var BATT_WEAK_BELOW = 10;            // motors start weakening below this %

  var MAX_SUBSTEP = 1 / 120;           // physics sub-step cap (s)
  var TWO_PI      = Math.PI * 2;

  /* ------------------------------ Helpers -------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function wrapPi(a) {
    // wrap angle to (-PI, PI]
    a = a % TWO_PI;
    if (a > Math.PI) a -= TWO_PI;
    else if (a <= -Math.PI) a += TWO_PI;
    return a;
  }

  // Body -> world rotation applied to the body-UP axis (0,1,0).
  // Rotation order: yaw (about +y), then pitch (about +x), then roll (about +z),
  // i.e. R = Ry(yaw) * Rx(-pitch') ... expressed directly below.
  // With pitch = nose-up positive and z = forward:
  //   nose-up (pitch+) tips the thrust vector BACKWARD (-z accel)  -> brakes
  //   nose-down (pitch-) tips it FORWARD (+z accel)
  //   roll+ (right down) tips it RIGHT (+x accel)
  function bodyUpWorld(e, out) {
    // R = Ry(yaw) * Rx(-pitch) * Rz(-roll)  (sign flips give the contract's
    // "nose-up = +pitch", "right-down = +roll" conventions in a RH frame).
    // Column for body-up (0,1,0) before yaw:
    //   roll  right-down (+): up leans RIGHT  -> ( sin r, cos r, 0 )
    //   pitch nose-up   (+): up leans BACK    -> multiply y,z by Rx(-p)
    //   => up_local = ( sr, cp*cr, -sp*cr )
    var cy = Math.cos(e.yaw),   sy = Math.sin(e.yaw);
    var cp = Math.cos(e.pitch), sp = Math.sin(e.pitch);
    var cr = Math.cos(e.roll),  sr = Math.sin(e.roll);
    var ux = sr;
    var uy = cp * cr;
    var uz = -sp * cr;
    // yaw about +y rotates x/z (yaw+ turns nose right):
    out.x = cy * ux + sy * uz;
    out.y = uy;
    out.z = -sy * ux + cy * uz;
    return out;
  }

  /* ------------------------------- create -------------------------------- */

  function create() {
    var state = {
      pos:    { x: 0, y: 0, z: 0 },
      vel:    { x: 0, y: 0, z: 0 },
      euler:  { yaw: 0, pitch: 0, roll: 0 },
      angVel: { yaw: 0, pitch: 0, roll: 0 },
      armed: false,
      mode: 'angle',
      throttleCmd: 0,
      battery: 100,
      // derived
      altitude: 0,
      speed: 0,
      verticalSpeed: 0,
      tiltDeg: 0,
      gForce: 1,
      motors: [0, 0, 0, 0],   // FL, FR, RL, RR
      crashed: false,
      // internal (prefixed _, safe for others to ignore)
      _motorOut: 0,           // spooled thrust fraction 0..1
      _prevVel: { x: 0, y: 0, z: 0 }
    };
    return state;
  }

  /* -------------------------------- reset -------------------------------- */

  function reset(state) {
    state.pos.x = 0; state.pos.y = 0; state.pos.z = 0;
    state.vel.x = 0; state.vel.y = 0; state.vel.z = 0;
    state.euler.yaw = 0; state.euler.pitch = 0; state.euler.roll = 0;
    state.angVel.yaw = 0; state.angVel.pitch = 0; state.angVel.roll = 0;
    state.armed = false;
    state.throttleCmd = 0;
    state.crashed = false;
    state._motorOut = 0;
    state._prevVel.x = 0; state._prevVel.y = 0; state._prevVel.z = 0;
    // keep mode and battery
    state.altitude = 0; state.speed = 0; state.verticalSpeed = 0;
    state.tiltDeg = 0; state.gForce = 1;
    state.motors[0] = state.motors[1] = state.motors[2] = state.motors[3] = 0;
  }

  /* ------------------------------- setMode ------------------------------- */

  function setMode(state, mode) {
    if (mode === 'angle' || mode === 'acro') state.mode = mode;
  }

  /* --------------------------------- step -------------------------------- */
  // step(state, input, dt [, wind]) — wind is an optional {x,y,z} m/s gust
  // vector (world frame) applied as external aero force on the airframe.

  var _up = { x: 0, y: 1, z: 0 }; // scratch vector, reused (no per-frame alloc)

  function step(state, input, dt, wind) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;                    // tab-switch guard
    wind = wind || null;

    // Sub-step so the 2nd-order attitude loop stays stable at any frame rate.
    var n = Math.ceil(dt / MAX_SUBSTEP);
    var h = dt / n;
    for (var i = 0; i < n; i++) subStep(state, input, h, wind);

    updateDerived(state, dt);
  }

  function subStep(state, input, h, wind) {
    var e = state.euler, w = state.angVel, v = state.vel;

    var thr   = clamp(input.throttle || 0, 0, 1);
    var inYaw   = clamp(input.yaw   || 0, -1, 1);
    var inPitch = clamp(input.pitch || 0, -1, 1);
    var inRoll  = clamp(input.roll  || 0, -1, 1);

    var flying = state.armed && !state.crashed;
    if (!flying) { thr = 0; inYaw = inPitch = inRoll = 0; }
    state.throttleCmd = flying ? clamp(input.throttle || 0, 0, 1) : 0;

    /* --- motor spool (1st order lag on thrust) --- */
    var battFactor = state.battery <= 0 ? 0
      : state.battery < BATT_WEAK_BELOW ? (0.55 + 0.45 * state.battery / BATT_WEAK_BELOW)
      : 1;
    var targetOut = flying ? thr * battFactor : 0;
    state._motorOut += (targetOut - state._motorOut) * (1 - Math.exp(-h / MOTOR_TAU));
    var T = state._motorOut * MAX_THRUST;   // Newtons along body-up

    /* --- attitude dynamics --- */
    if (flying) {
      if (state.mode === 'angle') {
        // Sticks command target tilt; critically-damped 2nd-order tracking.
        // pitch stick forward (+) => nose DOWN => negative pitch target.
        var tgtPitch = -inPitch * MAX_TILT;
        var tgtRoll  =  inRoll  * MAX_TILT;
        var w2 = ATT_W * ATT_W, tw = 2 * ATT_W;
        var aP = w2 * (tgtPitch - e.pitch) - tw * w.pitch;
        var aR = w2 * (tgtRoll  - e.roll ) - tw * w.roll;
        w.pitch += aP * h;
        w.roll  += aR * h;
        // yaw: rate command with spin-up lag
        var tgtYawRate = inYaw * MAX_YAW_RATE;
        w.yaw += (tgtYawRate - w.yaw) * (1 - Math.exp(-h / YAW_LAG_TAU));
      } else {
        // ACRO: direct body-rate command with short lag; no self-level.
        var k = 1 - Math.exp(-h / ACRO_LAG_TAU);
        w.pitch += (-inPitch * ACRO_MAX_RATE - w.pitch) * k;
        w.roll  += ( inRoll  * ACRO_MAX_RATE - w.roll ) * k;
        w.yaw   += ( inYaw   * ACRO_MAX_RATE - w.yaw  ) * k;
      }
    } else {
      // Unpowered: rotational damping only (no active control).
      var d = Math.exp(-h * 2.0);
      w.pitch *= d; w.roll *= d; w.yaw *= d;
    }

    e.yaw   = wrapPi(e.yaw   + w.yaw   * h);
    e.pitch = wrapPi(e.pitch + w.pitch * h);
    e.roll  = wrapPi(e.roll  + w.roll  * h);

    /* --- linear dynamics --- */
    bodyUpWorld(e, _up);           // thrust direction in world frame

    // Air-relative velocity (wind makes the airframe drift with the gust).
    var wx = wind ? (wind.x || 0) : 0;
    var wy = wind ? (wind.y || 0) : 0;
    var wz = wind ? (wind.z || 0) : 0;
    var rx = v.x - wx, ry = v.y - wy, rz = v.z - wz;
    var rmag = Math.sqrt(rx * rx + ry * ry + rz * rz);

    var ax = (T * _up.x - DRAG_H * rmag * rx) / MASS;
    var ay = (T * _up.y - DRAG_V * rmag * ry) / MASS - G;
    var az = (T * _up.z - DRAG_H * rmag * rz) / MASS;

    // semi-implicit Euler
    v.x += ax * h; v.y += ay * h; v.z += az * h;
    state.pos.x += v.x * h;
    state.pos.y += v.y * h;
    state.pos.z += v.z * h;

    /* --- ground contact --- */
    if (state.pos.y <= 0) {
      var impactV = v.y;      // velocity at touchdown (negative = descending)
      state.pos.y = 0;

      var tilt = totalTilt(e);
      if (state.armed && (impactV < CRASH_VSPEED || tilt > CRASH_TILT)) {
        // Hard landing or landing on the side/back: crash, motors cut.
        state.crashed = true;
        state.armed = false;
        state._motorOut = 0;
      }

      if (v.y < 0) v.y = 0;   // no bounce, ground absorbs it

      // Ground friction on horizontal velocity
      var f = Math.exp(-h * GROUND_FRICTION);
      v.x *= f; v.z *= f;

      // Sitting on the ground (low thrust): settle level & kill rotation,
      // unless crashed in acro etc. — keep it simple: level out when slow.
      if (state._motorOut * MAX_THRUST < MASS * G * 0.9) {
        var s = Math.exp(-h * 8);
        e.pitch *= s; e.roll *= s;
        w.pitch *= s; w.roll *= s;
        if (!flying) w.yaw *= s;
      }
    }

    /* --- battery --- */
    if (flying && state._motorOut > 0) {
      state.battery = Math.max(0, state.battery - state._motorOut * BATT_RATE * h);
    }
  }

  function totalTilt(e) {
    // angle between body-up and world-up
    var cp = Math.cos(e.pitch), cr = Math.cos(e.roll);
    return Math.acos(clamp(cr * cp, -1, 1));
  }

  /* --------------------------- derived fields ---------------------------- */

  function updateDerived(state, dt) {
    var v = state.vel, e = state.euler, w = state.angVel;

    state.altitude = state.pos.y;
    state.speed = Math.sqrt(v.x * v.x + v.z * v.z);
    state.verticalSpeed = v.y;
    state.tiltDeg = totalTilt(e) * 180 / Math.PI;

    // gForce: magnitude of proper acceleration (accel felt minus gravity)/g.
    // Approximate from velocity delta over the whole frame + gravity.
    var pax = (v.x - state._prevVel.x) / dt;
    var pay = (v.y - state._prevVel.y) / dt + G;
    var paz = (v.z - state._prevVel.z) / dt;
    state.gForce = Math.sqrt(pax * pax + pay * pay + paz * paz) / G;
    if (state.pos.y <= 0 && !state.armed) state.gForce = 1;
    state._prevVel.x = v.x; state._prevVel.y = v.y; state._prevVel.z = v.z;

    // Per-motor load mix — FL, FR, RL, RR.
    // Nose-down accel (pitch fwd) loads REAR motors; roll right loads LEFT;
    // yaw uses opposing prop torque (FL/RR spin one way, FR/RL the other).
    var base = state._motorOut;
    var m = state.motors;
    if (!state.armed || state.crashed) {
      m[0] = m[1] = m[2] = m[3] = 0;
      return;
    }
    // normalised control efforts (visual mix, not the actual torque solver)
    var pMix = clamp(-w.pitch / ACRO_MAX_RATE + (state.mode === 'angle' ? -e.pitch / MAX_TILT * 0.5 : 0), -1, 1) * 0.18;
    var rMix = clamp( w.roll  / ACRO_MAX_RATE + (state.mode === 'angle' ?  e.roll  / MAX_TILT * 0.5 : 0), -1, 1) * 0.18;
    var yMix = clamp( w.yaw   / MAX_YAW_RATE, -1, 1) * 0.10;
    var idle = 0.12; // props visibly idle-spin whenever armed
    // rolling right (rMix+) loads the LEFT motors; pitching nose-down
    // (pMix+) loads the REAR motors; yaw pairs FL/RR vs FR/RL.
    m[0] = clamp(base - pMix + rMix + yMix + idle, 0, 1); // FL
    m[1] = clamp(base - pMix - rMix - yMix + idle, 0, 1); // FR
    m[2] = clamp(base + pMix + rMix - yMix + idle, 0, 1); // RL
    m[3] = clamp(base + pMix - rMix + yMix + idle, 0, 1); // RR
  }

  /* ------------------------------- export -------------------------------- */

  window.DRONE.Physics = {
    create: create,
    step: step,
    reset: reset,
    setMode: setMode,
    // exposed tunables (read-only use recommended)
    constants: {
      MASS: MASS, G: G, TWR: TWR, MAX_THRUST: MAX_THRUST,
      MAX_TILT: MAX_TILT, ATT_TAU: ATT_TAU,
      MAX_YAW_RATE: MAX_YAW_RATE, ACRO_MAX_RATE: ACRO_MAX_RATE,
      MOTOR_TAU: MOTOR_TAU, DRAG_H: DRAG_H, DRAG_V: DRAG_V,
      CRASH_VSPEED: CRASH_VSPEED, CRASH_TILT: CRASH_TILT,
      BATT_RATE: BATT_RATE
    }
  };
})();
