// Shared helpers for Skyline tests: a world on the city stage and a tick runner that scripts both
// fighters' intents.
import { generateCity } from '../stages/city.js';
import { createWorld, stepWorld } from '../rules/world.js';
import { createIntent } from '../../../engine/input/intent.js';
import { STAGES } from '../config.js';

export const DT = 1 / 60;

export function makeWorld({ seed = 3, loadouts, p1, p2 } = {}) {
  const stage = generateCity(Object.assign({ seed }, STAGES.city));
  const w = createWorld({ stage, seed, loadouts });
  if (p1) Object.assign(w.fighters[0].pos, p1);
  if (p2) Object.assign(w.fighters[1].pos, p2);
  return w;
}

const reset = (it) => {
  for (const k in it.pressed) it.pressed[k] = false;
  for (const k in it.held) it.held[k] = false;
  it.move.x = 0; it.move.z = 0;
};

// Runs n ticks. fnA(it, i) / fnB(it, i) fill in each fighter's intent for tick i.
export function run(w, n, fnA, fnB) {
  const a = createIntent(), b = createIntent();
  for (let i = 0; i < n; i++) {
    reset(a); reset(b);
    if (fnA) fnA(a, i);
    if (fnB) fnB(b, i);
    stepWorld(w, [a, b], DT);
  }
  return w.fighters[0];
}

export const eventsOf = (w, type) => w.events.filter((e) => e.t === type);
export const clearEvents = (w) => { w.events = []; };
