// Mouse look through the Pointer Lock API, plus buttons and wheel. Movement deltas accumulate between
// samples. Buttons are reported as 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right) so a binding
// table can mix them with keyboard codes; the wheel as 'WheelUp' / 'WheelDown'.
//
// Without the lock the mouse still steers. Pointer lock is refused in some embedded frames, needs a
// click to start, and is lost with Esc or alt-tab; while the game is in play (setActive(true)) and the
// pointer is not captured, plain cursor movement counts as look movement, and since a free cursor
// stops at the edge of the frame, holding it near an edge keeps turning that way: `state.edge` is
// -1..1 per axis, how far into the edge band the cursor is. `state.refused` tells the game that the
// page does not allow capturing the pointer.

export function createMouse(canvas, { edgeBand = 0.08 } = {}) {
  const down = new Set();
  let pressed = new Set();
  let dx = 0, dy = 0, wheel = 0;
  const state = {
    locked: false, refused: false, active: false, free: false, edge: { x: 0, y: 0 },
    supported: typeof document !== 'undefined' && 'requestPointerLock' in document.body, lastLockError: '',
  };
  const listeners = { lock: [] };
  let rawPending = false, refusals = 0, attempt = 0, failedAttempt = 0, skipMove = true;

  const code = (b) => `Mouse${b}`;
  const clearEdge = () => { state.edge.x = 0; state.edge.y = 0; };
  const setFree = () => { state.free = state.active && !state.locked; if (!state.free) clearEdge(); };
  // How far into the band along one edge a position (0..1 across the canvas) is: -1 at the low edge, 1 at the high one.
  const band = (u, w) => (u < w ? -Math.min(1, (w - u) / w) : u > 1 - w ? Math.min(1, (u - (1 - w)) / w) : 0);

  const onMove = (e) => {
    if (state.locked) { dx += e.movementX; dy += e.movementY; return; }
    if (!state.active) return;
    // A free cursor: its movement turns the view. The first move after the cursor comes back into the
    // page can carry a jump from wherever it was, so it is skipped.
    if (skipMove) skipMove = false;
    else if (Math.abs(e.movementX) < 250 && Math.abs(e.movementY) < 250) { dx += e.movementX; dy += e.movementY; }
    const r = canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      state.edge.x = band((e.clientX - r.left) / r.width, edgeBand);
      state.edge.y = band((e.clientY - r.top) / r.height, edgeBand * 1.25);
    }
  };
  const onDown = (e) => {
    down.add(code(e.button)); pressed.add(code(e.button));
    if (e.button === 2 || e.button === 1) e.preventDefault();
  };
  const onUp = (e) => { down.delete(code(e.button)); };
  const onWheel = (e) => { wheel += Math.sign(e.deltaY); e.preventDefault(); };
  const onLeave = () => { clearEdge(); skipMove = true; };
  const onLockChange = () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) { state.refused = false; refusals = 0; } else down.clear();
    skipMove = true;
    setFree();
    for (const fn of listeners.lock) fn(state.locked);
  };
  // A failed request. The first try asks for raw movement, which some platforms reject although a
  // plain lock works, so that failure only triggers the plain retry; an attempt counts as refused once,
  // whichever of its two errors arrives. Two refused attempts mean the page does not allow it: stop
  // asking (each try logs an error in an embedded frame).
  const onLockError = (e) => {
    state.lastLockError = e && e.type;
    if (rawPending || failedAttempt === attempt) return;
    failedAttempt = attempt;
    state.refused = true;
    if (++refusals >= 2) state.supported = false;
  };

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.documentElement.addEventListener('mouseleave', onLeave);
  window.addEventListener('blur', onLeave);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);

  const plainLock = () => {
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { onLockError(e); }
  };

  return {
    state,
    isDown: (c) => down.has(c),
    // Everything since the last sample: look deltas in pixels, wheel notches, button codes that went down.
    consume() {
      const out = { dx, dy, wheel, pressed };
      dx = 0; dy = 0; wheel = 0; pressed = new Set();
      return out;
    },
    // The same in two halves, for a game that turns the view every frame but reads buttons every tick.
    consumeLook() { const out = { dx, dy }; dx = 0; dy = 0; return out; },
    consumeButtons() { const out = { wheel, pressed }; wheel = 0; pressed = new Set(); return out; },
    // In play: steer with the free cursor whenever the pointer is not captured.
    setActive(on) {
      state.active = !!on;
      if (!on) { dx = 0; dy = 0; }
      skipMove = true;
      setFree();
    },
    // Call from a click or key handler: browsers only grant the lock in answer to the player's input.
    requestLock() {
      if (!state.supported || state.locked) return;
      attempt++;
      try {
        // unadjustedMovement turns off OS acceleration where the browser allows it; fall back when it doesn't.
        rawPending = true;
        const p = canvas.requestPointerLock({ unadjustedMovement: true });
        if (p && p.then) p.then(() => { rawPending = false; }, () => { rawPending = false; if (!state.locked) plainLock(); });
        else rawPending = false;              // an older browser: no promise, and the options are ignored
      } catch (e) {
        rawPending = false;
        plainLock();
      }
    },
    exitLock() { if (state.locked && document.exitPointerLock) document.exitPointerLock(); },
    // Called with true when the pointer is captured and false when it is released (not on refusals).
    onLockChange(fn) { listeners.lock.push(fn); },
  };
}
