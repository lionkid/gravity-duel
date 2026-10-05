/* Computer opponent checks. Run: node tests/ai.test.js */
'use strict';
require('../src/config.js');
require('../src/physics.js');
require('../src/combat.js');
require('../src/ai.js');
const GD = globalThis.GD;
const assert = require('assert');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }
const foe = (mech, ranged, melee) => ({ mech, ranged, melee });

function match(l1, l2, stage, seed, limit = 120) {
  const c1 = GD.cpuChoose(l1, stage, foe('ax01', 'beam', 'saber'), seed);
  const c2 = GD.cpuChoose(l2, stage, c1, seed + 7);
  const w = GD.createWorld(stage, c1.mech, c2.mech, { 1: c1, 2: c2 }, seed * 11 + 3);
  const a1 = GD.createAI(l1, seed * 3 + 1), a2 = GD.createAI(l2, seed * 5 + 2);
  const stats = { switches: 0, vulcan: 0 };
  for (let i = 0; i < limit * 60; i++) {
    GD.stepWorld(w, [GD.aiInput(a1, w, 1, GD.DT), GD.aiInput(a2, w, 2, GD.DT)], GD.DT);
    for (const e of w.events) {
      if (e.type === 'switch') stats.switches++;
      if (e.type === 'fire' && e.weapon === 'vulcan') stats.vulcan++;
    }
    w.events.length = 0;
    if (w.winner) return Object.assign(stats, { winner: w.winner, t: i / 60 });
  }
  return Object.assign(stats, { winner: 0, t: limit });
}

// ---- loadout choice ----
test('CPU picks are valid and repeatable for the same seed', () => {
  for (const level of GD.AI_ORDER) for (const stage of GD.STAGE_ORDER) {
    const a = GD.cpuChoose(level, stage, foe('zr06', 'bazooka', 'axe'), 42);
    const b = GD.cpuChoose(level, stage, foe('zr06', 'bazooka', 'axe'), 42);
    assert.deepStrictEqual(a, b);
    assert.ok(GD.MECHS.some((m) => m.id === a.mech), a.mech);
    assert.ok(GD.RANGED.some((w) => w.id === a.ranged), a.ranged);
    assert.ok(GD.MELEE.some((w) => w.id === a.melee), a.melee);
    assert.ok(a.reasons.length > 0);
  }
});

test('normal and hard never bring a ranged weapon that is weak on the stage', () => {
  for (const level of ['normal', 'hard']) for (const stage of GD.STAGE_ORDER) for (let s = 1; s <= 60; s++) {
    const c = GD.cpuChoose(level, stage, foe(GD.MECHS[s % 4].id, GD.RANGED[s % 4].id, GD.MELEE[s % 3].id), s);
    assert.notStrictEqual(GD.aff(GD.weaponById(c.ranged), stage), 'bad', `${level} ${stage} picked ${c.ranged}`);
  }
});

test('hard counters a thin-armored frame with blast weapons in space', () => {
  let blast = 0;
  for (let s = 1; s <= 30; s++) if (GD.weaponById(GD.cpuChoose('hard', 'space', foe('zr06', 'beam', 'saber'), s).ranged).blast) blast++;
  assert.ok(blast >= 27, 'blast picks ' + blast);
});

test('easy varies its picks', () => {
  const seen = new Set();
  for (let s = 1; s <= 30; s++) seen.add(GD.cpuChoose('easy', 'earth', foe('ax01', 'beam', 'saber'), s).mech);
  assert.ok(seen.size >= 3);
});

// ---- controls ----
test('AI input has every key and only reports presses on new holds', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const ai = GD.createAI('hard', 9);
  let prev = {};
  for (let i = 0; i < 600; i++) {
    const inp = GD.aiInput(ai, w, 2, GD.DT);
    for (const k of ['up', 'down', 'left', 'right', 'attack', 'sub', 'guard', 'switch', 'dash']) assert.strictEqual(typeof inp[k], 'boolean', k);
    for (const k of Object.keys(inp.pressed)) assert.ok(inp[k] && !prev[k], 'bad edge ' + k);
    prev = inp;
    GD.stepWorld(w, [GD.IDLE_INPUT, inp], GD.DT);
  }
});

test('the AI fights back: it damages an idle player within 20 s on both stages', () => {
  for (const stage of GD.STAGE_ORDER) for (const level of GD.AI_ORDER) {
    const c = GD.cpuChoose(level, stage, foe('ax01', 'beam', 'saber'), 3);
    const w = GD.createWorld(stage, 'ax01', c.mech, { 1: { ranged: 'beam', melee: 'saber' }, 2: c }, 9);
    const ai = GD.createAI(level, 5);
    for (let i = 0; i < 20 * 60 && !w.winner; i++) GD.stepWorld(w, [GD.IDLE_INPUT, GD.aiInput(ai, w, 2, GD.DT)], GD.DT);
    assert.ok(w.fighters[0].hp < w.fighters[0].stats.hpMax, `${level} on ${stage} never hit`);
  }
});

test('difficulty ordering holds: hard > normal > easy, and every match finishes', () => {
  for (const stage of GD.STAGE_ORDER) for (const [hi, lo, need] of [['hard', 'easy', 16], ['normal', 'easy', 15], ['hard', 'normal', 13]]) {
    let wins = 0;
    for (let s = 1; s <= 20; s++) {
      const flip = s % 2 === 0;
      const r = flip ? match(lo, hi, stage, s) : match(hi, lo, stage, s);
      assert.ok(r.winner, `${hi} vs ${lo} on ${stage} seed ${s} did not finish`);
      if (r.winner === (flip ? 2 : 1)) wins++;
    }
    assert.ok(wins >= need, `${hi} beat ${lo} only ${wins}/20 on ${stage}`);
  }
});

test('hard uses weapon swaps and the vulcan during a match', () => {
  let switches = 0, vulcan = 0;
  for (let s = 1; s <= 6; s++) { const r = match('hard', 'hard', s % 2 ? 'earth' : 'space', s); switches += r.switches; vulcan += r.vulcan; }
  assert.ok(switches > 0, 'never switched');
  assert.ok(vulcan > 0, 'never used the vulcan');
});

console.log(`\n${passed} tests passed`);
