import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxAt } from '../sim/aabb.js';
import { createStatics } from '../sim/statics.js';
import { createBody } from '../sim/controller.js';
import { raycast, lineOfSight, segmentBody } from '../sim/sweep.js';

const city = createStatics({ statics: [boxAt(0, 0, 0, 70, 60, 70), boxAt(100, 0, 0, 70, 30, 70)], groundY: 0 });

test('raycast finds the closest building and where it was hit', () => {
  const hit = raycast(city, { x: -100, y: 10, z: 0 }, { x: 200, y: 10, z: 0 });
  assert.ok(hit && Math.abs(hit.x + 35) < 1e-9, 'first wall at x = -35');
  assert.equal(hit.axis, 0);
  const over = raycast(city, { x: -100, y: 65, z: 0 }, { x: 200, y: 65, z: 0 });
  assert.equal(over, null, 'clears both roofs');
  const ground = raycast(city, { x: -100, y: 10, z: 50 }, { x: -100, y: -10, z: 50 });
  assert.ok(ground && ground.box === null && Math.abs(ground.y) < 1e-9, 'hits the ground plane');
});

test('line of sight is blocked by buildings and open across streets', () => {
  assert.ok(!lineOfSight(city, { x: -60, y: 10, z: 0 }, { x: 60, y: 10, z: 0 }));
  assert.ok(lineOfSight(city, { x: -60, y: 10, z: 50 }, { x: 60, y: 10, z: 50 }));
  assert.ok(!lineOfSight(city, { x: -60, y: 10, z: 0 }, { x: 0, y: 80, z: 0 }), 'from street level the building wall is in the way of its own roof');
  assert.ok(lineOfSight(city, { x: -60, y: 50, z: 0 }, { x: 0, y: 80, z: 0 }), 'from higher up the roof is visible');
});

test('sphere sweeps use inflated boxes', () => {
  const near = raycast(city, { x: -100, y: 10, z: 36 }, { x: 100, y: 10, z: 36 }, 2);
  assert.ok(near, 'a 2 m sphere passing 1 m from the wall touches it');
  assert.equal(raycast(city, { x: -100, y: 10, z: 36 }, { x: 100, y: 10, z: 36 }, 0), null);
});

test('segments hit bodies', () => {
  const b = createBody({ x: 50, y: 0, z: 0, w: 10, h: 18, d: 10 });
  const hit = segmentBody({ x: 0, y: 9, z: 0 }, { x: 100, y: 9, z: 0 }, b);
  assert.ok(hit && Math.abs(hit.t - 0.45) < 1e-9);
  assert.equal(segmentBody({ x: 0, y: 20, z: 0 }, { x: 100, y: 20, z: 0 }, b), null, 'over the head');
});
