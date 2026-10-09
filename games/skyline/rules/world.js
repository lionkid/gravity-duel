// Skyline's simulation: fighters moving through the city. No DOM, no Three.js; a World is plain data
// plus a derived `statics` index, and stepWorld(world, intents, dt) is deterministic for the same
// inputs, so matches can be replayed, tested in Node and run on a LAN host.

import { makeRng } from '../../../engine/core/rng.js';
import { createStatics } from '../../../engine/sim/statics.js';
import { createBody, moveBody } from '../../../engine/sim/controller.js';
import { approachXZ, approachAngle, dirToYaw, yawToDir, wrapAngle } from '../../../engine/core/math.js';
import { emit } from '../../../engine/core/events.js';
import { IDLE_INTENT } from '../../../engine/input/intent.js';
import { MOVE, BODY } from '../config.js';
import { initCombat, stepLock, stepCombat, stepProjectiles, separateFighters, combatFacing, armorOf, rangedOf } from './combat.js';

const BUFFERED = ['boost', 'dash', 'attack', 'lock', 'switch1', 'switch2', 'switch3', 'switchNext', 'switchPrev'];

// loadouts: { 1: { weapon, armor }, 2: { weapon, armor } }
export function createWorld({ stage, seed = 1, players = 2, loadouts = {} }) {
  const world = {
    tick: 0, time: 0, seed, stage, winner: 0, koTick: 0, nextId: 0,
    fighters: [], projectiles: [], events: [],
    rnd: makeRng(seed),
    statics: createStatics(stage),
  };
  for (let i = 0; i < players; i++) {
    const sp = stage.spawns[i % stage.spawns.length];
    world.fighters.push(createFighter(i + 1, sp, loadouts[i + 1]));
  }
  return world;
}

export function createFighter(id, spawn, loadout) {
  const f = createBody({ x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z, w: BODY.w, h: BODY.h, d: BODY.d });
  Object.assign(f, {
    id,
    onGround: true,                 // spawns stand on a surface; the first step confirms it
    yaw: spawn.yaw,
    aim: { yaw: spawn.yaw, pitch: 0 },
    hp: 1000, hpMax: 1000,
    fuel: MOVE.fuelMax, fuelDelay: 0,
    boosting: false, aiming: false,
    dashTimer: 0, dashCd: 0, dashDir: { x: 0, z: -1 },
    landLag: 0,
    buf: {},
  });
  for (const a of BUFFERED) f.buf[a] = 0;
  initCombat(f, loadout);
  return f;
}

export function stepWorld(world, intents, dt) {
  const g = world.stage.gravity;
  world.fighters.forEach((f, i) => {
    const it = intents[i] || IDLE_INTENT;
    stepFighter(world, f, it, dt, g);
  });
  stepProjectiles(world, dt);
  separateFighters(world, dt);
  world.tick++;
  world.time += dt;
  return world;
}

function stepFighter(world, f, it, dt, g) {
  // Buffered presses stay valid for a short window so a tap just before landing still counts.
  for (const a of BUFFERED) f.buf[a] = it.pressed[a] ? MOVE.inputBuffer : Math.max(0, f.buf[a] - dt);
  f.landLag = Math.max(0, f.landLag - dt);
  f.dashCd = Math.max(0, f.dashCd - dt);

  f.aim.yaw = it.aim.yaw;
  f.aim.pitch = it.aim.pitch;
  stepLock(world, f, it, dt);
  const combat = stepCombat(world, f, it, dt);
  const canAct = f.landLag <= 0 && !f.dead && f.stun <= 0 && f.guardBreak <= 0;
  f.aiming = canAct && !!it.held.aim && !f.melee && !f.guard;

  const mv = canAct && !combat.lockMove ? it.move : IDLE_INTENT.move;
  const moving = Math.hypot(mv.x, mv.z) > 0.05;
  const speedMul = (f.aiming ? rangedOf(f).aimMoveMul : 1) * armorOf(f).speed;

  // Dash: a burst along the movement direction (or facing), hovering, paid for with fuel.
  if (f.buf.dash > 0 && canAct && !combat.lockMove && f.dashTimer <= 0 && f.dashCd <= 0 && f.fuel >= MOVE.dashFuel) {
    f.buf.dash = 0;
    f.dashTimer = MOVE.dashTime;
    f.dashCd = MOVE.dashCooldown + MOVE.dashTime;
    f.fuel -= MOVE.dashFuel;
    f.fuelDelay = MOVE.fuelRegenDelay;
    const d = moving ? { x: mv.x, z: mv.z } : yawToDir(f.yaw);
    const l = Math.hypot(d.x, d.z) || 1;
    f.dashDir = { x: d.x / l, z: d.z / l };
    f.onGround = false;
    emit(world, 'dash', { id: f.id, x: f.pos.x, y: f.pos.y, z: f.pos.z });
  }

  if (combat.lunge) {
    // A melee lunge carries the body straight at the target, hovering like a dash.
    f.vel.x = combat.lunge.x; f.vel.z = combat.lunge.z; f.vel.y = 0;
    f.boosting = false;
  } else if (f.dashTimer > 0) {
    f.dashTimer = Math.max(0, f.dashTimer - dt);
    f.vel.x = f.dashDir.x * MOVE.dash;
    f.vel.z = f.dashDir.z * MOVE.dash;
    f.vel.y = 0;
    f.boosting = false;
  } else {
    // Horizontal: snappy on the ground, limited control in the air (no air friction without input).
    const run = MOVE.run * speedMul;
    if (f.onGround) {
      approachXZ(f.vel, mv.x * run, mv.z * run, (moving ? MOVE.accelGround : MOVE.decelGround) * dt);
    } else {
      if (moving) approachXZ(f.vel, mv.x * MOVE.airMax * speedMul, mv.z * MOVE.airMax * speedMul, MOVE.accelAir * dt);
      // Momentum above the air speed limit (left over from a dash) bleeds off instead of gliding forever.
      const sp = Math.hypot(f.vel.x, f.vel.z);
      if (sp > MOVE.airMax) approachXZ(f.vel, f.vel.x / sp * MOVE.airMax, f.vel.z / sp * MOVE.airMax, MOVE.airBleed * dt);
    }
    // Jump on a fresh press from the ground; thrust while held in the air.
    if (f.buf.boost > 0 && f.onGround && canAct && !combat.lockMove) {
      f.buf.boost = 0;
      f.vel.y = MOVE.jump;
      f.onGround = false;
      f.fuelDelay = MOVE.fuelRegenDelay;
      emit(world, 'jump', { id: f.id });
    }
    f.boosting = canAct && !combat.lockMove && !!it.held.boost && !f.onGround && f.fuel > 0;
    if (f.boosting) {
      f.vel.y = Math.min(MOVE.maxRise, f.vel.y + MOVE.boostAccel * dt);
      f.fuel = Math.max(0, f.fuel - dt);
      f.fuelDelay = MOVE.fuelRegenDelay;
    }
    f.vel.y = Math.max(-MOVE.terminal, f.vel.y - g * dt);
  }

  // Facing: the view while aiming; the target while locked on or swinging; otherwise the movement.
  const face = combatFacing(world, f, combat);
  if (f.aiming) f.yaw = approachAngle(f.yaw, f.aim.yaw, MOVE.aimTurnRate * dt);
  else if (face != null && !f.dead) f.yaw = approachAngle(f.yaw, face, MOVE.turnRate * dt);
  else if (moving && f.dashTimer <= 0) f.yaw = approachAngle(f.yaw, dirToYaw(mv.x, mv.z), MOVE.turnRate * dt);
  else if (f.dashTimer > 0) f.yaw = approachAngle(f.yaw, dirToYaw(f.dashDir.x, f.dashDir.z), MOVE.turnRate * 2 * dt);
  f.yaw = wrapAngle(f.yaw);

  const wasAir = !f.onGround;
  moveBody(f, world.statics, dt, { stepUp: MOVE.stepUp, snap: MOVE.snap });
  if (wasAir && f.onGround) {
    const hard = f.landedSpeed > MOVE.landLagSpeed;
    if (hard) f.landLag = MOVE.landLag;
    f.boosting = false;
    emit(world, 'land', { id: f.id, hard, speed: f.landedSpeed, x: f.pos.x, y: f.pos.y, z: f.pos.z });
  }
  if (f.hitBounds) emit(world, 'fence', { id: f.id });

  // Fuel comes back on the ground after a short delay.
  if (f.onGround && f.dashTimer <= 0) {
    f.fuelDelay = Math.max(0, f.fuelDelay - dt);
    if (f.fuelDelay <= 0) f.fuel = Math.min(MOVE.fuelMax, f.fuel + MOVE.fuelRegen * dt);
  }
}

// Plain-data view of a fighter for snapshots and tests (no functions, no derived caches).
export function fighterState(f) {
  return {
    id: f.id, pos: { ...f.pos }, vel: { ...f.vel }, yaw: f.yaw, aim: { ...f.aim }, onGround: f.onGround,
    hp: f.hp, fuel: f.fuel, boosting: f.boosting, aiming: f.aiming, dashTimer: f.dashTimer, landLag: f.landLag,
    active: f.active, heat: f.heat, energy: f.energy, stun: f.stun, guard: f.guard, lock: f.lock, dead: f.dead,
    melee: f.melee ? { ...f.melee } : null,
  };
}
