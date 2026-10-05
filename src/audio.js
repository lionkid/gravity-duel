/* Gravity Duel - synthesized sound effects (Web Audio, no sound files).
 * Sounds come from the same world events the renderer uses, so LAN guests hear them too.
 * Browsers only start audio after a user gesture; unlock() is called on the first key or click. */
(function (GD) {
  'use strict';

  const W = GD.ARENA.w;

  class Sound {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.5;
      this.last = {};       // per-sound timestamp, to keep rapid fire from stacking
      this.loops = {};      // jet hiss per player
      this.noiseBuf = null;
    }

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try { this.ctx = new AC(); } catch (e) { return; }
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        // Gentle limiter so explosions on top of gunfire do not clip.
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12; comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.02);
      if (!on) for (const p of Object.keys(this.loops)) this.setLoop(p, 0);
    }

    ready() {
      return this.ctx && this.enabled && this.ctx.state === 'running';
    }

    // ---- building blocks ----
    out(pan) {
      const g = this.ctx.createGain();
      if (pan != null && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(p);
        p.connect(this.master);
      } else {
        g.connect(this.master);
      }
      return g;
    }

    tone(type, f0, f1, dur, gain, pan, delay = 0) {
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.out(pan);
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    noise(filter, f0, f1, dur, gain, pan, q = 1, delay = 0) {
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const bq = this.ctx.createBiquadFilter();
      bq.type = filter;
      bq.Q.value = q;
      bq.frequency.setValueAtTime(f0, t);
      bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = this.out(pan);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bq);
      bq.connect(g);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    }

    throttle(name, gap) {
      const now = this.ctx.currentTime;
      if (this.last[name] && now - this.last[name] < gap) return false;
      this.last[name] = now;
      return true;
    }

    // ---- named sounds ----
    play(name, x) {
      if (!this.ready()) return;
      const pan = x == null ? null : (x / W * 2 - 1) * 0.7;
      switch (name) {
        case 'beam':
          this.tone('square', 1500, 260, 0.14, 0.12, pan);
          this.tone('sine', 2400, 900, 0.09, 0.08, pan);
          break;
        case 'bazooka':
          this.noise('lowpass', 1100, 180, 0.38, 0.5, pan);
          this.tone('sine', 140, 48, 0.32, 0.4, pan);
          break;
        case 'mg':
          if (!this.throttle('mg', 0.045)) return;
          this.noise('bandpass', 2200, 900, 0.05, 0.3, pan, 2);
          this.tone('square', 240, 110, 0.035, 0.06, pan);
          break;
        case 'grenade':
          this.tone('sine', 320, 120, 0.14, 0.3, pan);
          this.noise('lowpass', 700, 200, 0.08, 0.15, pan);
          break;
        case 'vulcan':
          if (!this.throttle('vulcan', 0.035)) return;
          this.noise('highpass', 3200, 2400, 0.03, 0.14, pan);
          break;
        case 'melee':
          this.noise('bandpass', 700, 2600, 0.16, 0.25, pan, 3);
          this.tone('sawtooth', 180, 90, 0.18, 0.05, pan);
          break;
        case 'hit':
          this.noise('lowpass', 2400, 300, 0.14, 0.35, pan);
          this.tone('square', 180, 70, 0.09, 0.12, pan);
          break;
        case 'hitHeavy':
          this.noise('lowpass', 2000, 120, 0.3, 0.5, pan);
          this.tone('square', 130, 40, 0.22, 0.2, pan);
          break;
        case 'block':
          this.tone('triangle', 1900, 1500, 0.12, 0.18, pan);
          this.tone('sine', 2900, 2600, 0.16, 0.08, pan);
          break;
        case 'explode':
          this.noise('lowpass', 1400, 90, 0.75, 0.7, pan);
          this.tone('sine', 90, 32, 0.6, 0.45, pan);
          break;
        case 'ricochet':
          if (!this.throttle('ricochet', 0.05)) return;
          this.tone('triangle', 2600, 1700, 0.06, 0.05, pan);
          break;
        case 'jump':
          this.tone('sine', 220, 440, 0.1, 0.08, pan);
          this.noise('bandpass', 500, 1200, 0.12, 0.08, pan, 1.5);
          break;
        case 'land':
          this.noise('lowpass', 500, 120, 0.14, 0.22, pan);
          break;
        case 'dash':
          this.noise('bandpass', 500, 2200, 0.2, 0.3, pan, 2);
          break;
        case 'switch':
          this.tone('square', 640, 600, 0.03, 0.08, pan);
          this.tone('square', 960, 900, 0.04, 0.08, pan, 0.07);
          break;
        case 'deny':
          this.tone('square', 220, 200, 0.07, 0.06, pan);
          break;
        case 'overheat':
          for (let i = 0; i < 3; i++) this.tone('square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.08, 0.07, pan, i * 0.11);
          break;
        case 'ko':
          this.tone('sawtooth', 420, 55, 1.3, 0.18, pan);
          this.noise('lowpass', 900, 60, 1.2, 0.45, pan);
          break;
        case 'menuMove':
          this.tone('sine', 660, 660, 0.05, 0.07);
          break;
        case 'menuOk':
          this.tone('sine', 880, 1320, 0.09, 0.09);
          break;
        case 'menuBack':
          this.tone('sine', 520, 330, 0.09, 0.08);
          break;
        case 'start':
          this.tone('square', 440, 440, 0.08, 0.07);
          this.tone('square', 660, 660, 0.08, 0.07, null, 0.1);
          this.tone('square', 880, 880, 0.18, 0.08, null, 0.2);
          break;
      }
    }

    // World events: fire, hit, explode, land, jump, dash, switch, overheat, ko, ricochet.
    consume(events) {
      if (!this.ready()) return;
      for (const e of events) {
        switch (e.type) {
          case 'fire': this.play(e.weapon, e.x); break;
          case 'melee': this.play('melee', e.x); break;
          case 'hit': this.play(e.blocked ? 'block' : e.dmg >= 100 ? 'hitHeavy' : 'hit', e.x); break;
          case 'explode': this.play('explode', e.x); break;
          case 'ricochet': this.play('ricochet', e.x); break;
          case 'jump': this.play('jump', e.x); break;
          case 'land': if (e.impact > 300) this.play('land', e.x); break;
          case 'dash': this.play('dash', e.x); break;
          case 'switch': this.play('switch', e.x); break;
          case 'deny': this.play('deny', e.x); break;
          case 'overheat': this.play('overheat', e.x); break;
          case 'ko': this.play('ko', e.x); break;
        }
      }
    }

    // Continuous jet hiss while a frame is thrusting; silenced when paused.
    updateLoops(world, active) {
      if (!this.ctx) return;
      for (const f of world.fighters) this.setLoop(f.player, active && this.enabled && f.thrusting && !f.ko ? 1 : 0, f.x);
    }

    setLoop(player, level, x) {
      if (!this.ctx || !this.noiseBuf) return;
      let L = this.loops[player];
      if (!L && level > 0) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.loop = true;
        const bq = this.ctx.createBiquadFilter();
        bq.type = 'bandpass'; bq.frequency.value = 900; bq.Q.value = 0.8;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
        src.connect(bq); bq.connect(g);
        if (pan) { g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
        src.start();
        L = this.loops[player] = { src, g, pan };
      }
      if (!L) return;
      L.g.gain.setTargetAtTime(level * 0.09, this.ctx.currentTime, 0.04);
      if (L.pan && x != null) L.pan.pan.setTargetAtTime((x / W * 2 - 1) * 0.7, this.ctx.currentTime, 0.05);
    }
  }

  GD.Sound = Sound;
})(globalThis.GD = globalThis.GD || {});
