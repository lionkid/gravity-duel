// Mouse look through the Pointer Lock API, plus buttons and wheel. Movement deltas accumulate between
// samples. Buttons are reported as 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right) so a binding
// table can mix them with keyboard codes; the wheel as 'WheelUp' / 'WheelDown'.
//
// Pointer lock is not available everywhere (some embedded frames refuse it); `supported` turns false
// after a refusal so the game can tell the player to use the keyboard for the camera.

export function createMouse(canvas) {
  const down = new Set();
  let pressed = new Set();
  let dx = 0, dy = 0, wheel = 0;
  const state = { locked: false, supported: typeof document !== 'undefined' && 'requestPointerLock' in document.body, lastLockError: '' };
  const listeners = { lock: [] };

  const code = (b) => `Mouse${b}`;
  const onMove = (e) => { if (state.locked) { dx += e.movementX; dy += e.movementY; } };
  const onDown = (e) => {
    down.add(code(e.button)); pressed.add(code(e.button));
    if (e.button === 2 || e.button === 1) e.preventDefault();
  };
  const onUp = (e) => { down.delete(code(e.button)); };
  const onWheel = (e) => { wheel += Math.sign(e.deltaY); e.preventDefault(); };
  const onLockChange = () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) down.clear();
    for (const fn of listeners.lock) fn(state.locked);
  };
  const onLockError = (e) => { state.supported = false; state.lastLockError = e && e.type; for (const fn of listeners.lock) fn(false); };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  return {
    state,
    isDown: (c) => down.has(c),
    // Everything since the last sample: look deltas in pixels, wheel notches, button codes that went down.
    consume() {
      const out = { dx, dy, wheel, pressed };
      dx = 0; dy = 0; wheel = 0; pressed = new Set();
      return out;
    },
    requestLock() {
      if (!state.supported || state.locked) return;
      try {
        // unadjustedMovement turns off OS acceleration where the browser allows it; fall back when it doesn't.
        const p = canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => { try { canvas.requestPointerLock(); } catch (e) { /* refused */ } });
      } catch (e) {
        try { canvas.requestPointerLock(); } catch (e2) { state.supported = false; }
      }
    },
    exitLock() { if (state.locked && document.exitPointerLock) document.exitPointerLock(); },
    onLockChange(fn) { listeners.lock.push(fn); },
  };
}
