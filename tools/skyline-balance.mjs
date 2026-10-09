// Round robin of the nine loadouts (weapon class × armour), computer against computer, both sides
// swapped, several seeds. Prints the win matrix and each loadout's overall win rate; used to tune
// games/skyline/config.js. Usage: node tools/skyline-balance.mjs [seeds=2] [maxSeconds=90] [level=hard]
import { roundRobin } from '../games/skyline/ai/arena.js';

const seeds = Number(process.argv[2]) || 2;
const maxSeconds = Number(process.argv[3]) || 90;
const level = process.argv[4] || 'hard';
const t0 = Date.now();
const { loadouts, wins, games, rates, stats } = roundRobin({ seeds, maxSeconds, level });
const pad = (s, n) => String(s).padEnd(n);
console.log(`${stats.played} matches in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${stats.timeouts} timed out at ${maxSeconds} s; ` +
  `average match ${(stats.time / stats.played).toFixed(0)} s; winner keeps ${(stats.hpLeft / Math.max(1, stats.played - stats.timeouts)).toFixed(0)} hp\n`);
console.log(pad('', 14) + loadouts.map((l, i) => pad(i + 1, 6)).join(''));
loadouts.forEach((l, i) => {
  console.log(pad(`${i + 1} ${l.name}`, 14) + loadouts.map((m, j) => (i === j ? pad('-', 6) : pad(Math.round(wins[i][j] / games[i][j] * 100) + '%', 6))).join(''));
});
console.log('\noverall win rate:');
for (const r of [...rates].sort((a, b) => b.rate - a.rate)) console.log(`  ${pad(r.name, 14)} ${(r.rate * 100).toFixed(0)}%`);
