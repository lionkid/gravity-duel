// Sand twisters: dust columns that wander across a desert arena, drag mechs in and throw them into the
// sky. Deterministic: spawn spots and durations come from each twister's seed and cycle number, the
// wandering from the world clock, and the state is plain data in world.twisters (cloned and sent in
// snapshots like everything else), so no random generator is drawn while stepping.
//
//   twister: { id, seed, cycle, phase: 'rest' | 'grow' | 'live' | 'fade', t, dur, x, z, vx, vz, heading, strength }
//   fighter: wind {x, z} (pull, added to the movement's target velocity), caught (twister id or 0), caughtT,
//            twImmune (seconds clear of every twister after a throw or an escape), flung (thrown, until it lands)

import { emit } from '../../../engine/core/events.js';
import { angleDiff } from '../../../engine/core/math.js';
import { TWISTER as TW } from '../config.js';

// A hash in [0, 1) of two integers.
export function hash01(a, b) {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(((b >>> 0) + 0x632be5ab) >>> 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const span = ([lo, hi], u) => lo + (hi - lo) * u;

export function createTwisters(stage, seed) {
  const cfg = stage.hazards && stage.hazards.twisters;
  const n = cfg ? cfg.count | 0 : 0;
  const out = [];
  // Staggered: the first is up within a couple of seconds, the others follow.
  for (let i = 0; i < n; i++) {
    out.push({ id: i + 1, seed: (Math.imul(seed >>> 0, 2654435761) + (i + 1) * 40503) >>> 0, cycle: 0, phase: 'rest', t: 0, dur: 1.5 + i * 6,
      x: 0, z: 0, vx: 0, vz: 0, heading: 0, strength: 0 });
  }
  return out;
}

export function stepTwisters(world, dt) {
  const list = world.twisters;
  if (!list || !list.length) return;
  for (const tw of list) {
    tw.t += dt;
    if (tw.phase === 'rest') {
      tw.vx = tw.vz = 0;
      if (tw.t >= tw.dur) spawn(world, tw);
      continue;
    }
    if (tw.phase === 'grow') {
      tw.strength = Math.min(1, tw.t / TW.grow);
      if (tw.t >= tw.dur) { tw.phase = 'live'; tw.t = 0; tw.dur = span(TW.live, hash01(tw.seed, tw.cycle * 16 + 14)); }
    } else if (tw.phase === 'live') {
      tw.strength = 1;
      if (tw.t >= tw.dur) { tw.phase = 'fade'; tw.t = 0; tw.dur = TW.fade; }
    } else if (tw.phase === 'fade') {
      tw.strength = Math.max(0, 1 - tw.t / TW.fade);
      if (tw.t >= tw.dur) { tw.phase = 'rest'; tw.t = 0; tw.dur = span(TW.rest, hash01(tw.seed, tw.cycle * 16 + 15)); tw.strength = 0; emit(world, 'twisterGone', { tid: tw.id }); continue; }
    }
    wander(world, tw, dt);
  }
}

// A new column somewhere around the fight: of six candidate spots, the one whose nearest mech is
// closest to 180 m away (never right on top of anyone).
function spawn(world, tw) {
  const b = world.stage.bounds, lim = Math.min(b.maxX, b.maxZ) * 0.62;
  tw.cycle++;
  let best = null, bestScore = -Infinity;
  for (let k = 0; k < 6; k++) {
    const x = (hash01(tw.seed, tw.cycle * 16 + k * 2) * 2 - 1) * lim;
    const z = (hash01(tw.seed, tw.cycle * 16 + k * 2 + 1) * 2 - 1) * lim;
    let d = Infinity;
    for (const f of world.fighters) d = Math.min(d, Math.hypot(f.pos.x - x, f.pos.z - z));
    for (const o of world.twisters) if (o !== tw && o.phase !== 'rest') d = Math.min(d, Math.hypot(o.x - x, o.z - z));
    const score = d < 90 ? -1e6 + d : -Math.abs(d - 180);
    if (score > bestScore) { bestScore = score; best = [x, z]; }
  }
  tw.x = best[0]; tw.z = best[1];
  tw.heading = hash01(tw.seed, tw.cycle * 16 + 13) * Math.PI * 2;
  tw.phase = 'grow'; tw.t = 0; tw.dur = TW.grow; tw.strength = 0;
  emit(world, 'twister', { tid: tw.id, x: tw.x, z: tw.z });
}

// Slow meanders from a few sines, a weak pull toward the mechs so twisters cross the fight, and a
// turn back from the fence. The heading is an angle in the x–z plane (x = cos, z = sin).
function wander(world, tw, dt) {
  const b = world.stage.bounds, lim = Math.min(b.maxX, b.maxZ) * 0.7;
  const s = (tw.seed % 997) * 0.37;
  let turn = 0.32 * Math.sin(world.time * 0.23 + s) + 0.22 * Math.sin(world.time * 0.61 + s * 1.9);
  let mx = 0, mz = 0, n = 0;
  for (const f of world.fighters) if (!f.dead) { mx += f.pos.x; mz += f.pos.z; n++; }
  if (n) turn += angleDiff(tw.heading, Math.atan2(mz / n - tw.z, mx / n - tw.x)) * 0.12;
  if (Math.abs(tw.x) > lim || Math.abs(tw.z) > lim) turn += angleDiff(tw.heading, Math.atan2(-tw.z, -tw.x)) * 1.2;
  tw.heading += turn * dt;
  tw.vx = Math.cos(tw.heading) * TW.speed;
  tw.vz = Math.sin(tw.heading) * TW.speed;
  tw.x += tw.vx * dt;
  tw.z += tw.vz * dt;
}

// Per fighter, before it moves: the pull (as wind), being caught, and being thrown out.
export function twisterForces(world, f, dt) {
  if (!f.wind) f.wind = { x: 0, z: 0 };
  f.wind.x = 0; f.wind.z = 0;
  if (f.twImmune > 0) f.twImmune = Math.max(0, f.twImmune - dt);
  const list = world.twisters;
  if (!list || !list.length) return;
  if (f.caught) {
    const tw = list.find((t) => t.id === f.caught);
    f.caughtT += dt;
    if (f.dead || !tw || tw.strength < 0.35 || f.pos.y >= TW.ejectHeight || f.caughtT >= TW.maxCaught) fling(world, f, tw);
    return;
  }
  if (f.dead || f.twImmune > 0) return;
  for (const tw of list) {
    if (tw.strength <= 0) continue;
    const dx = f.pos.x - tw.x, dz = f.pos.z - tw.z, d = Math.hypot(dx, dz);
    if (d >= TW.reach) continue;
    if (d < TW.core && tw.strength > 0.6 && f.pos.y < TW.ejectHeight - 12) {
      f.caught = tw.id; f.caughtT = 0; f.onGround = false; f.melee = null; f.guard = false; f.flung = false;
      emit(world, 'caught', { id: f.id, tid: tw.id, x: f.pos.x, y: f.pos.y, z: f.pos.z });
      return;
    }
    // Inward and around, strongest at the edge of the core, nothing at the reach; plus the drift.
    const k = tw.strength * Math.min(1, (TW.reach - d) / (TW.reach - TW.core));
    const kk = k * k;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    f.wind.x += (-nx * TW.pull - nz * TW.swirl) * kk + tw.vx * k;
    f.wind.z += (-nz * TW.pull + nx * TW.swirl) * kk + tw.vz * k;
  }
}

// While caught: carried around the axis and up, with the twister's drift.
export function caughtVelocity(world, f) {
  const tw = world.twisters.find((t) => t.id === f.caught);
  if (!tw) return null;
  const dx = f.pos.x - tw.x, dz = f.pos.z - tw.z, d = Math.hypot(dx, dz);
  const nx = d > 1e-6 ? dx / d : Math.cos(tw.heading), nz = d > 1e-6 ? dz / d : Math.sin(tw.heading);
  const radial = (TW.core * 0.5 - d) * 3;           // held on a ring inside the core
  const sw = TW.coreSwirl * tw.strength;
  return { x: -nz * sw + nx * radial + tw.vx, z: nx * sw + nz * radial + tw.vz, y: TW.lift * tw.strength };
}

// Thrown out of the column: outward, along the spin, and up a little.
function fling(world, f, tw) {
  if (tw) {
    const dx = f.pos.x - tw.x, dz = f.pos.z - tw.z, d = Math.hypot(dx, dz);
    const nx = d > 1e-6 ? dx / d : Math.cos(tw.heading), nz = d > 1e-6 ? dz / d : Math.sin(tw.heading);
    f.vel.x = nx * TW.fling - nz * TW.coreSwirl * 0.5;
    f.vel.z = nz * TW.fling + nx * TW.coreSwirl * 0.5;
    f.vel.y = TW.flingUp;
    f.flung = true;                          // the throw carries: no air-speed bleed until it lands
  }
  f.caught = 0; f.caughtT = 0; f.twImmune = TW.immune;
  emit(world, 'fling', { id: f.id, x: f.pos.x, y: f.pos.y, z: f.pos.z });
}

// Breaking free with a dash.
export function escapeTwister(world, f) {
  if (!f.caught) return;
  f.caught = 0; f.caughtT = 0; f.twImmune = TW.immune;
  emit(world, 'escape', { id: f.id, x: f.pos.x, y: f.pos.y, z: f.pos.z });
}

// Shots passing through a column are dragged into it, swept around and lifted a little. (A swirl
// alone would cancel out on a straight pass: the push before and after the closest point is mirrored;
// the inward drag is what bends a shot off course.)
export function swirlShot(world, p, dt) {
  for (const tw of world.twisters) {
    if (tw.strength <= 0) continue;
    const dx = p.pos.x - tw.x, dz = p.pos.z - tw.z, d = Math.hypot(dx, dz), R = TW.core * 1.8;
    if (d >= R || p.pos.y > TW.height * 0.8 || d < 1e-6) continue;
    const k = tw.strength * (1 - d / R) * TW.shotSwirl * dt;
    const nx = dx / d, nz = dz / d;
    p.vel.x += (-nz * 0.6 - nx) * k; p.vel.z += (nx * 0.6 - nz) * k; p.vel.y += k * 0.25;
  }
}
