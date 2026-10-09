import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, DT } from './helpers.js';
import { stepWorld, cloneWorld, serializeWorld, applySnapshot, hashWorld } from '../rules/world.js';
import { createAI, aiIntent } from '../ai/brain.js';
import { encodeIntent, decodeIntent, carryOf } from '../../../engine/net/codec.js';
import { createHostSync, createGuestSync } from '../../../engine/net/sync.js';
import { createIntent, HELD, PRESSED } from '../../../engine/input/intent.js';

test('intents survive the wire encoding, including negative zero', () => {
  const it = createIntent();
  it.move.x = -0; it.move.z = 0.7071; it.aim.yaw = -2.5; it.aim.pitch = 0.3;
  it.held.boost = true; it.held.aim = true; it.pressed.dash = true; it.pressed.switch3 = true;
  const enc = JSON.parse(JSON.stringify(encodeIntent(it)));
  const out = decodeIntent(enc);
  assert.ok(Object.is(out.move.x, 0), 'negative zero normalised');
  assert.equal(out.move.z, 0.7071); assert.equal(out.aim.yaw, -2.5); assert.equal(out.aim.pitch, 0.3);
  for (const a of HELD) assert.equal(out.held[a], it.held[a], a);
  for (const a of PRESSED) assert.equal(out.pressed[a], it.pressed[a], a);
  const carried = decodeIntent(carryOf(enc));
  assert.ok(carried.held.boost && !carried.pressed.dash, 'carrying keeps held buttons and drops presses');
});

// Two AI pilots make a lively match; the same seeds give the same intents on both sides.
function pilots(world) {
  const a = createAI('hard', 11), b = createAI('hard', 12);
  return (w) => [aiIntent(a, w, 1, DT), aiIntent(b, w, 2, DT)];
}

test('a copy and a JSON snapshot continue exactly like the original', () => {
  const w = makeWorld({ seed: 5, loadouts: { 1: { weapon: 'normal', armor: 'normal' }, 2: { weapon: 'melee', armor: 'antiRanged' } } });
  const drive = pilots(w);
  for (let i = 0; i < 240; i++) stepWorld(w, drive(w), DT);
  const copy = cloneWorld(w);
  const fresh = makeWorld({ seed: 5, loadouts: { 1: { weapon: 'normal', armor: 'normal' }, 2: { weapon: 'melee', armor: 'antiRanged' } } });
  applySnapshot(fresh, JSON.parse(JSON.stringify(serializeWorld(w))));
  assert.equal(hashWorld(copy), hashWorld(w));
  assert.equal(hashWorld(fresh), hashWorld(w));
  assert.notEqual(copy.fighters[0], w.fighters[0], 'the copy has its own fighters');
  for (let i = 0; i < 240; i++) {
    const intents = drive(w).map((it) => decodeIntent(encodeIntent(it)));   // the AI reads w; replay the same intents everywhere
    stepWorld(w, intents, DT); stepWorld(copy, intents, DT); stepWorld(fresh, intents, DT);
    assert.equal(hashWorld(copy), hashWorld(w), `copy diverged at tick ${w.tick}`);
    assert.equal(hashWorld(fresh), hashWorld(w), `snapshot world diverged at tick ${w.tick}`);
  }
  assert.ok(w.projectiles.length + w.fighters.filter((f) => f.hp < f.hpMax).length > 0, 'something happened');
});

// A fake network: messages are delivered after `latency` frames, in order, on each side.
function link(latency) {
  const q = { host: [], guest: [] };
  let frame = 0;
  return {
    toGuest: (m) => q.guest.push({ at: frame + latency, m: JSON.parse(JSON.stringify(m)) }),
    toHost: (m) => q.host.push({ at: frame + latency, m: JSON.parse(JSON.stringify(m)) }),
    tick() { frame++; },
    deliver(side, fn) { while (q[side].length && q[side][0].at <= frame) fn(q[side].shift().m); },
  };
}

function session({ latency = 0, frames = 600, delay = 2, snapshotEvery = 60, hostFramesPerStep = 1, sabotage = null, guestPilot = null, hostPilot = null } = {}) {
  const loadouts = { 1: { weapon: 'ranged', armor: 'normal' }, 2: { weapon: 'normal', armor: 'antiMelee' } };
  const hostWorld = makeWorld({ seed: 9, loadouts }), guestWorld = makeWorld({ seed: 9, loadouts });
  const net = link(latency);
  let clock = 0;
  const host = createHostSync({ world: hostWorld, stepWorld, serializeWorld, send: net.toGuest, dt: DT, snapshotEvery });
  const guest = createGuestSync({ world: guestWorld, stepWorld, cloneWorld, applySnapshot, send: net.toHost, dt: DT, delay, now: () => clock });
  const aiHost = createAI('hard', 21), aiGuest = createAI('normal', 22);
  const hostHashes = new Map();
  let hostEvents = 0, guestEvents = 0, guestPresses = 0, hostDashes = 0, predicted = null, maxLead = 0;
  for (let f = 0; f < frames; f++) {
    clock += 1000 / 60;
    net.tick();
    // Host frame: read the guest's input, step, send.
    net.deliver('host', (m) => host.receive(m));
    if (f % hostFramesPerStep === 0) {
      host.step(hostPilot ? hostPilot(hostWorld, f) : aiIntent(aiHost, hostWorld, 1, DT));
      hostEvents += hostWorld.events.length;
      hostDashes += hostWorld.events.filter((e) => e.t === 'dash' && e.id === 2).length;
      hostWorld.events = [];
      hostHashes.set(hostWorld.tick, hashWorld(hostWorld));
      host.flush();
    }
    // Guest frame: read the host's ticks, sample input against the predicted world, send, predict.
    net.deliver('guest', (m) => guest.receive(m));
    const view = predicted || guestWorld;
    const it = guestPilot ? guestPilot(view, f) : aiIntent(aiGuest, view, 2, DT);
    if (guest.step(it) && it.pressed.dash) guestPresses++;
    guest.flush();
    predicted = guest.predict();
    maxLead = Math.max(maxLead, guest.stats.lead);
    const evs = guest.drainEvents();
    guestEvents += evs.length;
    if (sabotage && f === sabotage) { guestWorld.fighters[0].pos.x += 40; guestWorld.fighters[0].hp -= 100; }
    assert.ok(predicted.tick >= guestWorld.tick, 'prediction never behind the confirmed world');
  }
  return { hostWorld, guestWorld, host, guest, hostHashes, hostEvents, guestEvents, guestPresses, hostDashes, maxLead };
}

test('the guest confirmed world matches the host tick for tick over a fast link', () => {
  const s = session({ latency: 0, frames: 900 });
  assert.ok(s.guestWorld.tick > 800, `guest confirmed ${s.guestWorld.tick} ticks`);
  assert.equal(hashWorld(s.guestWorld), s.hostHashes.get(s.guestWorld.tick), 'confirmed state differs from the host at the same tick');
  assert.equal(s.guest.stats.corrections, 0, 'no corrections needed when inputs arrive on time');
  assert.equal(s.host.stats.late, 0);
  assert.ok(s.guest.stats.snapshots >= 10, `snapshots ${s.guest.stats.snapshots}`);
  assert.ok(s.maxLead <= 4, `lead ${s.maxLead}`);
  assert.ok(s.hostEvents > 20 && s.guestEvents === s.hostEvents, `events host ${s.hostEvents} guest ${s.guestEvents}`);
});

test('a laggy link costs corrections but never loses a press, and the host still rules', () => {
  // Nobody shoots: the guest taps dash every two seconds (well inside the cooldown) and otherwise
  // stands still, so every press that reaches the host must become a dash.
  const dasher = (view, f) => { const it = createIntent(); if (f % 120 === 30 && f < 700) it.pressed.dash = true; return it; };
  const idle = () => createIntent();
  const s = session({ latency: 4, frames: 900, delay: 1, guestPilot: dasher, hostPilot: idle });
  assert.equal(hashWorld(s.guestWorld), s.hostHashes.get(s.guestWorld.tick), 'confirmed state differs from the host');
  assert.ok(s.host.stats.late > 0, 'inputs did arrive late with a one-tick delay over a four-frame link');
  assert.ok(s.guest.stats.delay > 1, `the guest raised its input delay to ${s.guest.stats.delay}`);
  assert.ok(s.guestPresses >= 5 && s.hostDashes === s.guestPresses, `dash pressed ${s.guestPresses} times, performed on the host ${s.hostDashes}`);
});

test('a snapshot pulls a diverged guest back onto the host', () => {
  const s = session({ latency: 1, frames: 400, snapshotEvery: 30, sabotage: 200 });
  assert.equal(hashWorld(s.guestWorld), s.hostHashes.get(s.guestWorld.tick), 'the sabotaged guest was not corrected');
  assert.ok(s.guest.stats.snapshots >= 10);
});
