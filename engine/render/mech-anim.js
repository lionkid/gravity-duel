// Procedural animation for mechs built by mech-builder. Works on node names, so any design with the
// same names (torso, head, thighL/R, shinL/R, armL/R, wingL/R, flameL/R, rifleR, bladeR) animates
// the same way.
//
//   state: { speed, runSpeed, onGround, boosting, dashing, vy, landLag, aiming, aimPitch,
//            active ('melee' | 'vulcan' | 'ranged'), guard, stun, dead,
//            melee: null | { stage: 'lunge' | 'windup' | 'active' | 'recovery', progress 0..1, style: 'slashR' | 'slashL' | 'overhead' },
//            bladeScale [x, y, z], gunScale [x, y, z],
//            hitT (seconds since last hit, Infinity if none), hitSide (-1 | 0 | 1), hitHeavy,
//            firedT (seconds since last shot), firedKind }
//   mech.flash (seconds) is set by the game when the mech is hit and fades here.

import * as THREE from 'three';
import { clamp, TAU } from '../core/math.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion(), tmpV = new THREE.Vector3();

const mix = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;

// Keyframes for the three swing styles: [armR x, y, z, torso x, y, armL x] at the cocked position
// and at the end of the sweep.
const SWINGS = {
  slashR: { cock: [-2.5, 0.7, -1.1, -0.1, 0.65, -0.4], end: [-0.5, -0.9, 0.9, 0.35, -0.75, 0.3] },
  slashL: { cock: [-2.2, -1.1, 0.4, -0.1, -0.55, -0.6], end: [-0.5, 0.9, -1.1, 0.35, 0.7, 0.2] },
  overhead: { cock: [-3.1, 0, -0.15, -0.3, 0, -2.2], end: [0.4, 0, -0.1, 0.6, 0, 0.3] },
};

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

  // ---- legs and body: locomotion
  if (melee && melee.stage === 'lunge') {
    pose('thighL', 0.5, 0, 0.08, 1 - Math.exp(-25 * dt)); pose('thighR', -0.3, 0, -0.08, 1 - Math.exp(-25 * dt));
    pose('shinL', 0.9, 0, 0); pose('shinR', 0.4, 0, 0);
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
    armR = [-0.55, 0.15, -0.85]; armL = [-0.35, 0, 0.2]; torso = [torso[0], 0.2, 0];
  }
  if (melee) {
    const kf = SWINGS[melee.style] || SWINGS.slashR;
    const p = clamp(melee.progress || 0, 0, 1);
    snap = true;
    if (melee.stage === 'lunge') { armR = [-1.6, 0.4, -1.1]; armL = [-1.2, 0, 0.6]; torso = [0.45, 0.2, 0]; }
    else if (melee.stage === 'windup') { const t = easeOut(p); armR = [mix(-0.55, kf.cock[0], t), mix(0.15, kf.cock[1], t), mix(-0.85, kf.cock[2], t)]; torso = [mix(0.1, kf.cock[3], t), mix(0.2, kf.cock[4], t), 0]; armL = [mix(-0.35, kf.cock[5], t), 0, 0.2]; }
    else if (melee.stage === 'active') { const t = easeOut(p); armR = [mix(kf.cock[0], kf.end[0], t), mix(kf.cock[1], kf.end[1], t), mix(kf.cock[2], kf.end[2], t)]; torso = [mix(kf.cock[3], kf.end[3], t), mix(kf.cock[4], kf.end[4], t), 0]; armL = [mix(kf.cock[5], kf.end[5], t), 0, 0.2]; }
    else { const t = easeIn(p); armR = [mix(kf.end[0], -0.55, t), mix(kf.end[1], 0.15, t), mix(kf.end[2], -0.85, t)]; torso = [mix(kf.end[3], 0.1, t), mix(kf.end[4], 0.2, t), 0]; armL = [mix(kf.end[5], -0.35, t), 0, 0.2]; }
  }
  if (state.aiming) {
    head = [-state.aimPitch * 0.6, 0, 0];
    armR = [-Math.PI / 2 - state.aimPitch, 0, 0];
    armL = [-1.1 - state.aimPitch * 0.5, 0.5, 0.6];   // supporting hand on the launcher
  }
  if (state.guard) { armL = [-1.3, 0.6, 0.9]; armR = [-1.3, -0.6, -0.9]; torso = [0.1, 0, 0]; }
  // Firing recoil: a short kick that eases back.
  if (state.firedT < 0.12) {
    const k = 1 - state.firedT / 0.12;
    if (state.firedKind === 'vulcan') torso = [torso[0] - 0.08 * k, torso[1], torso[2]];
    else { armR = [armR[0] + 0.45 * k, armR[1], armR[2]]; torso = [torso[0] - 0.22 * k, torso[1], torso[2]]; }
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

  // ---- weapons: show the one in use, scaled for the loadout's weapon
  const rifle = n('rifleR'), blade = n('bladeR');
  if (rifle) {
    rifle.visible = state.active === 'ranged' && !state.dead;
    if (state.gunScale) rifle.scale.set(state.gunScale[0], state.gunScale[1], state.gunScale[2]);
  }
  if (blade) {
    blade.visible = state.active === 'melee' && !state.dead;
    if (state.bladeScale) blade.scale.set(state.bladeScale[0], state.bladeScale[1], state.bladeScale[2]);
    if (melee) {
      // Fixed in the fist: a thrust during the lunge, raised a little so the sweep clears the body.
      blade.rotation.set(melee.stage === 'lunge' ? 0 : 0.45, 0, 0);
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
    return;
  } else if (mech.group.rotation.x !== 0) {
    mech.group.rotation.x = 0;
    mech.materials.glow.emissiveIntensity = 2.2;
  }

  // ---- torso bob while running, squat on a hard landing, jolt when hit
  const torsoNode = n('torso');
  if (torsoNode) {
    const r = rest('torso');
    const bob = air ? 0 : Math.abs(Math.sin(ph * 2)) * 0.35 * s;
    const squat = state.landLag > 0 ? -1.2 : 0;
    const jolt = state.hitT < 0.3 ? -0.6 * (1 - state.hitT / 0.3) : 0;
    torsoNode.position.y += (r.pos.y + bob + squat + jolt - torsoNode.position.y) * (1 - Math.exp(-18 * dt));
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
    pose('wing' + side, 0, 0, sign * (state.boosting ? 0.55 : air ? 0.3 : 0));
  }
}
