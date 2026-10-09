import test from 'node:test';
import assert from 'node:assert/strict';
import { roundRobin, LOADOUTS } from '../ai/arena.js';

// Two seeds, both sides: 144 matches in a couple of seconds. Loose bounds catch a loadout that runs
// away with everything (or loses everything); tools/skyline-balance.mjs gives the fine-grained picture.
test('no loadout dominates the computer-versus-computer round robin', () => {
  const { rates, stats } = roundRobin({ seeds: 2, maxSeconds: 90 });
  assert.equal(rates.length, LOADOUTS.length);
  for (const r of rates) assert.ok(r.rate >= 0.28 && r.rate <= 0.72, `${r.name} wins ${(r.rate * 100).toFixed(0)}% of its matches`);
  assert.ok(stats.timeouts <= stats.played * 0.1, `${stats.timeouts} of ${stats.played} matches timed out`);
  assert.ok(stats.time / stats.played > 10, 'matches end suspiciously fast');
});
