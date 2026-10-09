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

// Turns a string (a room code, a player name) into a seed.
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
