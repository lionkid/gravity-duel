import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run, eventsOf, clearEvents, DT } from './helpers.js';
import { dirToAim } from '../../../engine/core/math.js';
import { WEAPONS, ARMORS, COMBAT } from '../config.js';

const aimAt = (f, e) => dirToAim({ x: e.pos.x - f.pos.x, y: (e.pos.y + 11) - (f.pos.y + COMBAT.muzzleHeight + 2), z: e.pos.z - f.pos.z });
const toRanged = (it, i) => { if (i === 0) it.pressed.switch3 = true; };
const toMelee = (it, i) => { if (i === 0) it.pressed.switch1 = true; };

test('fighters lock on to each other when in view; F toggles lock-on off and on again', () => {
  const w = makeWorld({ p1: { z: 40 }, p2: { z: -40 } });
  const [a, b] = w.fighters;
  run(w, 1);
  assert.equal(a.lock, 2); assert.equal(b.lock, 1);
  assert.ok(a.lockLos);
  // Walking away while locked keeps the body facing the opponent (strafing); unlocked it turns to the motion.
  run(w, 60, (it) => { it.move.z = 1; });
  assert.ok(Math.abs(a.yaw) < 0.05, `locked: faces the opponent, yaw ${a.yaw}`);
  run(w, 1, (it) => { it.pressed.lock = true; });
  assert.equal(a.lock, 0);
  run(w, 60, (it) => { it.move.z = 1; });
  assert.ok(Math.abs(Math.abs(a.yaw) - Math.PI) < 0.05, `unlocked: faces +z, yaw ${a.yaw}`);
  run(w, 1, (it) => { it.pressed.lock = true; });
  assert.equal(a.lock, 2);
});

test('the vulcan sprays straight ahead: it hits a mech on the same level and misses one on a roof', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -40 } });
  const [a, b] = w.fighters;
  run(w, 60, (it) => { it.held.attack = true; });
  assert.ok(b.hp < b.hpMax, 'opponent 100 m ahead takes damage');
  const n = eventsOf(w, 'tracer').length;
  assert.ok(n >= 13 && n <= 17, `about 15 rounds per second, got ${n}`);
  assert.ok(a.heat > 0.25 && a.heat < 0.45, `heat after a second ${a.heat}`);
  const w2 = makeWorld({ p1: { z: 60 }, p2: { z: -40 } });
  w2.fighters[1].pos.y = 40;
  w2.fighters[1].onGround = false;
  run(w2, 18, (it) => { it.held.attack = true; }, (it) => { it.held.boost = true; });
  assert.equal(w2.fighters[1].hp, w2.fighters[1].hpMax, 'a mech 40 m up is out of the level spray');
});

test('the vulcan overheats after three seconds and needs to cool down', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -40 } });
  const a = w.fighters[0];
  run(w, 60 * 3.2, (it) => { it.held.attack = true; });
  assert.ok(a.overheated && a.heat > 0.8, `overheated, heat ${a.heat}`);
  assert.equal(eventsOf(w, 'overheat').length, 1);
  clearEvents(w);
  run(w, 30, (it) => { it.held.attack = true; });
  assert.equal(eventsOf(w, 'tracer').length, 0, 'no rounds while overheated');
  run(w, 60 * 1.5, () => {});
  assert.ok(!a.overheated, 'cooled below the limit');
});

test('ranged weapons fire only while aiming, cost energy and hit where aimed', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -60 } });
  const [a, b] = w.fighters;
  run(w, 30, toRanged);
  assert.equal(a.active, 'ranged');
  run(w, 10, (it, i) => { if (i === 0) it.pressed.attack = true; });
  assert.equal(w.projectiles.length, 0, 'no shot without aiming');
  const e0 = a.energy;
  run(w, 90, (it, i) => { it.held.aim = true; Object.assign(it.aim, aimAt(a, b)); if (i === 0) it.pressed.attack = true; });
  assert.equal(b.hp, b.hpMax - WEAPONS.ranged.normal.dmg, `beam rifle damage, hp ${b.hp}`);
  assert.ok(e0 - a.energy < WEAPONS.ranged.normal.energy && a.energy < WEAPONS.ranged.normal.energyMax, 'energy spent and regenerating');
  const hit = eventsOf(w, 'hit')[0];
  assert.ok(hit && hit.by === 1 && hit.kind === 'ranged');
});

test('shots are stopped by buildings', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -60 } });
  const [a, b] = w.fighters;
  run(w, 30, toRanged);
  // Aim sideways into the block beside the street.
  run(w, 60, (it, i) => { it.held.aim = true; it.aim.yaw = -Math.PI / 2; it.aim.pitch = 0; if (i === 0) it.pressed.attack = true; });
  assert.equal(b.hp, b.hpMax);
  const imp = eventsOf(w, 'impact')[0];
  assert.ok(imp && !imp.body && imp.x > 10 && imp.x < 40, `hit the wall at x=${imp && imp.x}`);
});

test('the hand cannon drops with gravity, the beam rifle does not', () => {
  const fire = (weapon) => {
    const w = makeWorld({ loadouts: { 1: { weapon } }, p1: { z: 60 }, p2: { z: 300 } });
    run(w, 30, toRanged);
    run(w, 60 * 2.5, (it, i) => { it.held.aim = true; it.aim.yaw = 0; it.aim.pitch = 0; if (i === 0) it.pressed.attack = true; });
    return eventsOf(w, 'impact')[0];
  };
  const shell = fire('melee'), beam = fire('normal');
  assert.ok(shell && shell.y < 1, `the shell lands on the street, y=${shell && shell.y}`);
  assert.ok(beam && Math.abs(beam.y - (COMBAT.muzzleHeight + 2)) < 0.5, `the beam stays level, y=${beam && beam.y}`);
});

test('melee: lock on, lunge, three-hit combo', () => {
  const w = makeWorld({ p1: { z: 30 }, p2: { z: 0 } });
  const [a, b] = w.fighters;
  run(w, 30, toMelee);
  run(w, 1, (it) => { it.pressed.attack = true; });
  assert.ok(a.melee && a.melee.stage === 'lunge', 'starts with a lunge from 30 m');
  // Press again during each recovery to chain the three swings.
  const pressed = new Set();
  let stunned = false;
  run(w, 160, (it) => {
    if (a.melee && a.melee.stage === 'recovery' && !pressed.has(a.melee.combo)) { pressed.add(a.melee.combo); it.pressed.attack = true; }
    if (b.stun > 0) stunned = true;
  });
  const saber = WEAPONS.melee.normal;
  assert.deepEqual(eventsOf(w, 'hit').map((e) => e.amount), saber.combo.map((c) => c.dmg), 'three hits in combo order');
  assert.equal(b.hp, b.hpMax - saber.combo.reduce((s, c) => s + c.dmg, 0));
  assert.ok(stunned, 'opponent was stunned');
  assert.equal(eventsOf(w, 'slash').length, 3);
  assert.equal(a.melee, null, 'combo finished');
});

test('guard halves damage; the great blade breaks guard and has super armour', () => {
  const w = makeWorld({ p1: { z: 20 }, p2: { z: 0 } });
  const [a, b] = w.fighters;
  run(w, 30, toMelee);
  run(w, 60, (it, i) => { if (i === 0) it.pressed.attack = true; }, (it) => { it.held.guard = true; });
  assert.equal(b.hp, b.hpMax - WEAPONS.melee.normal.combo[0].dmg * COMBAT.guardMul, `guarded saber hit, hp ${b.hp}`);
  assert.ok(eventsOf(w, 'hit')[0].guard);

  const w2 = makeWorld({ loadouts: { 1: { weapon: 'melee' } }, p1: { z: 20 }, p2: { z: 0 } });
  const [c, d] = w2.fighters;
  run(w2, 30, toMelee);
  run(w2, 80, (it, i) => { if (i === 0) it.pressed.attack = true; }, (it) => { it.held.guard = true; });
  assert.equal(d.hp, d.hpMax - WEAPONS.melee.melee.combo[0].dmg, `great blade breaks guard for full damage, hp ${d.hp}`);
  assert.ok(eventsOf(w2, 'hit')[0].broke);

  // Super armour: vulcan fire during the wind-up does not interrupt the swing.
  const w3 = makeWorld({ loadouts: { 1: { weapon: 'melee' } }, p1: { z: 20 }, p2: { z: 0 } });
  const [e, f] = w3.fighters;
  run(w3, 30, toMelee);
  run(w3, 12, (it, i) => { if (i === 0) it.pressed.attack = true; }, (it) => { it.held.attack = true; });
  assert.ok(e.melee && (e.melee.stage === 'windup' || e.melee.stage === 'lunge'), 'still winding up under fire');
  assert.ok(e.hp < e.hpMax, 'but still takes the damage');
});

test('armour multiplies damage by kind', () => {
  const dmgWith = (armor, attack) => {
    const w = makeWorld({ loadouts: { 2: { armor } }, p1: { z: attack === 'melee' ? 20 : 60 }, p2: { z: 0 } });
    const b = w.fighters[1];
    if (attack === 'melee') { run(w, 30, toMelee); run(w, 60, (it, i) => { if (i === 0) it.pressed.attack = true; }); }
    else if (attack === 'ranged') { run(w, 30, toRanged); run(w, 90, (it, i) => { it.held.aim = true; Object.assign(it.aim, aimAt(w.fighters[0], b)); if (i === 0) it.pressed.attack = true; }); }
    else { run(w, 4, (it, i) => { it.held.attack = true; }); }
    return eventsOf(w, 'hit')[0].amount;
  };
  assert.equal(dmgWith('antiRanged', 'ranged'), Math.round(70 * ARMORS.antiRanged.ranged));
  assert.equal(dmgWith('antiMelee', 'ranged'), Math.round(70 * ARMORS.antiMelee.ranged));
  assert.equal(dmgWith('antiRanged', 'melee'), Math.round(120 * ARMORS.antiRanged.melee));
  assert.equal(dmgWith('antiMelee', 'melee'), Math.round(120 * ARMORS.antiMelee.melee));
  assert.equal(dmgWith('antiRanged', 'light'), Math.round(6 * ARMORS.antiRanged.light));
  assert.equal(dmgWith('normal', 'light'), 6);
});

test('switching has a draw time and a cooldown', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -40 } });
  const a = w.fighters[0];
  run(w, 1, toMelee);
  assert.equal(a.active, 'melee');
  run(w, 3, (it, i) => { if (i === 0) it.pressed.switch3 = true; });
  assert.equal(a.active, 'melee', 'cannot switch again during the cooldown');
  run(w, 60 * 2.6, () => {});
  run(w, 2, (it, i) => { if (i === 0) it.pressed.switch2 = true; });
  assert.equal(a.active, 'vulcan');
  clearEvents(w);
  run(w, 10, (it) => { it.held.attack = true; });
  assert.equal(eventsOf(w, 'tracer').length, 0, 'drawing: no fire yet');
  run(w, 20, (it) => { it.held.attack = true; });
  assert.ok(eventsOf(w, 'tracer').length > 0, 'fires once drawn');
});

test('KO ends the fight: the loser is dead, the winner recorded, no more damage', () => {
  const w = makeWorld({ p1: { z: 60 }, p2: { z: -40 } });
  const [a, b] = w.fighters;
  b.hp = 20;
  run(w, 60, (it) => { it.held.attack = true; });
  assert.ok(b.dead && b.hp === 0);
  assert.equal(w.winner, 1);
  assert.equal(eventsOf(w, 'ko').length, 1);
  const hits = eventsOf(w, 'hit').length;
  run(w, 30, (it) => { it.held.attack = true; });
  assert.equal(eventsOf(w, 'hit').length, hits, 'the dead take no more hits');
});

test('fighters are pushed apart instead of overlapping', () => {
  const w = makeWorld({ p1: { z: 0 }, p2: { z: 2 } });
  run(w, 2);
  const [a, b] = w.fighters;
  assert.ok(Math.abs(a.pos.z - b.pos.z) >= 10 - 1e-9 || Math.abs(a.pos.x - b.pos.x) >= 10 - 1e-9, `separated: dz=${b.pos.z - a.pos.z}`);
});

test('a scripted fight is deterministic', () => {
  const script = (it, i) => { it.move.x = Math.sin(i / 20); it.move.z = -Math.cos(i / 35); it.held.attack = i % 40 < 20; it.held.aim = i % 300 > 200; Object.assign(it.aim, { yaw: Math.sin(i / 50), pitch: 0.1 }); if (i % 97 === 0) it.pressed.attack = true; if (i % 200 === 0) it.pressed.switch1 = true; if (i % 200 === 100) it.pressed.switch3 = true; if (i % 150 === 0) it.pressed.dash = true; };
  const other = (it, i) => { it.move.x = Math.cos(i / 25); it.held.attack = true; it.held.guard = i % 120 < 30; };
  const a = makeWorld({ seed: 5, p1: { z: 60 }, p2: { z: -40 } }), b = makeWorld({ seed: 5, p1: { z: 60 }, p2: { z: -40 } });
  run(a, 900, script, other); run(b, 900, script, other);
  assert.deepEqual(JSON.stringify(a.fighters.map((f) => [f.pos, f.hp, f.heat, f.energy, f.melee, f.active])), JSON.stringify(b.fighters.map((f) => [f.pos, f.hp, f.heat, f.energy, f.melee, f.active])));
  assert.ok(a.fighters.some((f) => f.hp < f.hpMax), 'somebody got hit');
});
