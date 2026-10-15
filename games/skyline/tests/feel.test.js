// How fast attacks answer the controls: a locked-on lunge cocks the blade while closing in, draws are
// short, the ranged weapon hip-fires at a locked target, and a press that cannot fire says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, run, eventsOf, clearEvents, DT } from './helpers.js';
import { COMBAT, WEAPONS } from '../config.js';

const ticks = (sec) => Math.round(sec / DT);
// Lock-on engages by itself when the target is in view; the sword just needs drawing.
const swordOut = (w, slot) => run(w, 40, (it, i) => { it.pressed[slot] = i === 1; });

test('a saber lunge from 30 m connects within 0.2 s of the press', () => {
  const w = makeWorld({ loadouts: { 1: { weapon: 'normal', armor: 'normal' }, 2: { weapon: 'normal', armor: 'normal' } }, p1: { x: 0, z: 30 }, p2: { x: 0, z: 0 } });
  swordOut(w, 'switch1');
  clearEvents(w);
  let slashAt = -1, hitAt = -1;
  for (let i = 0; i < ticks(0.5); i++) {
    run(w, 1, (it) => { it.pressed.attack = i === 0; });
    if (slashAt < 0 && eventsOf(w, 'slash').length) slashAt = i;
    if (hitAt < 0 && eventsOf(w, 'hit').length) hitAt = i;
  }
  assert.ok(slashAt >= 0 && slashAt <= ticks(0.2), `blade swings at tick ${slashAt}`);
  assert.ok(hitAt >= 0 && hitAt <= ticks(0.25), `first hit at tick ${hitAt}`);
  assert.ok(w.fighters[1].hp < w.fighters[1].hpMax);
});

test('the great blade is slower but still well under half a second', () => {
  const w = makeWorld({ loadouts: { 1: { weapon: 'melee', armor: 'normal' }, 2: { weapon: 'normal', armor: 'normal' } }, p1: { x: 0, z: 36 }, p2: { x: 0, z: 0 } });
  swordOut(w, 'switch1');
  clearEvents(w);
  let hitAt = -1;
  for (let i = 0; i < ticks(0.8); i++) {
    run(w, 1, (it) => { it.pressed.attack = i === 0; });
    if (hitAt < 0 && eventsOf(w, 'hit').length) hitAt = i;
  }
  assert.ok(hitAt >= 0 && hitAt <= ticks(0.4), `great blade lands at tick ${hitAt}`);
});

test('a weapon switch followed at once by an attack still attacks after the short draw', () => {
  const w = makeWorld({ p1: { x: 0, z: 20 }, p2: { x: 0, z: 0 } });
  run(w, 5);
  clearEvents(w);
  // Switch to the sword and press attack on the very next tick, inside the draw time.
  run(w, 1, (it) => { it.pressed.switch1 = true; });
  run(w, 1, (it) => { it.pressed.attack = true; });
  const f = w.fighters[0];
  assert.equal(f.active, 'melee');
  assert.ok(!f.melee, 'not yet: the weapon is being drawn');
  run(w, ticks(COMBAT.switchDraw) + 1);
  assert.ok(f.melee, 'the buffered press starts the swing once the draw is done');
  assert.ok(COMBAT.switchDraw <= 0.15, `draw time ${COMBAT.switchDraw}`);
});

test('the ranged weapon hip-fires at a locked target without aiming, and says no when it cannot', () => {
  const w = makeWorld({ p1: { x: 0, z: 60 }, p2: { x: 0, z: 0 } });
  run(w, 40, (it, i) => { it.pressed.switch3 = i === 1; });
  const f = w.fighters[0];
  assert.equal(f.active, 'ranged');
  assert.equal(f.lock, 2, 'locked on by itself');
  clearEvents(w);
  run(w, 2, (it, i) => { it.pressed.attack = i === 0; });
  const shots = eventsOf(w, 'shot');
  assert.equal(shots.length, 1, 'one hip shot');
  assert.equal(shots[0].kind, WEAPONS.ranged.normal.id);
  assert.ok(f.fireCd > 0 && f.energy < 100);
  // Pressing again while the launcher reloads is refused audibly.
  clearEvents(w);
  run(w, 2, (it, i) => { it.pressed.attack = i === 0; });
  assert.equal(eventsOf(w, 'shot').length, 0);
  assert.deepEqual(eventsOf(w, 'dry').map((e) => e.reason), ['cooldown']);
  // Without a lock and without aiming there is nothing to shoot at.
  run(w, ticks(WEAPONS.ranged.normal.interval) + 2, (it, i) => { it.pressed.lock = i === 0; });
  assert.equal(f.lock, 0);
  clearEvents(w);
  run(w, 2, (it, i) => { it.pressed.attack = i === 0; });
  assert.equal(eventsOf(w, 'shot').length, 0);
  assert.deepEqual(eventsOf(w, 'dry').map((e) => e.reason), ['aim']);
});
