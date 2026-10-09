// Host-authoritative lockstep with guest-side prediction, for two players on a LAN.
//
// The host runs the simulation at full rate and never waits: each tick it uses its own intent and the
// guest's intent for that tick if it has arrived (otherwise the guest's last input, held on). It tells
// the guest which pair of intents every tick used, and every `snapshotEvery` ticks the whole state.
//
// The guest keeps a *confirmed* world that replays exactly those ticks (so it matches the host bit for
// bit when the simulation is deterministic, and is corrected by the snapshots when it is not), and
// renders a *predicted* world: the confirmed one stepped ahead with the guest's own intents, which it
// schedules `delay` ticks in the future so they reach the host in time. Its own mech answers at once;
// the host's mech is extrapolated with its last known input for the few ticks of lead.
//
// Both sides are pure: a game passes in its world and its step / clone / snapshot functions, and a
// `send(msg)` for the transport. Messages: { t: 'in' } guest → host, { t: 'tk' } host → guest,
// { t: 'ping' } / { t: 'pong' } for the round trip. Anything else is left to the game.

import { createIntent, IDLE_INTENT } from '../input/intent.js';
import { encodeIntent, decodeIntent, carryOf, sameEncoded, IDLE_ENCODED } from './codec.js';

export function createHostSync({ world, stepWorld, serializeWorld, send, dt = 1 / 60, localSeat = 1, remoteSeat = 2, snapshotEvery = 60 }) {
  const pending = new Map();        // tick → the guest's encoded intent for it
  let carried = null;               // the guest's latest input (used, held on, when a tick's own is missing)
  let latePressed = 0;              // presses that arrived after their tick: applied on the next one instead
  const batch = [];
  let batchStart = -1;
  let lastSnapTick = world.tick;
  const guestIntent = createIntent(), hostIntent = createIntent();
  const stats = { late: 0, received: 0 };

  return {
    stats,
    get world() { return world; },
    // Returns true when the message belonged to the sync layer.
    receive(m) {
      if (m.t === 'in') {
        for (let j = 0; j < m.l.length; j++) {
          const k = m.k + j, enc = m.l[j];
          stats.received++;
          if (k < world.tick) {                                   // too late: that tick is gone
            stats.late++;
            latePressed |= enc[5];
            carried = enc;
          } else if (k < world.tick + 600) pending.set(k, enc);
        }
        return true;
      }
      if (m.t === 'ping') { send({ t: 'pong', n: m.n }); return true; }
      return false;
    },
    // Advances the world one tick with the host's intent and whatever the guest sent for this tick.
    step(localIntent) {
      const k = world.tick;
      let enc = pending.get(k);
      let late = 0;
      if (enc) { pending.delete(k); carried = enc; } else { enc = carryOf(carried); late = 1; }
      if (latePressed) { enc = enc.slice(); enc[5] |= latePressed; latePressed = 0; }
      const h = encodeIntent(localIntent);
      const intents = [];
      intents[localSeat - 1] = decodeIntent(h, hostIntent);        // both ends run the normalised values
      intents[remoteSeat - 1] = decodeIntent(enc, guestIntent);
      stepWorld(world, intents, dt);
      if (batchStart < 0) batchStart = k;
      batch.push(late ? [h, enc, 1] : [h, enc]);
    },
    // Once per frame: the ticks stepped since the last call, plus a snapshot when one is due.
    flush() {
      if (!batch.length) return;
      const msg = { t: 'tk', k: batchStart, l: batch.splice(0) };
      batchStart = -1;
      if (world.tick - lastSnapTick >= snapshotEvery) { msg.s = serializeWorld(world); lastSnapTick = world.tick; }
      send(msg);
    },
  };
}

export function createGuestSync({ world, stepWorld, cloneWorld, applySnapshot, send, dt = 1 / 60, localSeat = 2, remoteSeat = 1, delay = 2, now = () => Date.now() }) {
  const local = new Map();          // tick → our encoded intent scheduled for it
  let predTick = world.tick;        // the predicted world runs up to here
  let hostCarried = null;           // the host's last confirmed input, for extrapolating it
  let lastLocal = null;
  const outBatch = [];
  let outStart = -1;
  const events = [];
  const tmpH = createIntent(), tmpG = createIntent();
  const stats = { lead: 0, delay, rtt: 0, corrections: 0, late: 0, snapshots: 0, skipped: 0 };
  let skippedPressed = 0, pingN = 0, pingAt = 0, lastPing = 0, lateWindow = 0, windowAt = 0;

  function stepConfirmed(h, g) {
    const intents = [];
    intents[remoteSeat - 1] = decodeIntent(h, tmpH);
    intents[localSeat - 1] = decodeIntent(g, tmpG);
    stepWorld(world, intents, dt);
    for (const e of world.events) events.push(e);
    world.events = [];
  }

  return {
    stats,
    get world() { return world; },
    get predTick() { return predTick; },
    receive(m) {
      if (m.t === 'tk') {
        for (let j = 0; j < m.l.length; j++) {
          const k = m.k + j;
          if (k < world.tick) continue;                          // already have it
          if (k > world.tick) break;                             // a gap: wait for the snapshot to catch up
          const [h, g, late] = m.l[j];
          hostCarried = h;
          const mine = local.get(k);
          if (mine && !sameEncoded(mine, g)) stats.corrections++;
          if (late) { stats.late++; lateWindow++; }
          local.delete(k);
          stepConfirmed(h, g);
        }
        if (m.s && m.s.tick >= world.tick) {                     // authoritative state after the batch
          applySnapshot(world, m.s);
          stats.snapshots++;
          for (const k of local.keys()) if (k < world.tick) local.delete(k);
        }
        if (predTick < world.tick) predTick = world.tick;
        stats.lead = predTick - world.tick;
        return true;
      }
      if (m.t === 'pong') { if (m.n === pingN) stats.rtt = now() - pingAt; return true; }
      return false;
    },
    // Once per local fixed step with the player's intent: it is scheduled `delay` ticks ahead so it
    // reaches the host before the host gets there. Running too far ahead of the host skips a step.
    step(localIntent) {
      // The lead is naturally about one-way latency; well beyond that the guest is ahead of the host.
      const maxLead = Math.max(4, Math.ceil(stats.rtt / (dt * 1000)) + 3);
      if (predTick - world.tick > maxLead) { stats.skipped++; skippedPressed |= encodeIntent(localIntent)[5]; return false; }
      const enc = encodeIntent(localIntent);
      if (skippedPressed) { enc[5] |= skippedPressed; skippedPressed = 0; }
      const k = predTick + stats.delay;
      local.set(k, enc);
      lastLocal = enc;
      if (outStart < 0) outStart = k;
      outBatch.push(enc);
      predTick++;
      stats.lead = predTick - world.tick;
      return true;
    },
    // Once per frame: send this frame's intents; ping once a second and adapt the input delay to how
    // often the host had to go without our input.
    flush() {
      if (outBatch.length) { send({ t: 'in', k: outStart, l: outBatch.splice(0) }); outStart = -1; }
      const t = now();
      if (t - lastPing > 1000) { lastPing = t; pingN++; pingAt = t; send({ t: 'ping', n: pingN }); }
      if (t - windowAt > 2000) {
        if (lateWindow > 3 && stats.delay < 8) stats.delay++;
        else if (lateWindow === 0 && stats.delay > 2 && stats.rtt < (stats.delay - 2) * dt * 1000) stats.delay--;
        lateWindow = 0; windowAt = t;
      }
    },
    // The confirmed world stepped ahead to predTick: our scheduled intents, the host's input held on.
    // `before(world)` is called just before the last step, so the caller can keep positions to
    // interpolate from.
    predict(before) {
      const w = cloneWorld(world);
      const h = decodeIntent(carryOf(hostCarried), tmpH);
      let g = lastLocal;
      for (let k = world.tick; k < predTick; k++) {
        const enc = local.get(k);
        if (enc) g = enc;
        const intents = [];
        intents[remoteSeat - 1] = h;
        intents[localSeat - 1] = decodeIntent(enc || carryOf(k < predTick ? g : null) || IDLE_ENCODED, tmpG);
        if (before && k === predTick - 1) before(w);
        stepWorld(w, intents, dt);
        w.events = [];
      }
      if (before && predTick === world.tick) before(w);
      return w;
    },
    drainEvents() { return events.splice(0); },
  };
}
