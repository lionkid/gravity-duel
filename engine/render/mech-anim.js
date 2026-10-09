// Procedural animation for mechs built by mech-builder. Works on node names, so any design with the
// same names (torso, head, thighL/R, shinL/R, armL/R, wingL/R, flameL/R) animates the same way.
//
//   state: { speed, runSpeed, onGround, boosting, dashing, vy, landLag, aiming, aimPitch }

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

  // Aiming: the head and torso follow the pitch; the right arm raises the weapon.
  if (state.aiming) {
    pose('head', -state.aimPitch * 0.6, 0, 0);
    pose('armR', -Math.PI / 2 - state.aimPitch, 0, 0, 1 - Math.exp(-20 * dt));
  } else {
    pose('head', 0, 0, 0);
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
