// Turns raw keyboard and mouse state into one Intent per tick, driven by a game-provided binding table:
//
//   { move:    { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
//     look:    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
//     actions: { boost: ['Space'], attack: ['KeyJ', 'Mouse0'], aim: ['KeyK', 'Mouse2'], ... } }
//
// `look` is the player's view angles. The mapper owns them (mouse deltas and arrow keys change them),
// the camera rig reads them, and the Intent carries them as `aim`. Movement keys are relative to the
// camera yaw passed in, so "forward" is always where the player looks.

import { createIntent, clearIntent, HELD, PRESSED } from './intent.js';
import { yawToDir, rightOfYaw, clamp, wrapAngle } from '../core/math.js';

export function createMapper({ keyboard, mouse, bindings, look, sensitivity = 0.0022, keyLookRate = { yaw: 2.4, pitch: 1.6 },
  pitchLimits = [-1.2, 1.1], invertY = false }) {
  const intent = createIntent();
  const codesOf = (name) => (bindings.actions && bindings.actions[name]) || [];
  const settings = { sensitivity, invertY };

  function anyDown(codes, mouseDown) {
    for (const c of codes) {
      if (c.startsWith('Mouse')) { if (mouseDown && mouseDown(c)) return true; } else if (keyboard.isDown(c)) return true;
    }
    return false;
  }
  function anyPressed(codes, kp, m) {
    for (const c of codes) {
      if (c === 'WheelDown') { if (m.wheel > 0) return true; } else if (c === 'WheelUp') { if (m.wheel < 0) return true; } else if (kp.has(c) || m.pressed.has(c)) return true;
    }
    return false;
  }

  return {
    settings,
    sample(dt, cameraYaw) {
      clearIntent(intent);
      const m = mouse ? mouse.consume() : { dx: 0, dy: 0, wheel: 0, pressed: new Set() };
      const kp = keyboard.consumePressed();

      // View angles: mouse first, arrow keys as the fallback (both can be used at once).
      let yawDelta = -m.dx * settings.sensitivity;
      let pitchDelta = -m.dy * settings.sensitivity * (settings.invertY ? -1 : 1);
      const lk = bindings.look || {};
      if (anyDown(lk.left || [])) yawDelta += keyLookRate.yaw * dt;
      if (anyDown(lk.right || [])) yawDelta -= keyLookRate.yaw * dt;
      if (anyDown(lk.up || [])) pitchDelta += keyLookRate.pitch * dt;
      if (anyDown(lk.down || [])) pitchDelta -= keyLookRate.pitch * dt;
      look.yaw = wrapAngle(look.yaw + yawDelta);
      look.pitch = clamp(look.pitch + pitchDelta, pitchLimits[0], pitchLimits[1]);
      intent.aim.yaw = look.yaw;
      intent.aim.pitch = look.pitch;

      // Movement keys → camera-relative → world direction. By default the camera yaw is the view yaw just
      // updated above; a lock-on camera passes its own yaw instead.
      const cy = cameraYaw == null ? look.yaw : cameraYaw;
      const mv = bindings.move || {};
      const lz = (anyDown(mv.forward || []) ? 1 : 0) - (anyDown(mv.back || []) ? 1 : 0);
      const lx = (anyDown(mv.right || []) ? 1 : 0) - (anyDown(mv.left || []) ? 1 : 0);
      if (lx || lz) {
        const f = yawToDir(cy), r = rightOfYaw(cy);
        let x = f.x * lz + r.x * lx, z = f.z * lz + r.z * lx;
        const l = Math.hypot(x, z);
        if (l > 1) { x /= l; z /= l; }
        intent.move.x = x; intent.move.z = z;
      }

      const md = mouse ? mouse.isDown : null;
      for (const a of HELD) intent.held[a] = anyDown(codesOf(a), md);
      for (const a of PRESSED) intent.pressed[a] = anyPressed(codesOf(a), kp, m);
      return intent;
    },
  };
}
