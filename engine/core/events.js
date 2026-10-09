// Simulation → presentation events. The simulation only pushes plain records (a hit, a jump, a shot);
// the renderer and the audio layer consume them each tick, and in LAN play the host sends them along
// with the snapshot so the guest hears and sees the same things.

export function emit(world, type, data) {
  const e = { t: type };
  if (data) Object.assign(e, data);
  world.events.push(e);
  return e;
}

export function drain(world) {
  const events = world.events;
  world.events = [];
  return events;
}
