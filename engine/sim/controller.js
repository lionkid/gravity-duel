// Character controller: moves an axis-aligned body through the static world one axis at a time and
// pushes it back out of anything it enters. Simple, stable and deterministic.
//
//   body: { pos: {x, y, z}, vel: {x, y, z}, size: {w, h, d}, onGround }   pos is the centre of the feet
//
// Horizontal moves can step up low obstacles (kerbs, rails, ramp risers); vertical moves land on tops,
// bump heads on undersides and, when the body was grounded, snap down short drops so it stays attached
// walking down ramps and steps. Gravity and acceleration are the caller's business.

import { overlaps } from './aabb.js';

export function createBody({ x = 0, y = 0, z = 0, w = 1, h = 2, d = 1 }) {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, size: { w, h, d }, onGround: false, hitWall: false, hitBounds: false, landedSpeed: 0 };
}

export function bodyBox(b, out) {
  const { pos, size } = b;
  const hw = size.w / 2, hd = size.d / 2;
  if (!out) out = { min: [0, 0, 0], max: [0, 0, 0] };
  out.min[0] = pos.x - hw; out.min[1] = pos.y; out.min[2] = pos.z - hd;
  out.max[0] = pos.x + hw; out.max[1] = pos.y + size.h; out.max[2] = pos.z + hd;
  return out;
}

const tmpBox = { min: [0, 0, 0], max: [0, 0, 0] };

function blocked(b, statics) {
  bodyBox(b, tmpBox);
  const near = statics.query(tmpBox);
  for (const s of near) if (overlaps(tmpBox, s)) return true;
  return false;
}

export function moveBody(b, statics, dt, { stepUp = 2, snap = 1.2 } = {}) {
  const wasOnGround = b.onGround;
  const groundY = statics.groundY;
  b.hitWall = false; b.hitBounds = false; b.landedSpeed = 0;

  // Horizontal axes.
  for (const axis of ['x', 'z']) {
    if (b.vel[axis] === 0) continue;
    b.pos[axis] += b.vel[axis] * dt;
    bodyBox(b, tmpBox);
    const near = statics.query(tmpBox);
    let hit = false, top = -Infinity;
    for (const s of near) if (overlaps(tmpBox, s)) { hit = true; if (s.max[1] > top) top = s.max[1]; }
    if (!hit) continue;
    // Step up: only while grounded, only onto something no higher than stepUp, only if there is room.
    const rise = top - b.pos.y;
    if (wasOnGround && rise > 0 && rise <= stepUp) {
      const y = b.pos.y;
      b.pos.y = top;
      if (!blocked(b, statics)) continue;
      b.pos.y = y;
    }
    const i = axis === 'x' ? 0 : 2;
    const half = (axis === 'x' ? b.size.w : b.size.d) / 2;
    for (const s of near) {
      if (!overlaps(tmpBox, s)) continue;
      if (b.vel[axis] > 0) b.pos[axis] = Math.min(b.pos[axis], s.min[i] - half);
      else b.pos[axis] = Math.max(b.pos[axis], s.max[i] + half);
      bodyBox(b, tmpBox);
    }
    b.vel[axis] = 0;
    b.hitWall = true;
  }

  // Vertical axis.
  b.pos.y += b.vel.y * dt;
  b.onGround = false;
  bodyBox(b, tmpBox);
  const near = statics.query(tmpBox);
  for (const s of near) {
    if (!overlaps(tmpBox, s)) continue;
    if (b.vel.y <= 0) { land(b, s.max[1], wasOnGround); } else { b.pos.y = s.min[1] - b.size.h; b.vel.y = 0; }
    bodyBox(b, tmpBox);
  }
  const ramp = statics.rampHeight(b.pos.x, b.pos.z);
  if (ramp > -Infinity && b.pos.y < ramp && (b.vel.y <= 0 || wasOnGround) && ramp - b.pos.y <= stepUp + Math.abs(b.vel.y * dt)) land(b, ramp, wasOnGround);
  if (b.pos.y <= groundY) land(b, groundY, wasOnGround);

  // Ground snap: a grounded body that just lost the floor under it (ramps, steps, kerbs) sticks to a
  // surface within `snap` below instead of floating off. Walking off a roof edge still falls.
  if (wasOnGround && !b.onGround && b.vel.y <= 0) {
    let floor = -Infinity;
    if (ramp > -Infinity && ramp <= b.pos.y) floor = ramp;
    if (groundY <= b.pos.y && groundY > floor) floor = groundY;
    bodyBox(b, tmpBox);
    tmpBox.min[1] -= snap;
    for (const s of statics.query(tmpBox)) {
      if (!overlaps(tmpBox, s) || s.max[1] > b.pos.y + 1e-6 || s.max[1] <= floor) continue;
      // Only tops that are actually under the body's footprint count.
      floor = s.max[1];
    }
    if (floor > -Infinity && b.pos.y - floor <= snap) { b.pos.y = floor; b.vel.y = 0; b.onGround = true; }
  }

  // Arena bounds (the energy fence) and ceiling.
  const bd = statics.bounds;
  if (bd) {
    const hw = b.size.w / 2, hd = b.size.d / 2;
    if (b.pos.x < bd.minX + hw) { b.pos.x = bd.minX + hw; b.vel.x = 0; b.hitBounds = true; }
    if (b.pos.x > bd.maxX - hw) { b.pos.x = bd.maxX - hw; b.vel.x = 0; b.hitBounds = true; }
    if (b.pos.z < bd.minZ + hd) { b.pos.z = bd.minZ + hd; b.vel.z = 0; b.hitBounds = true; }
    if (b.pos.z > bd.maxZ - hd) { b.pos.z = bd.maxZ - hd; b.vel.z = 0; b.hitBounds = true; }
    if (bd.ceiling != null && b.pos.y + b.size.h > bd.ceiling) { b.pos.y = bd.ceiling - b.size.h; if (b.vel.y > 0) b.vel.y = 0; }
  }
  return b;
}

// landedSpeed is only reported on the tick the body arrives from the air, so a resting body with
// gravity applied every tick does not look like it keeps landing.
function land(b, y, wasOnGround) {
  if (!wasOnGround && b.vel.y < 0) b.landedSpeed = Math.max(b.landedSpeed, -b.vel.y);
  b.pos.y = y;
  b.vel.y = 0;
  b.onGround = true;
}
