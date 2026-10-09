// The one input shape every source produces: keyboard + mouse, gamepad, touch, the AI and a remote
// player all hand the simulation an Intent per tick, so the rules never know where input came from.
//
//   move    world-space direction on the ground plane, length 0..1 (the client already applied its camera yaw)
//   aim     absolute view angles; used for first-person aiming and for where ranged shots go
//   held    actions that matter while held down
//   pressed actions that matter on the frame they go down (the rules buffer them for a short while)

export const HELD = ['boost', 'attack', 'guard', 'aim'];
export const PRESSED = ['boost', 'attack', 'dash', 'guard', 'lock', 'switch1', 'switch2', 'switch3', 'switchNext', 'switchPrev', 'pause', 'rematch'];

export function createIntent() {
  const held = {}, pressed = {};
  for (const a of HELD) held[a] = false;
  for (const a of PRESSED) pressed[a] = false;
  return { move: { x: 0, z: 0 }, aim: { yaw: 0, pitch: 0 }, held, pressed };
}

export function clearIntent(i) {
  i.move.x = 0; i.move.z = 0;
  for (const a of HELD) i.held[a] = false;
  for (const a of PRESSED) i.pressed[a] = false;
  return i;
}

export function copyIntent(out, i) {
  out.move.x = i.move.x; out.move.z = i.move.z;
  out.aim.yaw = i.aim.yaw; out.aim.pitch = i.aim.pitch;
  for (const a of HELD) out.held[a] = !!i.held[a];
  for (const a of PRESSED) out.pressed[a] = !!i.pressed[a];
  return out;
}

// Shared "no input" intent. Read-only by convention: the simulation never mutates intents.
export const IDLE_INTENT = createIntent();
