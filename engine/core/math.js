// Vector and angle helpers on plain { x, y, z } objects. The simulation uses these instead of Three.js
// so it has no renderer or DOM dependency and its whole state stays plain JSON.
//
// Conventions (shared with the renderer): Y is up, yaw 0 faces -Z, yaw grows counter-clockwise seen
// from above (turning left), pitch grows when looking up.

export const TAU = Math.PI * 2;

export function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
export function copy(out, a) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
export function set(out, x, y, z) { out.x = x; out.y = y; out.z = z; return out; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function addScaled(a, b, s) { return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function length(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function lengthXZ(a) { return Math.sqrt(a.x * a.x + a.z * a.z); }
export function dist(a, b) { return length(sub(a, b)); }
export function distXZ(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
export function normalize(a) { const l = length(a); return l > 1e-9 ? scale(a, 1 / l) : v3(); }
export function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; }
export function mix(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Moves v toward target by at most maxDelta.
export function approach(v, target, maxDelta) {
  const d = target - v;
  return Math.abs(d) <= maxDelta ? target : v + Math.sign(d) * maxDelta;
}
// Same for the horizontal components of a vector, moving along the straight line between them.
export function approachXZ(v, tx, tz, maxDelta) {
  const dx = tx - v.x, dz = tz - v.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxDelta || d < 1e-9) { v.x = tx; v.z = tz; return v; }
  const s = maxDelta / d;
  v.x += dx * s; v.z += dz * s;
  return v;
}

// Angles wrap to (-PI, PI].
export function wrapAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}
export function angleDiff(from, to) { return wrapAngle(to - from); }
export function approachAngle(a, target, maxDelta) {
  const d = angleDiff(a, target);
  return Math.abs(d) <= maxDelta ? target : wrapAngle(a + Math.sign(d) * maxDelta);
}
export function lerpAngle(a, b, t) { return wrapAngle(a + angleDiff(a, b) * t); }

// Direction helpers for the yaw / pitch convention above.
export function yawToDir(yaw) { return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }; }
export function rightOfYaw(yaw) { return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }; }
export function dirToYaw(x, z) { return Math.atan2(-x, -z); }
export function aimToDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
export function dirToAim(d) {
  const l = length(d) || 1;
  return { yaw: dirToYaw(d.x, d.z), pitch: Math.asin(clamp(d.y / l, -1, 1)) };
}
