// The computer opponent. It produces the same Intent a player does, once per tick, from what it can
// see: it only knows where the player is while it has line of sight, remembers the last position,
// paths through the streets (and up ramps) with the nav grid, and picks weapons by range and class.
// Deterministic for a given seed, so balance tests are repeatable.

import { createIntent, clearIntent } from '../../../engine/input/intent.js';
import { makeRng } from '../../../engine/core/rng.js';
import { distXZ, dirToAim, clamp } from '../../../engine/core/math.js';
import { enemyOf, rangedOf, meleeOf, armorOf } from '../rules/combat.js';
import { COMBAT, MOVE, SLOTS } from '../config.js';
import { buildNavGrid } from './nav.js';

export const AI_ORDER = ['easy', 'normal', 'hard'];
export const AI_LEVELS = {
  easy: { zh: '簡單', reaction: 0.7, decide: 0.5, aimErr: 0.07, dodge: 0.1, guard: 0, combo: 0.3, roofs: false, dash: 0.1, lead: 0, repath: 1.0 },
  normal: { zh: '普通', reaction: 0.3, decide: 0.3, aimErr: 0.03, dodge: 0.45, guard: 0.4, combo: 0.8, roofs: true, dash: 0.4, lead: 0.7, repath: 0.6 },
  hard: { zh: '困難', reaction: 0.12, decide: 0.15, aimErr: 0.012, dodge: 0.85, guard: 0.75, combo: 1, roofs: true, dash: 0.8, lead: 1, repath: 0.4 },
};

// Preferred fighting distance by weapon class.
const RANGE = { normal: [50, 130], ranged: [110, 230], melee: [0, 35] };

export function createAI(level = 'normal', seed = 1) {
  const k = AI_LEVELS[level] || AI_LEVELS.normal;
  return {
    level, k, rnd: makeRng(seed), intent: createIntent(),
    nav: null, navStage: null,
    known: null, seenFor: 0, lastLos: false, lostFor: 0,
    mode: 'approach', decideT: 0,
    path: [], pathT: 0, pathGoal: null,
    strafe: 1, strafeT: 0,
    aimErr: { yaw: 0, pitch: 0 }, aimErrT: 0,
    wantSlot: 'vulcan', range: RANGE.normal,
    dodgeT: 0, dodgeDir: { x: 0, z: 0 }, guardT: 0, dashT: 0,
    roofGoal: null, roofT: 0, comboPressed: -1,
  };
}

export function aiIntent(ai, world, playerId, dt) {
  const it = ai.intent;
  clearIntent(it);
  const me = world.fighters[playerId - 1];
  const e = enemyOf(world, me);
  if (!me || me.dead || !e || e.dead) return it;
  if (ai.navStage !== world.stage) { ai.nav = buildNavGrid(world.stage); ai.navStage = world.stage; ai.path = []; }
  const k = ai.k;

  // ---- perception: only what is in view, plus memory of where the target was
  const los = me.lockLos;
  if (los) {
    ai.known = { x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: e.vel.x, vy: e.vel.y, vz: e.vel.z };
    ai.seenFor = ai.lastLos ? ai.seenFor + dt : 0;
    ai.lostFor = 0;
  } else {
    ai.seenFor = 0;
    ai.lostFor += dt;
  }
  ai.lastLos = los;
  const target = ai.known;
  if (!target) return it;                                // nothing seen yet: hold position
  const reacted = los && ai.seenFor >= k.reaction;
  const dist = distXZ(me.pos, target);
  const dy = target.y - me.pos.y;

  // ---- timers
  ai.decideT -= dt; ai.strafeT -= dt; ai.aimErrT -= dt; ai.dodgeT -= dt; ai.guardT -= dt; ai.dashT -= dt; ai.roofT -= dt;
  if (ai.aimErrT <= 0) { ai.aimErrT = 0.25; ai.aimErr.yaw = (ai.rnd() - 0.5) * 2 * k.aimErr; ai.aimErr.pitch = (ai.rnd() - 0.5) * 2 * k.aimErr; }
  if (ai.strafeT <= 0) { ai.strafeT = 1.5 + ai.rnd() * 1.5; ai.strafe = ai.rnd() < 0.5 ? -1 : 1; }
  if (ai.decideT <= 0) { ai.decideT = k.decide; decide(ai, me, e, world, dist, dy, los); }

  // ---- movement
  const toT = { x: target.x - me.pos.x, z: target.z - me.pos.z };
  const dT = Math.hypot(toT.x, toT.z) || 1;
  const fwd = { x: toT.x / dT, z: toT.z / dT };
  const side = { x: -fwd.z * ai.strafe, z: fwd.x * ai.strafe };
  let mv = { x: 0, z: 0 };
  if (ai.dodgeT > 0) {
    mv = ai.dodgeDir;
  } else if (ai.mode === 'climb' && ai.roofGoal) {
    mv = { x: ai.roofGoal.x - me.pos.x, z: ai.roofGoal.z - me.pos.z };
    const l = Math.hypot(mv.x, mv.z) || 1;
    mv = l > 4 ? { x: mv.x / l, z: mv.z / l } : { x: 0, z: 0 };
    if (me.fuel > 0.3) { it.held.boost = true; if (me.onGround) it.pressed.boost = true; }
    if (me.pos.y >= ai.roofGoal.y - 0.5 || ai.roofT <= 0 || me.fuel <= 0.3 && me.onGround) { ai.mode = 'engage'; ai.roofGoal = null; }
  } else if (ai.mode === 'approach' || ai.mode === 'search') {
    const wp = waypoint(ai, me, target, world);
    const l = Math.hypot(wp.x - me.pos.x, wp.z - me.pos.z) || 1;
    mv = { x: (wp.x - me.pos.x) / l, z: (wp.z - me.pos.z) / l };
    // The target is up on a roof: fly up to it when close enough underneath.
    if (dy > 12 && dist < 70 && me.fuel > 1) { it.held.boost = true; if (me.onGround) it.pressed.boost = true; }
    // A dash down a clear street now and then.
    if (ai.dashT <= 0 && dist > 80 && ai.rnd() < k.dash && ai.nav.lineFree(me.pos.x, me.pos.z, wp.x, wp.z)) { it.pressed.dash = true; ai.dashT = 2.5; }
  } else if (ai.mode === 'retreat') {
    const back = { x: -fwd.x, z: -fwd.z };
    // Back off if the street behind is open, otherwise slide sideways.
    const openBack = ai.nav.lineFree(me.pos.x, me.pos.z, me.pos.x + back.x * 25, me.pos.z + back.z * 25);
    mv = openBack ? { x: back.x * 0.8 + side.x * 0.4, z: back.z * 0.8 + side.z * 0.4 } : side;
  } else {
    // engage: circle the target, drifting toward the middle of the preferred range
    const [lo, hi] = ai.range;
    const mid = (lo + hi) / 2;
    const radial = clamp((dist - mid) / Math.max(20, hi - lo), -1, 1) * 0.6;
    mv = { x: side.x + fwd.x * radial, z: side.z + fwd.z * radial };
    if (!ai.nav.lineFree(me.pos.x, me.pos.z, me.pos.x + mv.x * 12, me.pos.z + mv.z * 12)) { ai.strafe = -ai.strafe; mv = { x: -side.x, z: -side.z }; }
    // Too high to hit with the vulcan: hop up; too low and far: come down by walking.
    if (dy > 12 && me.fuel > 1.2 && me.active !== 'ranged') { it.held.boost = true; if (me.onGround) it.pressed.boost = true; }
  }
  const ml = Math.hypot(mv.x, mv.z);
  if (ml > 1) { mv.x /= ml; mv.z /= ml; }
  it.move.x = mv.x; it.move.z = mv.z;

  // ---- weapons
  if (ai.guardT > 0) it.held.guard = true;
  if (ai.wantSlot !== me.active && me.switchCd <= 0 && !me.melee) {
    const i = SLOTS.indexOf(ai.wantSlot);
    if (i === 0) it.pressed.switch1 = true; else if (i === 1) it.pressed.switch2 = true; else it.pressed.switch3 = true;
  }
  if (reacted && ai.guardT <= 0) {
    if (me.active === 'vulcan') {
      if (dist < 140 && Math.abs(dy) < 10 && !me.overheated && me.heat < 0.95) it.held.attack = true;
    } else if (me.active === 'ranged') {
      const w = rangedOf(me);
      if (me.energy >= w.energy && me.fireCd <= 0.35) {
        it.held.aim = true;
        // Lead the target by its velocity for the time of flight, with the difficulty's aim error.
        const tof = dist / w.speed * k.lead;
        const px = target.x + target.vx * tof, pz = target.z + target.vz * tof, py = target.y + 11 + target.vy * tof * 0.5;
        const muzzleY = me.pos.y + COMBAT.muzzleHeight + 2;
        const drop = w.gravityScale ? 0.5 * world.stage.gravity * w.gravityScale * tof * tof : 0;
        const aim = dirToAim({ x: px - me.pos.x, y: py + drop - muzzleY, z: pz - me.pos.z });
        it.aim.yaw = aim.yaw + ai.aimErr.yaw;
        it.aim.pitch = aim.pitch + ai.aimErr.pitch;
        if (me.fireCd <= 0 && me.aiming) it.pressed.attack = true;
      }
    } else if (me.active === 'melee') {
      const w = meleeOf(me);
      if (!me.melee) {
        if (dist < w.lungeRange && Math.abs(dy) < 18 && me.lock) it.pressed.attack = true;
      } else if (me.melee.stage === 'recovery' && ai.comboPressed !== me.melee.combo) {
        ai.comboPressed = me.melee.combo;
        if (ai.rnd() < k.combo) it.pressed.attack = true;
      }
    }
  }
  if (!me.melee) ai.comboPressed = -1;
  return it;
}

// Mode and weapon choices, made a few times a second.
function decide(ai, me, e, world, dist, dy, los) {
  const k = ai.k;
  const cls = me.loadout.weapon;
  // The target's armour decides how to fight it: one weak to blades is worth closing on, one that
  // shrugs them off is kept at gun range.
  const arm = armorOf(e);
  const bladeBonus = arm.melee >= 1.3, bladeWall = arm.melee <= 0.6;
  let [lo, hi] = RANGE[cls] || RANGE.normal;
  if (cls === 'normal' && bladeBonus) { lo = 0; hi = 60; }
  if (cls === 'melee' && bladeWall) { lo = 45; hi = 110; }
  ai.range = [lo, hi];
  if (!los) {
    ai.mode = ai.lostFor > 0.4 ? 'search' : ai.mode;
  } else if (ai.mode !== 'climb') {
    if (dist > hi) ai.mode = 'approach';
    else if (dist < lo) ai.mode = 'retreat';
    else ai.mode = 'engage';
    // Ranged types like a rooftop: a low building nearby with the target far away.
    if (k.roofs && cls !== 'melee' && me.onGround && me.pos.y < 3 && me.fuel > 2 && dist > 90 && ai.roofT <= 0 && ai.rnd() < 0.35) {
      const roof = nearbyRoof(world, me);
      if (roof) { ai.roofGoal = roof; ai.mode = 'climb'; ai.roofT = 6; }
    }
  }
  // Weapon by class, range and the target's armour.
  const ml = meleeOf(me), rg = rangedOf(me);
  const level = Math.abs(dy) < 10, nearLevel = Math.abs(dy) < 18;
  const canShoot = me.energy >= rg.energy;
  if (cls === 'melee') {
    if (dist < ml.lungeRange + (bladeWall ? -10 : 15) && nearLevel) ai.wantSlot = 'melee';
    else if (bladeWall && canShoot && dist < 160) ai.wantSlot = 'ranged';
    else if (dist < 130 && level) ai.wantSlot = 'vulcan';
    else ai.wantSlot = 'ranged';
  } else if (cls === 'ranged') {
    if (dist > 90 || !level) ai.wantSlot = 'ranged';
    else if (dist < 30 && (bladeBonus || ai.rnd() < 0.3)) ai.wantSlot = 'melee';
    else ai.wantSlot = 'vulcan';
  } else {
    if (dist < ml.lungeRange + (bladeBonus ? 10 : -5) && nearLevel) ai.wantSlot = 'melee';
    else if (dist < 110 && level && me.heat < 0.7 && (!bladeBonus || !canShoot)) ai.wantSlot = 'vulcan';
    else ai.wantSlot = 'ranged';
  }
  // Threats: a projectile coming in, or a melee wind-up in reach.
  if (ai.dodgeT <= 0 && los) {
    const incoming = world.projectiles.some((p) => p.owner !== me.id && closing(p, me) < 14);
    if (incoming && ai.rnd() < k.dodge && me.fuel >= MOVE.dashFuel) dodge(ai, me, e);
  }
  if (los && e.melee && (e.melee.stage === 'lunge' || e.melee.stage === 'windup') && dist < 40) {
    if (ai.rnd() < k.guard) ai.guardT = 0.5;
    else if (ai.rnd() < k.dodge && me.fuel >= MOVE.dashFuel) dodge(ai, me, e);
  }
}

// Distance of closest approach between a projectile's line of flight and the mech's chest.
function closing(p, me) {
  const cx = me.pos.x - p.pos.x, cy = me.pos.y + 11 - p.pos.y, cz = me.pos.z - p.pos.z;
  const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
  const t = (cx * p.vel.x + cy * p.vel.y + cz * p.vel.z) / sp;
  if (t < 0 || t > 90) return Infinity;                  // flying away, or too far to care yet
  const ox = cx - p.vel.x / sp * t, oy = cy - p.vel.y / sp * t, oz = cz - p.vel.z / sp * t;
  return Math.hypot(ox, oy, oz);
}

function dodge(ai, me, e) {
  const dx = e.pos.x - me.pos.x, dz = e.pos.z - me.pos.z, d = Math.hypot(dx, dz) || 1;
  const s = ai.rnd() < 0.5 ? -1 : 1;
  ai.dodgeDir = { x: -dz / d * s, z: dx / d * s };
  if (!ai.nav.lineFree(me.pos.x, me.pos.z, me.pos.x + ai.dodgeDir.x * 20, me.pos.z + ai.dodgeDir.z * 20)) ai.dodgeDir = { x: -ai.dodgeDir.x, z: -ai.dodgeDir.z };
  ai.dodgeT = 0.35;
  ai.intent.pressed.dash = true;
}

// Next point to walk toward: the farthest path corner in a straight free line, replanned now and then.
function waypoint(ai, me, target, world) {
  ai.pathT -= 1 / 60;
  const goalMoved = !ai.pathGoal || Math.hypot(ai.pathGoal.x - target.x, ai.pathGoal.z - target.z) > 15;
  if (ai.pathT <= 0 || goalMoved || !ai.path.length) {
    ai.pathT = ai.k.repath;
    ai.pathGoal = { x: target.x, z: target.z };
    ai.path = ai.nav.lineFree(me.pos.x, me.pos.z, target.x, target.z) ? [{ x: target.x, z: target.z }] : ai.nav.findPath(me.pos, target);
    if (!ai.path.length) ai.path = [{ x: target.x, z: target.z }];
  }
  // Drop corners already passed.
  while (ai.path.length > 1 && Math.hypot(ai.path[0].x - me.pos.x, ai.path[0].z - me.pos.z) < 8) ai.path.shift();
  let wp = ai.path[0];
  for (let i = ai.path.length - 1; i > 0; i--) {
    if (ai.nav.lineFree(me.pos.x, me.pos.z, ai.path[i].x, ai.path[i].z)) { wp = ai.path[i]; ai.path.splice(0, i); break; }
  }
  return wp;
}

// A low roof within reach of a boost from here: its top centre, or null.
function nearbyRoof(world, me) {
  let best = null, bestD = Infinity;
  for (const s of world.stage.statics) {
    if (s.tag !== 'building' || s.max[1] > 50 || s.max[1] < 20) continue;
    const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2;
    const d = Math.hypot(cx - me.pos.x, cz - me.pos.z);
    if (d < bestD && d < 70) { bestD = d; best = { x: cx, y: s.max[1], z: cz }; }
  }
  return best;
}
