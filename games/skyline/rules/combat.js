// Skyline combat rules: weapon switching, the vulcan, ranged shots and projectiles, melee lunges and
// swings, guard, damage with the armour matrix, lock-on and KO. Pure simulation: no DOM, no Three.js.
//
// Fighter combat state (set by initCombat):
//   loadout { weapon, armor }   active 'melee' | 'vulcan' | 'ranged'
//   switchTimer / switchCd      draw time after a switch / time before the next switch
//   heat / overheated           vulcan heat 0..1
//   energy                      ranged ammo
//   melee                       null or { stage: 'lunge' | 'windup' | 'active' | 'recovery', t, combo, hit }
//   stun / guard / guardBreak   recovery after being hit / holding guard / recovering from a guard break
//   lock / lockLost / autoLock  target id or 0 / seconds without line of sight / re-lock when seen again

import { yawToDir, aimToDir, dirToYaw, distXZ, approachAngle } from '../../../engine/core/math.js';
import { boxAt, overlaps } from '../../../engine/sim/aabb.js';
import { bodyBox } from '../../../engine/sim/controller.js';
import { raycast, lineOfSight, segmentBody } from '../../../engine/sim/sweep.js';
import { emit } from '../../../engine/core/events.js';
import { WEAPONS, ARMORS, COMBAT, SLOTS } from '../config.js';

export function initCombat(f, loadout) {
  f.loadout = { weapon: (loadout && loadout.weapon) || 'normal', armor: (loadout && loadout.armor) || 'normal' };
  f.active = 'vulcan';
  f.switchTimer = 0; f.switchCd = 0;
  f.heat = 0; f.overheated = false; f.vulcanCd = 0;
  f.energy = rangedOf(f).energyMax; f.fireCd = 0;
  f.melee = null;
  f.stun = 0; f.guard = false; f.guardBreak = 0;
  f.lock = 0; f.lockLost = 0; f.autoLock = true; f.lockLos = false;
  f.dead = false;
  f.hp = COMBAT.hp; f.hpMax = COMBAT.hp;
  f.attacked = 0;        // tick of the last attack input, for the HUD
  return f;
}

export const rangedOf = (f) => WEAPONS.ranged[f.loadout.weapon];
export const meleeOf = (f) => WEAPONS.melee[f.loadout.weapon];
export const armorOf = (f) => ARMORS[f.loadout.armor];
export function weaponIn(f, slot) { return slot === 'vulcan' ? WEAPONS.vulcan : slot === 'ranged' ? rangedOf(f) : meleeOf(f); }
export const enemyOf = (world, f) => world.fighters.find((o) => o.id !== f.id) || null;
const chest = (f) => ({ x: f.pos.x, y: f.pos.y + COMBAT.muzzleHeight, z: f.pos.z });

// Lock-on: keeps the target while it is in view; drops it after lockLose seconds hidden and comes
// back by itself when the target reappears (unless the player switched lock-on off).
export function stepLock(world, f, it, dt) {
  const e = enemyOf(world, f);
  if (!e || e.dead || f.dead) { f.lock = 0; f.lockLos = false; return; }
  f.lockLos = distXZ(f.pos, e.pos) <= COMBAT.lockRange && lineOfSight(world.statics, chest(f), chest(e));
  if (!f.lock && f.autoLock && f.lockLos) {
    f.lock = e.id; f.lockLost = 0;
    emit(world, 'lock', { id: f.id, auto: true });
  }
  if (f.buf.lock > 0) {
    f.buf.lock = 0;
    if (f.lock) { f.lock = 0; f.autoLock = false; emit(world, 'unlock', { id: f.id }); }
    else if (f.lockLos) { f.lock = e.id; f.autoLock = true; f.lockLost = 0; emit(world, 'lock', { id: f.id }); }
  }
  if (f.lock) {
    f.lockLost = f.lockLos ? 0 : f.lockLost + dt;
    if (f.lockLost > COMBAT.lockLose) { f.lock = 0; emit(world, 'unlock', { id: f.id, lost: true }); }
  }
}

// Weapons for one fighter this tick. Returns movement constraints for the movement code:
//   { lockMove: no walking, lunge: {x, z} velocity to apply or null, face: yaw to turn toward or null }
export function stepCombat(world, f, it, dt) {
  const out = { lockMove: false, lunge: null, face: null };
  f.stun = Math.max(0, f.stun - dt);
  f.guardBreak = Math.max(0, f.guardBreak - dt);
  f.switchTimer = Math.max(0, f.switchTimer - dt);
  f.switchCd = Math.max(0, f.switchCd - dt);
  f.fireCd = Math.max(0, f.fireCd - dt);
  const ranged = rangedOf(f);
  f.energy = Math.min(ranged.energyMax, f.energy + ranged.regen * dt);
  // Vulcan heat cools whenever it is not firing (handled below).
  let firedVulcan = false;

  if (f.dead) { f.melee = null; f.guard = false; return out; }
  const free = f.stun <= 0 && f.guardBreak <= 0 && f.landLag <= 0 && f.dashTimer <= 0;

  // Guard: hold to halve damage, cannot move or attack meanwhile.
  f.guard = free && !f.melee && !!it.held.guard && !f.aiming;
  if (f.guard) out.lockMove = true;

  // Switching: 1/2/3 pick a slot, wheel cycles. Draw time blocks attacks; cooldown blocks switching.
  if (free && !f.melee && f.switchCd <= 0) {
    let to = null;
    if (f.buf.switch1 > 0) to = SLOTS[0]; else if (f.buf.switch2 > 0) to = SLOTS[1]; else if (f.buf.switch3 > 0) to = SLOTS[2];
    else if (f.buf.switchNext > 0) to = SLOTS[(SLOTS.indexOf(f.active) + 1) % 3];
    else if (f.buf.switchPrev > 0) to = SLOTS[(SLOTS.indexOf(f.active) + 2) % 3];
    if (to) {
      for (const k of ['switch1', 'switch2', 'switch3', 'switchNext', 'switchPrev']) f.buf[k] = 0;
      if (to !== f.active) {
        f.active = to;
        f.switchTimer = COMBAT.switchDraw;
        f.switchCd = COMBAT.switchCooldown;
        emit(world, 'switch', { id: f.id, to });
      }
    }
  }
  const canAttack = free && f.switchTimer <= 0 && !f.guard;

  // Melee state machine.
  if (f.melee) {
    const w = meleeOf(f), m = f.melee, swing = w.combo[m.combo];
    const e = enemyOf(world, f);
    m.t += dt;
    if (m.stage === 'lunge') {
      out.lockMove = true;
      const dir = e ? { x: e.pos.x - f.pos.x, z: e.pos.z - f.pos.z } : yawToDir(f.yaw);
      const d = Math.hypot(dir.x, dir.z) || 1;
      out.face = dirToYaw(dir.x, dir.z);
      const close = e && distXZ(f.pos, e.pos) <= w.reach * 0.8;
      if (close || m.t >= w.lungeDist / w.lungeSpeed || !e) { m.stage = 'windup'; m.t = 0; }
      else out.lunge = { x: dir.x / d * w.lungeSpeed, z: dir.z / d * w.lungeSpeed };
    }
    if (m.stage === 'windup') {
      out.lockMove = true;
      if (e && f.lock) {
        out.face = dirToYaw(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
        // Later swings step toward the target so a combo keeps connecting after the knockback.
        const d = distXZ(f.pos, e.pos);
        if (m.combo > 0 && d > w.reach * 0.7 && d < w.lungeRange) {
          const dx = e.pos.x - f.pos.x, dz = e.pos.z - f.pos.z;
          out.lunge = { x: dx / d * w.stepSpeed, z: dz / d * w.stepSpeed };
        }
      }
      if (m.t >= swing.windup) { m.stage = 'active'; m.t = 0; m.hit = false; emit(world, 'slash', { id: f.id, x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw, combo: m.combo, style: swing.style, color: w.color }); }
    }
    if (m.stage === 'active') {
      out.lockMove = true;
      if (!m.hit && e && !e.dead && meleeHits(f, e, w)) {
        m.hit = true;
        applyDamage(world, e, swing.dmg, 'melee', f, { stun: w.stun, knock: swing.knock == null ? w.knock : swing.knock, guardBreak: w.guardBreak, melee: true, final: m.combo === w.combo.length - 1 });
      }
      if (m.t >= swing.active) { m.stage = 'recovery'; m.t = 0; }
    }
    if (m.stage === 'recovery') {
      out.lockMove = true;
      // Chain the next swing on a buffered press.
      if (f.buf.attack > 0 && m.combo + 1 < w.combo.length && m.t >= swing.recovery * 0.4) {
        f.buf.attack = 0;
        f.melee = { stage: 'windup', t: 0, combo: m.combo + 1, hit: false };
      } else if (m.t >= swing.recovery) f.melee = null;
    }
  } else if (canAttack) {
    if (f.active === 'melee' && f.buf.attack > 0) {
      f.buf.attack = 0;
      const w = meleeOf(f), e = enemyOf(world, f);
      const inRange = e && !e.dead && f.lock && distXZ(f.pos, e.pos) <= w.lungeRange && Math.abs(e.pos.y - f.pos.y) <= 20;
      f.melee = { stage: inRange ? 'lunge' : 'windup', t: 0, combo: 0, hit: false };
      f.attacked = world.tick;
      emit(world, 'melee', { id: f.id, lunge: !!inRange });
    } else if (f.active === 'vulcan' && it.held.attack && !f.overheated) {
      firedVulcan = true;
      fireVulcan(world, f, dt);
    } else if (f.active === 'ranged' && f.aiming && f.buf.attack > 0 && f.fireCd <= 0 && f.energy >= ranged.energy) {
      f.buf.attack = 0;
      fireRanged(world, f, ranged);
    }
  }

  if (!firedVulcan) {
    f.heat = Math.max(0, f.heat - WEAPONS.vulcan.cool * dt);
    if (f.overheated && f.heat <= WEAPONS.vulcan.overheatUntil) f.overheated = false;
    f.vulcanCd = 0;
  }
  return out;
}

function fireVulcan(world, f, dt) {
  const v = WEAPONS.vulcan;
  f.vulcanCd -= dt;
  while (f.vulcanCd <= 0 && !f.overheated) {
    f.vulcanCd += 1 / v.rate;
    f.heat += 1 / (v.rate * v.heatTime);
    if (f.heat >= 1) { f.heat = 1; f.overheated = true; emit(world, 'overheat', { id: f.id }); }
    // Straight ahead along the body, level, with a little scatter; alternating chest launchers.
    const yaw = f.yaw + (world.rnd() - 0.5) * 2 * v.spread;
    const pitch = (world.rnd() - 0.5) * 2 * v.spread;
    const dir = aimToDir(yaw, pitch);
    const fwd = yawToDir(f.yaw), right = { x: -fwd.z, z: fwd.x };
    const side = (f.vulcanSide = -(f.vulcanSide || 1));
    const from = { x: f.pos.x + fwd.x * 5 + right.x * side * 3, y: f.pos.y + COMBAT.muzzleHeight + 1, z: f.pos.z + fwd.z * 5 + right.z * side * 3 };
    world.projectiles.push({
      id: ++world.nextId, owner: f.id, kind: v.id, look: v.look, dmgKind: v.kind, dmg: v.dmg, stun: v.stun, knock: v.knock, color: v.color,
      pos: { ...from }, prev: { ...from }, vel: { x: dir.x * v.speed, y: dir.y * v.speed, z: dir.z * v.speed },
      gravityScale: v.gravityScale, ttl: v.range / v.speed, speed: v.speed,
    });
    emit(world, 'shot', { id: f.id, kind: v.id, x: from.x, y: from.y, z: from.z, dx: dir.x, dy: dir.y, dz: dir.z, color: v.color });
    f.attacked = world.tick;
  }
}

function fireRanged(world, f, w) {
  f.energy -= w.energy;
  f.fireCd = w.interval;
  const dir = aimToDir(f.aim.yaw, f.aim.pitch);
  const from = { x: f.pos.x + dir.x * 6, y: f.pos.y + COMBAT.muzzleHeight + 2 + dir.y * 6, z: f.pos.z + dir.z * 6 };
  world.projectiles.push({
    id: ++world.nextId, owner: f.id, kind: w.id, look: w.look, dmgKind: w.kind, dmg: w.dmg, stun: w.stun, knock: w.knock, color: w.color,
    pos: { ...from }, prev: { ...from }, vel: { x: dir.x * w.speed, y: dir.y * w.speed, z: dir.z * w.speed },
    gravityScale: w.gravityScale, ttl: w.ttl, speed: w.speed,
  });
  f.attacked = world.tick;
  emit(world, 'shot', { id: f.id, kind: w.id, x: from.x, y: from.y, z: from.z, dx: dir.x, dy: dir.y, dz: dir.z, color: w.color });
}

// Projectiles fly, drop if they are solid shells, and hit the first thing on their path.
export function stepProjectiles(world, dt) {
  const g = world.stage.gravity;
  const bd = world.stage.bounds;
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    p.prev.x = p.pos.x; p.prev.y = p.pos.y; p.prev.z = p.pos.z;
    p.vel.y -= g * p.gravityScale * dt;
    p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt; p.pos.z += p.vel.z * dt;
    p.ttl -= dt;
    let tEnd = 1, victim = null;
    const wall = raycast(world.statics, p.prev, p.pos);
    if (wall) tEnd = wall.t;
    for (const f of world.fighters) {
      if (f.id === p.owner || f.dead) continue;
      const hb = segmentBody(p.prev, p.pos, f);
      if (hb && hb.t < tEnd) { tEnd = hb.t; victim = f; }
    }
    const out = bd && (p.pos.x < bd.minX || p.pos.x > bd.maxX || p.pos.z < bd.minZ || p.pos.z > bd.maxZ || p.pos.y > bd.ceiling);
    if (wall || victim || p.ttl <= 0 || out) {
      const hx = p.prev.x + (p.pos.x - p.prev.x) * tEnd, hy = p.prev.y + (p.pos.y - p.prev.y) * tEnd, hz = p.prev.z + (p.pos.z - p.prev.z) * tEnd;
      if (victim) {
        const shooter = world.fighters.find((f) => f.id === p.owner);
        applyDamage(world, victim, p.dmg, p.dmgKind, shooter, { stun: p.stun, knock: p.knock, x: hx, y: hy, z: hz });
      }
      emit(world, 'impact', { x: hx, y: hy, z: hz, color: p.color, body: !!victim, kind: p.kind, look: p.look, dx: p.vel.x, dy: p.vel.y, dz: p.vel.z });
      world.projectiles.splice(i, 1);
    }
  }
}

// The swing's hit box: reach metres ahead of the attacker, width wide, full body height.
export function meleeHits(f, e, w) {
  const fwd = yawToDir(f.yaw);
  const box = boxAt(f.pos.x + fwd.x * (w.reach / 2 + 2), f.pos.y - 2, f.pos.z + fwd.z * (w.reach / 2 + 2), Math.max(w.width, w.reach), f.size.h + 4, Math.max(w.width, w.reach));
  return overlaps(box, bodyBox(e));
}

export function applyDamage(world, t, amount, kind, by, o = {}) {
  if (t.dead) return 0;
  let dmg = amount * (armorOf(t)[kind] || 1);
  let guarded = false, broke = false;
  const superArmor = t.melee && meleeOf(t).superArmor && (t.melee.stage === 'windup' || t.melee.stage === 'active');
  if (t.guard) {
    if (o.guardBreak) { broke = true; t.guard = false; t.guardBreak = COMBAT.guardBreakStun; }
    else { guarded = true; dmg *= COMBAT.guardMul; }
  }
  dmg = Math.round(dmg);
  t.hp = Math.max(0, t.hp - dmg);
  if (!superArmor && !guarded) {
    if (o.stun) t.stun = Math.min(COMBAT.maxStun, Math.max(t.stun, o.stun));
    if (o.knock && by) {
      const dx = t.pos.x - by.pos.x, dz = t.pos.z - by.pos.z, d = Math.hypot(dx, dz) || 1;
      t.vel.x += dx / d * o.knock; t.vel.z += dz / d * o.knock;
      if (kind === 'melee') { t.vel.y = Math.max(t.vel.y, o.knock * (o.final ? 0.45 : 0.25)); t.onGround = false; }
    }
    if (t.melee && kind !== 'light' && !superArmor) t.melee = null;      // a solid hit interrupts a swing
  }
  const fromYaw = by ? dirToYaw(by.pos.x - t.pos.x, by.pos.z - t.pos.z) : t.yaw;
  emit(world, 'hit', { id: t.id, by: by ? by.id : 0, amount: dmg, kind, guard: guarded, broke, superArmor, melee: !!o.melee, final: !!o.final, fromYaw,
    x: o.x == null ? t.pos.x : o.x, y: o.y == null ? t.pos.y + 12 : o.y, z: o.z == null ? t.pos.z : o.z });
  if (t.hp <= 0) {
    t.dead = true; t.melee = null; t.guard = false; t.aiming = false; t.lock = 0;
    world.winner = by ? by.id : 0;
    world.koTick = world.tick;
    emit(world, 'ko', { id: t.id, by: by ? by.id : 0 });
  }
  return dmg;
}

// Fighters cannot stand inside each other: push them apart on the ground plane.
export function separateFighters(world, dt) {
  const [a, b] = world.fighters;
  if (!a || !b) return;
  const ba = bodyBox(a), bb = bodyBox(b);
  if (!overlaps(ba, bb)) return;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const px = (a.size.w + b.size.w) / 2 - Math.abs(dx), pz = (a.size.d + b.size.d) / 2 - Math.abs(dz);
  let mx = 0, mz = 0;
  if (px < pz) mx = (dx >= 0 ? 1 : -1) * px / 2; else mz = (dz >= 0 ? 1 : -1) * pz / 2;
  a.pos.x -= mx; a.pos.z -= mz; b.pos.x += mx; b.pos.z += mz;
}

// Body facing wanted by the combat state this tick, or null to leave it to the movement code.
export function combatFacing(world, f, c) {
  if (c.face != null) return c.face;
  if (f.lock && !f.aiming) {
    const e = enemyOf(world, f);
    if (e) return dirToYaw(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
  }
  return null;
}

export { approachAngle };
