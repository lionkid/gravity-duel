/* Headless combat checks. Run: node tests/combat.test.js */
'use strict';
require('../src/config.js');
require('../src/physics.js');
require('../src/combat.js');
const GD = globalThis.GD;
const assert = require('assert');

const idle = () => ({ up: false, down: false, left: false, right: false, attack: false, sub: false, guard: false, switch: false, dash: false, pressed: {} });
const tap = (action, extra) => Object.assign(idle(), extra || {}, { [action]: true, pressed: { [action]: true } });
const lo = (r1, m1, r2, m2) => ({ 1: { ranged: r1, melee: m1 || 'saber' }, 2: { ranged: r2 || 'beam', melee: m2 || 'saber' } });
function run(world, frames, make1, make2) {
  for (let i = 0; i < frames; i++) {
    GD.stepWorld(world, [make1 ? make1(i) : idle(), make2 ? make2(i) : idle()], GD.DT);
  }
}
function place(world, x1, x2) {
  const [a, b] = world.fighters;
  a.x = x1; b.x = x2; a.facing = 1; b.facing = -1;
}
const taken = (f) => f.stats.hpMax - f.hp;
const D = (id) => GD.weaponById(id).dmg;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

// ---- ballistics ----
test('beam flies straight on Earth; bazooka drops with gravity', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', lo('beam', 'saber', 'bazooka'));
  place(w, 100, 600);
  run(w, 1, () => tap('attack'), () => tap('attack'));
  const [beam, rocket] = w.projectiles;
  const y0b = beam.y, y0r = rocket.y;
  run(w, 12);                // before the two shots cross (the beam would shoot the rocket down)
  assert.strictEqual(w.projectiles.length, 2);
  assert.ok(Math.abs(beam.y - y0b) < 1e-6, 'beam moved vertically');
  assert.ok(rocket.y - y0r > 6, 'rocket did not drop: ' + (rocket.y - y0r));
});

test('same bazooka shot stays level in space', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka'));
  place(w, 100, 900);
  run(w, 1, () => tap('attack'));
  const r = w.projectiles[0];
  const y0 = r.y;
  run(w, 30);
  assert.ok(Math.abs(r.y - y0) < 1e-6);
});

test('grenade lobs upward on Earth and explodes on the ground', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', lo('grenade'));
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
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('grenade'));
  place(w, 100, 900);
  w.fighters[0].facing = -1;   // fire back across the whole arena... it still leaves before the fuse
  w.fighters[0].x = 900; w.fighters[1].x = 100;
  w.fighters[0].facing = -1;
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles[0].vy, 0);
  // Keep it inside the arena so the fuse decides.
  w.projectiles[0].vx = -200;
  run(w, 3.2 * 60);
  assert.strictEqual(w.projectiles.length, 0);
  assert.ok(w.events.some((e) => e.type === 'explode'));
});

// ---- damage model ----
test('beam hit deals its damage scaled by armor (in vacuum, no falloff)', () => {
  const w = GD.createWorld('space', 'ax01', 'ax07', lo('beam'));
  place(w, 300, 500);
  w.fighters[1].y = w.fighters[0].y;
  const target = w.fighters[1];
  let maxStun = 0;
  for (let i = 0; i < 30; i++) {
    GD.stepWorld(w, [i === 0 ? tap('attack') : idle(), idle()], GD.DT);
    maxStun = Math.max(maxStun, target.hitstun);
  }
  assert.strictEqual(taken(target), Math.round(D('beam') * (1 - 5 * GD.COMBAT.armorPerPoint)));
  assert.ok(maxStun > 0.2, 'no stun');
});

test('bazooka direct hit deals its full direct damage (was only splash before)', () => {
  const w = GD.createWorld('space', 'ax01', 'ax01', lo('bazooka'));
  place(w, 300, 500);
  w.fighters[1].y = w.fighters[0].y;
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle()));
  const t = w.fighters[1];
  assert.strictEqual(taken(t), Math.round(D('bazooka') * t.stats.damageTaken));
});

test('explosive blast radius is wide in air: bazooka splash reaches 100 px away on Earth', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax01', lo('bazooka'));
  const [a, b] = w.fighters;
  place(w, 100, 600);
  b.y = a.y - 200;           // well off the shot line
  const p = GD.combatInternals.spawnProjectile(w, a, GD.weaponById('bazooka'), 0);
  p.x = b.x - b.w / 2 - 100; p.y = b.y - b.h / 2;   // detonate 100 px left of the target's hitbox
  GD.combatInternals.explode(w, p, null);
  assert.ok(taken(b) > 0, 'splash missed at 100 px');
  assert.ok(GD.weaponById('bazooka').blast >= 120 && GD.weaponById('grenade').blast >= 150);
});

test('grenade blast also hurts its own thrower', () => {
  const w = GD.createWorld('space', 'ax01', 'ax01', lo('grenade'));
  const a = w.fighters[0];
  place(w, 300, 800);
  const p = GD.combatInternals.spawnProjectile(w, a, GD.weaponById('grenade'), 0);
  p.x = a.x + 60; p.y = a.y - 40;
  GD.combatInternals.explode(w, p, null);
  assert.ok(taken(a) > 0);
});

test('melee hits much harder than ranged', () => {
  const ranged = GD.RANGED.filter((w) => !w.auto).map((w) => w.dmg);
  for (const m of GD.MELEE) assert.ok(m.dmg > Math.max(...ranged), m.id);
  const w = GD.createWorld('earth', 'ax01', 'ax01', lo('beam', 'saber'));
  const [a, b] = w.fighters;
  place(w, 300, 360);
  a.mode = 'melee';
  run(w, 30, (i) => (i === 0 ? tap('attack') : idle()));
  assert.strictEqual(taken(b), Math.round(D('saber') * b.stats.damageTaken));
});

test('guarding a frontal shot cuts damage to a quarter', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax01', lo('beam'));
  place(w, 300, 500);
  const target = w.fighters[1];
  run(w, 30, (i) => (i === 0 ? tap('attack') : idle()), () => Object.assign(idle(), { guard: true }));
  const full = Math.round(D('beam') * target.stats.damageTaken);
  assert.ok(taken(target) > 0 && taken(target) <= Math.round(full * 0.25) + 1, 'taken ' + taken(target));
  assert.strictEqual(target.hitstun, 0);
});

test('heat axe breaks guard: blocked hit still deals half', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax01', lo('beam', 'axe'));
  const [a, b] = w.fighters;
  place(w, 300, 350);
  a.mode = 'melee';
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle()), () => Object.assign(idle(), { guard: true }));
  assert.strictEqual(taken(b), Math.round(D('axe') * b.stats.damageTaken * 0.5));
});

test('beam lance reaches farther than the saber', () => {
  for (const id of ['saber', 'lance']) {
    const w = GD.createWorld('earth', 'ax01', 'ax01', lo('beam', id));
    const [a, b] = w.fighters;
    place(w, 300, 300 + 22 + 8 + 100);   // target hitbox starts 100 px past the reach origin
    a.mode = 'melee';
    run(w, 40, (i) => (i === 0 ? tap('attack') : idle()));
    if (id === 'saber') assert.strictEqual(taken(b), 0, 'saber should miss at 100 px');
    else assert.ok(taken(b) > 0, 'lance should hit at 100 px');
  }
});

// ---- resources ----
test('beam rifle drains energy and refuses to fire when empty', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('beam'));
  place(w, 100, 900);
  const f = w.fighters[0];
  f.energy = 20;
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 0);
  assert.ok(f.lowEnergy > 0);
  f.energy = 120;
  run(w, 1, () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 1);
});

test('bazooka has 4 rounds, then reloads over time', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka'));
  place(w, 100, 900);
  const f = w.fighters[0];
  run(w, 5 * 70, (i) => (i % 70 === 0 ? tap('attack') : idle()));
  assert.strictEqual(w.events.filter((e) => e.type === 'fire').length, 4);
  assert.strictEqual(f.ammo.bazooka, 0);
  f.sinceFire = GD.COMBAT.reloadDelay; f.reloadT = 0;
  run(w, 2.4 * 60 + 2);
  assert.strictEqual(f.ammo.bazooka, 1);
});

test('machine gun fires automatically while held', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('mg'));
  place(w, 100, 900);
  run(w, 60, () => Object.assign(idle(), { attack: true }));
  const shots = w.events.filter((e) => e.type === 'fire').length;
  const expected = 1 / GD.weaponById('mg').cooldown;   // shots in one second of holding
  assert.ok(Math.abs(shots - expected) <= 1.5, `shots ${shots}, expected about ${expected}`);
});

// ---- weapon switching ----
test('switch key swaps ranged ⇄ melee, then is locked for the cooldown', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('beam', 'saber'));
  const f = w.fighters[0];
  run(w, 1, () => tap('switch'));
  assert.strictEqual(GD.activeWeapon(f).id, 'saber');
  run(w, 60);                                   // 1 s later: still cooling down
  run(w, 1, () => tap('switch'));
  assert.strictEqual(GD.activeWeapon(f).id, 'saber', 'swapped during cooldown');
  assert.ok(f.switchDenied > 0, 'no denied feedback');
  run(w, (GD.COMBAT.switchCooldown - 1) * 60 + 2);
  run(w, 1, () => tap('switch'));
  assert.strictEqual(GD.activeWeapon(f).id, 'beam');
});

test('a fresh swap cannot attack until the weapon is drawn', () => {
  const w = GD.createWorld('earth', 'ax01', 'ax01', lo('beam', 'saber'));
  const [a] = w.fighters;
  place(w, 300, 340);
  run(w, 1, () => tap('switch'));
  run(w, 1, () => tap('attack'));
  assert.strictEqual(a.melee, null, 'swung during draw time');
  run(w, GD.COMBAT.switchLag * 60 + 1);
  run(w, 1, () => tap('attack'));
  assert.ok(a.melee, 'could not swing after the draw time');
});

test('vulcan fires on its own key in either mode and keeps its own ammo', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka', 'axe'));
  place(w, 100, 900);
  const f = w.fighters[0];
  run(w, 20, () => Object.assign(idle(), { sub: true }));
  const shots1 = w.events.filter((e) => e.type === 'fire' && e.weapon === 'vulcan').length;
  assert.ok(shots1 >= 2, 'vulcan did not fire in ranged mode');
  assert.strictEqual(f.ammo.bazooka, 4, 'vulcan spent bazooka ammo');
  f.mode = 'melee';
  run(w, 20, () => Object.assign(idle(), { sub: true }));
  const shots2 = w.events.filter((e) => e.type === 'fire' && e.weapon === 'vulcan').length;
  assert.ok(shots2 > shots1, 'vulcan did not fire in melee mode');
});

test('vulcan rounds shoot down an incoming rocket', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('beam', 'saber', 'bazooka'));
  const [a, b] = w.fighters;
  place(w, 200, 700);
  a.y = b.y;
  run(w, 1, () => idle(), () => tap('attack'));
  assert.strictEqual(w.projectiles.length, 1);
  run(w, 40, () => Object.assign(idle(), { sub: true }));
  assert.ok(w.events.some((e) => e.type === 'explode'), 'rocket not shot down');
  assert.ok(taken(a) < Math.round(D('bazooka') * a.stats.damageTaken), 'took the direct hit');
});

// ---- melee behaviour ----
test('saber hits only in range and grants brief invulnerability', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', lo('beam', 'saber'));
  const [a, b] = w.fighters;
  a.mode = 'melee';
  place(w, 300, 600);
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle()));
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
  const earth = GD.createWorld('earth', 'ax01', 'ax01', lo('bazooka'));
  const space = GD.createWorld('space', 'ax01', 'ax01', lo('bazooka'));
  for (const w of [earth, space]) {
    place(w, 300, 420);
    w.fighters[1].y = w.fighters[0].y;
    run(w, 90, (i) => (i === 0 ? tap('attack') : idle()));
  }
  assert.ok(space.fighters[1].x - 420 > earth.fighters[1].x - 420);
});

test('fighter is KO at zero HP and the world records the winner', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06', lo('beam'));
  const b = w.fighters[1];
  place(w, 300, 500);
  b.hp = 10;
  run(w, 40, (i) => (i === 0 ? tap('attack') : idle()));
  assert.ok(b.ko);
  assert.strictEqual(w.winner, 1);
  assert.strictEqual(b.state, 'down');
});

test('every weapon has a weakness in at least one stage or resource', () => {
  for (const w of GD.WEAPONS) {
    const penalised = w.kind === 'melee' || w.energy > 0 || w.g > 0;
    assert.ok(penalised, w.id);
    for (const st of GD.STAGE_ORDER) assert.ok(['good', 'even', 'bad'].includes(GD.aff(w, st)), w.id + ' affinity');
  }
});

// ---- grenade boundary bursts ----
test('grenade bursts when it reaches the side wall', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('grenade'));
  const a = w.fighters[0];
  place(w, 860, 100);
  a.facing = 1;
  const p = GD.combatInternals.spawnProjectile(w, a, GD.weaponById('grenade'), 0);
  run(w, 20);
  const boom = w.events.find((e) => e.type === 'explode');
  assert.ok(boom, 'no explosion at the wall');
  assert.ok(Math.abs(boom.x - GD.ARENA.w) < 1, 'exploded at x ' + boom.x);
  assert.ok(!w.projectiles.includes(p));
});

test('grenade bursts at the top boundary when lobbed into it', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('grenade'));
  const a = w.fighters[0];
  place(w, 400, 900);
  a.y = 200;
  GD.combatInternals.spawnProjectile(w, a, GD.weaponById('grenade'), -75);
  run(w, 30);
  const boom = w.events.find((e) => e.type === 'explode');
  assert.ok(boom && Math.abs(boom.y - GD.ARENA.ceilingY) < 1, 'top burst ' + (boom && boom.y));
});

test('other shells still leave the arena without exploding', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka'));
  const a = w.fighters[0];
  place(w, 900, 100);
  a.facing = 1;
  GD.combatInternals.spawnProjectile(w, a, GD.weaponById('bazooka'), 0);
  run(w, 30);
  assert.ok(!w.events.some((e) => e.type === 'explode'));
  assert.strictEqual(w.projectiles.length, 0);
});

// ---- input buffer ----
test('an attack pressed just before the cooldown ends still fires', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka'));
  place(w, 100, 900);
  const f = w.fighters[0];
  run(w, 1, () => tap('attack'));
  const cd = f.cooldown;
  run(w, Math.round((cd - 0.1) * 60));           // 0.1 s left on the cooldown
  run(w, 1, () => tap('attack'));
  run(w, 10);
  assert.strictEqual(w.events.filter((e) => e.type === 'fire').length, 2, 'early press was lost');
});

test('a press far too early is not stored', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('bazooka'));
  place(w, 100, 900);
  run(w, 1, () => tap('attack'));
  run(w, 5);
  run(w, 1, () => tap('attack'));                // ~1 s of cooldown left
  run(w, 90);
  assert.strictEqual(w.events.filter((e) => e.type === 'fire').length, 1);
});

test('a swap pressed in the last moment of its cooldown goes through without a denied flash', () => {
  const w = GD.createWorld('space', 'ax01', 'zr06', lo('beam', 'saber'));
  const f = w.fighters[0];
  run(w, 1, () => tap('switch'));
  run(w, Math.round((GD.COMBAT.switchCooldown - 0.08) * 60));
  run(w, 1, () => tap('switch'));
  assert.strictEqual(f.switchDenied, 0);
  run(w, 10);
  assert.strictEqual(f.mode, 'ranged');
});

// ---- bindings ----
test('the two players never share a key, and each action has a key', () => {
  const seen = new Map();
  for (const p of [1, 2]) for (const [a, codes] of Object.entries(GD.BINDINGS[p])) {
    assert.ok(codes.length > 0, `P${p} ${a}`);
    for (const c of codes) {
      assert.ok(!seen.has(c) || seen.get(c) === p, `${c} used by both players`);
      seen.set(c, p);
    }
  }
});

// ---- stage weaknesses ----
test('Earth air weakens beams over distance; vacuum does not', () => {
  const hitAt = (stage, x2) => {
    const w = GD.createWorld(stage, 'ax01', 'ax01', lo('beam'));
    place(w, 100, x2);
    w.fighters[1].y = w.fighters[0].y;
    run(w, 90, (i) => (i === 0 ? tap('attack') : idle()));
    return taken(w.fighters[1]);
  };
  assert.ok(hitAt('earth', 800) < hitAt('earth', 250), 'no falloff on Earth');
  assert.strictEqual(hitAt('space', 800), hitAt('space', 250));
});

test('blasts shrink in vacuum: same shell, smaller radius on the Moon and in space', () => {
  for (const stage of ['earth', 'moon', 'space']) {
    const w = GD.createWorld(stage, 'ax01', 'ax01', lo('bazooka'));
    const p = GD.combatInternals.spawnProjectile(w, w.fighters[0], GD.weaponById('bazooka'), 0);
    w.events.length = 0;
    GD.combatInternals.explode(w, p, null);
    const r = w.events.find((e) => e.type === 'explode').r;
    if (stage === 'earth') assert.strictEqual(r, 120);
    else assert.ok(r < 100, stage + ' radius ' + r);
  }
});

test('recoil pushes the shooter back in space and on the Moon, not on Earth ground', () => {
  const push = (stage) => {
    const w = GD.createWorld(stage, 'ax01', 'zr06', lo('bazooka'));
    place(w, 400, 900);
    run(w, 1, () => tap('attack'));
    return w.fighters[0].vx;
  };
  assert.ok(push('space') < -150, 'space ' + push('space'));
  assert.ok(push('moon') < -40, 'moon ' + push('moon'));
  assert.ok(Math.abs(push('earth')) < 1, 'earth ' + push('earth'));
});

test('light rounds lose more to armor: MG hurts BASTION far less than WRAITH', () => {
  const dealt = (mech) => {
    const w = GD.createWorld('space', 'ax01', mech, lo('mg'));
    const [a, b] = w.fighters;
    place(w, 300, 500);
    b.y = a.y;
    GD.applyHit(w, b, a, { dmg: 15, knock: 0, stun: 0, light: true, x: b.x, y: b.y, dx: 1, dy: 0 });
    return taken(b);
  };
  // Normal armor scaling would give 10.5 vs 13.2; light rounds widen that gap.
  assert.ok(dealt('ax07') / dealt('zr06') < 0.7, `${dealt('ax07')} vs ${dealt('zr06')}`);
});

test('every weapon names a weakness on every stage', () => {
  for (const w of GD.WEAPONS) for (const s of GD.STAGE_ORDER) {
    assert.ok(w.st[s] && w.st[s].con && w.st[s].con.length > 4, `${w.id} on ${s}`);
  }
});

test('Moon: low gravity jumps go higher and hang longer than Earth', () => {
  const jump = (stage) => {
    const w = GD.createWorld(stage, 'ax01', 'zr06');
    const f = w.fighters[0];
    let top = f.y, air = 0;
    for (let i = 0; i < 600; i++) {
      GD.stepWorld(w, [i === 0 ? tap('up') : idle(), idle()], GD.DT);
      top = Math.min(top, f.y);
      if (!f.onGround) air++; else if (i > 5) break;
    }
    return { apex: GD.ARENA.groundY - top, air };
  };
  const e = jump('earth'), m = jump('moon');
  assert.ok(m.apex > e.apex * 1.6 && m.air > e.air * 2, JSON.stringify({ e, m }));
  assert.ok(m.apex < GD.ARENA.groundY - GD.ARENA.ceilingY - 84, 'moon jump hits the ceiling');
});

console.log(`\n${passed} tests passed`);
