/* Gravity Duel - on-screen control pads for mouse and touch.
 * Each button holds an input action while pressed, exactly like its keyboard key.
 * Pointer capture keeps every finger tied to its own button, so two players can share a tablet. */
(function (GD) {
  'use strict';

  const DPAD = [
    { a: 'up', label: '▲', sub: '噴射' }, { a: 'left', label: '◀' }, { a: 'right', label: '▶' }, { a: 'down', label: '▼' },
  ];
  const ACTS = [
    { a: 'attack', label: '攻擊', cls: 'big' }, { a: 'sub', label: '火神砲' }, { a: 'switch', label: '切換' },
    { a: 'guard', label: '防禦' }, { a: 'dash', label: '衝刺' },
  ];

  function bindHold(el, onDown, onUp) {
    const pointers = new Set();
    const release = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size === 0) { el.classList.remove('on'); onUp(); }
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();               // no text selection, no focus steal, no double-tap zoom
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
      pointers.add(e.pointerId);
      el.classList.add('on');
      onDown();
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // onUse runs on every press so the game un-pauses its focus guard for pad players.
  GD.mountTouchPads = function (input, onUse) {
    for (const p of [1, 2]) {
      const root = document.getElementById(`pad${p}`);
      if (!root) continue;
      const keyOf = (a) => GD.keyLabel(GD.BINDINGS[p][a][0]);
      root.innerHTML = `
        <div class="pad-title">PLAYER ${p}</div>
        <div class="pad-body">
          <div class="dpad">${DPAD.map((b) => `<button type="button" tabindex="-1" class="vbtn d-${b.a}" data-a="${b.a}" aria-label="P${p} ${b.sub || b.a}">
            ${b.label}${b.sub ? `<small>${b.sub}</small>` : ''}</button>`).join('')}</div>
          <div class="acts">${ACTS.map((b) => `<button type="button" tabindex="-1" class="vbtn ${b.cls || ''}" data-a="${b.a}">
            ${b.label}<small>${keyOf(b.a)}</small></button>`).join('')}</div>
        </div>`;
      root.querySelectorAll('[data-a]').forEach((el) => {
        const a = el.dataset.a;
        bindHold(el, () => { onUse(); input.virtualDown(p, a); }, () => input.virtualUp(p, a));
      });
    }
    // System buttons: same as Esc and Enter on the keyboard.
    document.querySelectorAll('[data-sys]').forEach((el) => {
      bindHold(el, () => { onUse(); if (input.onGlobal) input.onGlobal(el.dataset.sys); }, () => {});
    });
  };
})(globalThis.GD = globalThis.GD || {});
