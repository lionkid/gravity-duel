// Gamepad input (standard mapping): polled once per tick, buttons by their usual names, sticks with a
// dead zone. Edges are latched for the simulation (`consumePressed`) and separately for menus
// (`consumeMenu`: d-pad or left-stick flicks, A, B, Start), so the two never steal each other's presses.

export const PAD_BUTTONS = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, Back: 8, Start: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15, Home: 16 };

export function createGamepad({ deadzone = 0.18 } = {}) {
  const down = new Set();
  let pressed = new Set(), menu = new Set();
  const axes = { lx: 0, ly: 0, rx: 0, ry: 0 };
  let connected = false, flick = { x: 0, y: 0 };
  const dz = (v) => (Math.abs(v) < deadzone ? 0 : Math.sign(v) * (Math.abs(v) - deadzone) / (1 - deadzone));

  return {
    axes,
    get connected() { return connected; },
    // Call once per tick before reading.
    poll() {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) if (p && p.connected && p.buttons.length >= 10) { pad = p; break; }
      connected = !!pad;
      if (!pad) { down.clear(); axes.lx = axes.ly = axes.rx = axes.ry = 0; return; }
      axes.lx = dz(pad.axes[0] || 0); axes.ly = dz(pad.axes[1] || 0);
      axes.rx = dz(pad.axes[2] || 0); axes.ry = dz(pad.axes[3] || 0);
      for (const name of Object.keys(PAD_BUTTONS)) {
        const b = pad.buttons[PAD_BUTTONS[name]];
        const on = !!b && (b.pressed || b.value > 0.5);
        if (on && !down.has(name)) { pressed.add(name); if (name === 'A' || name === 'B' || name === 'Start' || name === 'Back' || name === 'Up' || name === 'Down' || name === 'Left' || name === 'Right') menu.add(name); }
        if (on) down.add(name); else down.delete(name);
      }
      // A left-stick flick counts as a d-pad press for menus.
      const fx = axes.lx > 0.6 ? 1 : axes.lx < -0.6 ? -1 : 0, fy = axes.ly > 0.6 ? 1 : axes.ly < -0.6 ? -1 : 0;
      if (fy && fy !== flick.y) menu.add(fy > 0 ? 'Down' : 'Up');
      if (fx && fx !== flick.x) menu.add(fx > 0 ? 'Right' : 'Left');
      flick = { x: fx, y: fy };
    },
    isDown: (name) => down.has(name),
    axis: (name) => axes[name] || 0,
    consumePressed() { const p = pressed; pressed = new Set(); return p; },
    consumeMenu() { const m = menu; menu = new Set(); return m; },
    // Something is being touched on the pad right now.
    get active() { return connected && (down.size > 0 || Math.abs(axes.lx) + Math.abs(axes.ly) + Math.abs(axes.rx) + Math.abs(axes.ry) > 0.2); },
  };
}
