// Skyline's sounds: recipes for the synth and the mapping from simulation events to them.

export const RECIPES = {
  vulcan: (s, o) => { if (!s.throttle('vulcan', 0.05)) return; s.noise('bandpass', 1800, 700, 0.07, 0.3, o, 1.5); s.tone('sawtooth', 320, 90, 0.08, 0.12, o); },
  rocket: (s, o) => { s.noise('lowpass', 1400, 220, 0.45, 0.6, o); s.tone('sine', 160, 55, 0.35, 0.4, o); s.noise('bandpass', 600, 2400, 0.25, 0.2, o, 2, 0.02); },
  longrifle: (s, o) => { s.tone('square', 1800, 240, 0.18, 0.18, o); s.tone('sine', 2600, 700, 0.12, 0.12, o); s.noise('highpass', 2500, 1800, 0.2, 0.25, o); },
  handcannon: (s, o) => { s.noise('lowpass', 1600, 300, 0.22, 0.45, o); s.tone('sine', 200, 70, 0.18, 0.3, o); },
  boomS: (s, o) => { if (!s.throttle('boomS', 0.04)) return; s.noise('lowpass', 1200, 200, 0.22, 0.35, o); s.tone('sine', 140, 50, 0.18, 0.2, o); },
  boomM: (s, o) => { s.noise('lowpass', 1500, 90, 0.8, 0.8, o); s.tone('sine', 95, 30, 0.65, 0.5, o); },
  slash: (s, o) => { s.noise('bandpass', 700, 2800, 0.18, 0.3, o, 3); s.tone('sawtooth', 190, 90, 0.2, 0.06, o); },
  lunge: (s, o) => { s.noise('bandpass', 400, 1800, 0.3, 0.3, o, 2); },
  hit: (s, o) => { s.noise('lowpass', 2600, 300, 0.14, 0.35, o); s.tone('square', 190, 70, 0.1, 0.12, o); },
  hitHeavy: (s, o) => { s.noise('lowpass', 2000, 100, 0.35, 0.6, o); s.tone('square', 130, 38, 0.26, 0.25, o); s.tone('sine', 60, 30, 0.3, 0.3, o); },
  guard: (s, o) => { s.tone('triangle', 1900, 1500, 0.12, 0.2, o); s.tone('sine', 2900, 2600, 0.16, 0.08, o); },
  broke: (s, o) => { s.noise('highpass', 1200, 3200, 0.3, 0.35, o); s.tone('square', 900, 200, 0.28, 0.14, o); },
  jump: (s, o) => { s.tone('sine', 220, 440, 0.1, 0.08, o); s.noise('bandpass', 500, 1200, 0.12, 0.08, o, 1.5); },
  land: (s, o) => { s.noise('lowpass', 500, 120, 0.16, 0.25, o); },
  landHard: (s, o) => { s.noise('lowpass', 700, 80, 0.35, 0.5, o); s.tone('sine', 80, 35, 0.3, 0.3, o); },
  dash: (s, o) => { s.noise('bandpass', 500, 2200, 0.22, 0.3, o, 2); },
  switch: (s, o) => { s.tone('square', 640, 600, 0.03, 0.08, o); s.tone('square', 960, 900, 0.04, 0.08, o, 0.07); },
  lock: (s, o) => { s.tone('sine', 1100, 1100, 0.05, 0.08, o); s.tone('sine', 1500, 1500, 0.07, 0.08, o, 0.06); },
  unlock: (s, o) => { s.tone('sine', 900, 500, 0.12, 0.07, o); },
  overheat: (s, o) => { for (let i = 0; i < 3; i++) s.tone('square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.08, 0.07, o, i * 0.11); },
  fence: (s, o) => { if (!s.throttle('fence', 0.3)) return; s.tone('sine', 300, 180, 0.15, 0.1, o); },
  ko: (s, o) => { s.tone('sawtooth', 420, 55, 1.3, 0.2, o); s.noise('lowpass', 900, 60, 1.4, 0.6, o); s.tone('sine', 70, 28, 1.0, 0.4, o); },
  menuMove: (s, o) => { s.tone('sine', 660, 660, 0.05, 0.07, o); },
  menuOk: (s, o) => { s.tone('sine', 880, 1320, 0.09, 0.09, o); },
  menuBack: (s, o) => { s.tone('sine', 520, 330, 0.09, 0.08, o); },
  start: (s, o) => { s.tone('square', 440, 440, 0.08, 0.07, o); s.tone('square', 660, 660, 0.08, 0.07, o, 0.1); s.tone('square', 880, 880, 0.18, 0.08, o, 0.2); },
};

// Plays the sound for a simulation event at the event's position. Lock-on cues are interface sounds,
// so only the local player's (localId) are heard.
export function soundForEvent(sfx, e, world, localId = 1) {
  const at = e.x != null ? { x: e.x, y: e.y == null ? 10 : e.y, z: e.z } : null;
  const fighterPos = (id) => { const f = world.fighters[id - 1]; return f ? { x: f.pos.x, y: f.pos.y + 10, z: f.pos.z } : null; };
  switch (e.t) {
    case 'shot': sfx.play(e.kind === 'vulcan' ? 'vulcan' : e.kind === 'rocket' ? 'rocket' : e.kind === 'longrifle' ? 'longrifle' : 'handcannon', at); break;
    case 'impact': sfx.play(e.look === 'rocketM' ? 'boomM' : 'boomS', at); break;
    case 'slash': sfx.play('slash', at); break;
    case 'melee': if (e.lunge) sfx.play('lunge', fighterPos(e.id)); break;
    case 'hit': sfx.play(e.broke ? 'broke' : e.guard ? 'guard' : e.amount >= 120 || e.final ? 'hitHeavy' : 'hit', at); break;
    case 'jump': sfx.play('jump', fighterPos(e.id)); break;
    case 'land': sfx.play(e.hard ? 'landHard' : 'land', at); break;
    case 'dash': sfx.play('dash', at); break;
    case 'switch': sfx.play('switch', fighterPos(e.id)); break;
    case 'lock': if (e.id === localId && !e.auto) sfx.play('lock', null); break;
    case 'unlock': if (e.id === localId) sfx.play('unlock', null); break;
    case 'overheat': sfx.play('overheat', fighterPos(e.id)); break;
    case 'fence': sfx.play('fence', fighterPos(e.id)); break;
    case 'ko': sfx.play('ko', fighterPos(e.id)); break;
    default: break;
  }
}

// Thruster loops follow each fighter's boost state.
export function updateThrusterLoops(sfx, world, active) {
  for (const f of world.fighters) {
    const on = active && !f.dead && (f.boosting || f.dashTimer > 0 || (f.melee && f.melee.stage === 'lunge'));
    sfx.setLoop(`thrust${f.id}`, on ? 1 : 0, { x: f.pos.x, y: f.pos.y + 10, z: f.pos.z });
  }
}
