/* Gravity Duel - keyboard input for two players on one keyboard. */
(function (GD) {
  'use strict';

  class Input {
    constructor(bindings, target) {
      this.bindings = bindings;
      this.down = new Set();          // physical keys currently held
      this.latch = {};                // per player: actions pressed since last sample
      this.codeMap = new Map();       // key code -> [{ player, action }]
      this.onGlobal = null;           // callback for system keys (pause, debug...)
      this.globalCodes = new Set(['Escape', 'Backquote', 'Enter', 'Digit1', 'Digit2']);

      for (const [p, map] of Object.entries(bindings)) {
        this.latch[p] = {};
        for (const [action, codes] of Object.entries(map)) {
          for (const code of codes) {
            if (!this.codeMap.has(code)) this.codeMap.set(code, []);
            this.codeMap.get(code).push({ player: Number(p), action });
          }
        }
      }

      target.addEventListener('keydown', (e) => this.handleDown(e));
      target.addEventListener('keyup', (e) => this.handleUp(e));
      // Losing focus would leave keys "stuck" because keyup never arrives.
      target.addEventListener('blur', () => this.clear());
    }

    handleDown(e) {
      if (this.codeMap.has(e.code)) {
        e.preventDefault(); // stop arrows/space from scrolling the page
        if (!this.down.has(e.code)) {
          this.down.add(e.code);
          for (const m of this.codeMap.get(e.code)) this.latch[m.player][m.action] = true;
        }
        return;
      }
      if (this.globalCodes.has(e.code)) {
        e.preventDefault();
        if (!e.repeat && this.onGlobal) this.onGlobal(e.code);
      }
    }

    handleUp(e) {
      if (this.codeMap.has(e.code)) {
        e.preventDefault();
        this.down.delete(e.code);
      }
    }

    clear() {
      this.down.clear();
      for (const p of Object.keys(this.latch)) this.latch[p] = {};
    }

    // Held state of every action plus edge-triggered presses.
    // Presses are latched so a tap shorter than one physics step is never lost.
    sample(player) {
      const map = this.bindings[player];
      const state = {};
      for (const action of Object.keys(map)) {
        state[action] = map[action].some((c) => this.down.has(c));
      }
      state.pressed = this.latch[player];
      this.latch[player] = {};
      return state;
    }

    // Used by the on-page input monitor; does not consume presses.
    peekHeld(player, action) {
      return this.bindings[player][action].some((c) => this.down.has(c));
    }
  }

  GD.Input = Input;
})(globalThis.GD = globalThis.GD || {});
