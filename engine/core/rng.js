// Seeded random numbers (mulberry32). Every world and every stage generator takes a seed, so a match
// or a city can be replayed exactly and tests are repeatable.

export function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.seed = seed;
  rnd.range = (lo, hi) => lo + (hi - lo) * rnd();
  rnd.int = (n) => Math.floor(rnd() * n);
  rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  rnd.chance = (p) => rnd() < p;
  // A new generator derived from this one, so sub-systems can draw numbers without disturbing each other.
  rnd.fork = () => makeRng(Math.floor(rnd() * 4294967296));
  // The internal state, so a world copy or a snapshot continues the same sequence.
  Object.defineProperty(rnd, 'state', { get: () => s, set: (v) => { s = v >>> 0; } });
  return rnd;
}

// A hash in [0, 1) of two integers: random-looking numbers without a generator's state, for hazards
// that must replay exactly from a seed and a counter (which cycle, which candidate).
export function hash01(a, b) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b >>> 0) + 0x632be5ab) >>> 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// A value in [lo, hi] for u in [0, 1].
export const span = ([lo, hi], u) => lo + (hi - lo) * u;

// Turns a string (a room code, a player name) into a seed.
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
