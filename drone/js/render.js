/* ==========================================================================
 * DRONE.Render — pure 2D-canvas 3D renderer (hand-rolled projection)
 * --------------------------------------------------------------------------
 * Classic script, no modules. Attaches to window.DRONE.Render.
 *
 * Coordinate system (shared contract): right-handed, y = UP (m),
 * x = right, z = forward (north). euler.yaw about +y, euler.pitch about +x
 * (nose up = +), euler.roll about +z (right-down = +). Ground at y = 0.
 *
 * Rotation convention matches DRONE.Physics exactly:
 *   world = Ry(yaw) * Rx(-pitch) * Rz(-roll) * local
 * (see physics.js bodyUpWorld() for the derivation this mirrors).
 *
 * Public API:
 *   DRONE.Render.init(canvas)
 *   DRONE.Render.draw(state, world, camMode)   // camMode: 'chase'|'fpv'|'orbit'
 *   DRONE.Render.resize(w, h)
 * ========================================================================== */
(function () {
  'use strict';
  window.DRONE = window.DRONE || {};

  /* ------------------------------ constants ------------------------------- */
  var NEAR        = 0.08;                 // camera-space near clip (m)
  var FOV_Y       = 62 * Math.PI / 180;   // vertical field of view
  var MAX_FOG_DIST = 260;                 // grid/objects fade out past this (m)
  var GRID_STEP   = 8;                    // grid line spacing (m)
  var GRID_HALF_DEFAULT = 120;            // half-extent of scrolling grid (m)

  var SKY_TOP     = '#2f6fd1';
  var SKY_HORIZON = '#cfe6ee';
  var GROUND_NEAR = '#3a6b3d';
  var GROUND_FAR  = '#a9c2a5';

  var WORLD_UP = { x: 0, y: 1, z: 0 };

  /* Drone geometry (meters, body-local frame: x=right,y=up,z=forward) */
  var BODY_HALF   = { x: 0.085, y: 0.032, z: 0.125 };
  var ARM_K       = 0.20 * Math.SQRT1_2;  // motor offset from center per axis
  var ARM_Y       = 0.015;
  var MOTOR_R     = 0.028;
  var PROP_R      = 0.135;
  var MOTOR_LOCAL = [ // FL, FR, RL, RR
    { x: -ARM_K, y: ARM_Y, z:  ARM_K },
    { x:  ARM_K, y: ARM_Y, z:  ARM_K },
    { x: -ARM_K, y: ARM_Y, z: -ARM_K },
    { x:  ARM_K, y: ARM_Y, z: -ARM_K }
  ];

  var FRONT_ARM_COLOR = '#e8443a';
  var REAR_ARM_COLOR  = '#3a4148';
  var BODY_COLOR      = '#22262b';
  var BODY_COLOR_CRASH = '#8a2020';
  var MOTOR_COLOR     = '#111316';
  var PROP_COLOR      = '#d8dee3';

  /* -------------------------------- state --------------------------------- */
  var canvas = null, ctx = null;
  var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, FOCAL = 1;
  var lastTime = null;

  var cam = {
    pos: { x: 0, y: 3, z: -7 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    forward: { x: 0, y: 0, z: 1 }
  };
  var chaseCamPos = { x: 0, y: 3, z: -7 };
  var chaseLookAt = { x: 0, y: 1, z: 0 };
  var orbitCamPos = { x: 8, y: 6, z: 0 };
  var orbitAngle = 0;
  var camInitialized = false;

  var propAngle = [0, 0, 0, 0];
  var sparkSeed = 0;

  /* ------------------------------ math utils ------------------------------ */
  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function length(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function normalize(a) {
    var l = length(a);
    if (l < 1e-6) return { x: 0, y: 0, z: 1 };
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Exact same rotation physics.js applies: world = Ry(yaw)*Rx(-pitch)*Rz(-roll)*local
  function rotateBodyLocal(local, e, out) {
    var cy = Math.cos(e.yaw),   sy = Math.sin(e.yaw);
    var cp = Math.cos(e.pitch), sp = Math.sin(e.pitch);
    var cr = Math.cos(e.roll),  sr = Math.sin(e.roll);
    var x1 = local.x * cr + local.y * sr;
    var y1 = -local.x * sr + local.y * cr;
    var z1 = local.z;
    var x2 = x1;
    var y2 = y1 * cp + z1 * sp;
    var z2 = -y1 * sp + z1 * cp;
    var x3 = x2 * cy + z2 * sy;
    var y3 = y2;
    var z3 = -x2 * sy + z2 * cy;
    out.x = x3; out.y = y3; out.z = z3;
    return out;
  }
  var _bx = { x: 0, y: 0, z: 0 }, _by = { x: 0, y: 0, z: 0 }, _bz = { x: 0, y: 0, z: 0 };
  function bodyAxes(e) {
    rotateBodyLocal({ x: 1, y: 0, z: 0 }, e, _bx);
    rotateBodyLocal({ x: 0, y: 1, z: 0 }, e, _by);
    rotateBodyLocal({ x: 0, y: 0, z: 1 }, e, _bz);
    return { right: _bx, up: _by, forward: _bz };
  }
  function localToWorld(local, origin, basis, out) {
    out.x = origin.x + basis.right.x * local.x + basis.up.x * local.y + basis.forward.x * local.z;
    out.y = origin.y + basis.right.y * local.x + basis.up.y * local.y + basis.forward.y * local.z;
    out.z = origin.z + basis.right.z * local.x + basis.up.z * local.y + basis.forward.z * local.z;
    return out;
  }

  /* ------------------------------- camera ---------------------------------- */
  function buildCamera(pos, target, upHint) {
    var fwd = normalize(sub(target, pos));
    var right = normalize(cross(upHint, fwd));
    if (length(right) < 1e-4) right = { x: 1, y: 0, z: 0 };
    var up = normalize(cross(fwd, right));
    cam.pos.x = pos.x; cam.pos.y = pos.y; cam.pos.z = pos.z;
    cam.forward.x = fwd.x; cam.forward.y = fwd.y; cam.forward.z = fwd.z;
    cam.right.x = right.x; cam.right.y = right.y; cam.right.z = right.z;
    cam.up.x = up.x; cam.up.y = up.y; cam.up.z = up.z;
  }

  function updateCamera(state, world, camMode, dt) {
    var p = state.pos, e = state.euler;
    var basis = bodyAxes(e);

    if (camMode === 'fpv') {
      var nosePos = localToWorld({ x: 0, y: 0.02, z: 0.14 }, p, basis, { x: 0, y: 0, z: 0 });
      var target = { x: nosePos.x + basis.forward.x * 10, y: nosePos.y + basis.forward.y * 10, z: nosePos.z + basis.forward.z * 10 };
      buildCamera(nosePos, target, basis.up);
      chaseCamPos.x = nosePos.x; chaseCamPos.y = nosePos.y; chaseCamPos.z = nosePos.z;
    } else if (camMode === 'orbit') {
      orbitAngle += dt * 0.12;
      var dist = 9, height = 4.2 + clamp(p.y * 0.25, 0, 5);
      var idealX = p.x + Math.sin(orbitAngle) * dist;
      var idealZ = p.z + Math.cos(orbitAngle) * dist;
      var idealY = p.y + height;
      if (!camInitialized) { orbitCamPos.x = idealX; orbitCamPos.y = idealY; orbitCamPos.z = idealZ; }
      var k = 1 - Math.exp(-dt * 1.6);
      orbitCamPos.x = lerp(orbitCamPos.x, idealX, k);
      orbitCamPos.y = lerp(orbitCamPos.y, idealY, k);
      orbitCamPos.z = lerp(orbitCamPos.z, idealZ, k);
      var lookAt = { x: p.x, y: p.y + 0.3, z: p.z };
      buildCamera(orbitCamPos, lookAt, WORLD_UP);
    } else { // 'chase' (default)
      var yaw = e.yaw;
      var behind = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }; // nose direction (flat)
      var chaseDist = 6.2, chaseHeight = 2.3;
      var idealPos = {
        x: p.x - behind.x * chaseDist,
        y: p.y + chaseHeight,
        z: p.z - behind.z * chaseDist
      };
      if (idealPos.y < 0.6) idealPos.y = 0.6;
      var idealLook = { x: p.x, y: p.y + 0.35, z: p.z };
      if (!camInitialized) {
        chaseCamPos.x = idealPos.x; chaseCamPos.y = idealPos.y; chaseCamPos.z = idealPos.z;
        chaseLookAt.x = idealLook.x; chaseLookAt.y = idealLook.y; chaseLookAt.z = idealLook.z;
      }
      var kp = 1 - Math.exp(-dt * 3.2);
      var kl = 1 - Math.exp(-dt * 5.5);
      chaseCamPos.x = lerp(chaseCamPos.x, idealPos.x, kp);
      chaseCamPos.y = lerp(chaseCamPos.y, idealPos.y, kp);
      chaseCamPos.z = lerp(chaseCamPos.z, idealPos.z, kp);
      chaseLookAt.x = lerp(chaseLookAt.x, idealLook.x, kl);
      chaseLookAt.y = lerp(chaseLookAt.y, idealLook.y, kl);
      chaseLookAt.z = lerp(chaseLookAt.z, idealLook.z, kl);
      buildCamera(chaseCamPos, chaseLookAt, WORLD_UP);
    }
    camInitialized = true;
    return basis;
  }

  function camSpace(p, out) {
    var rx = p.x - cam.pos.x, ry = p.y - cam.pos.y, rz = p.z - cam.pos.z;
    out.x = rx * cam.right.x + ry * cam.right.y + rz * cam.right.z;
    out.y = rx * cam.up.x + ry * cam.up.y + rz * cam.up.z;
    out.z = rx * cam.forward.x + ry * cam.forward.y + rz * cam.forward.z;
    return out;
  }
  var _cs = { x: 0, y: 0, z: 0 };
  function projectPoint(p, out) {
    camSpace(p, _cs);
    if (_cs.z < NEAR) return null;
    var scale = FOCAL / _cs.z;
    out.x = CX + _cs.x * scale;
    out.y = CY - _cs.y * scale;
    out.scale = scale;
    out.depth = _cs.z;
    return out;
  }

  /* --------------------------- job pool (painter's algo) ------------------- */
  var jobs = [];
  var jobCount = 0;
  var order = [];

  function ensureJob(i) {
    var j = jobs[i];
    if (!j) {
      j = { kind: 'line', depth: 0, color: '#fff', alpha: 1, lw: 1, dashed: false,
            ax: 0, ay: 0, bx: 0, by: 0, r: 0, poly: [], polyLen: 0, fill: true,
            text: '', tx: 0, ty: 0, font: '' };
      jobs[i] = j;
    }
    return j;
  }
  function nextJob() { return ensureJob(jobCount++); }
  function polyPt(j, idx, x, y) {
    var p = j.poly[idx];
    if (!p) { p = { x: 0, y: 0 }; j.poly[idx] = p; }
    p.x = x; p.y = y;
  }

  var _pa = { x: 0, y: 0, z: 0, scale: 0, depth: 0 };
  var _pb = { x: 0, y: 0, z: 0, scale: 0, depth: 0 };
  var _wa = { x: 0, y: 0, z: 0 };
  var _wb = { x: 0, y: 0, z: 0 };

  // Clip a world-space segment to the near plane (camera space). Returns
  // false if fully behind. Writes clipped world points into _wa/_wb.
  function clipNear(p1, p2) {
    var z1 = dot(sub(p1, cam.pos), cam.forward);
    var z2 = dot(sub(p2, cam.pos), cam.forward);
    if (z1 < NEAR && z2 < NEAR) return false;
    _wa.x = p1.x; _wa.y = p1.y; _wa.z = p1.z;
    _wb.x = p2.x; _wb.y = p2.y; _wb.z = p2.z;
    if (z1 < NEAR) {
      var t = (NEAR - z1) / (z2 - z1);
      _wa.x = p1.x + (p2.x - p1.x) * t;
      _wa.y = p1.y + (p2.y - p1.y) * t;
      _wa.z = p1.z + (p2.z - p1.z) * t;
    } else if (z2 < NEAR) {
      var t2 = (NEAR - z2) / (z1 - z2);
      _wb.x = p2.x + (p1.x - p2.x) * t2;
      _wb.y = p2.y + (p1.y - p2.y) * t2;
      _wb.z = p2.z + (p1.z - p2.z) * t2;
    }
    return true;
  }

  function fogAlpha(depth, base) {
    var f = 1 - clamp(depth / MAX_FOG_DIST, 0, 1);
    return base * f;
  }

  function pushLine(p1, p2, color, widthM, alpha, dashed) {
    if (!clipNear(p1, p2)) return;
    var a = projectPoint(_wa, _pa);
    if (!a) return;
    var scaleA = _pa.scale, ax = _pa.x, ay = _pa.y, depthA = _pa.depth;
    var b = projectPoint(_wb, _pb);
    if (!b) return;
    var j = nextJob();
    j.kind = 'line';
    j.depth = (depthA + _pb.depth) * 0.5;
    j.color = color;
    j.alpha = fogAlpha(j.depth, alpha);
    j.lw = clamp(widthM * (scaleA + _pb.scale) * 0.5, 1, 60);
    j.dashed = !!dashed;
    j.ax = ax; j.ay = ay; j.bx = _pb.x; j.by = _pb.y;
  }

  function pushDot(p, radiusM, color, alpha) {
    var cs = { x: 0, y: 0, z: 0 };
    camSpace(p, cs);
    if (cs.z < NEAR) return;
    var pr = projectPoint(p, _pa);
    if (!pr) return;
    var j = nextJob();
    j.kind = 'dot';
    j.depth = _pa.depth;
    j.color = color;
    j.alpha = fogAlpha(j.depth, alpha);
    j.r = clamp(radiusM * _pa.scale, 1, 400);
    j.ax = _pa.x; j.ay = _pa.y;
  }

  // Oriented box (arbitrary right/up/forward basis), drawn as its visible
  // (camera-facing) faces only, each a separate depth-sorted poly job.
  var BOX_CORNER_SIGN = [
    [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
    [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]
  ];
  var BOX_FACES = [
    [0, 1, 5, 4], // bottom (y-)
    [2, 6, 7, 3], // top (y+)
    [0, 2, 3, 1], // left (x-)
    [4, 5, 7, 6], // right (x+)
    [0, 4, 6, 2], // back (z-)
    [1, 3, 7, 5]  // front (z+)
  ];
  var _corners = [];
  for (var _ci = 0; _ci < 8; _ci++) _corners.push({ x: 0, y: 0, z: 0 });
  var LIGHT_DIR = normalize({ x: -0.4, y: 1, z: -0.35 });

  function pushOrientedBox(center, half, basis, color, alpha) {
    var i, c;
    for (i = 0; i < 8; i++) {
      var s = BOX_CORNER_SIGN[i];
      c = _corners[i];
      c.x = center.x + basis.right.x * s[0] * half.x + basis.up.x * s[1] * half.y + basis.forward.x * s[2] * half.z;
      c.y = center.y + basis.right.y * s[0] * half.x + basis.up.y * s[1] * half.y + basis.forward.y * s[2] * half.z;
      c.z = center.z + basis.right.z * s[0] * half.x + basis.up.z * s[1] * half.y + basis.forward.z * s[2] * half.z;
    }
    for (var f = 0; f < 6; f++) {
      var idx = BOX_FACES[f];
      var c0 = _corners[idx[0]], c1 = _corners[idx[1]], c2 = _corners[idx[2]], c3 = _corners[idx[3]];
      // all 4 corners must be in front of the near plane to keep this simple
      var z0 = dot(sub(c0, cam.pos), cam.forward);
      var z1 = dot(sub(c1, cam.pos), cam.forward);
      var z2 = dot(sub(c2, cam.pos), cam.forward);
      var z3 = dot(sub(c3, cam.pos), cam.forward);
      if (z0 < NEAR || z1 < NEAR || z2 < NEAR || z3 < NEAR) continue;
      var fcx = (c0.x + c1.x + c2.x + c3.x) * 0.25;
      var fcy = (c0.y + c1.y + c2.y + c3.y) * 0.25;
      var fcz = (c0.z + c1.z + c2.z + c3.z) * 0.25;
      var e1x = c1.x - c0.x, e1y = c1.y - c0.y, e1z = c1.z - c0.z;
      var e2x = c2.x - c0.x, e2y = c2.y - c0.y, e2z = c2.z - c0.z;
      // Note: for this corner winding, e1 x e2 points INWARD (verified against
      // BOX_CORNER_SIGN/BOX_FACES), so negate to get the true outward normal.
      var nx = -(e1y * e2z - e1z * e2y), ny = -(e1z * e2x - e1x * e2z), nz = -(e1x * e2y - e1y * e2x);
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      var toCam = { x: cam.pos.x - fcx, y: cam.pos.y - fcy, z: cam.pos.z - fcz };
      if (nx * toCam.x + ny * toCam.y + nz * toCam.z <= 0) continue; // back-facing
      var p0 = projectPoint(c0, _pa); if (!p0) continue;
      var x0 = _pa.x, y0 = _pa.y, dep = _pa.depth;
      var p1 = projectPoint(c1, _pa); if (!p1) continue;
      var x1 = _pa.x, y1 = _pa.y; dep += _pa.depth;
      var p2 = projectPoint(c2, _pa); if (!p2) continue;
      var x2 = _pa.x, y2 = _pa.y; dep += _pa.depth;
      var p3 = projectPoint(c3, _pa); if (!p3) continue;
      var x3 = _pa.x, y3 = _pa.y; dep += _pa.depth;
      dep *= 0.25;
      var shade = clamp(nx * LIGHT_DIR.x + ny * LIGHT_DIR.y + nz * LIGHT_DIR.z, -1, 1) * 0.5 + 0.5;
      shade = 0.35 + shade * 0.75;
      var j = nextJob();
      j.kind = 'poly';
      j.depth = dep;
      j.color = shadeColor(color, shade);
      j.alpha = fogAlpha(dep, alpha);
      j.fill = true;
      j.polyLen = 4;
      polyPt(j, 0, x0, y0); polyPt(j, 1, x1, y1); polyPt(j, 2, x2, y2); polyPt(j, 3, x3, y3);
    }
  }

  function pushPoly(pts, color, alpha, fill, lw, depthOverride) {
    var n = pts.length, i, avgDepth = 0, ok = true, sx = [], sy = [];
    for (i = 0; i < n; i++) {
      var pr = projectPoint(pts[i], _pa);
      if (!pr) { ok = false; break; }
      sx.push(_pa.x); sy.push(_pa.y); avgDepth += _pa.depth;
    }
    if (!ok) return;
    avgDepth /= n;
    var j = nextJob();
    j.kind = 'poly';
    j.depth = depthOverride != null ? depthOverride : avgDepth;
    j.color = color;
    j.alpha = fogAlpha(j.depth, alpha);
    j.fill = fill;
    j.lw = lw || 1;
    j.polyLen = n;
    for (i = 0; i < n; i++) polyPt(j, i, sx[i], sy[i]);
  }

  var HEX6_RE = /^#[0-9a-fA-F]{6}$/;
  function shadeColor(hex, mul) {
    if (typeof hex !== 'string' || !HEX6_RE.test(hex)) return hex; // defensive: unknown color format, skip shading
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    r = clamp(Math.round(r * mul), 0, 255);
    g = clamp(Math.round(g * mul), 0, 255);
    b = clamp(Math.round(b * mul), 0, 255);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------------------------- world helpers ------------------------------ */
  function getPos(o) {
    if (o.pos) return o.pos;
    if (o.position) return o.position;
    return { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
  }
  function getYaw(o) { return o.yaw != null ? o.yaw : (o.heading != null ? o.heading : 0); }

  function yawBasis(yaw) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    return {
      right: { x: c, y: 0, z: -s },
      up: WORLD_UP,
      forward: { x: s, y: 0, z: c }
    };
  }

  function addObstacle(o) {
    var p = getPos(o);
    var type = o.type || 'box';
    if (type === 'pole' || type === 'pylon' || type === 'tree') {
      var height = o.height != null ? o.height : (o.size ? o.size.y : 3.2);
      var radius = o.radius != null ? o.radius : (o.size ? o.size.x * 0.5 : 0.16);
      var color = o.color || '#9a6b3a';
      var base = { x: p.x, y: p.y || 0, z: p.z };
      var top = { x: p.x, y: (p.y || 0) + height, z: p.z };
      pushLine(base, top, color, radius * 2, 0.95, false);
      pushDot(top, radius * 1.4, o.capColor || color, 0.95);
    } else {
      var half = o.size ? { x: o.size.x * 0.5, y: o.size.y * 0.5, z: o.size.z * 0.5 } : { x: 0.6, y: 0.6, z: 0.6 };
      var baseY = p.y || 0;
      var center = { x: p.x, y: baseY + half.y, z: p.z };
      pushOrientedBox(center, half, yawBasis(getYaw(o)), o.color || '#7c8591', 0.95);
    }
  }

  function addGate(g) {
    var p = getPos(g);
    var yaw = getYaw(g);
    var w = g.width != null ? g.width : (g.radius != null ? g.radius * 2 : 2.6);
    var h = g.height != null ? g.height : (g.radius != null ? g.radius * 2 : 2.6);
    var color = g.color || (g.passed ? '#4ade80' : '#f97316');
    var right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    var baseY = p.y != null ? p.y : h / 2;
    function pt(u, v) { return { x: p.x + right.x * u, y: baseY + v, z: p.z + right.z * u }; }
    if (g.shape === 'ring' || (g.radius != null && g.shape !== 'square')) {
      var segs = 16, rx = w / 2, ry = h / 2, prev = null;
      for (var i = 0; i <= segs; i++) {
        var a = (i / segs) * Math.PI * 2;
        var cur = pt(Math.cos(a) * rx, Math.sin(a) * ry);
        if (prev) pushLine(prev, cur, color, 0.11, 1, false);
        prev = cur;
      }
    } else {
      var hw = w / 2, hh = h / 2;
      var c0 = pt(-hw, -hh), c1 = pt(hw, -hh), c2 = pt(hw, hh), c3 = pt(-hw, hh);
      pushLine(c0, c1, color, 0.12, 1, false);
      pushLine(c1, c2, color, 0.12, 1, false);
      pushLine(c2, c3, color, 0.12, 1, false);
      pushLine(c3, c0, color, 0.12, 1, false);
    }
  }

  function addLandmark(l) {
    var p = getPos(l);
    var color = l.color || '#c9a227';
    var baseY = p.y || 0;
    var height = l.height != null ? l.height : 1.6;
    var top = { x: p.x, y: baseY + height, z: p.z };
    pushLine({ x: p.x, y: baseY, z: p.z }, top, color, 0.1, 0.9, false);
    pushDot(top, 0.22, color, 0.95);
    if (l.name || l.label) {
      var pr = projectPoint(top, _pa);
      if (pr) {
        var j = nextJob();
        j.kind = 'text';
        j.depth = _pa.depth;
        j.color = '#ffffff';
        j.alpha = fogAlpha(j.depth, 0.85);
        j.tx = _pa.x; j.ty = _pa.y - 12;
        j.text = l.name || l.label;
        j.font = clamp(13 * _pa.scale * 3, 9, 15) + 'px sans-serif';
      }
    }
  }

  /* ------------------------------- ground ---------------------------------- */
  function drawSkyAndGround(world) {
    // Eye-level horizon: project a distant point along the flattened camera
    // forward direction at the camera's own height.
    var flat = normalize({ x: cam.forward.x, y: 0, z: cam.forward.z });
    var horizonY = CY;
    if (length(flat) > 0.01) {
      var far = { x: cam.pos.x + flat.x * 1000, y: cam.pos.y, z: cam.pos.z + flat.z * 1000 };
      var pr = projectPoint(far, _pa);
      if (pr) horizonY = _pa.y;
    }
    horizonY = clamp(horizonY, -H * 0.5, H * 1.5);
    var hy = clamp(horizonY, 0, H);

    if (hy > 0) {
      var skyGrad = ctx.createLinearGradient(0, 0, 0, hy);
      skyGrad.addColorStop(0, SKY_TOP);
      skyGrad.addColorStop(1, SKY_HORIZON);
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, hy);
    }
    if (hy < H) {
      var groundGrad = ctx.createLinearGradient(0, hy, 0, H);
      groundGrad.addColorStop(0, GROUND_FAR);
      groundGrad.addColorStop(1, GROUND_NEAR);
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, hy, W, H - hy);
    }
  }

  function addGroundGrid(world, dronePos) {
    var half = (world && world.groundSize ? world.groundSize : GRID_HALF_DEFAULT * 2) / 2;
    half = Math.min(half, MAX_FOG_DIST);
    var n = Math.floor(half / GRID_STEP);
    var cxw = Math.round(dronePos.x / GRID_STEP) * GRID_STEP;
    var czw = Math.round(dronePos.z / GRID_STEP) * GRID_STEP;
    var color = 'rgba(225,238,220,1)';
    for (var i = -n; i <= n; i++) {
      var x = cxw + i * GRID_STEP;
      var d1 = { x: x, y: 0, z: czw - half };
      var d2 = { x: x, y: 0, z: czw + half };
      pushLine(d1, d2, color, 0.04, 0.28, false);
      var z = czw + i * GRID_STEP;
      var l1 = { x: cxw - half, y: 0, z: z };
      var l2 = { x: cxw + half, y: 0, z: z };
      pushLine(l1, l2, color, 0.04, 0.28, false);
    }
  }

  /* -------------------------------- drone ----------------------------------- */
  var _motorWorld = [
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }
  ];
  function drawDrone(state, basis, dt) {
    var p = state.pos;
    var crashed = !!state.crashed;
    var motors = state.motors || [0, 0, 0, 0];
    var i;

    for (i = 0; i < 4; i++) localToWorld(MOTOR_LOCAL[i], p, basis, _motorWorld[i]);

    // shadow on ground, scales/softens with altitude
    var alt = Math.max(0, p.y);
    var shadowGround = { x: p.x, y: 0, z: p.z };
    var sp = projectPoint(shadowGround, _pa);
    if (sp) {
      var shrink = 1 / (1 + alt * 0.18);
      var baseR = 0.34 * _pa.scale * shrink;
      var fade = clamp(1 - alt * 0.05, 0.08, 0.55);
      var j = nextJob();
      j.kind = 'shadow';
      j.depth = _pa.depth + 0.001; // sits just at ground level
      j.ax = _pa.x; j.ay = _pa.y;
      j.r = Math.max(2, baseR);
      j.alpha = fade;
      j.color = '#000000';
    }

    // altitude drop line
    if (alt > 0.05) {
      pushLine({ x: p.x, y: p.y, z: p.z }, shadowGround, '#e8f0ff', 0.012, 0.5, true);
    }

    // arms (front pair tinted distinctly)
    var bodyColor = crashed ? BODY_COLOR_CRASH : BODY_COLOR;
    pushLine(p, _motorWorld[0], FRONT_ARM_COLOR, 0.018, 1, false);
    pushLine(p, _motorWorld[1], FRONT_ARM_COLOR, 0.018, 1, false);
    pushLine(p, _motorWorld[2], REAR_ARM_COLOR, 0.018, 1, false);
    pushLine(p, _motorWorld[3], REAR_ARM_COLOR, 0.018, 1, false);

    // central body
    pushOrientedBox(p, BODY_HALF, basis, bodyColor, 1);

    // motor hubs
    for (i = 0; i < 4; i++) pushDot(_motorWorld[i], MOTOR_R, MOTOR_COLOR, 1);

    // props: spin speed follows per-motor load; disarmed/idle -> static blades
    for (i = 0; i < 4; i++) {
      var load = motors[i] != null ? motors[i] : 0;
      var spinRate = state.armed ? (5 + load * 55) : load * 8;
      propAngle[i] += spinRate * dt;
      var mp = _motorWorld[i];
      if (load < 0.1 && !state.armed) {
        // static prop: two thin blade lines
        var a0 = propAngle[i];
        var b0x = Math.cos(a0) * PROP_R, b0z = Math.sin(a0) * PROP_R;
        var e1 = localToWorld({ x: b0x, y: 0.005, z: b0z }, mp, basis, { x: 0, y: 0, z: 0 });
        var e2 = localToWorld({ x: -b0x, y: 0.005, z: -b0z }, mp, basis, { x: 0, y: 0, z: 0 });
        pushLine(e1, e2, PROP_COLOR, 0.01, 0.9, false);
      } else {
        var segs = 8;
        var wpts = [];
        for (var s2 = 0; s2 < segs; s2++) {
          var a2 = propAngle[i] + (s2 / segs) * Math.PI * 2;
          wpts.push(localToWorld({ x: Math.cos(a2) * PROP_R, y: 0.006, z: Math.sin(a2) * PROP_R }, mp, basis, { x: 0, y: 0, z: 0 }));
        }
        var blurAlpha = clamp(0.18 + load * 0.35, 0.15, 0.5);
        pushPoly(wpts, PROP_COLOR, blurAlpha, true, 1);
      }
    }

    // crash sparks: cheap deterministic-ish flicker near the body
    if (crashed) {
      sparkSeed += dt;
      var sparkCount = 5;
      for (i = 0; i < sparkCount; i++) {
        var rnd = Math.sin(sparkSeed * 37.1 + i * 91.7) * 0.5 + 0.5;
        var rnd2 = Math.sin(sparkSeed * 53.3 + i * 17.3) * 0.5 + 0.5;
        var ang = rnd * Math.PI * 2;
        var rad = 0.08 + rnd2 * 0.18;
        var from = { x: p.x, y: p.y + 0.03, z: p.z };
        var to = { x: p.x + Math.cos(ang) * rad, y: p.y + 0.03 + (rnd2 - 0.3) * 0.15, z: p.z + Math.sin(ang) * rad };
        pushLine(from, to, rnd > 0.5 ? '#ffd24a' : '#ff6a3a', 0.012, 0.9, false);
      }
    }
  }

  /* ------------------------------- execution -------------------------------- */
  function sortAndDraw() {
    order.length = jobCount;
    for (var k = 0; k < jobCount; k++) order[k] = k;
    order.sort(function (a, b) { return jobs[b].depth - jobs[a].depth; });

    for (var i = 0; i < jobCount; i++) {
      var j = jobs[order[i]];
      execJob(j);
    }
  }

  function execJob(j) {
    if (j.alpha <= 0.003) return;
    ctx.globalAlpha = clamp(j.alpha, 0, 1);
    if (j.kind === 'line') {
      ctx.strokeStyle = j.color;
      ctx.lineWidth = j.lw;
      ctx.lineCap = 'round';
      if (j.dashed) ctx.setLineDash([Math.max(3, j.lw * 2), Math.max(3, j.lw * 2)]);
      ctx.beginPath();
      ctx.moveTo(j.ax, j.ay);
      ctx.lineTo(j.bx, j.by);
      ctx.stroke();
      if (j.dashed) ctx.setLineDash(EMPTY_DASH);
    } else if (j.kind === 'poly') {
      var n = j.polyLen;
      if (n < 2) { ctx.globalAlpha = 1; return; }
      ctx.beginPath();
      ctx.moveTo(j.poly[0].x, j.poly[0].y);
      for (var i = 1; i < n; i++) ctx.lineTo(j.poly[i].x, j.poly[i].y);
      if (j.fill) {
        ctx.closePath();
        ctx.fillStyle = j.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = j.color;
        ctx.lineWidth = j.lw;
        ctx.stroke();
      }
    } else if (j.kind === 'dot') {
      ctx.beginPath();
      ctx.arc(j.ax, j.ay, j.r, 0, Math.PI * 2);
      ctx.fillStyle = j.color;
      ctx.fill();
    } else if (j.kind === 'shadow') {
      var rx = j.r, ry = j.r * 0.45;
      var grad = ctx.createRadialGradient(j.ax, j.ay, 0, j.ax, j.ay, rx);
      grad.addColorStop(0, 'rgba(0,0,0,' + j.alpha.toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(j.ax, j.ay, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (j.kind === 'text') {
      ctx.fillStyle = j.color;
      ctx.font = j.font || '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(j.text, j.tx, j.ty);
    }
    ctx.globalAlpha = 1;
  }
  var EMPTY_DASH = [];

  /* --------------------------------- API -------------------------------------- */
  function init(c) {
    canvas = c;
    ctx = canvas.getContext('2d');
    var w = canvas.clientWidth || canvas.width || 300;
    var h = canvas.clientHeight || canvas.height || 150;
    resize(w, h);
    lastTime = null;
    camInitialized = false;
  }

  function resize(w, h) {
    if (!canvas) return;
    DPR = window.devicePixelRatio || 1;
    W = Math.max(1, w);
    H = Math.max(1, h);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    if (ctx) ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2;
    CY = H / 2;
    FOCAL = (H / 2) / Math.tan(FOV_Y / 2);
  }

  function draw(state, world, camMode) {
    if (!ctx) return;
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var dt = lastTime == null ? 1 / 60 : (now - lastTime) / 1000;
    lastTime = now;
    dt = clamp(dt, 0, 0.1);

    jobCount = 0;

    var basis = updateCamera(state, world, camMode || 'chase', dt);

    ctx.clearRect(0, 0, W, H);
    drawSkyAndGround(world);

    addGroundGrid(world, state.pos);

    if (world && world.obstacles) {
      for (var i = 0; i < world.obstacles.length; i++) addObstacle(world.obstacles[i]);
    }
    if (world && world.gates) {
      for (var g = 0; g < world.gates.length; g++) addGate(world.gates[g]);
    }
    if (world && world.landmarks) {
      for (var l = 0; l < world.landmarks.length; l++) addLandmark(world.landmarks[l]);
    }

    drawDrone(state, basis, dt);

    sortAndDraw();
  }

  window.DRONE.Render = {
    init: init,
    draw: draw,
    resize: resize
  };
})();
