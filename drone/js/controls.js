/* ==========================================================================
 * DRONE.Controls — Mode-2 touch transmitter UI
 * --------------------------------------------------------------------------
 * Classic script, no modules. Attaches to window.DRONE.Controls.
 * Optimised for a PHONE held in LANDSCAPE. Builds its own DOM + injects a
 * scoped <style> block (prefix ".dctl-"). No external assets, no CDN.
 *
 * MODE 2 layout:
 *   LEFT  stick horizontal = YAW      (-1..1, self-centres)
 *   LEFT  stick vertical   = THROTTLE ( 0..1, ABSOLUTE — does NOT self-centre)
 *   RIGHT stick horizontal = ROLL     (-1..1, self-centres)
 *   RIGHT stick vertical   = PITCH    (-1..1, self-centres)
 *
 * Public API:
 *   DRONE.Controls.init(container)   // builds touch UI inside container el
 *   DRONE.Controls.read()            -> {throttle, yaw, pitch, roll}
 *   DRONE.Controls.on(name, fn)      // names: 'arm','reset','mode','camera'
 *   DRONE.Controls.setArmed(bool)    // reflect armed state on the ARM button
 * ========================================================================== */
(function () {
  'use strict';
  window.DRONE = window.DRONE || {};

  var DEADZONE = 0.06;          // normalised deadzone near centre
  var CLASS_PREFIX = 'dctl-';

  /* ------------------------------------------------------------------ *
   * Internal state
   * ------------------------------------------------------------------ */
  var listeners = { arm: [], reset: [], mode: [], camera: [] };
  var armed = false;

  // Stick model: each stick tracks its own active pointerId so both
  // thumbs can drive left+right simultaneously without stealing input.
  var leftStick = null;
  var rightStick = null;

  // Current normalised axis values (persist across frames).
  var axes = {
    throttle: 0,   // 0..1, ABSOLUTE, holds on release
    yaw: 0,        // -1..1, self-centres
    pitch: 0,      // -1..1, self-centres
    roll: 0        // -1..1, self-centres
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function applyDeadzone(v) {
    if (Math.abs(v) < DEADZONE) return 0;
    // rescale so output still spans -1..1 (or 0..1) smoothly past the deadzone
    var s = v > 0 ? 1 : -1;
    return s * (Math.abs(v) - DEADZONE) / (1 - DEADZONE);
  }

  function fire(name) {
    var fns = listeners[name];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](); } catch (e) { /* swallow — one bad handler shouldn't kill input loop */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * Stick factory — builds a circular base + draggable knob, wires
   * Pointer Events with per-stick pointerId tracking (multi-touch safe).
   * ------------------------------------------------------------------ */
  function createStick(opts) {
    // opts: { base, knob, radius, selfCentreX, selfCentreY, onMove(nx, ny) }
    var stick = {
      pointerId: null,
      nx: 0,       // normalised horizontal -1..1
      ny: 0,       // normalised vertical   -1..1 (ny = +1 is UP)
      base: opts.base,
      knob: opts.knob,
      radius: opts.radius,
      selfCentreX: opts.selfCentreX,
      selfCentreY: opts.selfCentreY
    };

    function setKnobFromClient(clientX, clientY) {
      var rect = stick.base.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = clientX - cx;
      var dy = clientY - cy;
      var r = rect.width / 2;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) {
        var k = r / dist;
        dx *= k;
        dy *= k;
      }
      stick.nx = clamp(dx / r, -1, 1);
      stick.ny = clamp(-dy / r, -1, 1); // invert so up = +1
      stick.knob.style.transform = 'translate(-50%, -50%) translate(' + dx + 'px,' + dy + 'px)';
      if (opts.onMove) opts.onMove(stick.nx, stick.ny);
    }

    function resetKnobVisual() {
      var visX = stick.selfCentreX ? 0 : stick.nx;
      var visY = stick.selfCentreY ? 0 : stick.ny;
      var r = stick.base.getBoundingClientRect().width / 2;
      stick.knob.style.transform = 'translate(-50%, -50%) translate(' + (visX * r) + 'px,' + (visY * r) + 'px)';
    }

    function onPointerDown(ev) {
      if (stick.pointerId !== null) return; // stick already owned by another finger
      stick.pointerId = ev.pointerId;
      stick.base.classList.add(CLASS_PREFIX + 'active');
      try { stick.base.setPointerCapture(ev.pointerId); } catch (e) {}
      setKnobFromClient(ev.clientX, ev.clientY);
      ev.preventDefault();
    }

    function onPointerMove(ev) {
      if (ev.pointerId !== stick.pointerId) return;
      setKnobFromClient(ev.clientX, ev.clientY);
      ev.preventDefault();
    }

    function onPointerUp(ev) {
      if (ev.pointerId !== stick.pointerId) return;
      stick.pointerId = null;
      stick.base.classList.remove(CLASS_PREFIX + 'active');
      try { stick.base.releasePointerCapture(ev.pointerId); } catch (e) {}

      // Self-centring per-axis (Mode-2 left stick: yaw centres, throttle holds)
      if (stick.selfCentreX) stick.nx = 0;
      if (stick.selfCentreY) stick.ny = 0;
      resetKnobVisual();
      if (opts.onMove) opts.onMove(stick.nx, stick.ny);
      ev.preventDefault();
    }

    stick.base.addEventListener('pointerdown', onPointerDown, { passive: false });
    stick.base.addEventListener('pointermove', onPointerMove, { passive: false });
    stick.base.addEventListener('pointerup', onPointerUp, { passive: false });
    stick.base.addEventListener('pointercancel', onPointerUp, { passive: false });
    // Pointer may leave the base bounds while captured — still tracked via
    // setPointerCapture, so leaving the element does not drop the drag.

    return stick;
  }

  /* ------------------------------------------------------------------ *
   * CSS (scoped, injected once)
   * ------------------------------------------------------------------ */
  function injectStyle() {
    if (document.getElementById('dctl-style')) return;
    var css = '' +
      '.dctl-root{position:absolute;inset:0;overflow:hidden;touch-action:none;' +
        'user-select:none;-webkit-user-select:none;font-family:-apple-system,BlinkMacSystemFont,' +
        '"Segoe UI",Roboto,sans-serif;z-index:20;}' +
      '.dctl-root *{box-sizing:border-box;touch-action:none;}' +
      '.dctl-stick-zone{position:absolute;bottom:0;width:46%;height:78%;max-width:340px;}' +
      '.dctl-stick-zone.dctl-left{left:0;}' +
      '.dctl-stick-zone.dctl-right{right:0;}' +
      '.dctl-base{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);' +
        'width:min(34vw,220px);height:min(34vw,220px);border-radius:50%;' +
        'background:radial-gradient(circle at 50% 45%, rgba(255,255,255,0.06), rgba(10,14,20,0.55) 70%);' +
        'border:2px solid rgba(140,200,255,0.25);' +
        'box-shadow:inset 0 0 22px rgba(0,0,0,0.55), 0 0 18px rgba(0,0,0,0.35);' +
        'pointer-events:auto;}' +
      '.dctl-base.dctl-active{border-color:rgba(120,220,255,0.75);' +
        'box-shadow:inset 0 0 22px rgba(0,0,0,0.55), 0 0 26px rgba(80,200,255,0.45);}' +
      '.dctl-guide{position:absolute;background:rgba(160,210,255,0.18);pointer-events:none;}' +
      '.dctl-guide.dctl-h{left:8%;right:8%;top:50%;height:1px;transform:translateY(-50%);}' +
      '.dctl-guide.dctl-v{top:8%;bottom:8%;left:50%;width:1px;transform:translateX(-50%);}' +
      '.dctl-base.dctl-throttle .dctl-guide.dctl-h{display:none;}' +
      '.dctl-center-dot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;' +
        'border-radius:50%;background:rgba(160,210,255,0.35);pointer-events:none;}' +
      '.dctl-knob{position:absolute;left:50%;top:50%;width:38%;height:38%;border-radius:50%;' +
        'transform:translate(-50%,-50%);' +
        'background:linear-gradient(160deg, rgba(90,220,255,0.95), rgba(20,90,140,0.9));' +
        'border:2px solid rgba(220,250,255,0.85);' +
        'box-shadow:0 4px 14px rgba(0,0,0,0.5), inset 0 0 10px rgba(255,255,255,0.25);' +
        'pointer-events:none;}' +
      '.dctl-label{position:absolute;bottom:2%;left:50%;transform:translateX(-50%);' +
        'font-size:11px;letter-spacing:.12em;color:rgba(190,220,255,0.55);pointer-events:none;' +
        'text-transform:uppercase;}' +
      '.dctl-topbar{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between;' +
        'padding:8px 10px;pointer-events:none;}' +
      '.dctl-btn-group{display:flex;gap:8px;pointer-events:auto;}' +
      '.dctl-btn{appearance:none;border:1px solid rgba(150,200,255,0.35);border-radius:10px;' +
        'background:linear-gradient(180deg, rgba(30,38,50,0.85), rgba(14,18,26,0.9));' +
        'color:#cfe6ff;font-size:12px;font-weight:600;letter-spacing:.06em;' +
        'padding:9px 14px;min-width:64px;text-transform:uppercase;' +
        'box-shadow:0 3px 10px rgba(0,0,0,0.4);' +
        'text-align:center;-webkit-tap-highlight-color:transparent;}' +
      '.dctl-btn:active{transform:translateY(1px) scale(0.97);}' +
      '.dctl-btn.dctl-arm{border-color:rgba(120,255,160,0.4);}' +
      '.dctl-btn.dctl-arm.dctl-armed{background:linear-gradient(180deg, rgba(60,220,120,0.95), rgba(20,120,60,0.95));' +
        'color:#04180a;border-color:rgba(180,255,200,0.9);' +
        'box-shadow:0 0 16px rgba(80,255,140,0.55), 0 3px 10px rgba(0,0,0,0.4);}' +
      '.dctl-btn.dctl-mode{min-width:78px;}' +
      '.dctl-readout{position:absolute;top:6px;left:50%;transform:translateX(-50%);' +
        'font-size:10px;color:rgba(180,210,255,0.4);letter-spacing:.08em;pointer-events:none;' +
        'white-space:nowrap;text-transform:uppercase;}' +
      '';
    var style = document.createElement('style');
    style.id = 'dctl-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ *
   * Button factory
   * ------------------------------------------------------------------ */
  function makeButton(label, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CLASS_PREFIX + 'btn' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = label;
    return btn;
  }

  /* ------------------------------------------------------------------ *
   * init(container)
   * ------------------------------------------------------------------ */
  function init(container) {
    if (!container) throw new Error('DRONE.Controls.init requires a container element');
    injectStyle();

    var root = document.createElement('div');
    root.className = CLASS_PREFIX + 'root';

    /* ---- Left stick zone: THROTTLE (vertical, absolute) + YAW (horiz, centring) ---- */
    var leftZone = document.createElement('div');
    leftZone.className = CLASS_PREFIX + 'stick-zone ' + CLASS_PREFIX + 'left';

    var leftBase = document.createElement('div');
    leftBase.className = CLASS_PREFIX + 'base ' + CLASS_PREFIX + 'throttle';
    var leftGuideH = document.createElement('div');
    leftGuideH.className = CLASS_PREFIX + 'guide ' + CLASS_PREFIX + 'h';
    var leftGuideV = document.createElement('div');
    leftGuideV.className = CLASS_PREFIX + 'guide ' + CLASS_PREFIX + 'v';
    var leftDot = document.createElement('div');
    leftDot.className = CLASS_PREFIX + 'center-dot';
    var leftKnob = document.createElement('div');
    leftKnob.className = CLASS_PREFIX + 'knob';
    leftBase.appendChild(leftGuideH);
    leftBase.appendChild(leftGuideV);
    leftBase.appendChild(leftDot);
    leftBase.appendChild(leftKnob);

    var leftLabel = document.createElement('div');
    leftLabel.className = CLASS_PREFIX + 'label';
    leftLabel.textContent = 'Throttle / Yaw';

    leftZone.appendChild(leftBase);
    leftZone.appendChild(leftLabel);

    /* ---- Right stick zone: PITCH (vertical, centring) + ROLL (horiz, centring) ---- */
    var rightZone = document.createElement('div');
    rightZone.className = CLASS_PREFIX + 'stick-zone ' + CLASS_PREFIX + 'right';

    var rightBase = document.createElement('div');
    rightBase.className = CLASS_PREFIX + 'base';
    var rightGuideH = document.createElement('div');
    rightGuideH.className = CLASS_PREFIX + 'guide ' + CLASS_PREFIX + 'h';
    var rightGuideV = document.createElement('div');
    rightGuideV.className = CLASS_PREFIX + 'guide ' + CLASS_PREFIX + 'v';
    var rightDot = document.createElement('div');
    rightDot.className = CLASS_PREFIX + 'center-dot';
    var rightKnob = document.createElement('div');
    rightKnob.className = CLASS_PREFIX + 'knob';
    rightBase.appendChild(rightGuideH);
    rightBase.appendChild(rightGuideV);
    rightBase.appendChild(rightDot);
    rightBase.appendChild(rightKnob);

    var rightLabel = document.createElement('div');
    rightLabel.className = CLASS_PREFIX + 'label';
    rightLabel.textContent = 'Pitch / Roll';

    rightZone.appendChild(rightBase);
    rightZone.appendChild(rightLabel);

    /* ---- Top bar: ARM (left), MODE + CAMERA + RESET (right) ---- */
    var topbar = document.createElement('div');
    topbar.className = CLASS_PREFIX + 'topbar';

    var leftGroup = document.createElement('div');
    leftGroup.className = CLASS_PREFIX + 'btn-group';
    var armBtn = makeButton('Arm', CLASS_PREFIX + 'arm');
    leftGroup.appendChild(armBtn);

    var rightGroup = document.createElement('div');
    rightGroup.className = CLASS_PREFIX + 'btn-group';
    var modeBtn = makeButton('Angle', CLASS_PREFIX + 'mode');
    var camBtn = makeButton('Cam', CLASS_PREFIX + 'camera');
    var resetBtn = makeButton('Reset', CLASS_PREFIX + 'reset');
    rightGroup.appendChild(modeBtn);
    rightGroup.appendChild(camBtn);
    rightGroup.appendChild(resetBtn);

    topbar.appendChild(leftGroup);
    topbar.appendChild(rightGroup);

    var readout = document.createElement('div');
    readout.className = CLASS_PREFIX + 'readout';
    readout.id = 'dctl-readout';

    root.appendChild(leftZone);
    root.appendChild(rightZone);
    root.appendChild(topbar);
    root.appendChild(readout);
    container.appendChild(root);

    // Prevent scroll/zoom/callout on the whole control surface.
    root.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
    root.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    root.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    root.style.webkitTouchCallout = 'none';

    /* ---- Wire up sticks ---- */
    leftStick = createStick({
      base: leftBase,
      knob: leftKnob,
      selfCentreX: true,   // yaw self-centres
      selfCentreY: false,  // throttle holds position
      onMove: function (nx, ny) {
        var y = applyDeadzone(nx);
        axes.yaw = clamp(y, -1, 1);
        // throttle: vertical -1..1 -> 0..1, absolute, no deadzone (full range needed)
        axes.throttle = clamp((ny + 1) / 2, 0, 1);
      }
    });
    // Throttle starts at 0 (bottom) on spawn — place knob there visually.
    leftKnob.style.transform = 'translate(-50%, -50%) translate(0px,' + (leftBase.clientWidth / 2) + 'px)';

    rightStick = createStick({
      base: rightBase,
      knob: rightKnob,
      selfCentreX: true,   // roll self-centres
      selfCentreY: true,   // pitch self-centres
      onMove: function (nx, ny) {
        axes.roll = clamp(applyDeadzone(nx), -1, 1);
        axes.pitch = clamp(applyDeadzone(ny), -1, 1);
      }
    });

    /* ---- Wire up buttons ---- */
    armBtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      fire('arm');
    }, { passive: false });

    resetBtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      fire('reset');
    }, { passive: false });

    modeBtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      modeBtn.textContent = modeBtn.textContent === 'Angle' ? 'Acro' : 'Angle';
      fire('mode');
    }, { passive: false });

    camBtn.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      fire('camera');
    }, { passive: false });
  }

  /* ------------------------------------------------------------------ *
   * read() -> input object consumed by DRONE.Physics.step
   * ------------------------------------------------------------------ */
  function read() {
    return {
      throttle: axes.throttle,
      yaw: axes.yaw,
      pitch: axes.pitch,
      roll: axes.roll
    };
  }

  /* ------------------------------------------------------------------ *
   * on(name, fn) — register a callback for 'arm'|'reset'|'mode'|'camera'
   * ------------------------------------------------------------------ */
  function on(name, fn) {
    if (!listeners[name]) listeners[name] = [];
    listeners[name].push(fn);
  }

  /* ------------------------------------------------------------------ *
   * setArmed(bool) — reflect armed state on the ARM button
   * ------------------------------------------------------------------ */
  function setArmed(bool) {
    armed = !!bool;
    var armBtn = document.querySelector('.' + CLASS_PREFIX + 'arm');
    if (!armBtn) return;
    if (armed) {
      armBtn.classList.add(CLASS_PREFIX + 'armed');
      armBtn.textContent = 'Disarm';
    } else {
      armBtn.classList.remove(CLASS_PREFIX + 'armed');
      armBtn.textContent = 'Arm';
    }
  }

  window.DRONE.Controls = {
    init: init,
    read: read,
    on: on,
    setArmed: setArmed
  };
})();
