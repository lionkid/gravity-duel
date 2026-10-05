/* Gravity Duel - bootstrap, fixed-timestep loop, screen flow and renderer management. */
(function (GD) {
  'use strict';

  const CX = GD.ARENA.w / 2;
  const canvas = document.getElementById('game');
  const frameEl = document.getElementById('frame');
  const focusHint = document.getElementById('focusHint');
  const input = new GD.Input(GD.BINDINGS, window);

  // Both renderers share the canvas; the view setting picks which one draws.
  const renderers = { '2d': new GD.Renderer(canvas) };
  if (GD.Renderer3D) renderers['3d'] = new GD.Renderer3D(canvas);

  // ---- remembered settings (per browser; works without storage too) ----
  const STORE_KEY = 'gravity-duel:v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { saved = {}; }
  const valid = (list, id, fallback) => (list.some((x) => x.id === id) ? id : fallback);
  const restorePick = (p, d) => {
    const s = (saved.picks && saved.picks[p]) || {};
    return { mech: valid(GD.MECHS, s.mech, d.mech), ranged: valid(GD.RANGED, s.ranged, d.ranged), melee: valid(GD.MELEE, s.melee, d.melee) };
  };

  const app = {
    mode: saved.mode === 'versus' ? 'versus' : 'solo',
    cpuLevel: GD.AI_LEVELS && GD.AI_LEVELS[saved.cpuLevel] ? saved.cpuLevel : 'normal',
    cpuSeed: 1 + Math.floor(Math.random() * 1e6),
    cpuPick: null,      // single-player: the computer's frame and weapons
    ai: null,
    view: renderers[saved.view] ? saved.view : (renderers['3d'] ? '3d' : '2d'),
    sound: saved.sound !== false,
    stageId: GD.STAGES[saved.stageId] ? saved.stageId : 'earth',
    picks: {
      1: restorePick(1, { mech: 'ax01', ranged: 'beam', melee: 'saber' }),
      2: restorePick(2, { mech: 'zr06', ranged: 'bazooka', melee: 'axe' }),
    },
    net: GD.Net ? new GD.Net() : null,
    lanNote: '',
    world: null,        // the running battle
    showcase: null,     // menu backdrop world
    showcaseKey: '',
    focusLost: !document.hasFocus(),
    debug: false,
    koT: 0,
  };
  let renderer = renderers[app.view];
  GD.app = app;
  GD.renderer = renderer;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode: app.mode, cpuLevel: app.cpuLevel, view: app.view, sound: app.sound, stageId: app.stageId, picks: app.picks }));
    } catch (e) { /* storage blocked */ }
  }

  const solo = () => app.mode === 'solo';
  // The computer re-plans whenever the stage or the player's picks change; same seed, same answer.
  function cpuPicks() {
    app.cpuPick = GD.cpuChoose(app.cpuLevel, app.stageId, app.picks[1], app.cpuSeed);
    return app.cpuPick;
  }
  const p2Pick = () => (solo() ? cpuPicks() : app.picks[2]);

  const loadout = () => {
    const b = p2Pick();
    return { 1: { ranged: app.picks[1].ranged, melee: app.picks[1].melee }, 2: { ranged: b.ranged, melee: b.melee } };
  };

  const lan = () => app.mode === 'lan';
  const me = () => (lan() ? app.net.player || 1 : 1);
  const lanGuest = () => lan() && app.net.player === 2;
  const remote = GD.createRemoteInput ? GD.createRemoteInput() : null;
  let lanEvents = [];
  let snapAt = 0, snapGap = 1 / 60;

  function labelLan(world) {
    for (const f of world.fighters) {
      const mine = f.player === me();
      f.label = mine ? `YOU P${f.player}` : `RIVAL P${f.player}`;
      f.keySet = mine ? 1 : 0;      // HUD key hints: either keyboard half works locally; the rival plays elsewhere
      f.remote = !mine;
    }
  }

  function startBattle() {
    if (lanGuest()) return;                       // only the host starts LAN matches
    const b = p2Pick();
    const seed = Math.floor(Math.random() * 1e9);
    app.world = GD.createWorld(app.stageId, app.picks[1].mech, b.mech, loadout(), seed);
    const [f1, f2] = app.world.fighters;
    if (lan()) {
      app.ai = null;
      labelLan(app.world);
      lanEvents = [];
      app.net.send({ t: 'start', stageId: app.stageId, picks: app.picks, seed });
    } else if (solo()) {
      app.ai = GD.createAI(app.cpuLevel, app.cpuSeed + 101);
      f1.label = 'PLAYER';
      f2.label = `CPU ${GD.AI_LEVELS[app.cpuLevel].label}`;
      f2.cpu = true;
    } else {
      app.ai = null;
    }
    app.koT = 0;
    input.clear();
    save();
    menus.go('battle');
    sfx('start');
  }

  // Guest side of a LAN match: build the same world, then follow the host's snapshots.
  function startGuest(m) {
    app.stageId = m.stageId;
    app.picks = m.picks;
    const lo = { 1: { ranged: m.picks[1].ranged, melee: m.picks[1].melee }, 2: { ranged: m.picks[2].ranged, melee: m.picks[2].melee } };
    app.world = GD.createWorld(m.stageId, m.picks[1].mech, m.picks[2].mech, lo, m.seed);
    labelLan(app.world);
    app.ai = null;
    app.koT = 0;
    snapAt = performance.now();
    input.clear();
    menus.go('battle');
    sfx('start');
  }

  function setMode(mode) {
    app.mode = mode;
    document.body.dataset.mode = mode;
    if (mode !== 'lan' && app.net) app.net.close();
    save();
  }

  // ---- LAN messages ----
  function sendPick() {
    if (!lan() || !app.net.player) return;
    app.net.send({ t: 'pick', screen: menus.screen, pick: app.picks[me()], ready: !!menus.ready[me()] });
    if (!lanGuest() && menus.screen === 'stage') app.net.send({ t: 'stage', id: app.stageId });
  }
  function picksChanged() {
    save();
    sendPick();
  }
  function onNet(m) {
    if (!lan()) return;
    const other = 3 - me();
    switch (m.t) {
      case 'hello':
      case 'status':
        app.lanNote = '';
        if (menus.screen === 'lan') menus.render();
        break;
      case 'peer':
        if (m.on) {
          app.lanNote = '';
          // The host takes both browsers to frame select as soon as the guest arrives.
          if (!lanGuest()) { menus.goShared('select'); sendPick(); } else menus.render();
        } else if (menus.screen !== 'title') {
          app.lanNote = '對手已離線。等待新的對手連線…';
          menus.go('lan');
        }
        break;
      case 'full':
        app.lanNote = '這個房間已經有兩位玩家了。';
        break;
      case 'closed':
        if (app.net.status === 'full') { menus.render(); break; }
        if (menus.screen !== 'title') { app.lanNote = app.lanNote || '與房間的連線中斷。'; menus.go('lan'); }
        break;
      case 'go':
        menus.go(m.screen);
        sendPick();
        break;
      case 'pick':
        app.picks[other] = m.pick;
        app.showcaseKey = '';
        if (m.screen === menus.screen && (m.screen === 'select' || m.screen === 'loadout')) menus.setReady(other, m.ready, true);
        else menus.render();
        break;
      case 'stage':
        if (lanGuest() && GD.STAGES[m.id]) { app.stageId = m.id; menus.render(); }
        break;
      case 'start':
        if (lanGuest()) startGuest(m);
        break;
      case 'restart':
        if (!lanGuest()) startBattle();
        break;
      case 'in':
        if (remote) GD.remoteReceive(remote, m);
        break;
      case 'snap':
        if (lanGuest() && app.world) {
          GD.lanApply(app.world, m);
          const now = performance.now();
          snapGap += (Math.min(0.1, (now - snapAt) / 1000) - snapGap) * 0.2;
          snapAt = now;
        }
        break;
    }
  }
  if (app.net) app.net.onMessage = onNet;
  function lanConnect(base) {
    app.lanNote = '';
    if (!app.net.ws) app.net.connect(base);
    menus.render();
  }
  // Room browser: while the lobby is open, ask this page's server which rooms it hears on the LAN.
  let roomsSeen = '';
  setInterval(() => {
    if (!lan() || menus.screen !== 'lan' || !app.net.supported || app.net.ws) return;
    fetch('/api/rooms', { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      const key = JSON.stringify(data);
      if (key === roomsSeen) return;
      roomsSeen = key;
      app.lanRooms = data;
      if (menus.screen === 'lan' && !app.net.ws) menus.render(true);
    }).catch(() => { /* an older server without discovery */ });
  }, 1200);
  function lanLeave() {
    if (app.net) app.net.close();
    app.lanNote = '';
  }
  document.body.dataset.mode = app.mode;

  // Single player may use either half of the keyboard (and either pad).
  const KEYS = ['up', 'down', 'left', 'right', 'attack', 'sub', 'guard', 'switch', 'dash'];
  function merge(a, b) {
    const o = { pressed: {} };
    for (const k of KEYS) {
      o[k] = !!(a[k] || b[k]);
      if (a.pressed[k] || b.pressed[k]) o.pressed[k] = true;
    }
    return o;
  }

  function toggleView() {
    const next = app.view === '3d' ? '2d' : '3d';
    if (!renderers[next]) return;
    app.view = next;
    renderer = renderers[next];
    renderer.stage = null;          // force a fresh setStage on the next frame
    GD.renderer = renderer;
    save();
  }

  // ---- sound: starts on the first key press or click (browser autoplay rule) ----
  const sound = GD.Sound ? new GD.Sound() : null;
  if (sound) {
    sound.setEnabled(app.sound);
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }
  GD.sound = sound;
  function toggleSound() {
    app.sound = !app.sound;
    if (sound) sound.setEnabled(app.sound);
    save();
  }
  const sfx = (name) => { if (sound) sound.play(name); };

  const menus = new GD.Menus(document.getElementById('screens'), app, {
    startBattle, toggleView, setMode, cpuPicks, toggleSound, sfx, picksChanged,
    share: (m) => { if (app.net) app.net.send(m); }, lanConnect, lanLeave,
    newCpuSeed: () => { app.cpuSeed = 1 + Math.floor(Math.random() * 1e6); },
  });
  GD.menus = menus;

  // Menu backdrop: the current picks standing in the arena, rebuilt whenever a pick changes.
  function showcaseWorld() {
    const scr = menus.screen === 'help' ? menus.helpFrom : menus.screen;
    const stageView = scr === 'stage';
    const hidden = solo() && (scr === 'select' || scr === 'loadout');
    const pk = app.picks;
    const b = p2Pick();
    const key = [stageView ? 'stage' : 'menu', hidden, app.stageId, pk[1].mech, b.mech, pk[1].ranged, pk[1].melee, b.ranged, b.melee].join('|');
    if (key !== app.showcaseKey) {
      const w = GD.createWorld(app.stageId, pk[1].mech, b.mech, loadout());
      // Until the stage is picked, the computer's frame is a silhouette.
      if (hidden) w.fighters[1].silhouette = true;
      if (!stageView) {
        const y = w.stage.gravity > 0 ? GD.ARENA.groundY : 330;
        w.fighters.forEach((f, i) => { f.x = f.prevX = CX + (i ? 45 : -45); f.y = f.prevY = y; });
      }
      app.showcase = w;
      app.showcaseKey = key;
    }
    // On the loadout screen each frame holds whichever slot that player is browsing.
    for (const f of app.showcase.fighters) {
      f.mode = menus.browsingMelee(f.player) ? 'melee' : 'ranged';
    }
    return app.showcase;
  }

  // ---- focus: keyboard only reaches the page while it has focus (matters inside iframes) ----
  window.addEventListener('blur', () => { app.focusLost = true; input.clear(); });
  window.addEventListener('focus', () => { app.focusLost = false; input.clear(); });
  focusHint.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    window.focus();
    canvas.focus({ preventScroll: true });
    app.focusLost = false;
  });
  frameEl.addEventListener('pointerdown', () => { app.focusLost = false; });

  input.onGlobal = (code) => {
    if (app.focusLost) return;
    if (code === 'Backquote') { app.debug = !app.debug; return; }
    if (code === 'KeyM') { toggleSound(); if (menus.screen !== 'battle') menus.render(); return; }
    menus.global(code);
  };

  // On-screen pads: pressing one also lifts the focus guard, so mouse or touch players are never paused.
  if (GD.mountTouchPads) GD.mountTouchPads(input, () => { app.focusLost = false; });

  // ---- input monitor below the game: which actions each player is holding ----
  const monitorCells = [];
  for (const p of [1, 2]) {
    const root = document.getElementById(`monitor${p}`);
    if (!root) continue;
    root.innerHTML = GD.ACTIONS.map((a) => {
      const keys = GD.BINDINGS[p][a.id].map((c) => `<kbd>${GD.keyLabel(c)}</kbd>`).join('');
      return `<div class="chip" data-a="${a.id}"><span>${a.label}</span><span class="keys">${keys}</span></div>`;
    }).join('');
    root.querySelectorAll('.chip').forEach((el) => monitorCells.push({ el, p, a: el.dataset.a, on: false }));
  }
  function updateMonitor() {
    for (const c of monitorCells) {
      const on = input.peekHeld(c.p, c.a);
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); }
    }
  }

  // ---- fixed timestep loop with render interpolation ----
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    // Menus read both keyboards whenever the players are not fighting.
    if (!app.focusLost && menus.screen !== 'battle') {
      const p1 = input.sample(1).pressed, p2 = input.sample(2).pressed;
      if (solo() || lan()) {
        // One local player: both halves of the keyboard drive that player's side.
        menus.input(me(), Object.assign({}, p2, p1));
      } else {
        menus.input(1, p1);
        menus.input(2, p2);
      }
    }
    menus.update(dt);

    const scr = menus.screen;
    let backdrop = scr === 'help' ? menus.helpFrom : scr;
    if (backdrop === 'cpu' || backdrop === 'lan') backdrop = 'title';   // these screens share the title backdrop
    const inBattle = menus.inBattle();
    const world = inBattle ? app.world : showcaseWorld();
    if (renderer.stage !== world.stage) renderer.setStage(world.stage);
    if (renderer.cam) {
      renderer.cam.mode = backdrop === 'title' ? 'title' : (backdrop === 'select' || backdrop === 'loadout') ? 'showcase' : 'duel';
    }

    const live = scr === 'battle';
    // A LAN match keeps running when one window loses focus; only the pause menu stops it.
    const halted = (app.focusLost && !(lan() && inBattle)) || scr === 'pause' || (scr === 'help' && inBattle);
    const guestView = lanGuest() && inBattle;
    if (guestView) {
      // LAN guest: send our keys to the host and draw the host's snapshots.
      if (live) app.net.send(Object.assign({ t: 'in' }, GD.encodeInput(merge(input.sample(1), input.sample(2)))));
    } else if (!halted) {
      acc += dt;
      let steps = 0;
      while (acc >= GD.DT && steps < GD.MAX_STEPS_PER_FRAME) {
        let inputs = [GD.IDLE_INPUT, GD.IDLE_INPUT];
        if (live && app.ai) inputs = [merge(input.sample(1), input.sample(2)), GD.aiInput(app.ai, world, 2, GD.DT)];
        else if (live && lan()) inputs = [merge(input.sample(1), input.sample(2)), GD.remoteStep(remote)];
        else if (live) inputs = [input.sample(1), input.sample(2)];
        GD.stepWorld(world, inputs, GD.DT);
        acc -= GD.DT;
        steps++;
      }
      if (steps === GD.MAX_STEPS_PER_FRAME) acc = 0;
      if (lan() && inBattle) {
        for (const e of world.events) lanEvents.push(e);
        if (steps > 0) { app.net.send(GD.lanSnapshot(world, lanEvents)); lanEvents = []; }
      }
    }
    if (guestView || !halted) {
      renderer.consume(world.events);
      if (sound && inBattle) sound.consume(world.events);
      world.events.length = 0;
    }
    if (live && app.world.winner) {
      app.koT += dt;
      if (app.koT > 1.4) menus.go('ko');
    }

    const alpha = guestView ? Math.min(1, (now - snapAt) / 1000 / Math.max(0.008, snapGap)) : halted ? 1 : acc / GD.DT;
    const opts = { debug: app.debug && inBattle, paused: halted && inBattle };
    if (backdrop === 'title' || backdrop === 'select' || backdrop === 'loadout') {
      opts.showcase = true;
      opts.offsetX = backdrop === 'title' ? 210 : 0;
    }
    if (backdrop === 'stage') opts.noHud = true;
    if (sound) sound.updateLoops(world, inBattle && !halted);
    renderer.update(halted ? 0 : dt, world, alpha);
    renderer.draw(world, alpha, opts);

    focusHint.hidden = !app.focusLost;
    updateMonitor();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})(globalThis.GD = globalThis.GD || {});
