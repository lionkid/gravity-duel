// Touch controls: a floating stick on the left half of the screen, camera drag on the right half and a
// row of action buttons. Buttons are named after intent actions, so the mapper reads them directly;
// `toggle` actions (aiming) switch on and off per tap instead of needing to be held.
//
//   <div id="touch"><div class="zone left"></div><div class="zone right"></div><div class="stick"><i></i></div>
//     <div class="tbtns"><button data-action="boost">…</button>…</div></div>

export function createTouch(root, { toggle = ['aim'], stickRadius = 56, onInteract = null } = {}) {
  const down = new Set(), latched = new Set();
  let pressed = new Set();
  const stick = { x: 0, y: 0 };            // -1..1, x right, y down (screen space)
  const look = { dx: 0, dy: 0 };
  let mode = 'auto', visible = false, seen = false, stickId = null, lookId = null;
  const stickBase = { x: 0, y: 0 }, lookLast = { x: 0, y: 0 };
  const supported = typeof window !== 'undefined' && (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!root) return inert();

  const stickEl = root.querySelector('.stick'), knob = stickEl && stickEl.querySelector('i');
  const left = root.querySelector('.zone.left'), right = root.querySelector('.zone.right');
  const touchy = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
  const interact = () => { seen = true; if (onInteract) onInteract(); };

  if (left) {
    left.addEventListener('pointerdown', (e) => {
      if (!touchy(e) || stickId != null) return;
      interact();
      stickId = e.pointerId; left.setPointerCapture(e.pointerId);
      stickBase.x = e.clientX; stickBase.y = e.clientY;
      if (stickEl) { stickEl.style.left = `${e.clientX}px`; stickEl.style.top = `${e.clientY}px`; stickEl.classList.add('on'); }
      e.preventDefault();
    });
    left.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - stickBase.x, dy = e.clientY - stickBase.y;
      const l = Math.hypot(dx, dy);
      if (l > stickRadius) { dx *= stickRadius / l; dy *= stickRadius / l; }
      stick.x = dx / stickRadius; stick.y = dy / stickRadius;
      if (knob) knob.style.transform = `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px)`;
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null; stick.x = stick.y = 0;
      if (knob) knob.style.transform = '';
      if (stickEl) stickEl.classList.remove('on');
    };
    left.addEventListener('pointerup', endStick); left.addEventListener('pointercancel', endStick);
  }
  if (right) {
    right.addEventListener('pointerdown', (e) => {
      if (!touchy(e) || lookId != null) return;
      interact();
      lookId = e.pointerId; right.setPointerCapture(e.pointerId);
      lookLast.x = e.clientX; lookLast.y = e.clientY;
      e.preventDefault();
    });
    right.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      look.dx += e.clientX - lookLast.x; look.dy += e.clientY - lookLast.y;
      lookLast.x = e.clientX; lookLast.y = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    right.addEventListener('pointerup', endLook); right.addEventListener('pointercancel', endLook);
  }
  for (const btn of root.querySelectorAll('[data-action]')) {
    const a = btn.dataset.action;
    const press = (e) => {
      if (!touchy(e)) return;
      interact();
      e.preventDefault();
      if (toggle.includes(a)) { if (latched.has(a)) latched.delete(a); else latched.add(a); btn.classList.toggle('on', latched.has(a)); return; }
      down.add(a); pressed.add(a); btn.classList.add('on');
    };
    const release = () => { down.delete(a); if (!toggle.includes(a)) btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release); btn.addEventListener('pointercancel', release); btn.addEventListener('pointerleave', release);
  }

  function apply() {
    const want = mode === 'on' || (mode === 'auto' && (coarse || seen));
    root.hidden = !(visible && want);
  }
  return {
    supported, stick, latched,
    get shown() { return !root.hidden; },
    isDown: (a) => down.has(a) || latched.has(a),
    consumePressed() { const p = pressed; pressed = new Set(); return p; },
    consumeLook() { const d = { dx: look.dx, dy: look.dy }; look.dx = look.dy = 0; return d; },
    // mode: 'auto' (coarse pointer or once a touch is seen) | 'on' | 'off'; visible: the game wants them now.
    setMode(m) { mode = m || 'auto'; apply(); },
    setVisible(on) { visible = !!on; if (!on) { latched.clear(); down.clear(); for (const b of root.querySelectorAll('.on')) b.classList.remove('on'); } apply(); },
    // Clears the aim toggle (a match ended, a menu opened).
    reset() { latched.clear(); down.clear(); stick.x = stick.y = 0; },
  };
}

function inert() {
  const none = new Set();
  return { supported: false, stick: { x: 0, y: 0 }, latched: none, shown: false, isDown: () => false, consumePressed: () => none, consumeLook: () => ({ dx: 0, dy: 0 }), setMode() {}, setVisible() {}, reset() {} };
}
