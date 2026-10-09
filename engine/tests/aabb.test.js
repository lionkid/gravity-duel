import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxAt, overlaps, segmentBox, expand, containsPoint } from '../sim/aabb.js';

test('boxes overlap only when they intersect on all three axes', () => {
  const a = boxAt(0, 0, 0, 10, 20, 10);
  assert.ok(overlaps(a, boxAt(4, 5, 4, 10, 10, 10)));
  assert.ok(!overlaps(a, boxAt(20, 0, 0, 10, 20, 10)), 'beside');
  assert.ok(!overlaps(a, boxAt(0, 20, 0, 10, 10, 10)), 'touching tops do not overlap');
  assert.ok(!overlaps(a, boxAt(0, 25, 0, 10, 10, 10)), 'above');
  assert.ok(containsPoint(expand(a, 1), { x: 5.5, y: 20.5, z: 0 }));
});

test('segment vs box reports the entry point and the face hit', () => {
  const b = boxAt(0, 0, 0, 10, 20, 10);
  const hit = segmentBox({ x: -20, y: 5, z: 0 }, { x: 20, y: 5, z: 0 }, b);
  assert.ok(hit && Math.abs(hit.t - 0.375) < 1e-9, 'enters at x = -5');
  assert.equal(hit.axis, 0);
  assert.equal(hit.sign, -1, 'hit the -x face');
  assert.equal(segmentBox({ x: -20, y: 25, z: 0 }, { x: 20, y: 25, z: 0 }, b), null, 'passes over the top');
  assert.equal(segmentBox({ x: -20, y: 5, z: 8 }, { x: 20, y: 5, z: 8 }, b), null, 'passes beside');
  const down = segmentBox({ x: 0, y: 40, z: 0 }, { x: 0, y: -10, z: 0 }, b);
  assert.ok(down && down.axis === 1 && Math.abs(down.t - 0.4) < 1e-9, 'lands on the roof');
  const inside = segmentBox({ x: 0, y: 5, z: 0 }, { x: 30, y: 5, z: 0 }, b);
  assert.ok(inside && inside.t === 0, 'a segment starting inside hits at t = 0');
  assert.equal(segmentBox({ x: -20, y: 5, z: 0 }, { x: -12, y: 5, z: 0 }, b), null, 'stops short');
});
