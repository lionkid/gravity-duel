// LAN lobby for Skyline: finds rooms through the page's own server, joins one over the relay socket
// and runs the small pre-match protocol. The sync layer's messages ('in', 'tk', 'ping', 'pong') are
// not its business: main.js hands those to the active sync first.
//
//   hi     { game, version, loadout }   sent to a newly met peer
//   pick   { loadout }                  a loadout change
//   ready  { on }
//   start  { seed, loadouts }           host → guest: both build the same world
//   again  {}                           ready for a rematch after a KO (the host starts when both are)
//   lobby  {}                           back to the room screen, both sides
//
// Seats come from the relay: the first browser on a server is seat 1 and hosts the simulation.

import { GAME } from './config.js';

export function createLobby({ socket, loadout, onChange, onStart, onPeerLeft, onLobby, random = Math.random }) {
  const st = {
    server: false,          // this page is served by a Gravity Duel server, so rooms and the relay exist
    phase: 'idle',          // idle | browsing | connecting | waiting | lobby | battle
    rooms: [], self: null, scanned: false,
    note: '',
    seat: 0,
    peerLoadout: null, peerReady: false, myReady: false, peerVersion: '', peerGame: '',
    againMe: false, againPeer: false,
  };
  let poll = 0;
  const change = () => { if (onChange) onChange(st); };
  const resetPeer = () => { st.peerLoadout = null; st.peerReady = false; st.myReady = false; st.againMe = false; st.againPeer = false; st.peerVersion = ''; st.peerGame = ''; };
  const sendHi = () => socket.send({ t: 'hi', game: GAME.id, version: GAME.version, loadout: { ...loadout } });
  const isHost = () => st.seat === 1;
  const loadouts = () => ({ 1: isHost() ? { ...loadout } : { ...st.peerLoadout }, 2: isHost() ? { ...st.peerLoadout } : { ...loadout } });

  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  function begin(seed, lo) {
    st.phase = 'battle';
    st.myReady = st.peerReady = false;
    st.againMe = st.againPeer = false;
    change();
    if (onStart) onStart({ seed, loadouts: lo, seat: st.seat });
  }
  function hostStart() {
    const seed = 1 + Math.floor(random() * 2147483000);
    const lo = loadouts();
    socket.send({ t: 'start', seed, loadouts: lo });
    begin(seed, lo);
  }
  function toLobby() {
    st.phase = 'lobby';
    st.myReady = st.peerReady = false;
    st.againMe = st.againPeer = false;
    if (onLobby) onLobby();
    change();
  }
  function stopPolling() { if (poll) { clearInterval(poll); poll = 0; } }

  const lobby = {
    state: st,
    get isHost() { return isHost(); },
    // Is this page served by a Gravity Duel server? Decides whether the LAN button does anything.
    async detectServer() {
      try { const info = await fetchJson('/api/info'); st.server = info && info.app === 'gravity-duel'; } catch (e) { st.server = false; }
      change();
      return st.server;
    },
    async refreshRooms() {
      try {
        const data = await fetchJson('/api/rooms');
        st.self = data.self || null;
        st.rooms = (data.rooms || []).filter((r) => r.players > 0);
        st.scanned = true;
      } catch (e) { /* keep the last list */ }
      change();
    },
    // The room browser: list this server's room and the rooms heard on the LAN, refreshed every two seconds.
    browse() {
      st.phase = 'browsing';
      st.note = '';
      lobby.refreshRooms();
      stopPolling();
      poll = setInterval(() => { if (st.phase === 'browsing') lobby.refreshRooms(); else stopPolling(); }, 2000);
      change();
    },
    stopBrowsing() { stopPolling(); if (st.phase === 'browsing') st.phase = 'idle'; },
    // base: another server's address, or '' for this page's own server (create a room, or join its waiting player).
    connect(base = '') {
      if (!st.server || socket.open) return;
      stopPolling();
      st.note = '';
      st.phase = 'connecting';
      socket.connect(base);
      change();
    },
    leave() {
      stopPolling();
      socket.close();
      resetPeer();
      st.seat = 0;
      st.phase = 'idle';
      change();
    },
    pickChanged() { if (socket.connected && st.phase !== 'waiting') { socket.send({ t: 'pick', loadout: { ...loadout } }); if (st.myReady) lobby.setReady(false); } },
    setReady(on) {
      st.myReady = !!on;
      socket.send({ t: 'ready', on: st.myReady });
      change();
      if (isHost() && st.myReady && st.peerReady && st.peerLoadout && st.phase === 'lobby') hostStart();
    },
    again() {
      if (st.againMe) return;
      st.againMe = true;
      socket.send({ t: 'again' });
      change();
      if (isHost() && st.againPeer && st.peerLoadout) hostStart();
    },
    goLobby() { socket.send({ t: 'lobby' }); toLobby(); },
    // Messages from the relay and the peer. Returns true when handled.
    receive(m) {
      switch (m.t) {
        case 'hello':
          st.seat = m.player;
          if (m.peer) { st.phase = 'lobby'; sendHi(); } else st.phase = 'waiting';
          break;
        case 'peer':
          if (m.on) { st.phase = 'lobby'; st.note = ''; sendHi(); } else {
            const wasBattle = st.phase === 'battle';
            resetPeer();
            st.phase = 'waiting';
            st.note = '對手已離線。';
            if (wasBattle && onPeerLeft) onPeerLeft();
          }
          break;
        case 'full':
          st.note = '這個房間已經有兩位玩家了。';
          break;
        case 'closed': {
          const wasBattle = st.phase === 'battle';
          const wasFull = st.note.startsWith('這個房間已經有');
          resetPeer();
          st.seat = 0;
          if (st.phase !== 'idle') {
            if (!wasFull) st.note = st.phase === 'connecting' ? '連不上這個房間。' : '與房間的連線中斷。';
            lobby.browse();
          }
          if (wasBattle && onPeerLeft) onPeerLeft();
          break;
        }
        case 'hi':
          st.peerLoadout = m.loadout || { weapon: 'normal', armor: 'normal' };
          st.peerVersion = m.version || '';
          st.peerGame = m.game || '';
          if (st.peerGame && st.peerGame !== GAME.id) st.note = '對方開的是另一款遊戲，無法對戰。';
          else if (st.peerVersion && st.peerVersion !== GAME.version) st.note = `對方的版本是 ${st.peerVersion}，這裡是 ${GAME.version}；版本不同可能會不同步。`;
          break;
        case 'pick': st.peerLoadout = m.loadout || st.peerLoadout; if (st.peerReady) st.peerReady = false; break;
        case 'ready':
          st.peerReady = !!m.on;
          if (isHost() && st.myReady && st.peerReady && st.peerLoadout && st.phase === 'lobby') { change(); hostStart(); return true; }
          break;
        case 'start': if (!isHost() && m.loadouts) begin(m.seed, m.loadouts); return true;
        case 'again':
          st.againPeer = true;
          if (isHost() && st.againMe && st.peerLoadout) { change(); hostStart(); return true; }
          break;
        case 'lobby': toLobby(); return true;
        default: return false;
      }
      change();
      return true;
    },
  };
  return lobby;
}
