// Intents on the wire: a flat array [moveX, moveZ, aimYaw, aimPitch, heldBits, pressedBits]. Numbers
// travel as JSON doubles (exact), so both ends of a LAN match feed the simulation identical values.
// Negative zero is normalised away: Math.atan2(-0, -1) and Math.atan2(0, -1) differ, and that would
// be enough to split two copies of a match.

import { HELD, PRESSED, createIntent } from '../input/intent.js';

export function encodeIntent(i) {
  let h = 0, p = 0;
  for (let k = 0; k < HELD.length; k++) if (i.held[HELD[k]]) h |= 1 << k;
  for (let k = 0; k < PRESSED.length; k++) if (i.pressed[PRESSED[k]]) p |= 1 << k;
  return [i.move.x + 0, i.move.z + 0, i.aim.yaw + 0, i.aim.pitch + 0, h, p];
}

export function decodeIntent(a, out = createIntent()) {
  out.move.x = a[0] || 0; out.move.z = a[1] || 0;
  out.aim.yaw = a[2] || 0; out.aim.pitch = a[3] || 0;
  const h = a[4] | 0, p = a[5] | 0;
  for (let k = 0; k < HELD.length; k++) out.held[HELD[k]] = (h & (1 << k)) !== 0;
  for (let k = 0; k < PRESSED.length; k++) out.pressed[PRESSED[k]] = (p & (1 << k)) !== 0;
  return out;
}

export const IDLE_ENCODED = Object.freeze([0, 0, 0, 0, 0, 0]);

// The same input held on: movement, view and held buttons continue, presses do not repeat.
export const carryOf = (enc) => (enc ? [enc[0], enc[1], enc[2], enc[3], enc[4], 0] : IDLE_ENCODED);

export const sameEncoded = (a, b) => !!a && !!b && a.length === b.length && a.every((v, k) => v === b[k]);
