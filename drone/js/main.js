/* ==========================================================================
 * main.js — boot, game loop, HUD  (integration layer)
 * --------------------------------------------------------------------------
 * Classic script, no modules. Load order: physics, world, render, controls,
 * then this file. Owns:
 *   - creating the single shared state/world objects
 *   - the requestAnimationFrame loop (World.update -> Physics.step -> Render.draw)
 *   - control button handlers (arm / reset / mode / camera)
 *   - the HUD (self-injected CSS, .dhud- scoped, pointer-events:none)
 *   - reconciling small data-shape differences between World and Render
 * ========================================================================== */
(function () {
  'use strict';

  var CAM_MODES = ['chase', 'orbit', 'fpv'];
  var CAM_LABEL = { chase: '追尾', orbit: '俯瞰', fpv: 'FPV' };
  // Throttle the sim auto-sets on ARM/START so the drone actually lifts off into a
  // gentle climb instead of sitting on the ground at zero throttle. Hover is ~0.45,
  // so this is just above it — the player then modulates with the left stick.
  var TAKEOFF_THROTTLE = 0.52;

  var state = null;
  var world = null;
  var camIdx = 0;
  var lastT = null;
  var gateFlashUntil = 0;
  var shownArmed = false;
  var hud = {}; // cached DOM refs

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ------------------------------------------------------------------ *
   * World data normalization — World produces {x,z,w,d,h} obstacles and
   * {x,z,type,scale} landmarks; Render expects size/height/radius/color.
   * Done ONCE at boot on the same objects (no copies — everyone keeps
   * reading the same world).
   * ------------------------------------------------------------------ */
  function normalizeWorld(w) {
    var i, o, l;
    if (w.obstacles) {
      for (i = 0; i < w.obstacles.length; i++) {
        o = w.obstacles[i];
        if (o.size || o.w == null) continue;
        if (o.w <= 2 && o.d <= 2) {
          // thin tall box -> render as a pole/tower
          o.type = 'pole';
          o.height = o.h;
          o.radius = Math.max(o.w, o.d) / 2;
        } else {
          o.type = 'box';
          o.size = { x: o.w, y: o.h, z: o.d };
        }
      }
    }
    if (w.landmarks) {
      for (i = 0; i < w.landmarks.length; i++) {
        l = w.landmarks[i];
        var s = l.scale || 1;
        if (l.type === 'tree') {
          l.height = 4.5 * s;
          l.color = '#2f7d3a';
        } else if (l.type === 'pad') {
          l.height = 0.3 * s;
          l.color = '#e8e8e8';
          if (l.x === 0 && l.z === 0) l.name = 'HOME';
        }
      }
    }
  }

  /* Gate colors reflect course progress every frame (Render honours g.color). */
  function updateGateColors() {
    var gs = world.gates;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i];
      g.color = g.passed ? '#4ade80' : (i === world.nextGate ? '#ffd24a' : '#f97316');
    }
  }

  /* ------------------------------------------------------------------ *
   * Course / full reset
   * ------------------------------------------------------------------ */
  function resetCourse() {
    world.nextGate = 0;
    world.justPassedGate = false;
    for (var i = 0; i < world.gates.length; i++) {
      world.gates[i].passed = false;
      world.gates[i]._prevAlong = undefined;
    }
  }

  function doReset() {
    DRONE.Physics.reset(state);   // back to spawn, disarmed (keeps mode)
    state.battery = 100;          // integration choice: reset = fresh pack
    resetCourse();
    DRONE.Controls.setArmed(false);
    if (DRONE.Controls.setThrottle) DRONE.Controls.setThrottle(0); // knob back to bottom
    shownArmed = false;
    gateFlashUntil = 0;
  }

  /* ------------------------------------------------------------------ *
   * HUD — scoped CSS injected once, DOM built once, values patched per frame
   * ------------------------------------------------------------------ */
  function injectHudStyle() {
    if (document.getElementById('dhud-style')) return;
    var css = '' +
      '.dhud-root{position:absolute;inset:0;pointer-events:none;z-index:30;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
        'user-select:none;-webkit-user-select:none;color:#eaf4ff;}' +
      '.dhud-bars{position:absolute;top:calc(6px + env(safe-area-inset-top,0px));left:50%;' +
        'transform:translateX(-50%);display:flex;flex-direction:column;gap:3px;align-items:center;}' +
      '.dhud-row{display:flex;gap:5px;}' +
      '.dhud-cell{background:rgba(8,14,22,0.55);border:1px solid rgba(140,200,255,0.22);' +
        'border-radius:8px;padding:2px 8px;min-width:52px;text-align:center;' +
        'backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);}' +
      '.dhud-lab{display:block;font-size:8px;letter-spacing:.14em;color:rgba(170,205,255,0.65);' +
        'text-transform:uppercase;white-space:nowrap;}' +
      '.dhud-val{display:block;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;' +
        'line-height:1.15;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.6);}' +
      '.dhud-val.dhud-warn{color:#ffd24a;}' +
      '.dhud-val.dhud-danger{color:#ff5a4a;}' +
      /* attitude indicator */
      '.dhud-adi{position:absolute;top:calc(70px + env(safe-area-inset-top,0px));left:50%;' +
        'transform:translateX(-50%);width:62px;height:62px;border-radius:50%;overflow:hidden;' +
        'border:2px solid rgba(200,230,255,0.55);box-shadow:0 2px 10px rgba(0,0,0,0.45);}' +
      '.dhud-adi-inner{position:absolute;left:50%;top:50%;width:200%;height:200%;' +
        'background:linear-gradient(180deg,#2f6fd1 0%,#7db2e8 49.2%,#f2f6fa 49.2%,#f2f6fa 50.8%,' +
        '#8a6a42 50.8%,#5c4326 100%);will-change:transform;}' +
      '.dhud-adi-ref{position:absolute;left:50%;top:50%;width:26px;height:2px;margin:-1px 0 0 -13px;' +
        'background:#ffd24a;border-radius:1px;box-shadow:0 0 4px rgba(0,0,0,0.7);}' +
      '.dhud-adi-dot{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;' +
        'border-radius:50%;background:#ffd24a;box-shadow:0 0 4px rgba(0,0,0,0.7);}' +
      /* banners */
      '.dhud-banner{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);' +
        'padding:10px 26px;border-radius:14px;font-weight:800;letter-spacing:.06em;' +
        'text-align:center;display:none;white-space:nowrap;}' +
      '.dhud-banner.dhud-show{display:block;}' +
      '.dhud-gate-banner{background:rgba(30,160,80,0.85);color:#eafff2;font-size:26px;' +
        'border:2px solid rgba(160,255,200,0.8);text-shadow:0 2px 6px rgba(0,0,0,0.4);' +
        'animation:dhud-pop .18s ease-out;}' +
      '.dhud-crash-banner{background:rgba(170,30,20,0.88);color:#ffecea;font-size:20px;' +
        'border:2px solid rgba(255,160,150,0.8);animation:dhud-blink 1s step-end infinite;}' +
      '@keyframes dhud-pop{0%{transform:translate(-50%,-50%) scale(0.6);}100%{transform:translate(-50%,-50%) scale(1);}}' +
      '@keyframes dhud-blink{0%,100%{opacity:1;}50%{opacity:0.55;}}' +
      '';
    var style = document.createElement('style');
    style.id = 'dhud-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function cell(labelText) {
    var c = document.createElement('div');
    c.className = 'dhud-cell';
    var lab = document.createElement('span');
    lab.className = 'dhud-lab';
    lab.textContent = labelText;
    var val = document.createElement('span');
    val.className = 'dhud-val';
    val.textContent = '—';
    c.appendChild(lab);
    c.appendChild(val);
    return { el: c, val: val };
  }

  function buildHud() {
    injectHudStyle();
    var root = document.createElement('div');
    root.className = 'dhud-root';

    var bars = document.createElement('div');
    bars.className = 'dhud-bars';

    var row1 = document.createElement('div');
    row1.className = 'dhud-row';
    hud.alt  = cell('高度 m');
    hud.spd  = cell('速度 km/h');
    hud.vs   = cell('昇降 m/s');
    hud.thr  = cell('出力 %');
    hud.bat  = cell('電池 %');
    row1.appendChild(hud.alt.el);
    row1.appendChild(hud.spd.el);
    row1.appendChild(hud.vs.el);
    row1.appendChild(hud.thr.el);
    row1.appendChild(hud.bat.el);

    var row2 = document.createElement('div');
    row2.className = 'dhud-row';
    hud.mode = cell('モード');
    hud.tilt = cell('傾き °');
    hud.gate = cell('ゲート');
    hud.lap  = cell('ラップ');
    hud.wind = cell('風 m/s');
    row2.appendChild(hud.mode.el);
    row2.appendChild(hud.tilt.el);
    row2.appendChild(hud.gate.el);
    row2.appendChild(hud.lap.el);
    row2.appendChild(hud.wind.el);

    bars.appendChild(row1);
    bars.appendChild(row2);
    root.appendChild(bars);

    // Attitude indicator (artificial horizon)
    var adi = document.createElement('div');
    adi.className = 'dhud-adi';
    hud.adiInner = document.createElement('div');
    hud.adiInner.className = 'dhud-adi-inner';
    var adiRef = document.createElement('div');
    adiRef.className = 'dhud-adi-ref';
    var adiDot = document.createElement('div');
    adiDot.className = 'dhud-adi-dot';
    adi.appendChild(hud.adiInner);
    adi.appendChild(adiRef);
    adi.appendChild(adiDot);
    root.appendChild(adi);

    // Banners
    hud.gateBanner = document.createElement('div');
    hud.gateBanner.className = 'dhud-banner dhud-gate-banner';
    hud.gateBanner.textContent = 'ゲート通過！';
    root.appendChild(hud.gateBanner);

    hud.crashBanner = document.createElement('div');
    hud.crashBanner.className = 'dhud-banner dhud-crash-banner';
    hud.crashBanner.textContent = 'クラッシュ！ — RESET を押してください';
    root.appendChild(hud.crashBanner);

    document.body.appendChild(root);
  }

  function setVal(c, text, cls) {
    if (c.val.textContent !== text) c.val.textContent = text;
    var want = 'dhud-val' + (cls ? ' ' + cls : '');
    if (c.val.className !== want) c.val.className = want;
  }

  function updateHUD(now) {
    setVal(hud.alt, state.altitude.toFixed(1));
    setVal(hud.spd, (state.speed * 3.6).toFixed(0));
    var vs = state.verticalSpeed;
    setVal(hud.vs, (vs >= 0 ? '+' : '') + vs.toFixed(1));
    setVal(hud.thr, String(Math.round(state.throttleCmd * 100)));

    var bat = Math.max(0, Math.round(state.battery));
    setVal(hud.bat, String(bat), bat <= 10 ? 'dhud-danger' : (bat <= 25 ? 'dhud-warn' : ''));

    setVal(hud.mode, state.mode === 'acro' ? 'ACRO' : 'ANGLE',
           state.mode === 'acro' ? 'dhud-warn' : '');
    var tilt = Math.round(state.tiltDeg);
    setVal(hud.tilt, String(tilt), tilt >= 45 ? 'dhud-warn' : '');

    var nGates = world.gates.length;
    var passedThisLap = (world.nextGate >= 0 && world.nextGate < nGates) ? world.nextGate : nGates;
    setVal(hud.gate, passedThisLap + '/' + nGates);
    setVal(hud.lap, world.lap + ' | ' + world.score + 'pt');

    var wmag = Math.sqrt(world.wind.x * world.wind.x + world.wind.y * world.wind.y +
                         world.wind.z * world.wind.z);
    setVal(hud.wind, wmag.toFixed(1), wmag > 5 ? 'dhud-warn' : '');

    // attitude indicator: roll right(+) -> horizon rotates CCW on screen;
    // pitch nose-up(+) -> horizon slides down.
    var rollDeg = state.euler.roll * 180 / Math.PI;
    var pitchDeg = state.euler.pitch * 180 / Math.PI;
    var pitchPx = clamp(pitchDeg * 0.9, -24, 24);
    hud.adiInner.style.transform =
      'translate(-50%,-50%) rotate(' + (-rollDeg).toFixed(1) + 'deg) translateY(' +
      pitchPx.toFixed(1) + 'px)';

    // banners
    if (world.justPassedGate) gateFlashUntil = now + 900;
    var showGate = now < gateFlashUntil && !state.crashed;
    hud.gateBanner.className = 'dhud-banner dhud-gate-banner' + (showGate ? ' dhud-show' : '');
    hud.crashBanner.className = 'dhud-banner dhud-crash-banner' + (state.crashed ? ' dhud-show' : '');
  }

  /* ------------------------------------------------------------------ *
   * Game loop
   * ------------------------------------------------------------------ */
  function frame(now) {
    window.requestAnimationFrame(frame);
    if (lastT == null) { lastT = now; return; }
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!(dt > 0)) return;
    if (dt > 0.05) dt = 0.05; // clamp tab-switch / hiccup spikes

    var input = DRONE.Controls.read();
    // Physics itself zeroes throttle/sticks while disarmed or crashed, so the
    // raw input can be passed straight through.
    DRONE.World.update(world, state, dt);
    DRONE.Physics.step(state, input, dt, world.wind);

    // Physics may disarm on its own (crash) — keep the ARM button in sync.
    if (state.armed !== shownArmed) {
      shownArmed = state.armed;
      DRONE.Controls.setArmed(shownArmed);
    }

    updateGateColors();
    DRONE.Render.draw(state, world, CAM_MODES[camIdx]);
    updateHUD(now);
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  function setArmedState(on) {
    if (state.crashed) return; // must RESET first
    if (on && state.battery <= 0) return;
    state.armed = !!on;
    shownArmed = state.armed;
    DRONE.Controls.setArmed(state.armed);
    // Auto-takeoff: when arming from the ground with throttle near zero, nudge the
    // throttle stick up so the drone lifts off instead of sitting there. If the
    // player already has the throttle raised, leave their input alone.
    if (state.armed && DRONE.Controls.setThrottle) {
      var input = DRONE.Controls.read();
      if (input.throttle < TAKEOFF_THROTTLE) DRONE.Controls.setThrottle(TAKEOFF_THROTTLE);
    }
  }

  function boot() {
    var canvas = document.getElementById('scene');
    var controlsEl = document.getElementById('controls');

    DRONE.Render.init(canvas);
    state = DRONE.Physics.create();
    world = DRONE.World.create();
    normalizeWorld(world);
    DRONE.Controls.init(controlsEl);

    /* --- control handlers --- */
    DRONE.Controls.on('arm', function () {
      setArmedState(!state.armed);
    });
    DRONE.Controls.on('reset', function () {
      doReset();
    });
    DRONE.Controls.on('mode', function () {
      DRONE.Physics.setMode(state, state.mode === 'angle' ? 'acro' : 'angle');
    });
    DRONE.Controls.on('camera', function () {
      camIdx = (camIdx + 1) % CAM_MODES.length;
      var camBtn = document.querySelector('.dctl-camera');
      if (camBtn) camBtn.textContent = CAM_LABEL[CAM_MODES[camIdx]];
    });

    /* --- HUD --- */
    buildHud();

    /* --- start overlay (markup lives in index.html) --- */
    var startOverlay = document.getElementById('start-overlay');
    var startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        if (startOverlay) startOverlay.style.display = 'none';
        setArmedState(true); // START arms the drone
      });
    }

    /* --- resize / rotate --- */
    function onResize() {
      DRONE.Render.resize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () {
      // size settles a moment after the rotate on most phones
      setTimeout(onResize, 250);
    });
    onResize();

    /* --- kill pinch-zoom / double-tap zoom / pull-to-refresh --- */
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
    document.body.addEventListener('touchmove', function (e) {
      if (e.target === document.body || e.target === canvas) e.preventDefault();
    }, { passive: false });

    window.requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
