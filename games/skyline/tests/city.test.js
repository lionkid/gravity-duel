import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../stages/city.js';
import { boxAt, overlaps } from '../../../engine/sim/aabb.js';
import { BODY, STAGES } from '../config.js';

const opts = Object.assign({ seed: 11 }, STAGES.city);

test('the same seed always builds the same city, another seed a different one', () => {
  assert.deepEqual(generateCity(opts), generateCity(opts));
  assert.notDeepEqual(generateCity(opts), generateCity(Object.assign({}, opts, { seed: 12 })));
});

test('buildings stay inside the fence, within the height range, and every block has a low step', () => {
  const c = generateCity(opts);
  const b = c.bounds;
  for (const s of c.statics) {
    assert.ok(s.min[0] >= b.minX && s.max[0] <= b.maxX && s.min[2] >= b.minZ && s.max[2] <= b.maxZ, 'inside the fence');
    assert.ok(s.max[1] >= opts.minHeight && s.max[1] <= opts.maxHeight, `height ${s.max[1]}`);
    assert.ok(s.max[0] - s.min[0] >= 10 && s.max[2] - s.min[2] >= 10, 'wide enough to stand on');
  }
  const low = c.statics.filter((s) => s.max[1] <= opts.stepHeight).length;
  assert.ok(low >= opts.blocks * opts.blocks, `${low} low buildings for ${opts.blocks * opts.blocks} blocks`);
  assert.ok(c.statics.length >= opts.blocks * opts.blocks * 2);
});

test('buildings never overlap each other', () => {
  const c = generateCity(opts);
  for (let i = 0; i < c.statics.length; i++) for (let j = i + 1; j < c.statics.length; j++) assert.ok(!overlaps(c.statics[i], c.statics[j]));
});

test('spawns are on the ground, in the open, facing each other down a clear street', () => {
  const c = generateCity(opts);
  assert.equal(c.spawns.length, 2);
  for (const sp of c.spawns) {
    const body = boxAt(sp.pos.x, sp.pos.y, sp.pos.z, BODY.w, BODY.h, BODY.d);
    assert.equal(sp.pos.y, 0);
    assert.ok(!c.statics.some((s) => overlaps(body, s)), 'spawn is not inside a building');
  }
  const street = { min: [-opts.street / 2, 0, c.bounds.minZ], max: [opts.street / 2, 300, c.bounds.maxZ] };
  assert.ok(!c.statics.some((s) => overlaps(street, s)), 'the central street is clear');
  assert.ok(c.spawns[0].pos.z > 0 && c.spawns[1].pos.z < 0 && c.spawns[0].yaw === 0 && Math.abs(c.spawns[1].yaw - Math.PI) < 1e-9);
});

test('the centre is taller than the edge', () => {
  const c = generateCity(opts);
  const h = (s) => s.max[1];
  const near = c.statics.filter((s) => Math.max(Math.abs(s.min[0]), Math.abs(s.min[2])) < 150).map(h);
  const far = c.statics.filter((s) => Math.max(Math.abs(s.min[0]), Math.abs(s.min[2])) > 300).map(h);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(near) > avg(far) + 20, `centre ${avg(near).toFixed(0)} m vs edge ${avg(far).toFixed(0)} m`);
});
