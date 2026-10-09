// Turns raw keyboard, mouse, gamepad and touch state into one Intent per tick, driven by a
// game-provided binding table:
//
//   { move:    { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
//     look:    { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
//     actions: { boost: ['Space', 'Pad:A'], attack: ['KeyJ', 'Mouse0', 'Pad:RT'], aim: ['KeyK', 'Mouse2', 'Pad:LT'], ... },
//     pad:     { lookRate: { yaw: 3.2, pitch: 2.2 }, curve: 1.6 },
//     touch:   { lookSensitivity: 0.006 } }
//
// Codes: KeyboardEvent.code, 'Mouse0'…'Mouse2', 'WheelUp' / 'WheelDown', 'Pad:<button>' (see gamepad.js).
// Touch buttons carry intent action names directly. `look` is the player's view angles. The mapper
// owns them (mouse, right stick, arrow keys and touch drags change them), the camera rig reads them,
// and the Intent carries them as `aim`. Movement keys and the left stick are relative to the camera
// yaw passed in, so "forward" is always where the player looks.

import { createIntent, clearIntent, HELD, PRESSED } from './intent.js';
import { yawToDir, rightOfYaw, clamp, wrapAngle } from '../core/math.js';

const EMPTY = new Set();
const curve = (v, k) => Math.sign(v) * Math.pow(Math.abs(v), k);

export function createMapper({ keyboard, mouse = null, gamepad = null, touch = null, bindings, look, sensitivity = 0.0022,
  keyLookRate = { yaw: 2.4, pitch: 1.6 }, pitchLimits = [-1.2, 1.1], invertY = false }) {
  const intent = createIntent();
  const codesOf = (name) => (bindings.actions && bindings.actions[name]) || [];
  const pad = bindings.pad || {};
  const settings = { sensitivity, invertY, padLookRate: pad.lookRate || { yaw: 3.2, pitch: 2.2 }, padCurve: pad.curve || 1.6, touchSensitivity: (bindings.touch && bindings.touch.lookSensitivity) || 0.006 };

  function anyDown(codes, action) {
    for (const c of codes) {
      if (c.startsWith('Mouse')) { if (mouse && mouse.isDown(c)) return true; }
      else if (c.startsWith('Pad:')) { if (gamepad && gamepad.isDown(c.slice(4))) return true; }
      else if (keyboard.isDown(c)) return true;
    }
    return !!(touch && action && touch.isDown(action));
  }
  function anyPressed(codes, action, kp, m, pp, tp) {
    for (const c of codes) {
      if (c === 'WheelDown') { if (m.wheel > 0) return true; }
      else if (c === 'WheelUp') { if (m.wheel < 0) return true; }
      else if (c.startsWith('Pad:')) { if (pp.has(c.slice(4))) return true; }
      else if (kp.has(c) || m.pressed.has(c)) return true;
    }
    return !!(touch && action && tp.has(action));
  }

  return {
    settings,
    sample(dt, cameraYaw) {
      clearIntent(intent);
      const m = mouse ? mouse.consume() : { dx: 0, dy: 0, wheel: 0, pressed: EMPTY };
      const kp = keyboard.consumePressed();
      if (gamepad) gamepad.poll();
      const pp = gamepad ? gamepad.consumePressed() : EMPTY;
      const tp = touch ? touch.consumePressed() : EMPTY;
      const tl = touch ? touch.consumeLook() : null;
      const invert = settings.invertY ? -1 : 1;
      // View angles: mouse and touch drags by distance, arrow keys and the right stick by rate.
      let yawDelta = -m.dx * settings.sensitivity;
      let pitchDelta = -m.dy * settings.sensitivity * invert;
      if (tl) { yawDelta -= tl.dx * settings.touchSensitivity; pitchDelta -= tl.dy * settings.touchSensitivity * invert; }
      const lk = bindings.look || {};
      if (anyDown(lk.left || [])) yawDelta += keyLookRate.yaw * dt;
      if (anyDown(lk.right || [])) yawDelta -= keyLookRate.yaw * dt;
      if (anyDown(lk.up || [])) pitchDelta += keyLookRate.pitch * dt;
      if (anyDown(lk.down || [])) pitchDelta -= keyLookRate.pitch * dt;
      if (gamepad) {
        yawDelta -= curve(gamepad.axis('rx'), settings.padCurve) * settings.padLookRate.yaw * dt;
        pitchDelta -= curve(gamepad.axis('ry'), settings.padCurve) * settings.padLookRate.pitch * dt * invert;
      }
      look.yaw = wrapAngle(look.yaw + yawDelta);
      look.pitch = clamp(look.pitch + pitchDelta, pitchLimits[0], pitchLimits[1]);
      intent.aim.yaw = look.yaw;
      intent.aim.pitch = look.pitch;
      // Movement: keys, else the left stick, else the touch stick → camera-relative → world direction.
      // By default the camera yaw is the view yaw just updated above; a lock-on camera passes its own.
      const cy = cameraYaw == null ? look.yaw : cameraYaw;
      const mv = bindings.move || {};
      let lz = (anyDown(mv.forward || []) ? 1 : 0) - (anyDown(mv.back || []) ? 1 : 0);
      let lx = (anyDown(mv.right || []) ? 1 : 0) - (anyDown(mv.left || []) ? 1 : 0);
      if (!lx && !lz && gamepad) { lx = gamepad.axis('lx'); lz = -gamepad.axis('ly'); }
      if (!lx && !lz && touch) { lx = touch.stick.x; lz = -touch.stick.y; }
      if (lx || lz) {
        const f = yawToDir(cy), r = rightOfYaw(cy);
        let x = f.x * lz + r.x * lx, z = f.z * lz + r.z * lx;
        const l = Math.hypot(x, z);
        if (l > 1) { x /= l; z /= l; }
        intent.move.x = x; intent.move.z = z;
      }
      for (const a of HELD) intent.held[a] = anyDown(codesOf(a), a);
      for (const a of PRESSED) intent.pressed[a] = anyPressed(codesOf(a), a, kp, m, pp, tp);
      return intent;
    },
  };
}
