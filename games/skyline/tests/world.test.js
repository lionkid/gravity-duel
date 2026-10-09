import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, HW } from '../stages/city.js';
import { createWorld, stepWorld, fighterState } from '../rules/world.js';
import { createIntent, IDLE_INTENT } from '../../../engine/input/intent.js';
import { MOVE, STAGES, ARMORS } from '../config.js';

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
  // Lock-on would keep the body facing the opponent, so switch it off first (F toggles it).
  run(w, 2, (it, i) => { it.pressed.lock = i === 0; });
  // Down the central street (-z), then back up it (+z): the body turns to face each way.
  const f = run(w, 120, (it) => { it.move.z = -1; });
  const top = MOVE.run * ARMORS[f.loadout.armor].speed;                 // armour sets the speed multiplier
  assert.ok(Math.abs(Math.hypot(f.vel.x, f.vel.z) - top) < 1e-6, `top speed ${top}, got ${Math.hypot(f.vel.x, f.vel.z)}`);
  assert.ok(f.pos.z < z0 - 40, `covered ground, got z=${f.pos.z}`);
  assert.ok(f.onGround && Math.abs(f.pos.x) < 1e-6 && f.yaw === 0);
  run(w, 60, (it) => { it.move.z = 1; });
  assert.ok(Math.abs(Math.abs(f.yaw) - Math.PI) < 1e-6, `faces +z (yaw π), got ${f.yaw}`);
  // Into the buildings beside the street: blocked, sliding is the controller's job.
  run(w, 60, (it) => { it.move.x = 1; });
  assert.ok(f.hitWall && f.vel.x === 0 && f.pos.x < STAGES.city.street / 2 + 10, `stopped by the building face, x=${f.pos.x}`);
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
  run(w, 300, (it, i) => { if (i < 90) it.move.z = -1; lagSeen = Math.max(lagSeen, w.fighters[0].landLag); });
  assert.ok(lagSeen > 0, 'landing recovery happened');
  assert.ok(f.onGround && f.pos.y === 0);
  f.fuel = 0; f.fuelDelay = 0;
  run(w, 150, () => {});
  assert.ok(Math.abs(f.fuel - MOVE.fuelMax) < 1e-6, `refuelled on the ground, got ${f.fuel}`);
});

test('dashing bursts forward, hovers, costs fuel and has a cooldown', () => {
  const w = world();
  const f = w.fighters[0];
  const z0 = f.pos.z, fuel0 = f.fuel;
  run(w, 18, (it, i) => { it.move.z = -1; if (i === 0) it.pressed.dash = true; });
  assert.ok(z0 - f.pos.z > 16 && z0 - f.pos.z < 19, `dash distance ${z0 - f.pos.z}`);
  assert.ok(Math.abs(fuel0 - f.fuel - MOVE.dashFuel) < 0.05);
  const fuel1 = f.fuel;
  run(w, 6, (it, i) => { it.move.z = -1; if (i === 0) it.pressed.dash = true; });
  assert.ok(f.dashTimer === 0 && Math.abs(f.fuel - fuel1) < 0.2, 'a second dash during the cooldown is refused');
  run(w, 90, (it) => { it.move.z = -1; });
  run(w, 3, (it, i) => { it.move.z = -1; if (i === 0) it.pressed.dash = true; });
  assert.ok(f.dashTimer > 0, 'after the cooldown a dash works again');
});

test('holding aim slows movement and turns the body to the view', () => {
  const w = world();
  const f = run(w, 120, (it) => { it.move.z = -1; it.held.aim = true; it.aim.yaw = 1.0; it.aim.pitch = 0.3; });
  assert.ok(f.aiming);
  assert.ok(Math.abs(Math.hypot(f.vel.x, f.vel.z) - MOVE.run * ARMORS[f.loadout.armor].speed * MOVE.aimMoveMul) < 1e-6);
  assert.ok(Math.abs(f.yaw - 1.0) < 1e-6, `body follows the aim yaw, got ${f.yaw}`);
  assert.equal(f.aim.pitch, 0.3);
});

test('a mech runs up a ramp onto the highway and all the way around the loop', () => {
  const w = world();
  const f = w.fighters[0];
  const R = w.stage.highway.R;
  let rampTicks = 0;
  run(w, 60 * 8, (it) => { if (f.pos.y < HW.deckY - 1e-6 || !f.onGround) { it.move.z = 1; rampTicks++; } });
  assert.ok(Math.abs(f.pos.y - HW.deckY) < 1e-6 && f.onGround, `on the deck, got y=${f.pos.y} ground=${f.onGround}`);
  assert.ok(rampTicks / 60 < 6, `ramp took ${rampTicks / 60} s`);
  const corners = [[R, R], [R, -R], [-R, -R], [-R, R], [0, R]];
  let ci = 0, minY = Infinity;
  run(w, 60 * 90, (it) => {
    if (ci >= corners.length) return;
    const [tx, tz] = corners[ci];
    const dx = tx - f.pos.x, dz = tz - f.pos.z, d = Math.hypot(dx, dz);
    if (d < 6) { ci++; return; }
    it.move.x = dx / d; it.move.z = dz / d;
    minY = Math.min(minY, f.pos.y);
  });
  assert.equal(ci, corners.length, `reached ${ci} of ${corners.length} waypoints`);
  assert.ok(minY >= HW.deckY - 1e-6, `never left the deck, lowest y ${minY}`);
});

test('the fence stops a fighter at the edge of the arena', () => {
  // Down the central street, over the south ramp and deck, off its far edge and on to the fence.
  const w = world();
  w.fighters[1].pos.z = 300;                 // the opponent out of the way (fighters push each other apart)
  const f = run(w, 60 * 30, (it) => { it.move.z = -1; });
  assert.equal(f.pos.z, w.stage.bounds.minZ + 5);
  assert.ok(f.onGround && f.pos.y === 0);
});

test('the same inputs give the same world', () => {
  const a = world(9), b = world(9);
  const script = (it, i) => { it.move.x = Math.sin(i / 30); it.move.z = -1; it.held.boost = i % 120 < 50; if (i % 90 === 0) it.pressed.dash = true; if (i === 3) it.pressed.boost = true; };
  run(a, 600, script); run(b, 600, script);
  assert.deepEqual(a.fighters.map(fighterState), b.fighters.map(fighterState));
  assert.ok(a.tick === 600);
});
