// The LAN lobby protocol over a fake relay: the host's stage and speed settings reach the guest, and
// the start message carries them so both sides build the same world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLobby } from '../lobby.js';

// Two lobbies joined by a relay that tags seats like the server does.
function pair() {
  const sent = { 1: [], 2: [] };
  const sides = {};
  const socketFor = (seat) => ({
    open: true, connected: true,
    send: (m) => { sent[seat].push(m); const other = sides[3 - seat]; if (other) other.lobby.receive(m); },
    connect() {}, close() {},
  });
  for (const seat of [1, 2]) {
    const started = [];
    const loadout = seat === 1 ? { weapon: 'ranged', armor: 'normal' } : { weapon: 'melee', armor: 'antiMelee' };
    const lobby = createLobby({ socket: socketFor(seat), loadout, onStart: (s) => started.push(s), random: () => 0.5 });
    sides[seat] = { lobby, started, loadout };
  }
  sides[1].lobby.state.server = sides[2].lobby.state.server = true;
  sides[1].lobby.receive({ t: 'hello', player: 1, peer: false });
  sides[2].lobby.receive({ t: 'hello', player: 2, peer: true });     // the guest arrives: says hi
  sides[1].lobby.receive({ t: 'peer', on: true });                    // the relay tells the host, who says hi back
  return { host: sides[1], guest: sides[2], sent };
}

test('the host picks the stage and the speeds; the guest sees them and the start message carries them', () => {
  const { host, guest } = pair();
  assert.equal(host.lobby.state.phase, 'lobby'); assert.equal(guest.lobby.state.phase, 'lobby');
  assert.deepEqual(guest.lobby.state.peerLoadout, host.loadout);
  host.lobby.setStage('space');
  host.lobby.setTuning({ run: 1.6, dash: 1.2 });
  assert.equal(guest.lobby.state.peerStage, 'space');
  assert.deepEqual(guest.lobby.state.peerTuning, { run: 1.6, dash: 1.2 }, 'the guest learns the host speeds before the match');
  guest.lobby.setTuning({ run: 0.8, dash: 0.8 });                      // a guest's own settings go nowhere
  assert.equal(host.lobby.state.peerTuning, null);
  host.lobby.setReady(true); guest.lobby.setReady(true);
  assert.equal(host.started.length, 1); assert.equal(guest.started.length, 1);
  const h = host.started[0], g = guest.started[0];
  assert.equal(h.seed, g.seed);
  assert.equal(h.seat, 1); assert.equal(g.seat, 2);
  assert.deepEqual(h.loadouts, g.loadouts);
  assert.deepEqual(h.loadouts, { 1: host.loadout, 2: guest.loadout });
  assert.equal(g.stage, 'space');
  assert.deepEqual(g.tuning, { run: 1.6, dash: 1.2 }); assert.deepEqual(h.tuning, { run: 1.6, dash: 1.2 });
});

test('without speed settings the start message says so, and a rematch starts again from the host', () => {
  const { host, guest } = pair();
  host.lobby.setReady(true); guest.lobby.setReady(true);
  assert.equal(guest.started[0].tuning, null);
  host.lobby.again(); guest.lobby.again();
  assert.equal(host.started.length, 2); assert.equal(guest.started.length, 2);
  assert.equal(host.started[1].seed, guest.started[1].seed);
});
