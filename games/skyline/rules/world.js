// Skyline's simulation: fighters moving through the city. No DOM, no Three.js; a World is plain data
// plus a derived `statics` index, and stepWorld(world, intents, dt) is deterministic for the same
// inputs, so matches can be replayed, tested in Node and run on a LAN host.

import { makeRng } from '../../../engine/core/rng.js';
import { createStatics } from '../../../engine/sim/statics.js';
import { createBody, moveBody } from '../../../engine/sim/controller.js';
import { approach, approachXZ, approachAngle, dirToYaw, yawToDir, wrapAngle } from '../../../engine/core/math.js';
import { emit } from '../../../engine/core/events.js';
import { IDLE_INTENT } from '../../../engine/input/intent.js';
import { MOVE, BODY, TWISTER } from '../config.js';
import { initCombat, stepLock, stepCombat, stepProjectiles, separateFighters, combatFacing, armorOf, rangedOf } from './combat.js';
import { createPractice, placeTargets, stepPractice } from './targets.js';
import { createTwisters, stepTwisters, twisterForces, caughtVelocity, escapeTwister } from './twisters.js';
import { createMeteors, stepMeteors, rockContacts } from './meteors.js';

const BUFFERED = ['boost', 'dash', 'attack', 'lock', 'switch1', 'switch2', 'switch3', 'switchNext', 'switchPrev'];

// loadouts: { 1: { weapon, armor }, 2: { weapon, armor } }; practice: null | { mode: 'free' | 'timed' }
// (bullseye targets, a dummy that stands up again, a score).
export function createWorld({ stage, seed = 1, players = 2, loadouts = {}, practice = null }) {
  const statics = createStatics(stage);
  const world = {
    tick: 0, time: 0, seed, stage, winner: 0, koTick: 0, nextId: 0,
    fighters: [], projectiles: [], events: [],
    rnd: makeRng(seed),
    statics,
    twisters: createTwisters(stage, seed),
    meteors: createMeteors(stage, seed, statics),
    targets: practice ? placeTargets(stage, seed) : [],
    practice: practice ? createPractice(practice.mode) : null,
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
  stepTwisters(world, dt);
  stepMeteors(world, dt);
  world.fighters.forEach((f, i) => {
    const it = intents[i] || IDLE_INTENT;
    stepFighter(world, f, it, dt, g);
  });
  stepProjectiles(world, dt);
  separateFighters(world, dt);
  stepPractice(world, dt);
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
  twisterForces(world, f, dt);
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
    f.flung = false;
    escapeTwister(world, f);                 // a dash breaks out of a twister
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
  } else if (f.caught && caughtVelocity(world, f)) {
    // Caught in a twister: carried around the axis and up, whatever the controls say.
    const cv = caughtVelocity(world, f);
    approachXZ(f.vel, cv.x, cv.z, 170 * dt);
    f.vel.y = approach(f.vel.y, cv.y, TWISTER.liftAccel * dt);
    f.boosting = false;
    f.onGround = false;
  } else {
    // Horizontal: snappy on the ground, limited control in the air (no air friction without input).
    // A twister's pull is wind: it moves the velocity the controls aim for.
    const run = MOVE.run * speedMul;
    const w = f.wind, windy = !!w && (w.x !== 0 || w.z !== 0);
    if (f.onGround) {
      if (windy) approachXZ(f.vel, mv.x * run + w.x, mv.z * run + w.z, (moving ? MOVE.accelGround : MOVE.decelGround) * dt);
      else approachXZ(f.vel, mv.x * run, mv.z * run, (moving ? MOVE.accelGround : MOVE.decelGround) * dt);
    } else {
      if (windy) approachXZ(f.vel, mv.x * MOVE.airMax * speedMul + w.x, mv.z * MOVE.airMax * speedMul + w.z, MOVE.accelAir * dt);
      else if (moving) approachXZ(f.vel, mv.x * MOVE.airMax * speedMul, mv.z * MOVE.airMax * speedMul, MOVE.accelAir * dt);
      // Momentum above the air speed limit (left over from a dash, or a fling) bleeds off instead of gliding forever.
      const lim = windy ? MOVE.airMax + Math.hypot(w.x, w.z) : MOVE.airMax;
      const sp = Math.hypot(f.vel.x, f.vel.z);
      if (sp > lim && !f.flung) approachXZ(f.vel, f.vel.x / sp * lim, f.vel.z / sp * lim, MOVE.airBleed * dt);
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

  // Facing: the view while aiming; spun round in a twister; the target while locked on or swinging;
  // otherwise the movement.
  const face = combatFacing(world, f, combat);
  if (f.aiming) f.yaw = approachAngle(f.yaw, f.aim.yaw, MOVE.aimTurnRate * dt);
  else if (f.caught) f.yaw = f.yaw + TWISTER.spin * dt;
  else if (face != null && !f.dead) f.yaw = approachAngle(f.yaw, face, MOVE.turnRate * dt);
  else if (moving && f.dashTimer <= 0) f.yaw = approachAngle(f.yaw, dirToYaw(mv.x, mv.z), MOVE.turnRate * dt);
  else if (f.dashTimer > 0) f.yaw = approachAngle(f.yaw, dirToYaw(f.dashDir.x, f.dashDir.z), MOVE.turnRate * 2 * dt);
  f.yaw = wrapAngle(f.yaw);

  const wasAir = !f.onGround;
  moveBody(f, world.statics, dt, { stepUp: MOVE.stepUp, snap: MOVE.snap });
  if (world.meteors) rockContacts(world, f, dt);       // drifting rocks push, and carry whoever stands on one
  if (wasAir && f.onGround) {
    f.flung = false;
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

// ---------------------------------------------------------------- copies and snapshots
// A World is plain data apart from the stage and the statics index (immutable, shared by reference)
// and the random generator (restored from its state). Copies let a LAN guest predict ahead of the
// host; snapshots travel over the wire as JSON.
const SHARED = new Set(['stage', 'statics', 'rnd', 'events']);

export function cloneWorld(world) {
  const copy = {};
  for (const k of Object.keys(world)) if (!SHARED.has(k)) copy[k] = structuredClone(world[k]);
  copy.stage = world.stage;
  copy.statics = world.statics;
  copy.events = [];
  copy.rnd = makeRng(world.seed);
  copy.rnd.state = world.rnd.state;
  return copy;
}

export function serializeWorld(world) {
  const snap = {};
  for (const k of Object.keys(world)) if (!SHARED.has(k)) snap[k] = structuredClone(world[k]);
  snap.rng = world.rnd.state;
  return snap;
}

// Overwrites a world with a snapshot of the same match. Fighter objects keep their identity.
export function applySnapshot(world, snap) {
  for (const k of Object.keys(snap)) {
    if (k === 'rng' || k === 'fighters') continue;
    world[k] = structuredClone(snap[k]);
  }
  snap.fighters.forEach((s, i) => {
    if (world.fighters[i]) Object.assign(world.fighters[i], structuredClone(s));
    else world.fighters[i] = structuredClone(s);
  });
  world.fighters.length = snap.fighters.length;
  world.rnd.state = snap.rng;
  world.events = [];
  return world;
}

// A cheap checksum of the state that matters, to count desyncs between two copies of a match.
export function hashWorld(world) {
  let h = 2166136261;
  const mix = (v) => {
    const n = typeof v === 'number' ? Math.round(v * 1000) | 0 : v === true ? 1 : v === false || v == null ? 0 : 7;
    h = Math.imul(h ^ n, 16777619);
  };
  for (const f of world.fighters) {
    mix(f.pos.x); mix(f.pos.y); mix(f.pos.z); mix(f.vel.x); mix(f.vel.y); mix(f.vel.z); mix(f.yaw);
    mix(f.hp); mix(f.fuel); mix(f.energy); mix(f.heat); mix(f.stun); mix(f.lock); mix(f.dead); mix(f.onGround);
    mix(f.active === 'melee' ? 1 : f.active === 'vulcan' ? 2 : 3); mix(f.melee ? f.melee.t : -1);
  }
  for (const p of world.projectiles) { mix(p.id); mix(p.pos.x); mix(p.pos.y); mix(p.pos.z); }
  for (const tw of world.twisters || []) { mix(tw.x); mix(tw.z); mix(tw.strength); mix(tw.cycle); }
  for (const f of world.fighters) mix(f.caught || 0);
  if (world.meteors) {
    const m = world.meteors;
    for (const rk of m.rocks) { mix(rk.x); mix(rk.y); mix(rk.z); mix(rk.cycle); }
    for (const st of m.strikes) { mix(st.id); mix(st.x); mix(st.y); mix(st.z); }
    mix(m.next); mix(m.count);
    for (const f of world.fighters) mix(f.rockOn || 0);
  }
  for (const tg of world.targets || []) { mix(tg.alive); mix(tg.hp); mix(tg.yaw); }
  if (world.practice) { mix(world.practice.score); mix(world.practice.shots); }
  mix(world.tick); mix(world.winner); mix(world.rnd.state);
  return h >>> 0;
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
