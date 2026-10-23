// Procedural animation for mechs built by mech-builder. Works on node names, so any design with the
// same names (torso, head, thighL/R, shinL/R, armL/R, wingL/R, flameL/R, and the weapons) animates the
// same way. Weapons: the right hand's `weapon` group holds one model per weapon id (rocket, longrifle,
// handcannon, saber, greatblade, knife); the one the loadout carries in the slot in use is shown, the
// others hidden. A melee model carries `edge`, `aura`, `bladeBase` and `bladeTip` inside it. Older
// designs with a single `rifle` and `blade` still work.
//
//   state: { speed, runSpeed, onGround, boosting, dashing, vy, landLag, aiming, aimPitch,
//            active ('melee' | 'vulcan' | 'ranged'), guard, stun, dead,
//            melee: null | { stage: 'lunge' | 'windup' | 'active' | 'recovery', progress 0..1,
//                            style: 'slashR' | 'slashL' | 'overhead' | 'spin' },
//            rangedId, meleeId (the weapon ids of the loadout),
//            hitT (seconds since last hit, Infinity if none), hitSide (-1 | 0 | 1), hitHeavy,
//            firedT (seconds since last shot), firedKind }
//   mech.flash (seconds) is set by the game when the mech is hit and fades here.
//   mech.rootYaw / mech.rootLift are written here: a spin and a hop the game adds to the root transform.

import * as THREE from 'three';
import { clamp, TAU } from '../core/math.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion(), tmpV = new THREE.Vector3();

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t;

// The ready stance with the sword out, which every swing starts from and returns to.
const STANCE = { armR: [-0.55, 0.15, -0.85], armL: [-0.35, 0, 0.2], torso: [0.1, 0.2, 0], head: [0, 0], crouch: 0, lift: 0 };

// Keyframes for the swing styles: the cocked pose and the end of the sweep. torso is [pitch, yaw,
// roll]; crouch lowers the hips and bends the knees; lift hops the whole frame; spin turns it.
const SWINGS = {
  // Big diagonal cuts: the torso winds up against the arm, then whips through with the hips dropping.
  slashR: {
    cock: { armR: [-2.6, 0.9, -1.3], armL: [-0.6, 0.2, 0.9], torso: [-0.18, 0.85, 0.1], head: [0.1, -0.5], crouch: 0.2, lift: 0 },
    end: { armR: [-0.4, -1.1, 1.0], armL: [-1.2, 0, -0.3], torso: [0.42, -0.9, -0.12], head: [0.1, 0.5], crouch: 0.8, lift: 0 },
  },
  slashL: {
    cock: { armR: [-2.3, -1.3, 0.5], armL: [-0.8, 0, 0.3], torso: [-0.18, -0.75, -0.1], head: [0.1, 0.5], crouch: 0.2, lift: 0 },
    end: { armR: [-0.4, 1.1, -1.3], armL: [-1.0, 0.3, 0.8], torso: [0.42, 0.85, 0.12], head: [0.1, -0.5], crouch: 0.8, lift: 0 },
  },
  // Rears up on its toes with both arms overhead, then slams down into a crouch.
  overhead: {
    cock: { armR: [-3.3, 0.1, -0.2], armL: [-3.0, -0.1, 0.4], torso: [-0.55, 0, 0], head: [-0.4, 0], crouch: -0.6, lift: 2.5 },
    end: { armR: [0.5, 0, -0.1], armL: [0.3, 0, 0.3], torso: [0.8, 0, 0], head: [0.3, 0], crouch: 1.8, lift: 0 },
  },
  // A full turn with the blade held level, finishing low.
  spin: {
    cock: { armR: [-1.4, 1.6, -1.2], armL: [-1.0, -0.4, 0.8], torso: [-0.1, 1.1, 0.15], head: [0, -0.6], crouch: 0.4, lift: 0 },
    end: { armR: [-1.3, -1.4, -0.2], armL: [-1.0, 0.4, 0.5], torso: [0.3, -1.1, -0.15], head: [0, 0.4], crouch: 1.0, lift: 1.2 },
    spin: -TAU,
  },
};

const blendPose = (a, b, t) => ({ armR: mix3(a.armR, b.armR, t), armL: mix3(a.armL, b.armL, t), torso: mix3(a.torso, b.torso, t), head: [mix(a.head[0], b.head[0], t), mix(a.head[1], b.head[1], t)], crouch: mix(a.crouch, b.crouch, t), lift: mix(a.lift, b.lift, t) });

export function animateMech(mech, state, dt) {
  const n = (name) => mech.nodes.get(name);
  const rest = (name) => mech.rest.get(name);
  const s = clamp(state.speed / (state.runSpeed || 1), 0, 1);
  const stride = 14;                                   // metres per full gait cycle
  const air = !state.onGround;
  const melee = state.melee;

  if (!air) mech.phase += (state.speed / stride) * dt * TAU;
  else mech.phase += dt * 1.5;
  const ph = mech.phase;
  const swing = Math.sin(ph), swing2 = Math.sin(ph + Math.PI);

  // pose(name, rx, ry, rz, k): ease a node toward rest + offset; k = 1 sets it outright.
  const pose = (name, rx, ry, rz, k) => {
    const o = n(name), r = rest(name);
    if (!o) return;
    const kk = k == null ? 1 - Math.exp(-14 * dt) : k;
    o.rotation.x += (r.rot.x + rx - o.rotation.x) * kk;
    o.rotation.y += (r.rot.y + ry - o.rotation.y) * kk;
    o.rotation.z += (r.rot.z + rz - o.rotation.z) * kk;
  };

  // ---- the swing, if any: a pose along the keyframes plus a blade flare, a hop and a spin
  let sw = null, flare = 0;
  mech.rootYaw = 0; mech.rootLift = 0;
  if (melee) {
    const kf = SWINGS[melee.style] || SWINGS.slashR;
    const p = clamp(melee.progress || 0, 0, 1);
    if (melee.stage === 'lunge' || melee.stage === 'windup') {
      // Cocking (during the lunge: while closing in, leaning into the charge).
      const t = easeOut(p);
      sw = blendPose(STANCE, kf.cock, t);
      if (melee.stage === 'lunge') { sw.torso = [sw.torso[0] + 0.35 * (1 - t * 0.5), sw.torso[1], sw.torso[2]]; sw.lift *= 0.5; }
      flare = 0.35 + 0.65 * t;
    } else if (melee.stage === 'active') {
      const t = easeOutCubic(p);
      sw = blendPose(kf.cock, kf.end, t);
      flare = 1;
      if (kf.spin) mech.rootYaw = kf.spin * 0.7 * t;
    } else {
      const t = easeIn(p);
      sw = blendPose(kf.end, STANCE, t);
      flare = 1 - t;
      if (kf.spin) mech.rootYaw = kf.spin * (0.7 + 0.3 * easeOut(p));
    }
    mech.rootLift = sw.lift;
  }

  // ---- legs and body: locomotion, or planted for a swing
  if (melee && melee.stage === 'lunge') {
    pose('thighL', 0.6, 0, 0.08, 1 - Math.exp(-25 * dt)); pose('thighR', -0.4, 0, -0.08, 1 - Math.exp(-25 * dt));
    pose('shinL', 1.0, 0, 0); pose('shinR', 0.5, 0, 0);
  } else if (sw && !air) {
    const c = sw.crouch;
    pose('thighL', 0.25 + c * 0.45, 0, 0.12, 1); pose('thighR', -0.2 + c * 0.45, 0, -0.12, 1);
    pose('shinL', 0.35 + c * 0.8, 0, 0, 1); pose('shinR', 0.5 + c * 0.8, 0, 0, 1);
  } else if (air) {
    pose('thighL', 0.35, 0, 0.05); pose('thighR', 0.35, 0, -0.05);
    pose('shinL', 0.55, 0, 0); pose('shinR', 0.55, 0, 0);
  } else {
    pose('thighL', swing * 0.75 * s, 0, 0); pose('thighR', swing2 * 0.75 * s, 0, 0);
    pose('shinL', Math.max(0, -swing) * 1.1 * s, 0, 0); pose('shinR', Math.max(0, -swing2) * 1.1 * s, 0, 0);
  }

  // ---- arms and torso: one owner per frame, in priority order
  let armL = [air ? -0.5 : swing2 * 0.55 * s, 0, air ? 0.25 : 0.1 * s];
  let armR = [air ? -0.5 : swing * 0.55 * s, 0, air ? -0.25 : -0.1 * s];
  let torso = [air ? clamp(-state.vy * 0.004, -0.25, 0.3) + s * 0.25 : 0.14 * s, 0, 0];
  let head = [0, 0, 0];
  let snap = false;                                    // true: set the pose outright instead of easing
  if (state.boosting) { armL[0] -= 0.3; armR[0] -= 0.3; }
  if (state.dashing) { torso = [0.45, 0, 0]; armL = [-0.9, 0, 0.4]; armR = [-0.9, 0, -0.4]; snap = true; }

  if (state.active === 'melee' && !melee && !state.aiming && !state.guard) {
    // Ready stance: sword arm out to the side, blade raised and visible from behind.
    armR = STANCE.armR; armL = STANCE.armL; torso = [torso[0], 0.2, 0];
  }
  if (sw) { armR = sw.armR; armL = sw.armL; torso = sw.torso; head = [sw.head[0], sw.head[1], 0]; snap = true; }
  if (state.aiming) {
    head = [-state.aimPitch * 0.6, 0, 0];
    armR = [-Math.PI / 2 - state.aimPitch, 0, 0];
    armL = [-1.1 - state.aimPitch * 0.5, 0.5, 0.6];   // supporting hand on the launcher
  }
  if (state.guard) { armL = [-1.3, 0.6, 0.9]; armR = [-1.3, -0.6, -0.9]; torso = [0.1, 0, 0]; }
  // Firing recoil: a hard kick that eases back; the heavy guns throw the shoulder and torso.
  const recoilDur = state.firedKind === 'vulcan' ? 0.1 : 0.2;
  if (state.firedT < recoilDur) {
    const k = Math.pow(1 - state.firedT / recoilDur, 1.5);
    if (state.firedKind === 'vulcan') torso = [torso[0] - 0.1 * k, torso[1] + (Math.sin(state.firedT * 90) * 0.03), torso[2]];
    else {
      const heavy = state.firedKind === 'longrifle' ? 1.3 : state.firedKind === 'rocket' ? 1.1 : 0.8;
      armR = [armR[0] + 0.7 * k * heavy, armR[1], armR[2] + 0.12 * k];
      armL = [armL[0] + 0.3 * k * heavy, armL[1], armL[2]];
      torso = [torso[0] - 0.32 * k * heavy, torso[1] + 0.08 * k, torso[2]];
      head = [head[0] - 0.2 * k, head[1], head[2]];
    }
  }
  // Hit reaction overrides the rest: thrown back, arms up, head snaps.
  if (state.hitT < 0.3) {
    const k = (1 - state.hitT / 0.3) * (state.hitHeavy ? 1.3 : 1);
    torso = [-0.55 * k, (state.hitSide || 0) * 0.45 * k, 0];
    armL = [-0.9 * k, 0, 0.7 * k]; armR = [-0.9 * k, 0, -0.7 * k];
    head = [-0.35 * k, 0, 0];
    snap = true;
  } else if (state.stun > 0) torso = [-0.3, torso[1], 0];

  const k = snap ? 1 : null;
  pose('armL', armL[0], armL[1], armL[2], k); pose('armR', armR[0], armR[1], armR[2], k);
  pose('torso', torso[0], torso[1], torso[2], k); pose('head', head[0], head[1], head[2], k);

  // ---- weapons: of the models in the hand, show the one in use
  const hand = n('weaponR');
  if (hand) for (const w of hand.children) w.visible = false;
  const rifle = n((state.rangedId || 'rifle') + 'R') || n('rifleR');
  const blade = n((state.meleeId || 'blade') + 'R') || n('bladeR');
  const aura = blade ? blade.getObjectByName('auraR') : null;
  mech.activeMelee = blade;
  if (rifle) rifle.visible = state.active === 'ranged' && !state.dead;
  if (blade) {
    blade.visible = state.active === 'melee' && !state.dead;
    if (melee) {
      // Fixed in the fist: a thrust during the lunge, raised a little so the sweep clears the body; held
      // flat for the spin.
      blade.rotation.set(melee.stage === 'lunge' ? 0 : melee.style === 'spin' ? 0.1 : 0.45, 0, 0);
    } else if (blade.visible && blade.parent) {
      // Ready stance: stand the blade up beside the head in mech space, whatever the arm is doing, so it
      // reads from behind and from the side.
      blade.parent.updateWorldMatrix(true, false);
      blade.parent.getWorldQuaternion(tmpQ);
      mech.group.getWorldQuaternion(tmpQ2);
      tmpV.set(0.3, 0.95, -0.3).normalize().applyQuaternion(tmpQ2);
      tmpQ3.setFromUnitVectors(FORWARD, tmpV);
      blade.quaternion.copy(tmpQ).invert().multiply(tmpQ3);
    }
  }
  // The blade flares while it is cocked and swung: brighter edge, a taller glow sheet.
  if (mech.materials.blade && !state.dead) {
    const target = 2.2 + 5 * flare;
    mech.materials.blade.emissiveIntensity += (target - mech.materials.blade.emissiveIntensity) * (flare > 0 ? 1 : 1 - Math.exp(-10 * dt));
    mech.materials.aura.opacity = 0.3 + 0.55 * flare;
    if (aura) { aura.scale.y = 1 + 1.6 * flare; aura.scale.x = 1 + 3 * flare; }
  }

  // ---- hit flash: armour glows white for a moment
  if (mech.flash > 0) {
    mech.flash = Math.max(0, mech.flash - dt);
    const f = mech.flash / 0.18;
    for (const key of ['armor', 'armor2']) mech.materials[key].emissive.setScalar(f * 0.9);
  } else if (mech.materials.armor.emissive.r > 0) {
    mech.materials.armor.emissive.setScalar(0); mech.materials.armor2.emissive.setScalar(0);
  }

  // ---- knocked out: the frame slumps forward and its lights go out
  if (state.dead) {
    mech.group.rotation.x += (1.35 - mech.group.rotation.x) * (1 - Math.exp(-4 * dt));
    mech.materials.glow.emissiveIntensity += (0.1 - mech.materials.glow.emissiveIntensity) * (1 - Math.exp(-3 * dt));
    if (mech.materials.blade) mech.materials.blade.emissiveIntensity = mech.materials.glow.emissiveIntensity;
    return;
  } else if (mech.group.rotation.x !== 0) {
    mech.group.rotation.x = 0;
    mech.materials.glow.emissiveIntensity = 2.2;
  }

  // ---- torso bob while running, squat on a hard landing, crouch into a swing, jolt when hit
  const torsoNode = n('torso');
  if (torsoNode) {
    const r = rest('torso');
    const bob = air ? 0 : Math.abs(Math.sin(ph * 2)) * 0.35 * s;
    const squat = state.landLag > 0 ? -1.2 : 0;
    const crouch = sw ? -sw.crouch * 1.1 : 0;
    const jolt = state.hitT < 0.3 ? -0.6 * (1 - state.hitT / 0.3) : 0;
    const target = r.pos.y + bob + squat + crouch + jolt;
    torsoNode.position.y += (target - torsoNode.position.y) * (sw ? 1 : 1 - Math.exp(-18 * dt));
  }

  // ---- thrusters: wings spread and flames stretch while boosting, dashing or lunging
  const thrust = state.boosting || state.dashing || (melee && melee.stage === 'lunge') ? 1 : air ? 0.35 : 0.12;
  for (const side of ['L', 'R']) {
    const flame = n('flame' + side);
    if (flame) {
      const flicker = 0.85 + 0.3 * Math.sin(ph * 23 + (side === 'L' ? 0 : 1.7));
      const target = thrust * flicker;
      flame.scale.y += (target * 2.2 - flame.scale.y) * (1 - Math.exp(-20 * dt));
      flame.scale.x = flame.scale.z = 0.6 + flame.scale.y * 0.25;
      flame.visible = flame.scale.y > 0.15;
    }
    const sign = side === 'L' ? -1 : 1;
    const spread = state.boosting ? 0.55 : (melee && (melee.stage === 'lunge' || melee.stage === 'active')) ? 0.7 : air ? 0.3 : 0;
    pose('wing' + side, 0, 0, sign * spread, melee ? 1 : null);
  }
}
