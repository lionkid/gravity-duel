// The orbital deck: station modules on open deck, rocks drifting through (pushing mechs aside,
// carrying the ones that stand on them, stopping shots, breaking the lock-on) and meteor strikes that
// are marked before they land, hurt more the closer they burst, and stay deterministic for LAN play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld, cloneWorld, serializeWorld, applySnapshot, hashWorld } from '../rules/world.js';
import { createAI, aiIntent } from '../ai/brain.js';
import { createIntent } from '../../../engine/input/intent.js';
import { dirToAim } from '../../../engine/core/math.js';
import { BODY, STAGES, METEOR, COMBAT } from '../config.js';
import { run, eventsOf, clearEvents, DT } from './helpers.js';
import { boxAt, overlaps } from '../../../engine/sim/aabb.js';

const opts = Object.assign({ seed: 7 }, STAGES.space);
const stageOf = (seed = 7) => generateCity(Object.assign({}, opts, { seed }));
const space = (seed = 7) => createWorld({ stage: stageOf(seed), seed });
const sec = (s) => Math.round(s / DT);
// Every rock parked far outside the arena, no strikes; then one rock where the test wants it.
function oneRock(w, x, y, z, r, vx = 0, vz = 0) {
  for (const rk of w.meteors.rocks) Object.assign(rk, { x: 5000 + rk.id * 200, y0: 50, y: 50, z: 5000, vx: 0, vz: 0, left: 1e9 });
  const rk = w.meteors.rocks[0];
  Object.assign(rk, { x, y, y0: y, z, r, vx, vz, left: 1e9, phase: 0 });
  return rk;
}
function noRocks(w) { for (const rk of w.meteors.rocks) Object.assign(rk, { x: 5000 + rk.id * 200, y0: 50, y: 50, z: 5000, vx: 0, vz: 0, left: 1e9 }); }
function noStrikes(w) { w.meteors.next = 1e9; w.meteors.strikes = []; }
// The next strike right now; returns its warning.
function strikeNow(w) {
  w.meteors.next = 0;
  clearEvents(w);
  run(w, 1);
  const warn = eventsOf(w, 'meteorWarn');
  w.meteors.next = 1e9;
  return warn;
}

test('the orbital deck: modules, masts and cargo yards on open deck, with open lanes for the rocks', () => {
  const st = stageOf();
  assert.deepEqual(stageOf(), st, 'deterministic');
  assert.equal(st.highway, null);
  assert.equal(st.gravity, STAGES.space.gravity);
  assert.ok(st.hazards && st.hazards.meteors && st.hazards.meteors.lanes.length === STAGES.space.blocks - 1);
  for (const id of ['city', 'moon', 'desert']) assert.ok(!(generateCity(Object.assign({ seed: 7 }, STAGES[id])).hazards || {}).meteors, `no meteors on the ${id}`);
  const tags = {};
  for (const s of st.statics) tags[s.tag] = (tags[s.tag] || 0) + 1;
  assert.ok(tags.building > 40 && tags.crate > 20, JSON.stringify(tags));
  assert.ok(st.visual.beacons.length > 0 && st.statics.some((s) => s.max[1] > 60), 'antenna masts with beacons');
  // Nothing stands in the lanes, so a rock can always drift down one.
  const half = STAGES.space.street / 2;
  for (const c of st.hazards.meteors.lanes) {
    assert.ok(!st.statics.some((s) => s.min[0] < c + half && s.max[0] > c - half), `lane x = ${c} is open`);
    assert.ok(!st.statics.some((s) => s.min[2] < c + half && s.max[2] > c - half), `lane z = ${c} is open`);
  }
  for (const sp of st.spawns) assert.ok(!st.statics.some((s) => overlaps(boxAt(sp.pos.x, 0, sp.pos.z, BODY.w, BODY.h, BODY.d), s)), 'spawn in the open');
  const w = space();
  assert.equal(w.meteors.rocks.length, METEOR.rocks.low + METEOR.rocks.mid + METEOR.rocks.high);
  for (const sp of st.spawns) for (const rk of w.meteors.rocks) {
    if (rk.y - rk.r < 20) assert.ok(Math.hypot(rk.x - sp.pos.x, rk.z - sp.pos.z) > rk.r + 25, 'no low rock on a spawn');
  }
  assert.equal(createWorld({ stage: generateCity(Object.assign({ seed: 7 }, STAGES.city)), seed: 7 }).meteors, null);
});

test('rocks drift clear of every wall and roof, leave the arena and come round again', () => {
  const w = space();
  noStrikes(w);
  const st = w.stage;
  let worst = Infinity;
  for (let i = 0; i < sec(420); i++) {
    stepWorld(w, [], DT);
    w.events = [];
    if (i % 30) continue;
    for (const rk of w.meteors.rocks) {
      for (const s of st.statics) {
        // Distance from the rock's surface to the box grown by the clearance (sideways and over roofs).
        const mx = METEOR.clear - 0.01, my = METEOR.clearY - 0.01;
        const cx = Math.max(s.min[0] - mx, Math.min(rk.x, s.max[0] + mx)), cy = Math.max(s.min[1] - my, Math.min(rk.y, s.max[1] + my)), cz = Math.max(s.min[2] - mx, Math.min(rk.z, s.max[2] + mx));
        worst = Math.min(worst, Math.hypot(cx - rk.x, cy - rk.y, cz - rk.z) - rk.r);
      }
      assert.ok(rk.y - rk.r > 0, 'never in the deck');
      if (rk.band === 'mid') assert.ok(rk.y - rk.r >= BODY.h + 2, 'room to walk under a middle rock');
    }
  }
  assert.ok(worst >= 0, `a rock came ${(-worst).toFixed(1)} m too close to a building`);
  assert.ok(w.meteors.rocks.every((rk) => rk.cycle >= 1), 'every rock crossed and came back');
});

test('a drifting rock shoves a mech aside, and a mech cannot walk through one', () => {
  const w = space();
  noStrikes(w);
  const f = w.fighters[0];
  const z0 = f.pos.z;
  const rk = oneRock(w, f.pos.x - 40, 13, f.pos.z, 11, 7, 0);     // coming down the lane at the mech
  clearEvents(w);
  let bumped = false;
  for (let i = 0; i < sec(8); i++) { run(w, 1); if (eventsOf(w, 'bump').length) bumped = true; clearEvents(w); }
  assert.ok(bumped, 'a bump when it arrives');
  const d = Math.hypot(f.pos.x - rk.x, f.pos.z - rk.z);
  assert.ok(d >= rk.r + BODY.w / 2 - 1, `not inside the rock: ${d.toFixed(1)} m from its axis`);
  assert.ok(f.pos.x > 15 || Math.abs(f.pos.z - z0) > 4, `moved by the rock: now at ${f.pos.x.toFixed(1)}, ${f.pos.z.toFixed(1)}`);
  // Walking straight at a rock that is not moving stops at its surface.
  const w2 = space(); noStrikes(w2);
  const g = w2.fighters[0];
  const rk2 = oneRock(w2, g.pos.x, 13, g.pos.z - 40, 12);
  run(w2, sec(4), (it) => { it.move.z = -1; });
  const gap = Math.hypot(g.pos.x - rk2.x, g.pos.z - rk2.z) - BODY.d / 2;
  assert.ok(gap > rk2.r - 1.5 && gap < rk2.r + 2, `stopped at the rock: ${gap.toFixed(1)} m (radius ${rk2.r})`);
});

test('a mech lands on a rock, stands on it, rides it and jumps off', () => {
  const w = space();
  noStrikes(w);
  const f = w.fighters[0];
  const rk = oneRock(w, f.pos.x, 46, f.pos.z, 14, 5, 0);
  Object.assign(f.pos, { x: rk.x, y: 70, z: rk.z });
  f.onGround = false;
  clearEvents(w);
  run(w, sec(1.5));
  assert.equal(eventsOf(w, 'land').length, 1, 'one landing');
  assert.equal(f.rockOn, rk.id);
  assert.ok(f.onGround && Math.abs(f.pos.y - (rk.y + rk.r)) < 0.6, `on top at ${f.pos.y.toFixed(1)} (top ${(rk.y + rk.r).toFixed(1)})`);
  const x0 = f.pos.x, rx0 = rk.x;
  f.fuel = 1;
  clearEvents(w);
  run(w, sec(2));
  assert.equal(eventsOf(w, 'land').length, 0, 'no repeated landings while standing');
  assert.ok(Math.abs((f.pos.x - x0) - (rk.x - rx0)) < 0.5, `carried along: ${(f.pos.x - x0).toFixed(1)} m with the rock's ${(rk.x - rx0).toFixed(1)}`);
  assert.ok(f.onGround && f.rockOn === rk.id);
  assert.ok(f.fuel > 2, 'fuel comes back while standing on a rock');
  run(w, sec(0.6), (it, i) => { it.pressed.boost = i === 0; it.held.boost = true; it.move.z = 1; });
  assert.equal(f.rockOn, 0, 'jumped off');
  assert.ok(f.pos.y > rk.y + rk.r + 5);
});

test('rocks stop shots and break the lock-on', () => {
  const w = space();
  noStrikes(w);
  const [a, b] = w.fighters;
  Object.assign(a.pos, { x: 0, y: 0, z: 60 }); Object.assign(b.pos, { x: 0, y: 0, z: -60 });
  noRocks(w);
  run(w, 10);
  assert.ok(a.lockLos, 'sees the other mech with no rock between');
  const rk = oneRock(w, 0, 13, 0, 12);
  run(w, 2);
  assert.ok(!a.lockLos && !b.lockLos, 'the rock hides them from each other');
  run(w, 2, (it, i) => { it.pressed.switch3 = i === 0; });
  run(w, sec(COMBAT.switchDraw) + 2);
  const eye = { x: a.pos.x, y: a.pos.y + COMBAT.muzzleHeight + 2, z: a.pos.z };
  const aim = dirToAim({ x: b.pos.x - eye.x, y: b.pos.y + 11 - eye.y, z: b.pos.z - eye.z });
  run(w, 12, (it) => { it.held.aim = true; Object.assign(it.aim, aim); });
  clearEvents(w);
  run(w, 40, (it, i) => { it.held.aim = true; Object.assign(it.aim, aim); it.pressed.attack = i === 0; });
  const imp = eventsOf(w, 'impact');
  assert.equal(imp.length, 1);
  assert.equal(imp[0].rock, rk.id, 'burst on the rock');
  assert.ok(Math.abs(imp[0].z - (rk.z + rk.r)) < 4, `at the rock's face: z ${imp[0].z.toFixed(1)}`);
  assert.equal(b.hp, b.hpMax, 'nothing got through');
});

test('a meteor strike is marked first, lands on the mark and hurts more near its centre', () => {
  const w = space();
  noRocks(w);
  const [a, b] = w.fighters;
  const warn = strikeNow(w);
  assert.equal(warn.length, 1);
  const s = w.meteors.strikes[0];
  const target = w.fighters[warn[0].target - 1];
  assert.ok(Math.hypot(warn[0].x - target.pos.x, warn[0].z - target.pos.z) <= METEOR.spread + 0.01, 'aimed at a mech');
  assert.ok(warn[0].eta >= METEOR.flight[0] && warn[0].eta <= METEOR.flight[1]);
  // One mech beside the mark (on the far side from the meteor's approach), the other far away.
  const vh = Math.hypot(s.vx, s.vz), ux = s.vx / vh, uz = s.vz / vh;
  const near = target, far = target === a ? b : a;
  Object.assign(near.pos, { x: s.ax + ux * 14, y: 0, z: s.az + uz * 14 });
  Object.assign(far.pos, { x: s.ax + ux * 120, y: 0, z: s.az + uz * 120 });
  near.vel.x = near.vel.z = 0; near.onGround = true;
  clearEvents(w);
  let hit = null, t = 0;
  while (!hit && t < sec(3)) { run(w, 1); hit = eventsOf(w, 'meteorHit')[0]; t++; if (!hit) clearEvents(w); }
  assert.ok(hit, 'it landed');
  assert.ok(Math.abs(t * DT - warn[0].eta) < 0.1, `on time: ${(t * DT).toFixed(2)} s for ${warn[0].eta.toFixed(2)} s`);
  assert.equal(hit.on, 'ground');
  assert.ok(Math.hypot(hit.x - s.ax, hit.z - s.az) < 1.5, 'where the mark was');
  const dmg = eventsOf(w, 'hit');
  assert.equal(dmg.length, 1, 'only the mech in the blast');
  assert.equal(dmg[0].id, near.id);
  const d = Math.hypot(dmg[0].x - hit.x, dmg[0].y - hit.y, dmg[0].z - hit.z);       // to the nearest point of the body
  const want = Math.round(METEOR.dmg[0] + (METEOR.dmg[1] - METEOR.dmg[0]) * d / METEOR.blast);
  assert.ok(d > 4 && Math.abs(dmg[0].amount - want) <= 1, `${dmg[0].amount} damage ${d.toFixed(1)} m from the burst (expected ${want})`);
  assert.ok(dmg[0].amount < METEOR.dmg[0] && dmg[0].amount > METEOR.dmg[1]);
  assert.equal(far.hp, far.hpMax);
  assert.ok(!near.onGround && near.vel.y > 0 && near.vel.x * ux + near.vel.z * uz > 10, 'thrown away from the burst');
});

// Moves a strike so it lands on (x, y, z) at the same time, from the same direction.
function aimStrike(s, x, y, z) {
  Object.assign(s, { ax: x, ay: y, az: z, x: x - s.vx * s.eta, y: y + METEOR.head - s.vy * s.eta, z: z - s.vz * s.eta });
}
function untilBurst(w, max = sec(3)) {
  for (let i = 0; i < max; i++) { run(w, 1); const h = eventsOf(w, 'meteorHit')[0]; if (h) return h; }
  return null;
}

test('a wall shelters a mech from the blast, and a rock in the way takes the meteor', () => {
  // A pillar in the middle of the open crossing; the burst on the meteor's side of it, the mech behind.
  const blast = (pillar) => {
    const st = stageOf();
    if (pillar) st.statics.push({ min: [-3, 0, -3], max: [3, 40, 3], tag: 'building', tint: 0, seed: 1 });
    const w = createWorld({ stage: st, seed: 7 });
    noRocks(w);
    const warn = strikeNow(w);
    const s = w.meteors.strikes[0];
    const vh = Math.hypot(s.vx, s.vz), ux = s.vx / vh, uz = s.vz / vh;
    aimStrike(s, -ux * 10, 0, -uz * 10);
    const target = w.fighters[warn[0].target - 1], other = w.fighters.find((f) => f !== target);
    Object.assign(target.pos, { x: ux * 13, y: 0, z: uz * 13 });
    Object.assign(other.pos, { x: -ux * 200, y: 0, z: -uz * 200 });
    clearEvents(w);
    return { hit: untilBurst(w), target };
  };
  const open = blast(false), shut = blast(true);
  assert.equal(open.hit.on, 'ground'); assert.equal(shut.hit.on, 'ground');
  assert.ok(open.target.hp < open.target.hpMax, 'in the open the blast hurts');
  assert.equal(shut.target.hp, shut.target.hpMax, 'behind the pillar it does not');
  // A rock across the meteor's path, 80 m before the mark: the meteor bursts on it, far from the mech.
  const w = space();
  noRocks(w);
  const warn = strikeNow(w);
  const s = w.meteors.strikes[0];
  const target = w.fighters[warn[0].target - 1];
  const L = 80 / METEOR.strikeSpeed;
  const rk = oneRock(w, s.ax - s.vx * L, s.ay + METEOR.head - s.vy * L, s.az - s.vz * L, 12);
  clearEvents(w);
  const hit = untilBurst(w);
  assert.equal(hit.on, 'rock');
  assert.ok(Math.hypot(hit.x - rk.x, hit.y - rk.y, hit.z - rk.z) < rk.r + METEOR.head + 0.5, 'on the rock');
  assert.equal(target.hp, target.hpMax, 'the rock took it');
});

test('a meteor that knocks a mech out gives the win to the other one, and no more fall', () => {
  const w = space();
  noRocks(w);
  const warn = strikeNow(w);
  const target = w.fighters[warn[0].target - 1], other = w.fighters.find((f) => f !== target);
  target.hp = 30;
  clearEvents(w);
  run(w, sec(2.5));
  const ko = eventsOf(w, 'ko')[0];
  assert.ok(ko && ko.id === target.id, 'knocked out by the meteor');
  assert.equal(ko.cause, 'meteor');
  assert.equal(w.winner, other.id);
  assert.equal(ko.winner, other.id);
  w.meteors.next = 0;
  clearEvents(w);
  run(w, sec(30));
  assert.equal(eventsOf(w, 'meteorWarn').length, 0, 'no strikes after the match is decided');
  assert.equal(other.hp, other.hpMax);
});

test('strikes take turns between the mechs and come every few seconds', () => {
  const w = space();
  noRocks(w);
  const counts = { 1: 0, 2: 0 }, salvos = { 1: 0, 2: 0 };
  let warns = 0;
  for (let i = 0; i < sec(240); i++) {
    for (const f of w.fighters) f.hp = f.hpMax;          // nobody is knocked out, so the strikes go on
    run(w, 1);
    for (const e of eventsOf(w, 'meteorWarn')) { warns++; counts[e.target]++; if (e.salvo) salvos[e.target]++; }
    clearEvents(w);
  }
  const launches = warns - (salvos[1] + salvos[2]) * 2 / 3;
  assert.ok(launches >= 240 / METEOR.every[1] - 2 && launches <= 240 / METEOR.every[0], `${launches} strikes in 4 minutes`);
  assert.ok(Math.abs(counts[1] - counts[2]) <= 4, `fair: ${counts[1]} and ${counts[2]}`);
  assert.ok(salvos[1] > 0 && salvos[2] > 0, 'both get salvos');
});

// Strikes aimed at each seat and how many of them hurt it, over `secs` seconds with health topped up
// so nobody is knocked out. levels: an AI level per seat, or null to stand still.
function strikeRecord(levels, secs, seed) {
  const w = space(seed);
  const ais = levels.map((l, i) => (l ? createAI(l, i + 1) : null)), idle = createIntent();
  const aimed = { 1: 0, 2: 0 }, hurt = { 1: 0, 2: 0 };
  for (let i = 0; i < sec(secs); i++) {
    for (const f of w.fighters) f.hp = f.hpMax;
    stepWorld(w, ais.map((ai, k) => (ai ? aiIntent(ai, w, k + 1, DT) : idle)), DT);
    for (const e of w.events) { if (e.t === 'meteorWarn') aimed[e.target]++; if (e.t === 'hit' && !e.by) hurt[e.id]++; }
    w.events = [];
  }
  return { aimed, hurt };
}

test('the computer steps out of the strike circles; a mech that stands still gets hit', () => {
  const idle = strikeRecord([null, null], 240, 5);
  const still = idle.hurt[1] + idle.hurt[2], all = idle.aimed[1] + idle.aimed[2];
  assert.ok(all >= 20 && still >= all * 0.5, `standing still: hurt by ${still} of ${all}`);
  // Two seeds' worth of hard and normal pilots against the same strikes.
  let aimed = { hard: 0, normal: 0 }, hurt = { hard: 0, normal: 0 };
  for (const [seed, levels] of [[11, ['hard', 'normal']], [23, ['normal', 'hard']]]) {
    const r = strikeRecord(levels, 240, seed);
    levels.forEach((l, i) => { aimed[l] += r.aimed[i + 1]; hurt[l] += r.hurt[i + 1]; });
  }
  const idleShare = still / all;
  assert.ok(aimed.hard >= 20 && hurt.hard / aimed.hard <= idleShare * 0.5, `hard: hurt by ${hurt.hard} of ${aimed.hard} (standing still ${(idleShare * 100).toFixed(0)}%)`);
  assert.ok(aimed.normal >= 20 && hurt.normal / aimed.normal <= idleShare * 0.75, `normal: hurt by ${hurt.normal} of ${aimed.normal}`);
});

test('a space match between computers runs, and copies and snapshots agree', () => {
  const w = space(11);
  const ai1 = createAI('hard', 1), ai2 = createAI('normal', 2);
  for (let i = 0; i < sec(40) && !w.winner; i++) {
    stepWorld(w, [aiIntent(ai1, w, 1, DT), aiIntent(ai2, w, 2, DT)], DT);
    w.events = [];
  }
  for (const f of w.fighters) assert.ok(Math.abs(f.pos.x) <= w.stage.bounds.maxX && Math.abs(f.pos.z) <= w.stage.bounds.maxZ);
  assert.ok(w.fighters.some((f) => f.hp < f.hpMax), 'they fought');
  const copy = cloneWorld(w), fresh = space(11);
  applySnapshot(fresh, JSON.parse(JSON.stringify(serializeWorld(w))));
  for (let i = 0; i < 900; i++) {
    const it = createIntent(); it.move.x = Math.sin(i / 30); it.held.attack = i % 4 === 0; it.pressed.boost = i % 90 === 0; it.held.boost = i % 90 < 30;
    for (const x of [w, copy, fresh]) stepWorld(x, [it, createIntent()], DT);
  }
  assert.ok(w.meteors.strikes.length + w.meteors.count > 0);
  assert.equal(hashWorld(copy), hashWorld(w));
  assert.equal(hashWorld(fresh), hashWorld(w));
});
