/* Gravity Duel - bootstrap, fixed-timestep loop and page controls. */
(function (GD) {
  'use strict';

  const canvas = document.getElementById('game');
  const renderer = new GD.Renderer(canvas);
  const input = new GD.Input(GD.BINDINGS, window);

  const app = {
    stageId: 'earth',
    mechs: { 1: 'ax01', 2: 'zr06' },
    paused: false,
    focusLost: false,
    debug: false,
    world: null,
  };

  function newWorld() {
    app.world = GD.createWorld(app.stageId, app.mechs[1], app.mechs[2]);
    renderer.setStage(app.world.stage);
    input.clear();
  }

  function setStage(id) {
    app.stageId = id;
    document.querySelectorAll('[data-stage]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stage === id)));
    document.querySelectorAll('[data-help]').forEach((el) => { el.hidden = el.dataset.help !== id; });
    newWorld();
  }

  function setPaused(p) {
    app.paused = p;
    if (!p) input.clear();
  }

  function toggleDebug() {
    app.debug = !app.debug;
    document.getElementById('debugBtn').setAttribute('aria-pressed', String(app.debug));
  }

  input.onGlobal = (code) => {
    if (app.focusLost) return;
    if (code === 'Escape') setPaused(!app.paused);
    else if (code === 'Backquote') toggleDebug();
    else if (app.paused && code === 'Enter') { newWorld(); setPaused(false); }
    else if (app.paused && code === 'Digit1') { setStage('earth'); setPaused(false); }
    else if (app.paused && code === 'Digit2') { setStage('space'); setPaused(false); }
  };

  // Keyboard only reaches the page while it has focus (important inside iframes).
  window.addEventListener('blur', () => { app.focusLost = true; input.clear(); });
  window.addEventListener('focus', () => { app.focusLost = false; input.clear(); });
  canvas.addEventListener('pointerdown', () => { canvas.focus(); app.focusLost = false; });

  // ---- Page controls ----
  // Buttons and selects release focus after use so keys go back to the game.
  const release = (el) => { el.blur(); canvas.focus({ preventScroll: true }); };
  document.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => { setStage(b.dataset.stage); release(b); }));
  document.getElementById('resetBtn').addEventListener('click', (e) => { newWorld(); setPaused(false); release(e.currentTarget); });
  document.getElementById('debugBtn').addEventListener('click', (e) => { toggleDebug(); release(e.currentTarget); });

  for (const p of [1, 2]) {
    const sel = document.getElementById(`p${p}Mech`);
    sel.innerHTML = GD.MECHS.map((m) => `<option value="${m.id}">${m.code} ${m.name} · ${m.role}</option>`).join('');
    sel.value = app.mechs[p];
    sel.addEventListener('change', () => { app.mechs[p] = sel.value; newWorld(); release(sel); });
  }

  // ---- Input monitor: shows which actions each player is holding ----
  const monitorCells = [];
  for (const p of [1, 2]) {
    const root = document.getElementById(`monitor${p}`);
    root.innerHTML = GD.ACTIONS.map((a) => {
      const keys = GD.BINDINGS[p][a.id].map((c) => `<kbd>${GD.keyLabel(c)}</kbd>`).join('');
      return `<div class="chip" data-p="${p}" data-a="${a.id}"><span>${a.label}</span><span class="keys">${keys}</span></div>`;
    }).join('');
    root.querySelectorAll('.chip').forEach((el) => monitorCells.push({ el, p, a: el.dataset.a, on: false }));
  }
  function updateMonitor() {
    for (const c of monitorCells) {
      const on = input.peekHeld(c.p, c.a);
      if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); }
    }
  }

  // ---- Fixed timestep loop with render interpolation ----
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const halted = app.paused || app.focusLost;
    if (!halted) {
      acc += dt;
      let steps = 0;
      while (acc >= GD.DT && steps < GD.MAX_STEPS_PER_FRAME) {
        GD.stepWorld(app.world, [input.sample(1), input.sample(2)], GD.DT);
        acc -= GD.DT;
        steps++;
      }
      if (steps === GD.MAX_STEPS_PER_FRAME) acc = 0;
      renderer.consume(app.world.events);
      app.world.events.length = 0;
    }
    const alpha = halted ? 1 : acc / GD.DT;
    renderer.update(halted ? 0 : dt, app.world, alpha);
    renderer.draw(app.world, alpha, { debug: app.debug, paused: halted, focusLost: app.focusLost });
    updateMonitor();
    requestAnimationFrame(frame);
  }

  setStage('earth');
  app.focusLost = !document.hasFocus();
  canvas.focus({ preventScroll: true });
  requestAnimationFrame(frame);

  GD.app = app; // handy for poking at state from the console
})(globalThis.GD = globalThis.GD || {});
