import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, HW } from '../stages/city.js';
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
  const buildings = c.statics.filter((s) => s.tag === 'building');
  for (const s of buildings) {
    assert.ok(s.min[0] >= b.minX && s.max[0] <= b.maxX && s.min[2] >= b.minZ && s.max[2] <= b.maxZ, 'inside the fence');
    assert.ok(s.max[1] >= opts.minHeight && s.max[1] <= opts.maxHeight, `height ${s.max[1]}`);
    assert.ok(s.max[0] - s.min[0] >= 10 && s.max[2] - s.min[2] >= 10, 'wide enough to stand on');
  }
  const low = buildings.filter((s) => s.max[1] <= opts.stepHeight).length;
  assert.ok(low >= opts.blocks * opts.blocks, `${low} low buildings for ${opts.blocks * opts.blocks} blocks`);
  assert.ok(buildings.length >= opts.blocks * opts.blocks * 2);
});

test('buildings never overlap each other', () => {
  const b = generateCity(opts).statics.filter((s) => s.tag === 'building');
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) assert.ok(!overlaps(b[i], b[j]));
});

test('spawns are on the ground, in the open, facing each other down a clear street', () => {
  const c = generateCity(opts);
  assert.equal(c.spawns.length, 2);
  for (const sp of c.spawns) {
    const body = boxAt(sp.pos.x, sp.pos.y, sp.pos.z, BODY.w, BODY.h, BODY.d);
    assert.equal(sp.pos.y, 0);
    assert.ok(!c.statics.some((s) => overlaps(body, s)), 'spawn is not inside a building');
  }
  const street = { min: [-opts.street / 2, 0, c.spawns[1].pos.z - 10], max: [opts.street / 2, 300, c.spawns[0].pos.z + 10] };
  assert.ok(!c.statics.some((s) => overlaps(street, s)), 'the street between the spawns is clear');
  assert.ok(c.spawns[0].pos.z > 0 && c.spawns[1].pos.z < 0 && c.spawns[0].yaw === 0 && Math.abs(c.spawns[1].yaw - Math.PI) < 1e-9);
});

test('the highway loops around the inner blocks: deck, rails, pillars and four ramps', () => {
  const c = generateCity(opts);
  const long = (s) => s.max[0] - s.min[0] > 300 || s.max[2] - s.min[2] > 300;
  const decks = c.statics.filter((s) => s.tag === 'deck' && long(s));
  assert.equal(decks.length, 4);
  for (const d of decks) {
    assert.equal(d.max[1], HW.deckY);
    assert.ok(d.min[1] >= BODY.h + 2, 'a mech fits under the deck');
    assert.ok(Math.abs(d.max[0] - d.min[0] - (2 * c.highway.R + opts.street)) < 1e-9 || Math.abs(d.max[2] - d.min[2] - (2 * c.highway.R + opts.street)) < 1e-9);
  }
  assert.equal(c.ramps.length, 4);
  for (const r of c.ramps) {
    assert.equal(r.min[1], 0);
    assert.equal(r.max[1], HW.deckY);
    assert.ok((r.axis === 'x' ? r.max[0] - r.min[0] : r.max[2] - r.min[2]) === HW.rampLen);
  }
  assert.ok(c.statics.filter((s) => s.tag === 'rail').length >= 12);
  assert.ok(c.statics.filter((s) => s.tag === 'pillar').length >= 16);
  assert.ok(c.statics.filter((s) => s.tag === 'pillar').every((s) => s.max[1] <= HW.deckY - HW.thick));
  // Buildings and highway never intersect.
  const hw = c.statics.filter((s) => s.tag !== 'building');
  const bl = c.statics.filter((s) => s.tag === 'building');
  for (const h of hw) assert.ok(!bl.some((b) => overlaps(h, b)), 'highway clear of buildings');
});

test('the centre is taller than the edge', () => {
  const c = generateCity(opts);
  const h = (s) => s.max[1];
  const bl = c.statics.filter((s) => s.tag === 'building');
  const near = bl.filter((s) => Math.max(Math.abs(s.min[0]), Math.abs(s.min[2])) < 150).map(h);
  const far = bl.filter((s) => Math.max(Math.abs(s.min[0]), Math.abs(s.min[2])) > 300).map(h);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(near) > avg(far) + 20, `centre ${avg(near).toFixed(0)} m vs edge ${avg(far).toFixed(0)} m`);
});
