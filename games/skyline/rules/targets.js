// Practice targets ("鏢靶"): bullseye boards on stands, on rooftops, sliding along streets or hovering
// in the air. Pure simulation like the rest of rules/: placed from the stage and a seed, stepped with
// the world, hit by projectiles (a segment against the board's disc) and by blades. Boards turn on
// their stands to face the player, so they can be hit from anywhere.
//
//   target: { id, kind, pos {x,y,z} (centre of the face), prev, yaw (the face looks along yawToDir(yaw)),
//             radius, hp, hpMax, alive, respawn, home {x,y,z}, path: null | { ... } }
//   world.practice: { mode, player, phase: 'ready' | 'run' | 'over', ready, timeLeft,
//                     score, shots, hits, breaks, bulls, dummyDamage }

import { makeRng } from '../../../engine/core/rng.js';
import { approachAngle, dirToYaw, yawToDir } from '../../../engine/core/math.js';
import { emit } from '../../../engine/core/events.js';
import { PRACTICE } from '../config.js';

export function createPractice(mode = 'free') {
  const timed = mode === 'timed';
  return { mode: timed ? 'timed' : 'free', player: 1, phase: timed ? 'ready' : 'run', ready: timed ? PRACTICE.ready : 0, timeLeft: timed ? PRACTICE.timed : 0,
    score: 0, shots: 0, hits: 0, breaks: 0, bulls: 0, dummyDamage: 0 };
}

// Whether the player's hits count right now (not during the countdown, not after the time is up).
export const scoring = (world) => !!world.practice && world.practice.phase === 'run';

// ---------------------------------------------------------------- placement
export function placeTargets(stage, seed, counts = PRACTICE.counts) {
  const rnd = makeRng(((seed >>> 0) * 31 + 17) >>> 0);
  const statics = stage.statics, ramps = stage.ramps || [];
  const b = stage.bounds;
  const vis = stage.visual || {};
  const pitch = vis.pitch || 120, street = vis.street || 40;
  const half = Math.min(b.maxX, b.maxZ);
  const blocks = Math.round((b.maxX - b.minX) / pitch);
  const home = stage.spawns[0].pos;
  const lines = [];
  for (let k = 1; k < blocks; k++) lines.push(-half + k * pitch);
  const targets = [];
  const K = PRACTICE.kinds;
  const boxOf = (x, y, z, r, floor) => ({ min: [x - r, floor, z - r], max: [x + r, y + r, z + r] });
  const blocked = (box, pad = 2) => statics.some((s) => box.min[0] - pad < s.max[0] && box.max[0] + pad > s.min[0] && box.min[1] < s.max[1] && box.max[1] > s.min[1] && box.min[2] - pad < s.max[2] && box.max[2] + pad > s.min[2])
    || ramps.some((r) => box.min[0] - pad < r.max[0] && box.max[0] + pad > r.min[0] && box.min[2] - pad < r.max[2] && box.max[2] + pad > r.min[2]);
  const inside = (x, z, m = 20) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  const spaced = (x, y, z, d = 18) => targets.every((t) => Math.hypot(t.pos.x - x, t.pos.y - y, t.pos.z - z) > d)
    && stage.spawns.every((sp) => Math.hypot(sp.pos.x - x, sp.pos.z - z) > 26);
  const near = (x, z, lo, hi) => { const d = Math.hypot(x - home.x, z - home.z); return d >= lo && d <= hi; };
  const add = (kind, x, y, z, extra = {}) => {
    const k = K[kind];
    targets.push(Object.assign({ id: targets.length + 1, kind, pos: { x, y, z }, prev: { x, y, z }, home: { x, y, z }, yaw: dirToYaw(home.x - x, home.z - z),
      radius: k.radius, hp: k.hp, hpMax: k.hp, alive: true, respawn: 0, path: null }, extra));
  };
  // A point on a street: along one of the grid lines, at the kerb (offset from the centre line).
  const streetPoint = (edge) => {
    const c = rnd.pick(lines), along = rnd.range(-half + 30, half - 30);
    const off = edge ? (rnd.chance(0.5) ? 1 : -1) * (street / 2 - rnd.range(6, 9)) : rnd.range(-street / 4, street / 4);
    return rnd.chance(0.5) ? [c + off, along, 'z'] : [along, c + off, 'x'];
  };

  // Boards on stands at the kerbs, at chest height so the level vulcan reaches them.
  for (let n = 0, tries = 0; n < counts.stand && tries < 4000; tries++) {
    const [x, z] = streetPoint(true), r = K.stand.radius, y = K.stand.height;
    if (!inside(x, z) || !near(x, z, 50, 280) || !spaced(x, y, z) || blocked(boxOf(x, y, z, r, 0))) continue;
    add('stand', x, y, z); n++;
  }
  // Boards on low rooftops: jump up, or shoot from the first person.
  const roofs = statics.filter((s) => s.tag === 'building' && s.max[1] <= 70 && s.max[0] - s.min[0] >= 14 && s.max[2] - s.min[2] >= 14);
  for (let n = 0, tries = 0; n < counts.roof && tries < 2000 && roofs.length; tries++) {
    const s = rnd.pick(roofs), r = K.roof.radius;
    const x = (s.min[0] + s.max[0]) / 2, z = (s.min[2] + s.max[2]) / 2, y = s.max[1] + r + 2;
    if (!near(x, z, 70, 340) || !spaced(x, y, z, 30)) continue;
    if (blocked(boxOf(x, y, z, r, s.max[1] + 0.5))) continue;               // nothing taller on top
    add('roof', x, y, z, { floor: s.max[1] }); n++;
  }
  // Boards sliding back and forth along a stretch of street.
  for (let n = 0, tries = 0; n < counts.slider && tries < 3000; tries++) {
    const [x, z, axis] = streetPoint(false), r = K.slider.radius, y = K.slider.height;
    const len = rnd.range(40, 64);
    const ax = axis === 'z' ? x : x - len / 2, az = axis === 'z' ? z - len / 2 : z;
    const bx = axis === 'z' ? x : x + len / 2, bz = axis === 'z' ? z + len / 2 : z;
    if (!inside(ax, az) || !inside(bx, bz) || !near(x, z, 60, 300) || !spaced(x, y, z, 30)) continue;
    let clear = true;
    for (let i = 0; i <= 6 && clear; i++) { const u = i / 6; clear = !blocked(boxOf(ax + (bx - ax) * u, y, az + (bz - az) * u, r, 0)); }
    if (!clear) continue;
    add('slider', ax, y, az, { path: { kind: 'line', ax, az, bx, bz, y, phase: rnd.range(0, Math.PI * 2), omega: Math.PI / rnd.range(3.5, 5.5) } });
    n++;
  }
  // Drones circling high over the streets.
  for (let n = 0, tries = 0; n < counts.drone && tries < 3000; tries++) {
    const [x, z] = streetPoint(false), r = K.drone.radius, y = rnd.range(45, 90), R = rnd.range(14, 24);
    if (!inside(x, z, R + 20) || !near(x, z, 100, 320) || !spaced(x, y, z, 40)) continue;
    let clear = true;
    for (let i = 0; i < 8 && clear; i++) { const a = i / 8 * Math.PI * 2; clear = !blocked(boxOf(x + Math.cos(a) * R, y, z + Math.sin(a) * R, r * 1.6, y - r * 2), 3); }
    if (!clear) continue;
    add('drone', x + R, y, z, { path: { kind: 'circle', cx: x, cz: z, y, R, phase: rnd.range(0, Math.PI * 2), omega: rnd.range(0.25, 0.45) * (rnd.chance(0.5) ? 1 : -1), bob: rnd.range(2, 5) } });
    n++;
  }
  return targets;
}

// ---------------------------------------------------------------- hits
// Where a segment crosses a target's face, or null: { t (0..1 along the segment), x, y, z, r (from the centre) }.
export function segmentTarget(p0, p1, tg) {
  const n = yawToDir(tg.yaw);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const denom = dx * n.x + dz * n.z;
  if (Math.abs(denom) < 1e-9) return null;
  const s = -((p0.x - tg.pos.x) * n.x + (p0.z - tg.pos.z) * n.z) / denom;
  if (s < 0 || s > 1) return null;
  const x = p0.x + dx * s, y = p0.y + dy * s, z = p0.z + dz * s;
  const r = Math.hypot(x - tg.pos.x, y - tg.pos.y, z - tg.pos.z);
  return r <= tg.radius ? { t: s, x, y, z, r } : null;
}

// The earliest live target a segment hits before tEnd, or null.
export function firstTargetHit(world, p0, p1, tEnd = 1) {
  let best = null;
  for (const tg of world.targets || []) {
    if (!tg.alive) continue;
    const h = segmentTarget(p0, p1, tg);
    if (h && h.t < tEnd && (!best || h.t < best.hit.t)) best = { tg, hit: h };
  }
  return best;
}

export const ringOf = (r, radius) => Math.min(PRACTICE.rings.length - 1, Math.floor(r / radius * PRACTICE.rings.length));

// Damage a target. A board breaks when its durability runs out; the breaking hit scores: the ring it
// landed in (or a flat amount for a blade) times the kind's multiplier.
export function hitTarget(world, tg, amount, by, hit, { melee = false } = {}) {
  if (!tg.alive) return;
  const P = world.practice;
  const mine = !!P && !!by && by.id === P.player && scoring(world);
  const ring = melee ? -1 : ringOf(hit.r, tg.radius);
  tg.hp -= amount;
  const broke = tg.hp <= 0;
  let points = 0;
  if (broke) {
    tg.alive = false;
    tg.respawn = PRACTICE.respawn;
    points = Math.round((melee ? PRACTICE.meleePoints : PRACTICE.rings[ring]) * PRACTICE.kinds[tg.kind].mult);
  }
  if (mine) {
    if (!melee) P.hits++;
    if (broke) { P.score += points; P.breaks++; if (ring === 0) P.bulls++; }
  }
  emit(world, 'target', { tid: tg.id, by: by ? by.id : 0, kind: tg.kind, ring, points: mine ? points : 0, broke, bull: ring === 0, melee, x: hit.x, y: hit.y, z: hit.z, yaw: tg.yaw });
}

// Targets inside a melee swing's box.
export function meleeTargets(world, box) {
  const out = [];
  for (const tg of world.targets || []) {
    if (!tg.alive) continue;
    const r = tg.radius, p = tg.pos;
    if (box.min[0] < p.x + r && box.max[0] > p.x - r && box.min[1] < p.y + r && box.max[1] > p.y - r && box.min[2] < p.z + r && box.max[2] > p.z - r) out.push(tg);
  }
  return out;
}

// ---------------------------------------------------------------- stepping
export function stepPractice(world, dt) {
  const P = world.practice;
  if (!P) return;
  const player = world.fighters[P.player - 1];
  for (const tg of world.targets) {
    tg.prev.x = tg.pos.x; tg.prev.y = tg.pos.y; tg.prev.z = tg.pos.z;
    if (!tg.alive) {
      tg.respawn -= dt;
      if (tg.respawn <= 0) { tg.alive = true; tg.hp = tg.hpMax; emit(world, 'targetUp', { tid: tg.id, x: tg.pos.x, y: tg.pos.y, z: tg.pos.z }); }
    }
    const pa = tg.path;
    if (pa) {
      pa.phase += pa.omega * dt;
      if (pa.kind === 'line') {
        const u = 0.5 - 0.5 * Math.cos(pa.phase);
        tg.pos.x = pa.ax + (pa.bx - pa.ax) * u; tg.pos.z = pa.az + (pa.bz - pa.az) * u; tg.pos.y = pa.y;
      } else {
        tg.pos.x = pa.cx + Math.cos(pa.phase) * pa.R; tg.pos.z = pa.cz + Math.sin(pa.phase) * pa.R;
        tg.pos.y = pa.y + Math.sin(pa.phase * 2.3) * pa.bob;
      }
    }
    if (player) tg.yaw = approachAngle(tg.yaw, dirToYaw(player.pos.x - tg.pos.x, player.pos.z - tg.pos.z), PRACTICE.turnRate * dt);
  }
  // The knocked-out dummy (or anyone) stands up again at its spawn.
  for (const f of world.fighters) {
    if (!f.dead || !(f.revive > 0)) continue;
    f.revive -= dt;
    if (f.revive <= 0) {
      const sp = world.stage.spawns[(f.id - 1) % world.stage.spawns.length];
      Object.assign(f.pos, sp.pos); f.vel.x = f.vel.y = f.vel.z = 0; f.yaw = sp.yaw;
      f.dead = false; f.hp = f.hpMax; f.stun = 0; f.guardBreak = 0; f.melee = null; f.onGround = true; f.revive = 0;
      emit(world, 'revive', { id: f.id });
    }
  }
  // The time attack: a countdown, the clock, the end.
  if (P.phase === 'ready') {
    const before = Math.ceil(P.ready);
    P.ready = Math.max(0, P.ready - dt);
    if (Math.ceil(P.ready) !== before) emit(world, 'count', { n: Math.ceil(P.ready) });
    if (P.ready <= 0) P.phase = 'run';
  } else if (P.phase === 'run' && P.mode === 'timed') {
    const before = Math.ceil(P.timeLeft);
    P.timeLeft = Math.max(0, P.timeLeft - dt);
    if (Math.ceil(P.timeLeft) !== before && P.timeLeft <= 5 && P.timeLeft > 0) emit(world, 'count', { n: Math.ceil(P.timeLeft), clock: true });
    if (P.timeLeft <= 0) { P.phase = 'over'; emit(world, 'practiceEnd', { score: P.score }); }
  }
}
