// Meteors over the orbital deck: rocks that drift slowly through the arena, and meteor strikes that
// fall at the mechs. Deterministic like the twisters: every choice comes from hash01 of a seed and a
// counter (a rock's path from its seed and cycle, a strike from the schedule's seed and count), all
// motion is straight lines and the world clock, and the state is plain data in world.meteors (cloned
// and sent in snapshots like everything else), so no random generator is drawn while stepping.
//
//   world.meteors: { seed, rocks: [rock], strikes: [strike], next (seconds to the next strike), count, nextId }
//   rock:   { id, seed, cycle, band: 'low' | 'mid' | 'high', r, x, y, z, vx, vy, vz, y0, phase, left }
//           a sphere of radius r drifting along a straight path; `left` is the distance still to go
//   strike: { id, target, salvo, ax, ay, az (where it will land), x, y, z, vx, vy, vz, t (seconds in flight), eta }
//   fighter: rockOn (the rock it stands on, or 0), rockTouch (the rock it pushed against last tick, or 0)
//
// Rocks are solid: they push mechs aside (and carry the ones standing on them), stop shots and block
// the line of sight. Paths keep METEOR.clear metres from walls (METEOR.clearY from roofs), so a mech can
// always get out of the way and is never crushed against a building. A strike's landing spot is marked
// for its whole flight; it bursts on the first thing it meets (deck, roof, wall, rock or mech) and hurts
// every mech within METEOR.blast metres that the burst can see.

import { emit } from '../../../engine/core/events.js';
import { hash01, span } from '../../../engine/core/rng.js';
import { clamp } from '../../../engine/core/math.js';
import { segmentBox, expand } from '../../../engine/sim/aabb.js';
import { bodyBox } from '../../../engine/sim/controller.js';
import { raycast } from '../../../engine/sim/sweep.js';
import { METEOR as M } from '../config.js';
import { applyDamage } from './combat.js';

const BANDS = ['low', 'mid', 'high'];
const TAU = Math.PI * 2;

export function createMeteors(stage, seed, statics) {
  const cfg = stage.hazards && stage.hazards.meteors;
  if (!cfg) return null;
  const m = { seed: (Math.imul(seed >>> 0, 2246822519) + 0x5bd1e995) >>> 0, rocks: [], strikes: [], next: M.first, count: 0, nextId: 0 };
  let id = 0;
  for (const band of BANDS) {
    for (let i = 0; i < M.rocks[band]; i++) {
      id++;
      const rock = { id, seed: (m.seed + Math.imul(id, 2654435761)) >>> 0, cycle: 0, band, r: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, y0: 0, phase: 0, left: 0 };
      launchRock(rock, stage, statics, true);
      m.rocks.push(rock);
    }
  }
  return m;
}

// Rocks drift and bob; strikes are scheduled, fly and burst. Runs before the fighters move.
export function stepMeteors(world, dt) {
  const m = world.meteors;
  if (!m) return;
  driftRocks(world, dt, world.time);
  // No new strikes once the match is decided or the time attack is over.
  const over = !!world.winner || !!(world.practice && world.practice.phase === 'over');
  m.next -= dt;
  if (m.next <= 0 && !over) {
    m.count++;
    m.next = span(M.every, hash01(m.seed, m.count * 64 + 1));
    launchStrikes(world, m);
  }
  for (let i = m.strikes.length - 1; i >= 0; i--) {
    const s = m.strikes[i];
    s.t += dt;
    s.eta -= dt;
    const p0 = { x: s.x, y: s.y, z: s.z };
    const p1 = { x: s.x + s.vx * dt, y: s.y + s.vy * dt, z: s.z + s.vz * dt };
    const hit = strikeHit(world, p0, p1);
    if (hit) {
      m.strikes.splice(i, 1);
      burst(world, s, hit);
    } else { s.x = p1.x; s.y = p1.y; s.z = p1.z; }
  }
}

// ---------------------------------------------------------------- drifting rocks
// Rocks move on along their paths (and start a new one once across). `time` drives the bobbing;
// the title screen drifts the rocks of a world that is not being played, with its own clock.
export function driftRocks(world, dt, time) {
  const m = world.meteors;
  if (!m) return;
  for (const rock of m.rocks) {
    rock.x += rock.vx * dt;
    rock.z += rock.vz * dt;
    const a = time * 0.4 + rock.phase;
    rock.y = rock.y0 + Math.sin(a) * M.bob;
    rock.vy = Math.cos(a) * M.bob * 0.4;
    rock.left -= Math.hypot(rock.vx, rock.vz) * dt;
    if (rock.left <= 0) { rock.cycle++; launchRock(rock, world.stage, world.statics, false); }
  }
}

// A new straight path for a rock: in over one side of the arena and out over another, clear of every
// wall and roof all along. The first launch puts the rock somewhere along its path (never on a spawn);
// later ones start just outside the fence.
function launchRock(rock, stage, statics, initial) {
  const cfg = stage.hazards.meteors;
  const b = stage.bounds, half = Math.min(b.maxX, b.maxZ);
  const h = (k) => hash01(rock.seed, rock.cycle * 256 + k);
  rock.r = span(M.radius[rock.band], h(0));
  const speed = span(M.speed, h(1));
  rock.phase = h(2) * TAU;
  const B = half + rock.r + 30;
  let path = null;
  for (let k = 0; k < 14 && !path; k++) {
    const cand = candidatePath(rock, k, cfg, half, B, (j) => h(16 + k * 8 + j));
    if (cand && pathClear(statics, b, cand, rock.r)) path = cand;
  }
  // Every lane is open deck the whole way across, so a lane path always fits a low or middle rock;
  // a high one goes up over everything instead.
  if (!path) path = rock.band === 'high' ? overEverything(rock, statics, B, h(4)) : lanePath(rock, cfg, B, (j) => h(8 + j), span(M.gap[rock.band], h(5)) + rock.r, 0);
  const dx = path.x1 - path.x0, dz = path.z1 - path.z0, len = Math.hypot(dx, dz);
  rock.vx = dx / len * speed; rock.vz = dz / len * speed;
  rock.y0 = path.y;
  let u = 0;
  if (initial) {
    // Spread over the arena from the start, but clear of where the mechs stand.
    for (let k = 0; k < 6; k++) {
      u = 0.08 + 0.84 * ((h(3) + k * 0.17) % 1);
      const x = path.x0 + dx * u, z = path.z0 + dz * u;
      const low = path.y - rock.r < 20;
      if (!low || stage.spawns.every((sp) => Math.hypot(sp.pos.x - x, sp.pos.z - z) > rock.r + 30)) break;
    }
  }
  rock.x = path.x0 + dx * u; rock.z = path.z0 + dz * u;
  rock.y = rock.y0 + Math.sin(rock.phase) * M.bob;
  rock.left = len * (1 - u);
}

// Candidate k for a rock's path (hk(0..7) are its own hash values), or null. Low rocks keep to the
// lanes between the lots; the others cross at height, along a lane or on a slant across the lots.
function candidatePath(rock, k, cfg, half, B, hk) {
  const y = span(M.gap[rock.band], hk(0)) + rock.r;
  if (rock.band === 'low' || k % 2 === 1) return lanePath(rock, cfg, B, (j) => hk(4 + j), y, rock.band === 'low' ? 2 : 6);
  const px = (hk(1) * 2 - 1) * half * 0.7, pz = (hk(2) * 2 - 1) * half * 0.7;
  const a = hk(3) * TAU;
  return clipToSquare(px, pz, Math.cos(a), Math.sin(a), B, y);
}
// Straight down a lane, a little off its middle, in either direction along either axis.
function lanePath(rock, cfg, B, hk, y, spread) {
  const lane = cfg.lanes[Math.min(cfg.lanes.length - 1, Math.floor(hk(0) * cfg.lanes.length))];
  const off = (hk(1) * 2 - 1) * spread;
  const dir = hk(2) < 0.5 ? 1 : -1;
  return hk(3) < 0.5 ? { x0: lane + off, z0: -B * dir, x1: lane + off, z1: B * dir, y } : { x0: -B * dir, z0: lane + off, x1: B * dir, z1: lane + off, y };
}
function overEverything(rock, statics, B, u) {
  let top = 0;
  for (const s of statics.boxes) top = Math.max(top, s.max[1]);
  const a = u * TAU;
  return clipToSquare(0, 0, Math.cos(a), Math.sin(a), B, top + M.clearY + M.bob + rock.r + 2);
}
// The line through (px, pz) along (dx, dz) between its two crossings of the square |x|, |z| <= B.
function clipToSquare(px, pz, dx, dz, B, y) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, d] of [[px, dx], [pz, dz]]) {
    if (Math.abs(d) < 1e-9) continue;
    const a = (-B - p) / d, c = (B - p) / d;
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  }
  if (!(t1 > t0)) return null;
  return { x0: px + dx * t0, z0: pz + dz * t0, x1: px + dx * t1, z1: pz + dz * t1, y };
}
// The path keeps its clearance from every static box, checked every few metres inside the arena.
function pathClear(statics, b, path, r) {
  const dx = path.x1 - path.x0, dz = path.z1 - path.z0, len = Math.hypot(dx, dz);
  const n = Math.ceil(len / 6);
  const mx = M.clear, my = M.clearY + M.bob;
  const q = { min: [0, 0, 0], max: [0, 0, 0] };
  for (let i = 0; i <= n; i++) {
    const x = path.x0 + dx * i / n, z = path.z0 + dz * i / n;
    if (x < b.minX - r - mx || x > b.maxX + r + mx || z < b.minZ - r - mx || z > b.maxZ + r + mx) continue;
    q.min[0] = x - r - mx; q.min[1] = path.y - r - my; q.min[2] = z - r - mx;
    q.max[0] = x + r + mx; q.max[1] = path.y + r + my; q.max[2] = z + r + mx;
    for (const s of statics.query(q)) {
      const cx = clamp(x, s.min[0] - mx, s.max[0] + mx), cy = clamp(path.y, s.min[1] - my, s.max[1] + my), cz = clamp(z, s.min[2] - mx, s.max[2] + mx);
      if (Math.hypot(cx - x, cy - path.y, cz - z) < r) return false;
    }
  }
  return true;
}

// Per fighter, after it has moved: rocks push it out of themselves, and one it stands on carries it.
export function rockContacts(world, f, dt) {
  const m = world.meteors;
  if (!m) return;
  const wasOn = f.rockOn || 0, wasTouch = f.rockTouch || 0;
  f.rockOn = 0; f.rockTouch = 0;
  for (const rock of m.rocks) contact(world, f, rock, dt, wasOn, wasTouch);
}

function contact(world, f, rock, dt, wasOn, wasTouch) {
  const r = rock.r, hw = f.size.w / 2, hd = f.size.d / 2;
  const minY = f.pos.y, maxY = f.pos.y + f.size.h;
  if (rock.x + r <= f.pos.x - hw || rock.x - r >= f.pos.x + hw || rock.z + r <= f.pos.z - hd || rock.z - r >= f.pos.z + hd) return;
  if (rock.y + r + 1 <= minY || rock.y - r >= maxY) return;
  // The nearest point of the footprint to the rock's axis.
  const qx = clamp(rock.x, f.pos.x - hw, f.pos.x + hw), qz = clamp(rock.z, f.pos.z - hd, f.pos.z + hd);
  const h2 = (qx - rock.x) ** 2 + (qz - rock.z) ** 2;
  // Standing on the cap: feet above the middle, over the top. A mech that stood here last tick
  // sticks to the surface as the rock bobs, unless it is jumping off.
  if (minY >= rock.y && h2 < (r * 0.8) ** 2) {
    const top = rock.y + Math.sqrt(r * r - h2);
    const stick = wasOn === rock.id && minY < top + 0.8 && f.vel.y <= rock.vy + 1;
    if (minY >= top && !stick) return;
    if (!f.onGround && f.vel.y < rock.vy) f.landedSpeed = Math.max(f.landedSpeed || 0, rock.vy - f.vel.y);
    f.pos.y = top;
    if (f.vel.y < rock.vy) f.vel.y = rock.vy;
    f.onGround = true;
    f.rockOn = rock.id;
    f.pos.x += rock.vx * dt; f.pos.z += rock.vz * dt;
    keepInside(world, f);
    return;
  }
  const qy = clamp(rock.y, minY, maxY);
  const dx = qx - rock.x, dy = qy - rock.y, dz = qz - rock.z, d = Math.hypot(dx, dy, dz);
  if (d >= r) return;
  let nx, ny, nz;
  if (d > 1e-6) { nx = dx / d; ny = dy / d; nz = dz / d; } else { const s = Math.hypot(rock.vx, rock.vz) || 1; nx = rock.vx / s; ny = 0; nz = rock.vz / s; }
  // On the deck a rock shoves sideways, never down into the floor.
  if (ny < 0 && f.onGround) {
    const l = Math.hypot(nx, nz);
    if (l > 0.2) { nx /= l; nz /= l; } else { const s = Math.hypot(rock.vx, rock.vz) || 1; nx = rock.vx / s; nz = rock.vz / s; }
    ny = 0;
  }
  const pen = r - d;
  f.pos.x += nx * pen; f.pos.y = Math.max(0, f.pos.y + ny * pen); f.pos.z += nz * pen;
  keepInside(world, f);
  // No moving into the rock; its own drift carries over.
  const rv = rock.vx * nx + rock.vy * ny + rock.vz * nz, fv = f.vel.x * nx + f.vel.y * ny + f.vel.z * nz;
  if (fv < rv) { f.vel.x += nx * (rv - fv); f.vel.y += ny * (rv - fv); f.vel.z += nz * (rv - fv); }
  f.rockTouch = rock.id;
  if (wasTouch !== rock.id && wasOn !== rock.id) emit(world, 'bump', { id: f.id, rid: rock.id, speed: rv - fv, x: rock.x + nx * r, y: rock.y + ny * r, z: rock.z + nz * r });
}
function keepInside(world, f) {
  const bd = world.stage.bounds, hw = f.size.w / 2, hd = f.size.d / 2;
  f.pos.x = clamp(f.pos.x, bd.minX + hw, bd.maxX - hw);
  f.pos.z = clamp(f.pos.z, bd.minZ + hd, bd.maxZ - hd);
}

// Where p0→p1 enters a rock sphere grown by `pad` (t from 0 to 1), or null.
function segmentSphere(p0, p1, c, r) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const fx = p0.x - c.x, fy = p0.y - c.y, fz = p0.z - c.z;
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  if (cc <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz, bb = fx * dx + fy * dy + fz * dz;
  if (a < 1e-12 || bb >= 0) return null;
  const disc = bb * bb - a * cc;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / a;
  return t <= 1 ? t : null;
}

// The first rock a segment runs into before tEnd: { t, rock } or null. Shots stop on rocks.
export function rockOnSegment(world, p0, p1, tEnd = 1, pad = 0) {
  const m = world.meteors;
  if (!m) return null;
  let best = null;
  for (const rock of m.rocks) {
    const t = segmentSphere(p0, p1, rock, rock.r + pad);
    if (t != null && t < tEnd && (!best || t < best.t)) best = { t, rock };
  }
  return best;
}

// Whether a rock stands between two points (lock-on and line of sight). Grazing lines still see.
export function rocksBlock(world, a, b) {
  const m = world.meteors;
  if (!m) return false;
  for (const rock of m.rocks) if (segmentSphere(a, b, rock, rock.r * 0.9) != null) return true;
  return false;
}

// ---------------------------------------------------------------- strikes
// Every few seconds a meteor dives at one of the mechs in turn (every METEOR.salvo-th time, three:
// one at the mech, two close around it). It aims at the floor under the mech's feet, scattered a
// little, and its landing spot is marked for the whole flight.
function launchStrikes(world, m) {
  const alive = world.fighters.filter((f) => !f.dead);
  if (!alive.length) return;
  // Taking turns, and the salvos take turns too.
  const f = alive[(m.count + Math.floor(m.count / M.salvo)) % alive.length];
  const salvo = m.count % M.salvo === 0;
  const b = world.stage.bounds;
  const n = salvo ? 3 : 1;
  for (let j = 0; j < n; j++) {
    const h = (k) => hash01(m.seed, m.count * 64 + 8 + j * 8 + k);
    const a = h(0) * TAU, d = j === 0 ? h(1) * M.spread : 26 + 14 * h(1);
    const ax = clamp(f.pos.x + Math.cos(a) * d, b.minX + 12, b.maxX - 12), az = clamp(f.pos.z + Math.sin(a) * d, b.minZ + 12, b.maxZ - 12);
    const floor = raycast(world.statics, { x: ax, y: b.ceiling, z: az }, { x: ax, y: -1, z: az });
    const ay = floor ? floor.y : world.statics.groundY;
    const T = span(M.flight, h(2)) + j * 0.35, el = span(M.elevation, h(3)), dir = h(4) * TAU;
    const vx = Math.cos(dir) * Math.cos(el) * M.strikeSpeed, vy = -Math.sin(el) * M.strikeSpeed, vz = Math.sin(dir) * Math.cos(el) * M.strikeSpeed;
    // Start where it reaches the spot after T seconds (the head's centre arrives one head radius up).
    const sx = ax - vx * T, sy = ay + M.head - vy * T, sz = az - vz * T;
    const s = { id: ++m.nextId, target: f.id, salvo, ax, ay, az, x: sx, y: sy, z: sz, vx, vy, vz, t: 0, eta: T };
    m.strikes.push(s);
    emit(world, 'meteorWarn', { mid: s.id, target: f.id, salvo, x: ax, y: ay, z: az, eta: T });
  }
}

// What a falling meteor meets between p0 and p1 first: the deck, a building, a rock or a mech.
function strikeHit(world, p0, p1) {
  let best = null;
  const wall = raycast(world.statics, p0, p1, M.head);
  if (wall) best = { t: wall.t, on: wall.box ? 'static' : 'ground' };
  const rk = rockOnSegment(world, p0, p1, best ? best.t : 1, M.head);
  if (rk) best = { t: rk.t, on: 'rock', rid: rk.rock.id };
  for (const f of world.fighters) {
    if (f.dead) continue;
    const hb = segmentBox(p0, p1, expand(bodyBox(f), M.head));
    if (hb && (!best || hb.t < best.t)) best = { t: hb.t, on: 'body', id: f.id };
  }
  if (!best) return null;
  best.x = p0.x + (p1.x - p0.x) * best.t; best.y = p0.y + (p1.y - p0.y) * best.t; best.z = p0.z + (p1.z - p0.z) * best.t;
  return best;
}

// The burst: damage falling off from the centre to the edge of the blast for every mech the burst can
// see (walls and rocks shelter), and a throw away from it.
function burst(world, s, hit) {
  emit(world, 'meteorHit', { mid: s.id, x: hit.x, y: hit.y, z: hit.z, on: hit.on, r: M.blast, dx: s.vx, dy: s.vy, dz: s.vz });
  for (const f of world.fighters) {
    if (f.dead || world.winner) continue;             // the match is decided: no more damage
    const box = bodyBox(f);
    const qx = clamp(hit.x, box.min[0], box.max[0]), qy = clamp(hit.y, box.min[1], box.max[1]), qz = clamp(hit.z, box.min[2], box.max[2]);
    const d = Math.hypot(qx - hit.x, qy - hit.y, qz - hit.z);
    if (d >= M.blast) continue;
    if (!(hit.on === 'body' && hit.id === f.id)) {
      const mid = { x: f.pos.x, y: f.pos.y + f.size.h / 2, z: f.pos.z };
      if (raycast(world.statics, hit, mid) || rocksBlock(world, hit, mid)) continue;
    }
    const k = d / M.blast;
    applyDamage(world, f, Math.round(span(M.dmg, k)), 'blast', null, { stun: M.stun, x: qx, y: qy, z: qz, from: hit, cause: 'meteor' });
    const dx = f.pos.x - hit.x, dz = f.pos.z - hit.z, l = Math.hypot(dx, dz);
    const nx = l > 1e-3 ? dx / l : 1, nz = l > 1e-3 ? dz / l : 0;
    const push = M.knock * (1 - 0.5 * k);
    f.vel.x += nx * push; f.vel.z += nz * push;
    f.vel.y = Math.max(f.vel.y, M.knockUp * (1 - 0.4 * k));
    f.onGround = false; f.flung = true;
  }
}
