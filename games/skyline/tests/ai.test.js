import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, DT } from './helpers.js';
import { stepWorld } from '../rules/world.js';
import { createAI, aiIntent, AI_ORDER } from '../ai/brain.js';
import { buildNavGrid } from '../ai/nav.js';
import { IDLE_INTENT } from '../../../engine/input/intent.js';
import { generateCity } from '../stages/city.js';
import { STAGES } from '../config.js';

// Runs the AI as fighter 2 against a scripted (or idle) fighter 1 for n ticks.
function duel(w, ai, n, fn) {
  const it = structuredClone(IDLE_INTENT);
  for (let i = 0; i < n; i++) {
    for (const k in it.pressed) it.pressed[k] = false;
    for (const k in it.held) it.held[k] = false;
    it.move.x = 0; it.move.z = 0;
    if (fn) fn(it, i);
    stepWorld(w, [it, aiIntent(ai, w, 2, DT)], DT);
  }
}

test('the nav grid blocks buildings, keeps streets free and routes around a block', () => {
  const stage = generateCity(Object.assign({ seed: 4 }, STAGES.city));
  const nav = buildNavGrid(stage);
  const c = nav.toCell(0, 0);
  assert.ok(nav.free(c.ix, c.iz), 'the central crossing is free');
  const inside = stage.statics.find((s) => s.tag === 'building');
  const bc = nav.toCell((inside.min[0] + inside.max[0]) / 2, (inside.min[2] + inside.max[2]) / 2);
  assert.ok(!nav.free(bc.ix, bc.iz), 'a building interior is blocked');
  const pitch = STAGES.city.pitch;
  const path = nav.findPath({ x: 0, z: pitch }, { x: 2 * pitch, z: -pitch });
  assert.ok(path.length >= 2, `a route with corners, got ${path.length} points`);
  for (let i = 1; i < path.length; i++) assert.ok(nav.lineFree(path[i - 1].x, path[i - 1].z, path[i].x, path[i].z), 'every leg is clear');
  assert.ok(Math.hypot(path[path.length - 1].x - 2 * pitch, path[path.length - 1].z + pitch) < 1e-6, 'ends at the goal');
});

test('every difficulty finds and damages an idle player within 40 s, hard sooner than easy', () => {
  const times = {};
  for (const level of AI_ORDER) {
    const w = makeWorld({ seed: 2, p1: { z: 60 }, p2: { z: -60 } });
    const ai = createAI(level, 7);
    let t = 0;
    while (t < 40 && w.fighters[0].hp === w.fighters[0].hpMax) { duel(w, ai, 1); t += DT; }
    times[level] = t;
    assert.ok(w.fighters[0].hp < w.fighters[0].hpMax, `${level} never landed a hit`);
  }
  assert.ok(times.hard <= times.easy, `hard ${times.hard.toFixed(1)} s vs easy ${times.easy.toFixed(1)} s`);
});

test('the AI walks around buildings to reach a player it cannot see', () => {
  const pitch = STAGES.city.pitch;
  const w = makeWorld({ seed: 2, p1: { x: 2 * pitch, z: -pitch }, p2: { x: 0, z: pitch } });
  const [p, c] = w.fighters;
  const ai = createAI('normal', 3);
  ai.known = { x: p.pos.x, y: 0, z: p.pos.z, vx: 0, vy: 0, vz: 0 };     // it heard the player over there
  const d0 = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
  duel(w, ai, 60 * 25);
  const d1 = Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z);
  assert.ok(d1 < 70, `closed in through the streets: ${d0.toFixed(0)} m → ${d1.toFixed(0)} m`);
});

test('the AI picks weapons by class and range, and is deterministic for a seed', () => {
  const far = makeWorld({ seed: 5, loadouts: { 2: { weapon: 'ranged' } }, p1: { z: 100 }, p2: { z: -100 } });
  duel(far, createAI('hard', 1), 120);
  assert.equal(far.fighters[1].active, 'ranged', 'a sniper 200 m out draws the rifle');
  const near = makeWorld({ seed: 5, loadouts: { 2: { weapon: 'melee' } }, p1: { z: 15 }, p2: { z: -15 } });
  duel(near, createAI('hard', 1), 120);
  assert.equal(near.fighters[1].active, 'melee', 'a brawler 30 m out draws the blade');
  const a = makeWorld({ seed: 9, p1: { z: 60 }, p2: { z: -60 } }), b = makeWorld({ seed: 9, p1: { z: 60 }, p2: { z: -60 } });
  const script = (it, i) => { it.move.x = Math.sin(i / 40); it.move.z = -0.5; it.held.attack = i % 60 < 30; };
  duel(a, createAI('normal', 11), 600, script); duel(b, createAI('normal', 11), 600, script);
  assert.deepEqual(a.fighters.map((f) => [f.pos, f.hp, f.active]), b.fighters.map((f) => [f.pos, f.hp, f.active]));
});
