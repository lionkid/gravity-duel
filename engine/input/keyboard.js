// Keyboard state by KeyboardEvent.code, with press edges latched until the next sample so a tap
// between two simulation ticks is never lost. Keys typed into form fields are ignored.

const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export function createKeyboard(target = window) {
  const down = new Set();
  let pressed = new Set();

  // Keys typed into form fields or sent to a focused button (a menu) are not game input.
  const typing = (e) => {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable);
  };
  const onDown = (e) => {
    if (typing(e)) return;
    if (!down.has(e.code) && !e.repeat) pressed.add(e.code);
    down.add(e.code);
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
  };
  const onUp = (e) => { down.delete(e.code); };
  const onBlur = () => { down.clear(); };
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  return {
    isDown: (code) => down.has(code),
    anyDown: (codes) => codes.some((c) => down.has(c)),
    // Returns the codes pressed since the last call and starts a new batch.
    consumePressed() { const p = pressed; pressed = new Set(); return p; },
    release() { down.clear(); pressed.clear(); },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
