// Skyline's sounds: recipes for the synth and the mapping from simulation events to them.

export const RECIPES = {
  vulcan: (s, o) => { if (!s.throttle('vulcan', 0.05)) return; s.noise('bandpass', 1800, 700, 0.07, 0.3, o, 1.5); s.tone('sawtooth', 320, 90, 0.08, 0.12, o); },
  rocket: (s, o) => { s.noise('lowpass', 1400, 220, 0.45, 0.6, o); s.tone('sine', 160, 55, 0.35, 0.4, o); s.noise('bandpass', 600, 2400, 0.25, 0.2, o, 2, 0.02); },
  longrifle: (s, o) => { s.tone('square', 1800, 240, 0.18, 0.18, o); s.tone('sine', 2600, 700, 0.12, 0.12, o); s.noise('highpass', 2500, 1800, 0.2, 0.25, o); },
  handcannon: (s, o) => { s.noise('lowpass', 1600, 300, 0.22, 0.45, o); s.tone('sine', 200, 70, 0.18, 0.3, o); },
  boomS: (s, o) => { if (!s.throttle('boomS', 0.04)) return; s.noise('lowpass', 1200, 200, 0.22, 0.35, o); s.tone('sine', 140, 50, 0.18, 0.2, o); },
  boomM: (s, o) => { s.noise('lowpass', 1500, 90, 0.8, 0.8, o); s.tone('sine', 95, 30, 0.65, 0.5, o); },
  slash: (s, o) => { s.noise('bandpass', 700, 2800, 0.18, 0.3, o, 3); s.tone('sawtooth', 190, 90, 0.2, 0.06, o); },
  swingHeavy: (s, o) => { s.noise('bandpass', 260, 1500, 0.32, 0.5, o, 2.5); s.tone('sawtooth', 140, 45, 0.3, 0.12, o); s.tone('sine', 70, 40, 0.25, 0.2, o, 0.05); },
  // Practice targets: a wooden knock, a bell for the bullseye, a crack when a board breaks.
  tHit: (s, o) => { s.noise('lowpass', 1800, 400, 0.08, 0.3, o, 1); s.tone('triangle', 420, 300, 0.07, 0.12, o); },
  tBull: (s, o) => { s.tone('sine', 1320, 1320, 0.5, 0.16, o); s.tone('sine', 1980, 1980, 0.6, 0.1, o, 0.04); s.tone('sine', 2640, 2640, 0.4, 0.05, o, 0.08); },
  tBreak: (s, o) => { s.noise('bandpass', 2400, 700, 0.22, 0.45, o, 1.4); s.tone('square', 330, 120, 0.14, 0.08, o); s.noise('highpass', 3000, 1500, 0.3, 0.12, o, 1, 0.05); },
  tUp: (s, o) => { s.tone('sine', 520, 880, 0.12, 0.05, o); },
  count: (s, o) => { s.tone('square', 880, 880, 0.09, 0.07, o); },
  countGo: (s, o) => { s.tone('square', 1320, 1320, 0.28, 0.09, o); s.tone('square', 660, 660, 0.28, 0.05, o); },
  buzzer: (s, o) => { s.tone('sawtooth', 220, 200, 0.7, 0.12, o); s.tone('square', 330, 300, 0.7, 0.06, o); },
  // Twisters: a rising whoosh when caught, a falling one when thrown out.
  caught: (s, o) => { s.noise('bandpass', 300, 1800, 0.9, 0.5, o, 1.2); s.tone('sine', 90, 180, 0.8, 0.12, o); },
  fling: (s, o) => { s.noise('bandpass', 1600, 300, 0.7, 0.45, o, 1.2); },
  dry: (s, o) => { s.tone('square', 1500, 1000, 0.025, 0.07, o); s.noise('highpass', 3000, 2000, 0.03, 0.08, o); },
  // Meteors: a two-tone alarm when one is coming for you, a deep blast when it lands, a dull knock off a rock.
  meteorWarn: (s, o) => { for (let i = 0; i < 4; i++) s.tone('square', i % 2 ? 620 : 930, i % 2 ? 600 : 900, 0.13, 0.075, o, i * 0.15); },
  meteorFar: (s, o) => { s.tone('sine', 1250, 900, 0.5, 0.06, o); },
  meteorBoom: (s, o) => { s.noise('lowpass', 1500, 50, 1.7, 1.0, o); s.tone('sine', 85, 24, 1.3, 0.75, o); s.noise('bandpass', 2600, 300, 0.45, 0.55, o, 1.4); s.noise('lowpass', 500, 60, 2.4, 0.4, o, 1, 0.12); },
  rockBump: (s, o) => { if (!s.throttle('rockBump', 0.25)) return; s.noise('lowpass', 420, 90, 0.3, 0.45, o); s.tone('sine', 70, 40, 0.25, 0.22, o); },
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
    case 'slash': sfx.play(e.style === 'overhead' || e.style === 'spin' ? 'swingHeavy' : 'slash', at); break;
    case 'dry': if (e.id === localId) sfx.play('dry', null); break;
    case 'target': sfx.play(e.broke ? (e.bull ? 'tBull' : 'tBreak') : 'tHit', at); if (e.broke && e.bull) sfx.play('tBreak', at); break;
    case 'targetUp': sfx.play('tUp', at); break;
    case 'count': sfx.play(e.n > 0 ? 'count' : 'countGo', null); break;
    case 'practiceEnd': sfx.play('buzzer', null); break;
    case 'caught': sfx.play('caught', at); break;
    case 'meteorWarn': if (e.target === localId) sfx.play('meteorWarn', null); else sfx.play('meteorFar', at); break;
    case 'meteorHit': sfx.play('meteorBoom', at); break;
    case 'bump': sfx.play('rockBump', at); break;
    case 'fling': case 'escape': sfx.play('fling', at); break;
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

// Each twister roars where it stands, louder as it grows; quiet when the match is not running.
export function updateTwisterLoops(sfx, world, active) {
  for (const tw of world.twisters || []) {
    sfx.setLoop(`twister${tw.id}`, active ? tw.strength : 0, { x: tw.x, y: 20, z: tw.z }, { freq: 260, q: 0.5, gain: 0.5 });
  }
}

// A falling meteor roars as it comes down, louder as it closes in (one loop per slot in the list).
export function updateMeteorLoops(sfx, world, active, slots = 8) {
  const list = (world.meteors && world.meteors.strikes) || [];
  for (let i = 0; i < slots; i++) {
    const s = list[i];
    sfx.setLoop(`meteor${i}`, active && s ? Math.min(1, 0.35 + s.t * 0.5) : 0, s ? { x: s.x, y: s.y, z: s.z } : null, { freq: 380, q: 0.6, gain: 0.7 });
  }
}

// Thruster loops follow each fighter's boost state.
export function updateThrusterLoops(sfx, world, active) {
  for (const f of world.fighters) {
    const on = active && !f.dead && (f.boosting || f.dashTimer > 0 || (f.melee && f.melee.stage === 'lunge'));
    sfx.setLoop(`thrust${f.id}`, on ? 1 : 0, { x: f.pos.x, y: f.pos.y + 10, z: f.pos.z });
  }
}
