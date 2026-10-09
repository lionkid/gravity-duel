// Automated matches between computer players. The balance tool and the balance test both use this to
// play the nine loadouts (weapon class × armour) against each other on a fixed stage.

import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld } from '../rules/world.js';
import { createAI, aiIntent } from './brain.js';
import { WEAPON_CLASSES, ARMORS, STAGES } from '../config.js';

export const LOADOUTS = [];
for (const weapon of Object.keys(WEAPON_CLASSES)) {
  for (const armor of Object.keys(ARMORS)) LOADOUTS.push({ weapon, armor, name: `${WEAPON_CLASSES[weapon].zh}/${ARMORS[armor].zh}` });
}

export const arenaStage = (seed = 3) => generateCity(Object.assign({ seed }, STAGES.city));

// One match. Returns { winner: 1 | 2 | 0, time, hp, timeout }; a time-out goes to the healthier side.
export function playMatch(stage, a, b, seed, { level = 'hard', maxSeconds = 90, dt = 1 / 60 } = {}) {
  const w = createWorld({ stage, seed, loadouts: { 1: a, 2: b } });
  const ai1 = createAI(level, seed * 3 + 1), ai2 = createAI(level, seed * 5 + 2);
  const ticks = Math.round(maxSeconds / dt);
  for (let i = 0; i < ticks && !w.winner; i++) stepWorld(w, [aiIntent(ai1, w, 1, dt), aiIntent(ai2, w, 2, dt)], dt);
  const [f1, f2] = w.fighters;
  const timeout = !w.winner;
  const winner = w.winner || (f1.hp === f2.hp ? 0 : f1.hp > f2.hp ? 1 : 2);
  return { winner, time: w.time, hp: [f1.hp, f2.hp], timeout };
}

// Every pair of loadouts, both sides, `seeds` times each. Returns the win matrix and per-loadout rates.
export function roundRobin({ stage = arenaStage(), seeds = 2, maxSeconds = 90, level = 'hard', loadouts = LOADOUTS } = {}) {
  const n = loadouts.length;
  const wins = loadouts.map(() => new Array(n).fill(0));
  const games = loadouts.map(() => new Array(n).fill(0));
  const stats = { played: 0, timeouts: 0, time: 0, hpLeft: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let s = 1; s <= seeds; s++) {
        for (const [x, y] of [[i, j], [j, i]]) {
          const r = playMatch(stage, loadouts[x], loadouts[y], s, { level, maxSeconds });
          games[x][y]++; games[y][x]++;
          if (r.winner === 1) wins[x][y]++; else if (r.winner === 2) wins[y][x]++; else { wins[x][y] += 0.5; wins[y][x] += 0.5; }
          stats.played++; stats.time += r.time;
          if (r.timeout) stats.timeouts++; else stats.hpLeft += Math.max(r.hp[0], r.hp[1]);
        }
      }
    }
  }
  const sum = (row) => row.reduce((a, b) => a + b, 0);
  const rates = loadouts.map((l, i) => ({ name: l.name, weapon: l.weapon, armor: l.armor, rate: sum(wins[i]) / sum(games[i]) }));
  return { loadouts, wins, games, rates, stats };
}
