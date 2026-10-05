/* Gravity Duel - LAN play: WebSocket client plus the host-authoritative sync helpers.
 * The host (player 1) runs the simulation and streams snapshots; the guest (player 2) sends
 * only its inputs and draws what the host sends. Snapshot helpers have no DOM and run in Node. */
(function (GD) {
  'use strict';

  const KEYS = ['up', 'down', 'left', 'right', 'attack', 'sub', 'guard', 'switch', 'dash'];

  // ---------------------------------------------------------------- inputs as bitmasks
  GD.encodeInput = function (inp) {
    let h = 0, p = 0;
    KEYS.forEach((k, i) => {
      if (inp[k]) h |= 1 << i;
      if (inp.pressed && inp.pressed[k]) p |= 1 << i;
    });
    return { h, p };
  };

  // The host keeps the guest's latest held keys and collects presses until a physics step uses them.
  GD.createRemoteInput = function () {
    return { held: 0, pressed: 0 };
  };
  GD.remoteReceive = function (ri, msg) {
    ri.held = msg.h | 0;
    ri.pressed |= msg.p | 0;
  };
  GD.remoteStep = function (ri) {
    const out = { pressed: {} };
    KEYS.forEach((k, i) => {
      out[k] = (ri.held & (1 << i)) !== 0;
      if (ri.pressed & (1 << i)) out.pressed[k] = true;
    });
    ri.pressed = 0;
    return out;
  };

  // ---------------------------------------------------------------- snapshots
  const FIELDS = ['x', 'y', 'vx', 'vy', 'facing', 'onGround', 'state', 'hp', 'fuel', 'overheat', 'boosting', 'thrusting',
    'thrustX', 'thrustY', 'guarding', 'dashT', 'walkPhase', 'landSquash', 'hitstun', 'ko', 'mode', 'ammo', 'sinceFire',
    'cooldown', 'switchCd', 'switchDenied', 'switchLag', 'energy', 'lowEnergy', 'hitFlash', 'recoil', 'lastAim', 'subFlash',
    'invuln', 'damageDealt'];
  const r1 = (v) => Math.round(v * 10) / 10;

  GD.lanSnapshot = function (world, events) {
    return {
      t: 'snap',
      time: r1(world.time),
      winner: world.winner,
      f: world.fighters.map((f) => {
        const o = {};
        for (const k of FIELDS) o[k] = typeof f[k] === 'number' ? Math.round(f[k] * 1000) / 1000 : f[k];
        o.melee = f.melee ? { t: f.melee.t, range: f.melee.range, hit: f.melee.hit, w: f.melee.w.id } : null;
        return o;
      }),
      p: world.projectiles.map((p) => [p.id, p.weapon.id, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.owner, Math.round(p.life * 1000) / 1000]),
      e: events,
    };
  };

  // Apply a host snapshot. The previous positions become prevX/prevY so the renderer can
  // interpolate between snapshots exactly like it interpolates between physics steps.
  GD.lanApply = function (world, snap) {
    world.time = snap.time;
    world.winner = snap.winner;
    snap.f.forEach((s, i) => {
      const f = world.fighters[i];
      f.prevX = f.x; f.prevY = f.y;
      for (const k of FIELDS) if (k in s) f[k] = s[k];
      f.melee = s.melee ? { t: s.melee.t, range: s.melee.range, hit: s.melee.hit, w: GD.weaponById(s.melee.w) } : null;
    });
    const before = new Map(world.projectiles.map((p) => [p.id, p]));
    world.projectiles = snap.p.map(([id, wid, x, y, vx, vy, owner, life]) => {
      const old = before.get(id);
      const w = GD.weaponById(wid);
      return { id, weapon: w, x, y, vx, vy, owner, life, r: w.radius, g: w.g,
        prevX: old ? old.x : x, prevY: old ? old.y : y };
    });
    for (const e of snap.e || []) world.events.push(e);
  };

  // ---------------------------------------------------------------- connection
  class Net {
    constructor() {
      this.ws = null;
      this.player = 0;          // 1 = host, 2 = guest
      this.peer = false;
      this.status = 'idle';     // idle | connecting | online | full | closed | error
      this.onMessage = null;
    }

    get supported() {
      return typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && typeof WebSocket !== 'undefined';
    }

    get isHost() { return this.player === 1; }
    // Links the other computer can open: the server's LAN addresses, or this page's address if it is not localhost.
    get links() {
      const here = typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '';
      const local = typeof location !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
      const list = (this.addrs || []).slice();
      if (!local && here && !list.includes(here)) list.unshift(here);
      return list.length ? list : [here];
    }

    // base: another server's address such as http://192.168.1.20:8080, or empty for this page's own server.
    connect(base) {
      if (this.ws || !this.supported) return;
      this.status = 'connecting';
      this.base = base || '';
      const url = base ? `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`
        : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) { this.status = 'error'; this.emit({ t: 'status' }); return; }
      this.ws = ws;
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') { this.player = m.player; this.peer = m.peer; this.status = 'online'; this.addrs = m.addrs || []; }
        else if (m.t === 'peer') this.peer = m.on;
        else if (m.t === 'full') this.status = 'full';
        this.emit(m);
      };
      ws.onerror = () => { if (this.status === 'connecting') this.status = 'error'; };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.status !== 'full') this.status = this.status === 'connecting' || this.status === 'error' ? 'error' : 'closed';
        this.peer = false;
        this.player = 0;
        this.emit({ t: 'closed' });
      };
      this.emit({ t: 'status' });
    }

    emit(m) { if (this.onMessage) this.onMessage(m); }

    send(m) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
    }

    close() {
      const ws = this.ws;
      this.ws = null;
      this.status = 'idle';
      this.player = 0;
      this.peer = false;
      if (ws) try { ws.close(); } catch (e) { /* already closed */ }
    }
  }

  GD.Net = Net;
  GD.NET_KEYS = KEYS;
})(globalThis.GD = globalThis.GD || {});
