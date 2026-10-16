// The desert: hamlets, mesas and open sand from the city generator, and sand twisters that pull mechs
// in, lift them, throw them out, sweep shots aside, and stay deterministic for LAN play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld, cloneWorld, serializeWorld, applySnapshot, hashWorld } from '../rules/world.js';
import { createAI, aiIntent } from '../ai/brain.js';
import { createIntent } from '../../../engine/input/intent.js';
import { BODY, STAGES, TWISTER } from '../config.js';
import { run, eventsOf, clearEvents, DT } from './helpers.js';
import { boxAt, overlaps } from '../../../engine/sim/aabb.js';

const opts = Object.assign({ seed: 7 }, STAGES.desert);
const desert = (seed = 7) => createWorld({ stage: generateCity(Object.assign({}, opts, { seed })), seed });
const sec = (s) => Math.round(s / DT);
// Park every twister but the first, and put the first, fully grown, at (x, z).
function placeTwister(w, x, z) {
  for (const tw of w.twisters) { tw.phase = 'rest'; tw.t = 0; tw.dur = 1e6; tw.strength = 0; }
  const tw = w.twisters[0];
  Object.assign(tw, { phase: 'live', t: 0, dur: 1e6, strength: 1, x, z, heading: 0 });
  return tw;
}

test('the desert is open sand, adobe hamlets and mesas, with twisters and no highway', () => {
  const st = generateCity(opts);
  assert.deepEqual(generateCity(opts), st, 'deterministic');
  assert.equal(st.highway, null);
  assert.deepEqual(st.hazards, { twisters: { count: STAGES.desert.twisters } });
  assert.equal(generateCity(Object.assign({ seed: 7 }, STAGES.city)).hazards, null, 'the city has no twisters');
  const mesas = st.statics.filter((s) => s.tag === 'mesa');
  assert.equal(mesas.length, STAGES.desert.mesas * 2, 'two tiers per mesa');
  assert.ok(Math.max(...mesas.map((s) => s.max[1])) >= 62);
  const houses = st.statics.filter((s) => s.tag === 'building');
  assert.ok(houses.length > 60 && houses.every((s) => s.max[1] <= STAGES.desert.maxHeight), `${houses.length} houses`);
  for (let i = 0; i < houses.length; i++) for (let j = i + 1; j < houses.length; j++) assert.ok(!overlaps(houses[i], houses[j]), 'houses apart');
  assert.equal(Math.abs(st.spawns[0].pos.z - st.spawns[1].pos.z), STAGES.desert.spawnZ * 2);
  for (const sp of st.spawns) assert.ok(!st.statics.some((s) => overlaps(boxAt(sp.pos.x, 0, sp.pos.z, BODY.w, BODY.h, BODY.d), s)), 'spawn in the open');
});

test('a twister catches a mech, lifts it high and throws it out', () => {
  const w = desert();
  const f = w.fighters[0];
  placeTwister(w, f.pos.x, f.pos.z);
  clearEvents(w);
  let top = 0, flungAt = -1;
  for (let i = 0; i < sec(6); i++) {
    run(w, 1);
    top = Math.max(top, f.pos.y);
    if (flungAt < 0 && eventsOf(w, 'fling').length) flungAt = i;
  }
  assert.equal(eventsOf(w, 'caught').length, 1);
  assert.ok(top > TWISTER.ejectHeight - 10, `lifted to ${top.toFixed(0)} m`);
  assert.ok(flungAt > 0 && flungAt <= sec(TWISTER.maxCaught) + 2, `thrown out after ${(flungAt * DT).toFixed(1)} s`);
  let landed = -1;
  for (let i = 0; i < sec(5) && landed < 0; i++) { run(w, 1); if (f.onGround) landed = i; }
  const tw = w.twisters[0];
  assert.ok(landed >= 0 && !f.caught, 'back on the ground');
  assert.ok(Math.hypot(f.pos.x - tw.x, f.pos.z - tw.z) > TWISTER.reach, `thrown clear of the pull: ${Math.hypot(f.pos.x - tw.x, f.pos.z - tw.z).toFixed(0)} m`);
});

test('the pull drags a mech that stands still, and running away gets out of it', () => {
  const w = desert();
  const f = w.fighters[0];
  const tw = placeTwister(w, f.pos.x + 40, f.pos.z);
  tw.heading = Math.PI / 2;                                     // drifting sideways, not at the mech
  const d0 = Math.hypot(f.pos.x - tw.x, f.pos.z - tw.z);
  run(w, sec(1));
  const d1 = Math.hypot(f.pos.x - tw.x, f.pos.z - tw.z);
  assert.ok(d1 < d0 - 4, `dragged from ${d0.toFixed(1)} to ${d1.toFixed(1)} m`);
  const w2 = desert(), f2 = w2.fighters[0];
  const tw2 = placeTwister(w2, f2.pos.x + 40, f2.pos.z);
  tw2.heading = Math.PI / 2;
  run(w2, sec(1.5), (it) => { it.move.x = -1; });
  assert.ok(Math.hypot(f2.pos.x - tw2.x, f2.pos.z - tw2.z) > d0, 'ran clear');
  assert.equal(eventsOf(w2, 'caught').length, 0);
});

test('a dash breaks out of the column', () => {
  const w = desert();
  const f = w.fighters[0];
  placeTwister(w, f.pos.x, f.pos.z);
  run(w, sec(0.5));
  assert.ok(f.caught, 'caught');
  clearEvents(w);
  run(w, 2, (it, i) => { it.pressed.dash = i === 0; it.move.z = 1; });
  assert.equal(f.caught, 0);
  assert.equal(eventsOf(w, 'escape').length, 1);
  run(w, sec(1.5));
  assert.ok(!f.caught, 'not caught again straight away');
});

test('shots through a twister are swept aside', () => {
  const w = desert();
  const [a] = w.fighters;
  placeTwister(w, a.pos.x + 8, a.pos.z - 60);              // off the line of fire: a vortex sweeps a passing shot to one side
  w.twisters[0].heading = Math.PI / 2;
  const straight = desert();
  for (const x of [w, straight]) {
    run(x, 2, (it, i) => { it.pressed.switch3 = i === 0; });
    run(x, 12, (it) => { it.held.aim = true; it.aim.yaw = 0; it.aim.pitch = 0; });
    run(x, 4, (it, i) => { it.held.aim = true; it.aim.yaw = 0; it.aim.pitch = 0; it.pressed.attack = i === 0; });
  }
  for (const tw of straight.twisters) { tw.phase = 'rest'; tw.dur = 1e6; tw.strength = 0; }
  run(w, 12, (it) => { it.held.aim = true; }); run(straight, 12, (it) => { it.held.aim = true; });
  const p = w.projectiles[0], q = straight.projectiles[0];
  assert.ok(p && q, 'both rockets still flying');
  const ang = (v) => Math.atan2(v.x, -v.z);
  assert.ok(Math.abs(ang(p.vel) - ang(q.vel)) > 0.05, `deflected by ${(Math.abs(ang(p.vel) - ang(q.vel)) * 180 / Math.PI).toFixed(1)}°`);
});

test('twisters come and go, stay inside the arena, and replay exactly', () => {
  const a = desert(), b = desert();
  const evs = [];
  let maxR = 0;
  for (let i = 0; i < sec(300); i++) {
    stepWorld(a, [], DT); stepWorld(b, [], DT);
    for (const e of a.events) evs.push(e.t);
    a.events = []; b.events = [];
    for (const tw of a.twisters) if (tw.strength > 0) maxR = Math.max(maxR, Math.abs(tw.x), Math.abs(tw.z));
  }
  assert.equal(hashWorld(a), hashWorld(b));
  assert.ok(evs.filter((t) => t === 'twister').length >= 6, `${evs.filter((t) => t === 'twister').length} twisters formed`);
  assert.ok(evs.includes('twisterGone'));
  assert.ok(maxR < a.stage.bounds.maxX * 0.85, `widest ${maxR.toFixed(0)} m`);
});

test('a desert match between computers runs, copies and snapshots consistently', () => {
  const w = desert(11);
  const ai1 = createAI('hard', 1), ai2 = createAI('normal', 2);
  let caught = 0;
  for (let i = 0; i < sec(40) && !w.winner; i++) {
    stepWorld(w, [aiIntent(ai1, w, 1, DT), aiIntent(ai2, w, 2, DT)], DT);
    caught += w.events.filter((e) => e.t === 'caught').length;
    w.events = [];
  }
  for (const f of w.fighters) assert.ok(Math.abs(f.pos.x) <= w.stage.bounds.maxX && Math.abs(f.pos.z) <= w.stage.bounds.maxZ);
  assert.ok(w.fighters.some((f) => f.hp < f.hpMax), 'they fought');
  const copy = cloneWorld(w), fresh = desert(11);
  applySnapshot(fresh, JSON.parse(JSON.stringify(serializeWorld(w))));
  for (let i = 0; i < 300; i++) {
    const it = createIntent(); it.move.x = Math.sin(i / 30); it.held.attack = i % 4 === 0;
    for (const x of [w, copy, fresh]) stepWorld(x, [it, createIntent()], DT);
  }
  assert.equal(hashWorld(copy), hashWorld(w));
  assert.equal(hashWorld(fresh), hashWorld(w));
});
