// Segment queries against the static world and against bodies: projectiles, line of sight, camera.

import { segmentBox, expand } from './aabb.js';
import { bodyBox } from './controller.js';

// Closest hit of p0→p1 against the static boxes and the ground plane, or null.
// `radius` inflates the boxes, which turns the segment into a cheap sphere sweep (used by the camera).
export function raycast(statics, p0, p1, radius = 0) {
  let best = null;
  for (const s of statics.queryRay(p0, p1)) {
    const hit = segmentBox(p0, p1, radius ? expand(s, radius) : s);
    if (hit && (!best || hit.t < best.t)) best = { t: hit.t, axis: hit.axis, sign: hit.sign, box: s };
  }
  const g = statics.groundY + radius;    // a sphere touches the ground when its centre is one radius above it
  if (p0.y > g && p1.y < g) {
    const t = (p0.y - g) / (p0.y - p1.y);
    if (!best || t < best.t) best = { t, axis: 1, sign: 1, box: null };
  }
  if (best) {
    best.x = p0.x + (p1.x - p0.x) * best.t;
    best.y = p0.y + (p1.y - p0.y) * best.t;
    best.z = p0.z + (p1.z - p0.z) * best.t;
  }
  return best;
}

export function lineOfSight(statics, a, b) {
  return raycast(statics, a, b) === null;
}

// Where p0→p1 enters a body's box, or null.
export function segmentBody(p0, p1, body) {
  return segmentBox(p0, p1, bodyBox(body));
}
