// Synthesized sound effects (Web Audio, no sound files), positioned around a listener. A game
// registers recipes by name; each recipe builds its sound from tones and filtered noise:
//
//   const sfx = createSynth({ rocket: (s, o) => { s.noise('lowpass', 1100, 180, 0.4, 0.5, o); s.tone('sine', 140, 48, 0.3, 0.4, o); } });
//   sfx.unlock();                       // on the first click or key: browsers start audio after a gesture
//   sfx.listen(camera);                 // each frame
//   sfx.play('rocket', { x, y, z });    // positioned; omit the position for UI sounds
//
// `o` carries the pan and distance gain computed from the listener, so recipes stay positional for free.

import * as THREE from 'three';

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), rel = new THREE.Vector3();

export function createSynth(recipes = {}, { volume = 0.5, hearing = 420 } = {}) {
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;
  const last = {};
  const loops = {};
  const listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0), fwd: new THREE.Vector3(0, 0, -1) };

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      master = ctx.createGain();
      master.gain.value = enabled ? volume : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  const ready = () => !!ctx && enabled && ctx.state === 'running';

  // Pan (-1..1) and gain (0..1) for a world position relative to the listener.
  function place(pos) {
    if (!pos) return { pan: 0, gain: 1 };
    rel.set(pos.x, pos.y, pos.z).sub(listener.pos);
    const d = rel.length();
    const pan = d > 1 ? Math.max(-1, Math.min(1, rel.dot(listener.right) / d)) * 0.75 : 0;
    const gain = 1 / (1 + d / hearing * d / hearing * 3);
    return { pan, gain };
  }
  function out(o) {
    const g = ctx.createGain();
    g.gain.value = 1;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p); p.connect(master);
    } else g.connect(master);
    return g;
  }
  const s = {
    get ctx() { return ctx; },
    tone(type, f0, f1, dur, gain, o, delay = 0) {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = out(o);
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * o.gain), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    noise(filter, f0, f1, dur, gain, o, q = 1, delay = 0) {
      const t = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bq = ctx.createBiquadFilter();
      bq.type = filter;
      bq.Q.value = q;
      bq.frequency.setValueAtTime(f0, t);
      bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = out(o);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * o.gain), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bq);
      bq.connect(g);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    },
    // True at most once per `gap` seconds for a name: keeps rapid fire from stacking.
    throttle(name, gap) {
      const now = ctx.currentTime;
      if (last[name] && now - last[name] < gap) return false;
      last[name] = now;
      return true;
    },
  };

  return {
    unlock, ready,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.02);
      if (!enabled) for (const k of Object.keys(loops)) this.setLoop(k, 0);
    },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master && enabled) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02); },
    get volume() { return volume; },
    // Update the listener from a camera (or any object with a world transform).
    listen(camera) {
      camera.getWorldPosition(listener.pos);
      camera.getWorldDirection(fwd);
      right.crossVectors(fwd, camera.up).normalize();
      listener.right.copy(right);
      listener.fwd.copy(fwd);
    },
    play(name, pos) {
      if (!ready()) return;
      const r = recipes[name];
      if (!r) return;
      r(s, place(pos));
    },
    // A continuous filtered-noise loop (thrusters) keyed by name; level 0 silences it.
    setLoop(key, level, pos, { freq = 900, q = 0.8, gain = 0.09 } = {}) {
      if (!ctx || !noiseBuf) return;
      let L = loops[key];
      if (!L && level > 0) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const bq = ctx.createBiquadFilter();
        bq.type = 'bandpass'; bq.frequency.value = freq; bq.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        src.connect(bq); bq.connect(g);
        if (pan) { g.connect(pan); pan.connect(master); } else g.connect(master);
        src.start();
        L = loops[key] = { src, g, pan };
      }
      if (!L) return;
      const o = place(pos);
      L.g.gain.setTargetAtTime(level * gain * o.gain, ctx.currentTime, 0.04);
      if (L.pan) L.pan.pan.setTargetAtTime(o.pan, ctx.currentTime, 0.05);
    },
  };
}
