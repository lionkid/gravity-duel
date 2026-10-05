/* Weapon balance guard: hard AI vs hard AI on the same frame, only one weapon slot differs.
 * Every weapon must win between 30% and 70% of its games on every stage (no weapon dominates),
 * and every weapon must be below 60% on at least one stage (each one has a weak stage or a counter).
 * Matches are fully seeded, so this test is deterministic. Run: node tests/balance.test.js */
'use strict';
for (const f of ['config', 'physics', 'combat', 'ai']) require(`../src/${f}.js`);
const GD = globalThis.GD;
const assert = require('assert');
const N = 80;

function match(stage, l1, l2, seed) {
  const w = GD.createWorld(stage, 'ax01', 'ax01', { 1: l1, 2: l2 }, seed * 7 + 3);
  const a1 = GD.createAI('hard', seed * 3 + 1), a2 = GD.createAI('hard', seed * 5 + 2);
  for (let i = 0; i < 120 * 60; i++) {
    GD.stepWorld(w, [GD.aiInput(a1, w, 1, GD.DT), GD.aiInput(a2, w, 2, GD.DT)], GD.DT);
    w.events.length = 0;
    if (w.winner) return w.winner;
  }
  const [f1, f2] = w.fighters;
  return f1.hp / f1.stats.hpMax >= f2.hp / f2.stats.hpMax ? 1 : 2;
}

function rates(slot, list, fixed) {
  const out = {};
  for (const stage of GD.STAGE_ORDER) {
    const wins = Object.fromEntries(list.map((a) => [a, 0]));
    const games = Object.fromEntries(list.map((a) => [a, 0]));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      for (let s = 1; s <= N; s++) {
        const flip = s % 2 === 0;
        const la = Object.assign({}, fixed, { [slot]: list[i] }), lb = Object.assign({}, fixed, { [slot]: list[j] });
        const r = flip ? match(stage, lb, la, s) : match(stage, la, lb, s);
        wins[(flip ? r === 2 : r === 1) ? list[i] : list[j]]++;
        games[list[i]]++; games[list[j]]++;
      }
    }
    out[stage] = Object.fromEntries(list.map((a) => [a, Math.round(100 * wins[a] / games[a])]));
  }
  return out;
}

let passed = 0;
for (const [slot, list, fixed] of [['ranged', GD.RANGED.map((w) => w.id), { melee: 'saber' }], ['melee', GD.MELEE.map((w) => w.id), { ranged: 'beam' }]]) {
  const r = rates(slot, list, fixed);
  console.log(`  ${slot}: ${JSON.stringify(r)}`);
  for (const stage of GD.STAGE_ORDER) for (const id of list) {
    assert.ok(r[stage][id] >= 30 && r[stage][id] <= 70, `${id} wins ${r[stage][id]}% on ${stage}`);
  }
  for (const id of list) {
    assert.ok(GD.STAGE_ORDER.some((s) => r[s][id] < 60), `${id} is strong on every stage`);
  }
  passed++;
  console.log(`  ok  ${slot} weapons stay inside 30-70% on every stage`);
}
console.log(`\n${passed} tests passed`);
