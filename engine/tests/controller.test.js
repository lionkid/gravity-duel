import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxAt } from '../sim/aabb.js';
import { createStatics } from '../sim/statics.js';
import { createBody, moveBody } from '../sim/controller.js';

const DT = 1 / 60;
const MECH = { w: 10, h: 18, d: 10 };
function stage(statics, extra) {
  return createStatics(Object.assign({ statics, ramps: [], groundY: 0, bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400, ceiling: 300 } }, extra));
}
function body(x, y, z) { return createBody(Object.assign({ x, y, z }, MECH)); }
// Runs the body with gravity for n ticks, like the game does.
function run(b, statics, n, vx = 0, vz = 0, g = 32) {
  for (let i = 0; i < n; i++) { b.vel.x = vx; b.vel.z = vz; b.vel.y -= g * DT; moveBody(b, statics, DT, { stepUp: 2, snap: 1.2 }); }
  return b;
}

test('a body falls onto the ground and stays there', () => {
  const s = stage([]);
  const b = run(body(0, 30, 0), s, 120);
  assert.equal(b.pos.y, 0);
  assert.ok(b.onGround);
  assert.ok(b.landedSpeed === 0, 'landedSpeed is per tick: zero once resting');
});

test('landing on a roof reports the impact speed and leaves the body on top', () => {
  const s = stage([boxAt(0, 0, 0, 70, 60, 70)]);
  const b = body(0, 100, 0);
  let impact = 0;
  for (let i = 0; i < 180 && !b.onGround; i++) { b.vel.y -= 32 * DT; moveBody(b, s, DT); impact = b.landedSpeed; }
  assert.ok(b.onGround && b.pos.y === 60, `rests on the roof, got y=${b.pos.y}`);
  assert.ok(impact > 40 && impact < 60, `impact speed ${impact}`);
});

test('walls stop the body at their face and raise hitWall', () => {
  const s = stage([boxAt(50, 0, 0, 20, 60, 60)]);     // wall face at x = 40
  const b = run(body(0, 0, 0), s, 120, 28, 0);
  assert.ok(Math.abs(b.pos.x - 35) < 1e-9, `body half-width 5 → centre stops at 35, got ${b.pos.x}`);
  assert.ok(b.hitWall);
  assert.equal(b.vel.x, 0);
});

test('low obstacles are stepped onto, tall ones block', () => {
  const kerb = stage([boxAt(30, 0, 0, 10, 1.5, 60)]);
  const b = run(body(0, 0, 0), kerb, 90, 28, 0);
  assert.ok(b.pos.x > 40, 'walked past the kerb');
  const wall = stage([boxAt(30, 0, 0, 10, 3, 60)]);
  const c = run(body(0, 0, 0), wall, 90, 28, 0);
  assert.ok(Math.abs(c.pos.x - 20) < 1e-9, `blocked at the 3 m wall, got ${c.pos.x}`);
  const air = stage([boxAt(30, 0, 0, 10, 1.5, 60)]);
  const d = body(0, 0.5, 0);      // just off the ground, so the kerb is in the way but we are airborne
  d.vel.y = 0;
  moveBody(Object.assign(d, { vel: { x: 28 * 60, y: 0, z: 0 } }), air, DT);   // airborne, flying into the kerb side
  assert.ok(d.hitWall, 'no step-up while airborne');
});

test('walking down a small step snaps to it, walking off a roof falls', () => {
  const s = stage([boxAt(0, 0, 0, 40, 1, 40)]);
  const b = run(body(0, 1, 0), s, 60, 28, 0);
  assert.ok(b.onGround && b.pos.y === 0, `snapped down to the ground, got y=${b.pos.y} onGround=${b.onGround}`);
  const roof = stage([boxAt(0, 0, 0, 40, 30, 40)]);
  const c = run(body(0, 30, 0), roof, 70, 28, 0);   // the edge is at x = 20, the body reaches it after ~54 ticks
  assert.ok(!c.onGround && c.pos.y < 30 && c.pos.y > 0, `fell off the roof, got y=${c.pos.y}`);
});

test('an overhang stops upward motion', () => {
  const s = stage([boxAt(0, 25, 0, 40, 10, 40)]);
  const b = body(0, 0, 0);
  for (let i = 0; i < 60; i++) { b.vel.y = 40; moveBody(b, s, DT); }
  assert.ok(Math.abs(b.pos.y - 7) < 1e-9, `head stops under the slab at y=7, got ${b.pos.y}`);
  assert.equal(b.vel.y, 0);
});

test('ramps carry the body up and down smoothly', () => {
  const s = stage([boxAt(100, 0, 0, 60, 16, 36)], { ramps: [{ min: [10, 0, -18], max: [70, 16, 18], axis: 'x', up: 1 }] });
  const b = run(body(0, 0, 0), s, 150, 28, 0);
  assert.ok(b.onGround && b.pos.x > 70 && Math.abs(b.pos.y - 16) < 1e-9, `on the deck at 16 m, got x=${b.pos.x} y=${b.pos.y}`);
  const c = run(body(60, 13.3333, 0), s, 150, -28, 0);
  assert.ok(c.onGround && c.pos.y === 0 && c.pos.x < 10, `walked back down, got x=${c.pos.x} y=${c.pos.y}`);
});

test('the arena fence clamps position and kills velocity into it', () => {
  const s = stage([]);
  const b = run(body(380, 0, 0), s, 60, 28, 0);
  assert.equal(b.pos.x, 395);
  assert.ok(b.hitBounds && b.vel.x === 0);
});

test('results are deterministic', () => {
  const s = stage([boxAt(30, 0, 0, 10, 1.5, 60), boxAt(80, 0, 0, 20, 40, 60)]);
  const a = run(body(0, 0, 0), s, 200, 28, 3), b = run(body(0, 0, 0), s, 200, 28, 3);
  assert.deepEqual(a, b);
});
