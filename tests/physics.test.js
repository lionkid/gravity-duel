/* Headless physics checks. Run: node tests/physics.test.js */
'use strict';
require('../src/config.js');
require('../src/physics.js');
const GD = globalThis.GD;
const assert = require('assert');

const idle = () => ({ up: false, down: false, left: false, right: false, attack: false, sub: false, guard: false, switch: false, dash: false, pressed: {} });
function run(world, frames, make1, make2) {
  for (let i = 0; i < frames; i++) {
    GD.stepWorld(world, [make1 ? make1(i) : idle(), make2 ? make2(i) : idle()], GD.DT);
  }
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('fighter rests on the ground on Earth', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  run(w, 60);
  assert.strictEqual(w.fighters[0].y, GD.ARENA.groundY);
  assert.ok(w.fighters[0].onGround);
});

test('tapping up jumps to a sensible apex and lands again', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  let minY = Infinity, landedAt = -1;
  for (let i = 0; i < 180; i++) {
    const inp = idle(); if (i === 0) { inp.up = true; inp.pressed = { up: true }; }
    GD.stepWorld(w, [inp, idle()], GD.DT);
    minY = Math.min(minY, f.y);
    if (i > 2 && f.onGround && landedAt < 0) landedAt = i;
  }
  const apex = GD.ARENA.groundY - minY;
  assert.ok(apex > 100 && apex < 160, 'apex ' + apex);
  assert.ok(landedAt > 40 && landedAt < 80, 'landed at frame ' + landedAt);
});

test('holding up engages the jet, spends fuel, then overheats', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  let boosted = false, overheated = false;
  for (let i = 0; i < 600; i++) {
    const inp = idle(); inp.up = true; if (i === 0) inp.pressed = { up: true };
    GD.stepWorld(w, [inp, idle()], GD.DT);
    if (f.boosting) boosted = true;
    if (f.overheat) { overheated = true; break; }
  }
  assert.ok(boosted, 'booster never engaged');
  assert.ok(overheated, 'fuel never ran out');
});

test('walking into a platform from below does not snag, landing on it works', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  const p = w.stage.platforms[0];
  f.x = p.x + p.w / 2; f.y = p.y - 60; f.prevY = f.y; f.onGround = false; f.vy = 0;
  run(w, 60);
  assert.strictEqual(f.y, p.y);
  assert.strictEqual(f.groundRef, p);
});

test('holding down drops through a platform, a tap does not', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  const p = w.stage.platforms[0];
  f.x = p.x + p.w / 2; f.y = p.y; f.prevY = f.y; f.onGround = true; f.groundRef = p;
  run(w, 6, () => Object.assign(idle(), { down: true }));    // 0.1 s tap
  run(w, 30);
  assert.strictEqual(f.y, p.y, 'a short tap should not drop');
  run(w, 90, (i) => Object.assign(idle(), { down: i < 20 }));
  assert.strictEqual(f.y, GD.ARENA.groundY);
});

test('faster mech walks faster (balance stat applied)', () => {
  const w = GD.createWorld('earth', 'ax07', 'zr06');
  run(w, 30, () => Object.assign(idle(), { right: true }), () => Object.assign(idle(), { left: true }));
  const [slow, fast] = w.fighters;
  assert.ok(Math.abs(fast.vx) > Math.abs(slow.vx));
});

test('fighters never overlap after walking into each other on Earth', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  run(w, 240, () => Object.assign(idle(), { right: true }), () => Object.assign(idle(), { left: true }));
  const [a, b] = w.fighters;
  const gap = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  assert.ok(gap > -T(), 'overlap ' + gap);
  function T() { return GD.TUNING.softPushMax; }
});

test('pushing an opponent into the wall keeps both inside the arena', () => {
  const w = GD.createWorld('earth', 'ax07', 'zr06');
  run(w, 400, () => Object.assign(idle(), { right: true }));
  const [a, b] = w.fighters;
  assert.ok(b.x <= GD.ARENA.w - b.w / 2 + 1e-6);
  assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 1e-6);
});

test('Earth dash moves quickly and costs fuel', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  const x0 = f.x, fuel0 = f.fuel;
  run(w, 12, (i) => { const inp = idle(); if (i === 0) { inp.dash = true; inp.pressed = { dash: true }; } return inp; });
  assert.ok(f.x - x0 > 70, 'dash distance ' + (f.x - x0));
  assert.ok(f.fuel < fuel0);
});

test('space: no gravity, fighter stays put without input', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06');
  const f = w.fighters[0];
  const y0 = f.y;
  run(w, 120);
  assert.strictEqual(f.y, y0);
});

test('space: thrust builds momentum that keeps drifting after release', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06');
  const f = w.fighters[0];
  run(w, 30, () => Object.assign(idle(), { right: true }));
  const vAfterThrust = f.vx;
  run(w, 30);
  assert.ok(vAfterThrust > 100);
  assert.ok(f.vx > vAfterThrust * 0.8, 'drift decayed too fast: ' + f.vx);
});

test('space: guarding fires retro thrusters and brakes to a stop', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06');
  const f = w.fighters[0];
  run(w, 30, () => Object.assign(idle(), { down: true }));
  run(w, 40, () => Object.assign(idle(), { guard: true }));
  assert.ok(Math.hypot(f.vx, f.vy) < 1, 'still moving ' + Math.hypot(f.vx, f.vy));
});

test('space: fighter bounces off arena bounds', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06');
  const f = w.fighters[0];
  run(w, 240, () => Object.assign(idle(), { up: true }));
  assert.ok(f.y - f.h >= GD.ARENA.ceilingY);
});

test('space: overheated booster cannot thrust until fuel recovers', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06');
  const f = w.fighters[0];
  f.fuel = 0.1;
  run(w, 5, () => Object.assign(idle(), { right: true }));
  assert.ok(f.overheat);
  f.vx = 0; f.vy = 0;
  run(w, 10, () => Object.assign(idle(), { right: true }));
  assert.strictEqual(f.vx, 0);
});

test('stats keep the 20-point balance rule', () => {
  for (const m of GD.MECHS) assert.strictEqual(m.hp + m.spd + m.arm + m.en + m.bst, 20, m.id);
});

test('aiming down from a platform does not drop through it', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  const f = w.fighters[0];
  const p = w.stage.platforms[0];
  f.x = p.x + p.w / 2; f.y = p.y; f.prevY = f.y; f.onGround = true; f.groundRef = p;
  run(w, 40, () => Object.assign(idle(), { down: true, attack: true }));
  assert.strictEqual(f.y, p.y);
});

console.log(`\n${passed} tests passed`);
