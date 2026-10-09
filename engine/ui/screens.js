// A small screen stack for menus rendered in a DOM container. A game defines screens as functions
// returning HTML; buttons carry data-act and the manager dispatches clicks (and hotkeys) to the
// screen's actions:
//
//   const ui = createScreens(document.getElementById('screens'));
//   ui.define('title', () => ({ html: `<h1>…</h1><button data-act="play">Play</button>`,
//                               actions: { play: () => ui.show('cpu'), escape: () => ui.back() },
//                               keys: { KeyR: 'play' } }));
//   ui.show('title');
//
// show() pushes a screen (so back() returns to the previous one), replace() swaps the top, hide()
// closes everything. Up/Down (or W/S) move focus between buttons, Escape calls the `escape` action
// when a screen defines one, and `keys` maps other key codes to actions. onChange(name | null)
// fires after every change so the game can pause or resume.

export function createScreens(root, { onChange } = {}) {
  const defs = new Map();
  const stack = [];
  let current = null;

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled || !current) return;
    e.stopPropagation();
    const fn = current.actions[btn.dataset.act];
    if (fn) fn(btn.dataset, btn);
  });

  const focusables = () => [...root.querySelectorAll('button:not([disabled]), input')];
  // Moves the focus to the next (dir 1) or previous (dir -1) control; also what a gamepad drives.
  function moveFocus(dir) {
    if (!current) return;
    const items = focusables();
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }
  function activate() {
    if (!current) return;
    const el = document.activeElement;
    if (el && root.contains(el) && el.tagName === 'BUTTON') el.click();
    else { const first = root.querySelector('.primary:not([disabled])') || root.querySelector('button:not([disabled])'); if (first) first.click(); }
  }
  function escape() { if (current && current.actions.escape) current.actions.escape(); }
  window.addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.code === 'Escape') {
      if (current.actions.escape) { e.preventDefault(); escape(); }
      return;
    }
    const hot = current.view.keys && current.view.keys[e.code];
    if (hot && current.actions[hot]) { e.preventDefault(); current.actions[hot](); return; }
    if (e.target && e.target.tagName === 'INPUT') return;           // sliders use the arrows themselves
    const dir = e.code === 'ArrowDown' || e.code === 'KeyS' ? 1 : e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 0;
    if (!dir) return;
    moveFocus(dir);
    e.preventDefault();
  });

  function render() {
    const top = stack[stack.length - 1];
    if (!top) {
      current = null;
      root.hidden = true;
      root.innerHTML = '';
      delete root.dataset.screen;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (onChange) onChange(null);
      return;
    }
    const def = defs.get(top.name);
    if (!def) throw new Error(`screen ${top.name} is not defined`);
    const view = def(top.data || {});
    // A refresh keeps the focus (and a text box's caret) where it was.
    const active = document.activeElement;
    const keep = active && root.contains(active) ? {
      id: active.id, act: active.dataset.act, key: active.dataset.url ?? active.dataset.id ?? active.dataset.level ?? '',
      text: active.tagName === 'INPUT' && active.type === 'text', start: active.selectionStart, end: active.selectionEnd,
    } : null;
    current = { name: top.name, actions: view.actions || {}, view };
    root.hidden = false;
    root.innerHTML = view.html;
    root.dataset.screen = top.name;
    if (view.mount) view.mount(root);
    let focus = null;
    if (keep) {
      if (keep.id) focus = root.querySelector(`#${CSS.escape(keep.id)}`);
      else if (keep.act) focus = [...root.querySelectorAll(`[data-act="${keep.act}"]`)].find((el) => (el.dataset.url ?? el.dataset.id ?? el.dataset.level ?? '') === keep.key) || null;
    }
    if (focus) {
      focus.focus({ preventScroll: true });
      if (keep.text && focus.setSelectionRange && keep.start != null) try { focus.setSelectionRange(keep.start, keep.end); } catch (e) { /* not a text box */ }
    } else {
      // Focus the main button so Enter works at once.
      const first = root.querySelector('.primary:not([disabled]), .on:not([disabled])') || root.querySelector('button:not([disabled])');
      if (first) first.focus({ preventScroll: true });
    }
    if (onChange) onChange(top.name);
  }

  return {
    define(name, fn) { defs.set(name, fn); },
    show(name, data) { stack.push({ name, data }); render(); },
    replace(name, data) { stack.pop(); stack.push({ name, data }); render(); },
    back() { if (stack.length) stack.pop(); render(); },
    hide() { stack.length = 0; render(); },
    refresh() { render(); },
    moveFocus, activate, escape,
    get name() { return current ? current.name : null; },
    get depth() { return stack.length; },
  };
}

// Escape text for HTML templates.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
