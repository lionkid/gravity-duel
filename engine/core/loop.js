// Fixed-timestep game loop with render interpolation: the simulation always advances in dt steps
// (60 Hz by default) and the renderer draws between the last two states using alpha.
// Browser only (requestAnimationFrame); the simulation itself never needs this file.

export function createLoop({ dt = 1 / 60, maxSteps = 6, step, render }) {
  let acc = 0, last = 0, raf = 0, running = false;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    let frameDt = last ? (now - last) / 1000 : dt;
    last = now;
    if (frameDt > 0.25) frameDt = 0.25;        // the tab was hidden: do not try to catch up
    acc += frameDt;
    let steps = 0;
    while (acc >= dt && steps < maxSteps) { step(dt); acc -= dt; steps++; }
    if (steps === maxSteps) acc = 0;           // too slow to keep up: drop time instead of spiralling
    render(acc / dt, frameDt);
  }

  return {
    get running() { return running; },
    start() { if (running) return; running = true; last = 0; acc = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}
