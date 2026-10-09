// Procedural animation for mechs built by mech-builder. Works on node names, so any design with the
// same names (torso, head, thighL/R, shinL/R, armL/R, wingL/R, flameL/R) animates the same way.
//
//   state: { speed, runSpeed, onGround, boosting, dashing, vy, landLag, aiming, aimPitch,
//            active ('melee' | 'vulcan' | 'ranged'), melee ({ stage, t, combo } | null), guard, stun, dead }
//   mech.flash (seconds) is set by the game when the mech is hit and fades here.

import { clamp, TAU } from '../core/math.js';

export function animateMech(mech, state, dt) {
  const n = (name) => mech.nodes.get(name);
  const rest = (name) => mech.rest.get(name);
  const s = clamp(state.speed / (state.runSpeed || 1), 0, 1);
  const stride = 14;                                   // metres per full gait cycle
  const air = !state.onGround;

  if (!air) mech.phase += (state.speed / stride) * dt * TAU;
  else mech.phase += dt * 1.5;
  const ph = mech.phase;
  const swing = Math.sin(ph), swing2 = Math.sin(ph + Math.PI);

  const pose = (name, rx, ry, rz, k) => {
    const o = n(name), r = rest(name);
    if (!o) return;
    const kk = k == null ? 1 - Math.exp(-14 * dt) : k;
    o.rotation.x += (r.rot.x + rx - o.rotation.x) * kk;
    o.rotation.y += (r.rot.y + ry - o.rotation.y) * kk;
    o.rotation.z += (r.rot.z + rz - o.rotation.z) * kk;
  };

  if (air) {
    // Legs trail, knees bent; the body leans with vertical speed.
    pose('thighL', 0.35, 0, 0.05); pose('thighR', 0.35, 0, -0.05);
    pose('shinL', 0.55, 0, 0); pose('shinR', 0.55, 0, 0);
    pose('armL', -0.5 + (state.boosting ? -0.3 : 0), 0, 0.25); pose('armR', -0.5 + (state.boosting ? -0.3 : 0), 0, -0.25);
    pose('torso', clamp(-state.vy * 0.004, -0.25, 0.3) + s * 0.25, 0, 0);
  } else {
    pose('thighL', swing * 0.75 * s, 0, 0); pose('thighR', swing2 * 0.75 * s, 0, 0);
    pose('shinL', Math.max(0, -swing) * 1.1 * s, 0, 0); pose('shinR', Math.max(0, -swing2) * 1.1 * s, 0, 0);
    pose('armL', swing2 * 0.55 * s, 0, 0.1 * s); pose('armR', swing * 0.55 * s, 0, -0.1 * s);
    pose('torso', 0.14 * s, 0, 0);
  }
  if (state.dashing) { pose('torso', 0.45, 0, 0, 1); pose('armL', -0.9, 0, 0.4, 1); pose('armR', -0.9, 0, -0.4, 1); }

  // Weapons: show the one in use. The blade points up when drawn.
  const rifle = n('rifleR'), blade = n('bladeR');
  if (rifle) rifle.visible = state.active === 'ranged' && !state.dead;
  if (blade) { blade.visible = state.active === 'melee' && !state.dead; blade.rotation.x += (Math.PI - blade.rotation.x) * (1 - Math.exp(-12 * dt)); }

  // Aiming: the head and torso follow the pitch; the right arm raises the weapon.
  if (state.aiming) {
    pose('head', -state.aimPitch * 0.6, 0, 0);
    pose('armR', -Math.PI / 2 - state.aimPitch, 0, 0, 1 - Math.exp(-20 * dt));
  } else if (!state.melee) {
    pose('head', 0, 0, 0);
  }
  // Melee: wind up over the shoulder, then sweep across in the active frames.
  if (state.melee) {
    const m = state.melee;
    const k = 1 - Math.exp(-30 * dt);
    if (m.stage === 'lunge' || m.stage === 'windup') { pose('armR', -2.6, 0.5, -0.4, k); pose('torso', 0.1, 0.5, 0, k); }
    else if (m.stage === 'active') { pose('armR', -0.6 - m.combo * 0.2, -0.8, 0.5, k); pose('torso', 0.25, -0.6, 0, k); }
    else { pose('armR', -0.3, 0, 0.2, 1 - Math.exp(-10 * dt)); pose('torso', 0.1, 0, 0, 1 - Math.exp(-10 * dt)); }
  }
  // Guard: arms crossed in front; stun: knocked back.
  if (state.guard) { pose('armL', -1.3, 0.6, 0.9, 1 - Math.exp(-20 * dt)); pose('armR', -1.3, -0.6, -0.9, 1 - Math.exp(-20 * dt)); }
  if (state.stun > 0) pose('torso', -0.35, 0, 0, 1 - Math.exp(-20 * dt));

  // Hit flash: armour glows white for a moment.
  if (mech.flash > 0) {
    mech.flash = Math.max(0, mech.flash - dt);
    const k = mech.flash / 0.18;
    for (const key of ['armor', 'armor2']) { const mat = mech.materials[key]; mat.emissive.setScalar(k * 0.9); }
  } else if (mech.materials.armor.emissive.r > 0) {
    mech.materials.armor.emissive.setScalar(0); mech.materials.armor2.emissive.setScalar(0);
  }

  // Knocked out: the frame slumps forward and its lights go out.
  if (state.dead) {
    mech.group.rotation.x += (1.35 - mech.group.rotation.x) * (1 - Math.exp(-4 * dt));
    mech.materials.glow.emissiveIntensity += (0.1 - mech.materials.glow.emissiveIntensity) * (1 - Math.exp(-3 * dt));
    return;
  } else if (mech.group.rotation.x !== 0) {
    mech.group.rotation.x = 0;
    mech.materials.glow.emissiveIntensity = 2.2;
  }

  // Torso bob while running, squat on a hard landing.
  const torso = n('torso');
  if (torso) {
    const r = rest('torso');
    const bob = air ? 0 : Math.abs(Math.sin(ph * 2)) * 0.35 * s;
    const squat = state.landLag > 0 ? -1.2 : 0;
    torso.position.y += (r.pos.y + bob + squat - torso.position.y) * (1 - Math.exp(-18 * dt));
  }

  // Thrusters: wings spread and flames stretch while boosting or dashing.
  const thrust = state.boosting || state.dashing ? 1 : air ? 0.35 : 0.12;
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
