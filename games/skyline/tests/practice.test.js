// Practice mode: bullseye targets placed in the open, scored by ring, broken and respawned, cut by
// blades; the time attack's clock; the dummy that stands up again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld, cloneWorld, serializeWorld, applySnapshot, hashWorld } from '../rules/world.js';
import { placeTargets, ringOf } from '../rules/targets.js';
import { applyDamage } from '../rules/combat.js';
import { createIntent } from '../../../engine/input/intent.js';
import { dirToAim, dirToYaw } from '../../../engine/core/math.js';
import { STAGES, PRACTICE, COMBAT } from '../config.js';
import { run, eventsOf, clearEvents, DT } from './helpers.js';

const stageOf = (id, seed = 7) => generateCity(Object.assign({ seed }, STAGES[id]));
const practiceWorld = (mode = 'free', id = 'city') => createWorld({ stage: stageOf(id), seed: 7, practice: { mode } });
const sec = (s) => Math.round(s / DT);

// One board at a known clear spot on the central street, facing the player.
function oneBoard(w, kind, x, y, z) {
  const k = PRACTICE.kinds[kind], f = w.fighters[0];
  w.targets = [{ id: 1, kind, pos: { x, y, z }, prev: { x, y, z }, home: { x, y, z }, yaw: dirToYaw(f.pos.x - x, f.pos.z - z), radius: k.radius, hp: k.hp, hpMax: k.hp, alive: true, respawn: 0, path: null }];
  return w.targets[0];
}
const eye = (f) => ({ x: f.pos.x, y: f.pos.y + COMBAT.muzzleHeight + 2, z: f.pos.z });
function aimedShot(w, at) {
  const f = w.fighters[0];
  run(w, 2, (it, i) => { it.pressed.switch3 = i === 0; });
  run(w, sec(COMBAT.switchDraw) + 2);
  const e = eye(f), aim = dirToAim({ x: at.x - e.x, y: at.y - e.y, z: at.z - e.z });
  run(w, 12, (it) => { it.held.aim = true; Object.assign(it.aim, aim); });
  clearEvents(w);
  run(w, 30, (it, i) => { it.held.aim = true; Object.assign(it.aim, aim); it.pressed.attack = i === 0; });
}

test('targets stand in the open on every stage, of every kind, the same for the same seed', () => {
  for (const id of ['city', 'moon', 'desert', 'space']) {
    const st = stageOf(id);
    const a = placeTargets(st, 7);
    assert.deepEqual(placeTargets(st, 7), a);
    assert.notDeepEqual(placeTargets(st, 8), a);
    const kinds = {};
    for (const t of a) kinds[t.kind] = (kinds[t.kind] || 0) + 1;
    for (const k of Object.keys(PRACTICE.counts)) assert.ok((kinds[k] || 0) >= Math.ceil(PRACTICE.counts[k] * 0.6), `${id}: ${kinds[k] || 0} ${k} of ${PRACTICE.counts[k]}`);
    for (const t of a) {
      const r = t.radius, floor = t.kind === 'drone' ? t.pos.y - r : (t.floor || 0) + 0.01;
      const box = { min: [t.pos.x - r, floor, t.pos.z - r], max: [t.pos.x + r, t.pos.y + r, t.pos.z + r] };
      const hit = st.statics.find((s) => box.min[0] < s.max[0] && box.max[0] > s.min[0] && box.min[1] < s.max[1] && box.max[1] > s.min[1] && box.min[2] < s.max[2] && box.max[2] > s.min[2]);
      assert.ok(!hit, `${id}: ${t.kind} #${t.id} at ${t.pos.x.toFixed(0)},${t.pos.y.toFixed(0)},${t.pos.z.toFixed(0)} is inside a ${hit && hit.tag}`);
      assert.ok(t.pos.x > st.bounds.minX && t.pos.x < st.bounds.maxX && t.pos.z > st.bounds.minZ && t.pos.z < st.bounds.maxZ);
      if (t.kind === 'stand' || t.kind === 'slider') assert.ok(Math.abs(t.pos.y - (COMBAT.muzzleHeight + 1)) <= 1, 'at the height of the level vulcan');
      if (t.kind === 'drone') assert.ok(t.pos.y >= 40, 'drones fly high');
    }
  }
  assert.equal(createWorld({ stage: stageOf('city'), seed: 7 }).targets.length, 0, 'no targets outside practice');
});

test('an aimed rocket into the bullseye breaks the board for 10 points', () => {
  const w = practiceWorld();
  const f = w.fighters[0];
  Object.assign(f.pos, { x: 0, y: 0, z: 60 });
  const tg = oneBoard(w, 'stand', 0, 14, -10);
  aimedShot(w, tg.pos);
  const ev = eventsOf(w, 'target');
  assert.equal(ev.length, 1, 'one hit');
  assert.equal(ev[0].ring, 0); assert.ok(ev[0].bull && ev[0].broke);
  assert.equal(ev[0].points, PRACTICE.rings[0]);
  const P = w.practice;
  assert.deepEqual([P.score, P.breaks, P.bulls, P.hits, P.shots], [10, 1, 1, 1, 1]);
  assert.ok(!tg.alive);
  assert.equal(w.fighters[1].hp, w.fighters[1].hpMax, 'the board took the rocket, not the dummy behind it');
});

test('an off-centre hit scores its ring, and the kind multiplies it', () => {
  const w = practiceWorld();
  Object.assign(w.fighters[0].pos, { x: 0, y: 0, z: 60 });
  const tg = oneBoard(w, 'slider', 0, 14, -10);
  const off = tg.radius * 0.7;
  aimedShot(w, { x: 0, y: 14 + off, z: -10 });
  const ev = eventsOf(w, 'target')[0];
  assert.ok(ev && ev.broke, 'hit and broken');
  assert.equal(ev.ring, ringOf(off, tg.radius));
  assert.equal(ev.ring, 3);
  assert.equal(ev.points, Math.round(PRACTICE.rings[3] * PRACTICE.kinds.slider.mult));
});

test('vulcan rounds chip a board down, every round counted, and it comes back later', () => {
  const w = practiceWorld();
  Object.assign(w.fighters[0].pos, { x: 0, y: 0, z: 60 });
  const tg = oneBoard(w, 'stand', 0, 14, -10);
  run(w, 30);                                         // locked on the dummy behind the board
  clearEvents(w);
  run(w, sec(1.2), (it) => { it.held.attack = true; });
  const hits = eventsOf(w, 'target');
  assert.ok(hits.length >= 4, `${hits.length} rounds landed`);
  assert.ok(hits.slice(0, -1).every((e) => !e.broke) && hits[hits.length - 1].broke, 'breaks on the round that runs it out');
  const P = w.practice;
  assert.ok(P.shots >= hits.length && P.hits >= hits.length, `shots ${P.shots}, hits ${P.hits}`);
  assert.ok(!tg.alive);
  clearEvents(w);
  run(w, sec(PRACTICE.respawn + 0.2));
  assert.ok(tg.alive && tg.hp === tg.hpMax, 'respawned at full strength');
  assert.equal(eventsOf(w, 'targetUp').length, 1);
});

test('a blade cuts a board down in one swing', () => {
  const w = practiceWorld();
  const f = w.fighters[0];
  Object.assign(f.pos, { x: 0, y: 0, z: 60 });
  oneBoard(w, 'stand', 0, 14, 50);
  run(w, 2, (it, i) => { it.pressed.switch1 = i === 0; });
  run(w, sec(COMBAT.switchDraw) + 2);
  clearEvents(w);
  run(w, sec(0.5), (it, i) => { it.pressed.attack = i === 0; });
  const ev = eventsOf(w, 'target');
  assert.equal(ev.length, 1);
  assert.ok(ev[0].melee && ev[0].broke);
  assert.equal(ev[0].points, PRACTICE.meleePoints);
  assert.equal(w.practice.score, PRACTICE.meleePoints);
});

test('the time attack counts down, runs its minute, then stops scoring', () => {
  const w = practiceWorld('timed');
  const P = w.practice;
  assert.equal(P.phase, 'ready');
  run(w, sec(1), (it) => { it.held.attack = true; });          // firing during the countdown does not count
  assert.equal(P.shots, 0);
  run(w, sec(PRACTICE.ready - 1) + 2);
  assert.equal(P.phase, 'run');
  assert.deepEqual(eventsOf(w, 'count').filter((e) => !e.clock).map((e) => e.n), [2, 1, 0]);
  run(w, sec(PRACTICE.timed) + 2);
  assert.equal(P.phase, 'over');
  assert.equal(P.timeLeft, 0);
  assert.equal(eventsOf(w, 'practiceEnd').length, 1);
  assert.deepEqual(eventsOf(w, 'count').filter((e) => e.clock).map((e) => e.n), [5, 4, 3, 2, 1]);
  const before = P.shots;
  run(w, 30, (it) => { it.held.attack = true; });
  assert.equal(P.shots, before, 'nothing counts once the time is up');
});

test('the dummy goes down without ending the session and stands up again', () => {
  const w = practiceWorld();
  const [me, dummy] = w.fighters;
  clearEvents(w);
  applyDamage(w, dummy, 5000, 'ranged', me, {});
  assert.ok(dummy.dead && !w.winner, 'no winner in practice');
  assert.ok(eventsOf(w, 'ko')[0].practice);
  assert.ok(w.practice.dummyDamage > 0);
  run(w, sec(PRACTICE.dummyRevive) + 2);
  assert.ok(!dummy.dead && dummy.hp === dummy.hpMax);
  assert.equal(eventsOf(w, 'revive').length, 1);
  assert.deepEqual([dummy.pos.x, dummy.pos.z], [w.stage.spawns[1].pos.x, w.stage.spawns[1].pos.z]);
});

test('a practice world copies and snapshots like any other', () => {
  const w = practiceWorld('timed');
  run(w, sec(4), (it) => { it.held.attack = true; it.move.x = 0.3; });
  const copy = cloneWorld(w), fresh = practiceWorld('timed');
  applySnapshot(fresh, JSON.parse(JSON.stringify(serializeWorld(w))));
  for (let i = 0; i < 200; i++) {
    const it = createIntent(); it.held.attack = i % 3 === 0; it.move.z = -1;
    for (const x of [w, copy, fresh]) stepWorld(x, [it, createIntent()], DT);
  }
  assert.equal(hashWorld(copy), hashWorld(w));
  assert.equal(hashWorld(fresh), hashWorld(w));
});
