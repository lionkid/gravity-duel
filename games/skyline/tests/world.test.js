import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld, fighterState } from '../rules/world.js';
import { createIntent, IDLE_INTENT } from '../../../engine/input/intent.js';
import { MOVE, STAGES } from '../config.js';

const DT = 1 / 60;
function world(seed = 3) {
  const stage = generateCity(Object.assign({ seed }, STAGES.city));
  return createWorld({ stage, seed });
}
// Runs n ticks feeding fighter 1 the intent produced by fn(tick).
function run(w, n, fn) {
  const it = createIntent();
  for (let i = 0; i < n; i++) {
    for (const k in it.pressed) it.pressed[k] = false;
    for (const k in it.held) it.held[k] = false;
    it.move.x = 0; it.move.z = 0;
    fn(it, i);
    stepWorld(w, [it, IDLE_INTENT], DT);
  }
  return w.fighters[0];
}

test('two fighters start on their spawns facing each other', () => {
  const w = world();
  assert.equal(w.fighters.length, 2);
  assert.ok(w.fighters[0].pos.z > 0 && w.fighters[1].pos.z < 0);
  assert.equal(w.fighters[0].yaw, 0);
});

test('running reaches top speed quickly and turns the body toward the movement', () => {
  const w = world();
  const z0 = w.fighters[0].pos.z;
  const f = run(w, 120, (it) => { it.move.x = 1; it.move.z = 0; });
  assert.ok(Math.abs(Math.hypot(f.vel.x, f.vel.z) - MOVE.run) < 1e-6, `top speed, got ${Math.hypot(f.vel.x, f.vel.z)}`);
  assert.ok(f.pos.x > 40, `covered ground, got x=${f.pos.x}`);
  assert.ok(f.onGround && Math.abs(f.pos.z - z0) < 1e-6);
  assert.ok(Math.abs(f.yaw - (-Math.PI / 2)) < 1e-6, `faces +x (yaw -π/2), got ${f.yaw}`);
});

test('an air dash does not glide at dash speed forever', () => {
  const w = world();
  const f = w.fighters[0];
  f.pos.y = 150; f.onGround = false;
  run(w, 60, (it, i) => { if (i === 0) it.pressed.dash = true; });   // 0.3 s dash, then 0.5 s of bleed
  const sp = Math.hypot(f.vel.x, f.vel.z);
  assert.ok(sp <= MOVE.airMax + 1e-6 && sp > 20, `speed settles to the air limit, got ${sp}`);
});

test('a jump with held boost reaches a 60 m roof in under two seconds, then fuel runs out', () => {
  const w = world();
  let peak = 0, tReach = 0;
  const f = run(w, 240, (it, i) => {
    if (i === 0) it.pressed.boost = true;
    it.held.boost = true;
    peak = Math.max(peak, w.fighters[0].pos.y);
    if (!tReach && w.fighters[0].pos.y >= 60) tReach = i * DT;
  });
  assert.ok(tReach > 0 && tReach < 2, `reached 60 m after ${tReach.toFixed(2)} s`);
  assert.ok(f.fuel === 0, 'fuel is spent after 4 s of holding');
  assert.ok(peak > 100);
});

test('after landing, fuel comes back and a hard landing costs a short recovery', () => {
  const w = world();
  const f = w.fighters[0];
  f.pos.y = 120;
  f.onGround = false;
  let lagSeen = 0;
  run(w, 300, (it, i) => { if (i < 90) it.move.x = 1; lagSeen = Math.max(lagSeen, w.fighters[0].landLag); });
  assert.ok(lagSeen > 0, 'landing recovery happened');
  assert.ok(f.onGround && f.pos.y === 0);
  f.fuel = 0; f.fuelDelay = 0;
  run(w, 150, () => {});
  assert.ok(Math.abs(f.fuel - MOVE.fuelMax) < 1e-6, `refuelled on the ground, got ${f.fuel}`);
});

test('dashing bursts forward, hovers, costs fuel and has a cooldown', () => {
  const w = world();
  const f = w.fighters[0];
  const x0 = f.pos.x, fuel0 = f.fuel;
  run(w, 18, (it, i) => { it.move.x = 1; if (i === 0) it.pressed.dash = true; });
  assert.ok(f.pos.x - x0 > 16 && f.pos.x - x0 < 19, `dash distance ${f.pos.x - x0}`);
  assert.ok(Math.abs(fuel0 - f.fuel - MOVE.dashFuel) < 0.05);
  const fuel1 = f.fuel;
  run(w, 6, (it, i) => { it.move.x = 1; if (i === 0) it.pressed.dash = true; });
  assert.ok(f.dashTimer === 0 && Math.abs(f.fuel - fuel1) < 0.2, 'a second dash during the cooldown is refused');
  run(w, 90, (it) => { it.move.x = 1; });
  run(w, 3, (it, i) => { it.move.x = 1; if (i === 0) it.pressed.dash = true; });
  assert.ok(f.dashTimer > 0, 'after the cooldown a dash works again');
});

test('holding aim slows movement and turns the body to the view', () => {
  const w = world();
  const f = run(w, 120, (it) => { it.move.x = 1; it.held.aim = true; it.aim.yaw = 1.0; it.aim.pitch = 0.3; });
  assert.ok(f.aiming);
  assert.ok(Math.abs(Math.hypot(f.vel.x, f.vel.z) - MOVE.run * MOVE.aimMoveMul) < 1e-6);
  assert.ok(Math.abs(f.yaw - 1.0) < 1e-6, `body follows the aim yaw, got ${f.yaw}`);
  assert.equal(f.aim.pitch, 0.3);
});

test('the fence stops a fighter at the edge of the arena', () => {
  const w = world();
  const f = run(w, 60 * 30, (it) => { it.move.x = 1; });
  assert.equal(f.pos.x, w.stage.bounds.maxX - 5);
});

test('the same inputs give the same world', () => {
  const a = world(9), b = world(9);
  const script = (it, i) => { it.move.x = Math.sin(i / 30); it.move.z = -1; it.held.boost = i % 120 < 50; if (i % 90 === 0) it.pressed.dash = true; if (i === 3) it.pressed.boost = true; };
  run(a, 600, script); run(b, 600, script);
  assert.deepEqual(a.fighters.map(fighterState), b.fighters.map(fighterState));
  assert.ok(a.tick === 600);
});
