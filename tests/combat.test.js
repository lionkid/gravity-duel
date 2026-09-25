/* Headless combat checks. Run: node tests/combat.test.js */
'use strict';
require('../src/config.js');
require('../src/physics.js');
require('../src/combat.js');
const GD = globalThis.GD;
const assert = require('assert');

const idle = () => ({ up: false, down: false, left: false, right: false, attack: false, jump: false, guard: false, switch: false, dash: false, pressed: {} });
const tap = (action, extra) => Object.assign(idle(), extra || {}, { [action]: true, pressed: { [action]: true } });
function run(world, frames, make1, make2) {
  for (let i = 0; i < frames; i++) {
    GD.stepWorld(world, [make1 ? make1(i) : idle(), make2 ? make2(i) : idle()], GD.DT);
  }
}
function place(world, x1, x2) {
  const [a, b] = world.fighters;
  a.x = x1; b.x = x2; a.facing = 1; b.facing = -1;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('beam flies straight on Earth; bazooka drops with gravity', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', { 1: 'beam', 2: 'bazooka' });
  place(w, 100, 600); // P1 fires right, P2 fires left; both shots stay in the arena for 20 frames
  run(w, 1, () => tap('attack'), () => tap('attack'));
  const [beam, rocket] = w.projectiles;
  const y0b = beam.y, y0r = rocket.y;
  run(w, 20);
  assert.strictEqual(w.projectiles.length, 2);
  assert.ok(Math.abs(beam.y - y0b) < 1e-6, 'beam moved vertically');
  assert.ok(rocket.y - y0r > 15, 'rocket did not drop: ' + (rocket.y - y0r));
});

test('same bazooka shot stays level in space', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'bazooka', 2: 'beam' });
  place(w, 100, 900);
  run(w, 1, () => tap('attack'));
  const r = w.projectiles[0];
  const y0 = r.y;
  run(w, 30);
  assert.ok(Math.abs(r.y - y0) < 1e-6);
});

test('grenade lobs upward on Earth and explodes on the ground', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', { 1: 'grenade', 2: 'beam' });
  place(w, 100, 900);
  run(w, 1, () => tap('attack'));
  assert.ok(w.projectiles[0].vy < 0, 'grenade should start rising');
  let exploded = false;
  for (let i = 0; i < 240 && !exploded; i++) {
    GD.stepWorld(w, [idle(), idle()], GD.DT);
    exploded = w.events.some((e) => e.type === 'explode');
  }
  assert.ok(exploded);
});

test('grenade in space flies flat and self-destructs after its fuse', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'grenade', 2: 'beam' });
  place(w, 100, 900);
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles[0].vy, 0);
  run(w, 3.2 * 60);
  assert.strictEqual(w.projectiles.length, 0);
  assert.ok(w.events.some((e) => e.type === 'explode'));
});

test('beam hit deals armor-scaled damage and stuns the target', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax07', { 1: 'beam', 2: 'beam' });
  place(w, 300, 500);
  const target = w.fighters[1];
  let maxStun = 0;
  for (let i = 0; i < 30; i++) {
    GD.stepWorld(w, [i === 0 ? tap('attack') : idle(), idle()], GD.DT);
    maxStun = Math.max(maxStun, target.hitstun);
  }
  const expected = Math.round(90 * (1 - 5 * GD.COMBAT.armorPerPoint));
  assert.strictEqual(target.stats.hpMax - target.hp, expected);
  assert.ok(maxStun > 0.2, 'no stun');
  assert.ok(w.events.some((e) => e.type === 'hit' && e.player === 2));
});

test('guarding a frontal hit cuts damage to a quarter', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax01', { 1: 'beam', 2: 'beam' });
  place(w, 300, 500);
  const target = w.fighters[1];
  run(w, 30, (i) => (i === 0 ? tap('attack') : idle()), () => Object.assign(idle(), { guard: true }));
  const full = Math.round(90 * target.stats.damageTaken);
  const taken = target.stats.hpMax - target.hp;
  assert.ok(taken > 0 && taken <= Math.round(full * GD.COMBAT.guardDamage) + 1, 'taken ' + taken);
  assert.strictEqual(target.hitstun, 0);
});

test('beam rifle drains energy and refuses to fire when empty', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'beam', 2: 'beam' });
  place(w, 100, 900);
  const f = w.fighters[0];
  f.energy = 20;
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 0);
  assert.ok(f.lowEnergy > 0);
  f.energy = 120;
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 1);
  assert.ok(f.energy < 100);
});

test('bazooka has 4 rounds, then reloads over time', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'bazooka', 2: 'beam' });
  place(w, 100, 900);
  const f = w.fighters[0];
  run(w, 5 * 70, (i) => (i % 70 === 0 ? tap('attack') : idle()));
  assert.strictEqual(w.events.filter((e) => e.type === 'fire').length, 4);
  assert.strictEqual(f.ammo.bazooka, 0);
  // The reload delay already elapsed while the empty trigger was being tapped.
  f.sinceFire = GD.COMBAT.reloadDelay; f.reloadT = 0;
  run(w, 2.4 * 60 + 2);
  assert.strictEqual(f.ammo.bazooka, 1);
  run(w, 2.4 * 60);
  assert.strictEqual(f.ammo.bazooka, 2);
});

test('machine gun fires automatically while held', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'mg', 2: 'beam' });
  place(w, 100, 900);
  run(w, 60, () => Object.assign(idle(), { attack: true }));
  const shots = w.events.filter((e) => e.type === 'fire').length;
  assert.ok(shots >= 10 && shots <= 12, 'shots ' + shots);
});

test('switch key swaps to vulcan and back', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'beam', 2: 'beam' });
  const f = w.fighters[0];
  run(w, 1, () => tap('switch'));
  assert.strictEqual(GD.activeWeapon(f).id, 'vulcan');
  run(w, 20);
  run(w, 1, () => tap('switch'));
  assert.strictEqual(GD.activeWeapon(f).id, 'beam');
});

test('vulcan rounds shoot down an incoming rocket', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', { 1: 'vulcan-test', 2: 'bazooka' });
  const [a, b] = w.fighters;
  place(w, 200, 700);
  a.usingSecondary = true;
  a.y = b.y;
  run(w, 1, () => idle(), () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 1);
  run(w, 40, () => Object.assign(idle(), { attack: true }));
  assert.ok(w.events.some((e) => e.type === 'explode'), 'rocket not shot down');
  // Rocket detonated in flight: P1 took at most blast splash, never the 137-point direct hit.
  assert.ok(a.stats.hpMax - a.hp < 100, 'took ' + (a.stats.hpMax - a.hp));
});

test('saber hits only in range and grants brief invulnerability', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', { 1: 'saber', 2: 'beam' });
  const [a, b] = w.fighters;
  place(w, 300, 600);
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle())); // 40 frames also clears the swing cooldown
  assert.strictEqual(b.hp, b.stats.hpMax, 'hit from too far');
  place(w, 300, 360);
  let sawInvuln = false;
  for (let i = 0; i < 30; i++) {
    GD.stepWorld(w, [i === 0 ? tap('attack') : idle(), idle()], GD.DT);
    if (a.invuln > 0) sawInvuln = true;
  }
  assert.ok(b.hp < b.stats.hpMax, 'saber missed in range');
  assert.ok(sawInvuln);
});

test('knockback drifts further in space than on Earth', () => {
  const earth = GD.createWorld('earth', 'ax01', 'ax01', { 1: 'bazooka', 2: 'beam' });
  const space = GD.createWorld('space', 'ax01', 'ax01', { 1: 'bazooka', 2: 'beam' });
  for (const w of [earth, space]) {
    place(w, 300, 420);
    w.fighters[1].y = w.fighters[0].y;
    run(w, 90, (i) => (i === 0 ? tap('attack') : idle()));
  }
  const dEarth = earth.fighters[1].x - 420;
  const dSpace = space.fighters[1].x - 420;
  assert.ok(dSpace > dEarth, `space ${dSpace} earth ${dEarth}`);
});

test('fighter is KO at zero HP and the world records the winner', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', { 1: 'beam', 2: 'beam' });
  const [a, b] = w.fighters;
  place(w, 300, 500);
  b.hp = 10;
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle()));
  assert.ok(b.ko);
  assert.strictEqual(w.winner, 1);
  assert.strictEqual(b.state, 'down');
  // Downed fighter ignores input.
  const x0 = b.x;
  run(w, 60, () => idle(), () => Object.assign(idle(), { left: true }));
  assert.ok(Math.abs(b.x - x0) < 60);
});

test('every weapon has a penalty in at least one stage (design rule)', () => {
  // Beam: no gravity effect but costs energy. Others: gravity coefficient > 0 or melee.
  for (const w of GD.WEAPONS) {
    const penalised = (w.kind === 'melee') || w.energy > 0 || w.g > 0;
    assert.ok(penalised, w.id);
  }
});

console.log(`\n${passed} tests passed`);
