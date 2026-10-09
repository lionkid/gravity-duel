import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapper } from '../input/bindings.js';

const BINDINGS = {
  move: { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  look: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
  actions: { boost: ['Space', 'Pad:A'], attack: ['KeyJ', 'Mouse0', 'Pad:RT'], aim: ['KeyK', 'Mouse2', 'Pad:LT'], dash: ['KeyL', 'Pad:B'], guard: ['Pad:LB'], lock: ['KeyF', 'Pad:RB'], switchNext: ['WheelDown', 'Pad:Y'], switchPrev: ['WheelUp'], switch1: ['Digit1'], switch2: [], switch3: [], pause: ['Escape', 'Pad:Start'], rematch: ['KeyR'] },
  pad: { lookRate: { yaw: 3, pitch: 2 }, curve: 1 },
  touch: { lookSensitivity: 0.01 },
};
const fakes = () => {
  const keys = new Set(); let kp = new Set();
  const keyboard = { isDown: (c) => keys.has(c), consumePressed: () => { const p = kp; kp = new Set(); return p; }, press(c) { keys.add(c); kp.add(c); }, release(c) { keys.delete(c); } };
  const mouse = { dx: 0, dy: 0, wheel: 0, downs: new Set(), isDown(c) { return this.downs.has(c); }, consume() { const r = { dx: this.dx, dy: this.dy, wheel: this.wheel, pressed: new Set() }; this.dx = this.dy = this.wheel = 0; return r; } };
  const gamepad = { downs: new Set(), pp: new Set(), axes: { lx: 0, ly: 0, rx: 0, ry: 0 }, polled: 0, poll() { this.polled++; }, isDown(n) { return this.downs.has(n); }, axis(n) { return this.axes[n]; }, consumePressed() { const p = this.pp; this.pp = new Set(); return p; } };
  const touch = { stick: { x: 0, y: 0 }, downs: new Set(), pp: new Set(), look: { dx: 0, dy: 0 }, isDown(a) { return this.downs.has(a); }, consumePressed() { const p = this.pp; this.pp = new Set(); return p; }, consumeLook() { const d = { ...this.look }; this.look.dx = this.look.dy = 0; return d; } };
  return { keyboard, mouse, gamepad, touch };
};

test('gamepad buttons and sticks drive the intent like keys and the mouse do', () => {
  const f = fakes();
  const look = { yaw: 0, pitch: 0 };
  const mapper = createMapper({ ...f, bindings: BINDINGS, look, sensitivity: 0.001 });
  f.gamepad.downs.add('A'); f.gamepad.pp.add('A'); f.gamepad.downs.add('RT'); f.gamepad.pp.add('Start');
  f.gamepad.axes.lx = 1;                      // full right on the left stick
  const it = mapper.sample(1 / 60);
  assert.equal(f.gamepad.polled, 1);
  assert.ok(it.held.boost && it.pressed.boost && it.held.attack && it.pressed.pause && !it.pressed.attack);
  assert.ok(Math.abs(it.move.x - 1) < 1e-9 && Math.abs(it.move.z) < 1e-9, `moves right of the camera, got ${it.move.x}, ${it.move.z}`);
  f.gamepad.axes.lx = 0; f.gamepad.axes.rx = 0.5;   // look right at half rate
  mapper.sample(1 / 60);
  assert.ok(look.yaw < 0, 'right stick turns the view right (negative yaw)');
  assert.ok(Math.abs(look.yaw + 0.5 * 3 / 60) < 1e-9);
  // Keys win over the stick when both are used.
  f.keyboard.press('KeyW');
  const it2 = mapper.sample(1 / 60);
  assert.ok(it2.move.z < -0.9 && Math.abs(it2.move.x) < 0.1, 'W moves forward (−z) even with the stick held right');
});

test('touch stick, drag and toggled buttons feed the same intent', () => {
  const f = fakes();
  const look = { yaw: 0, pitch: 0 };
  const mapper = createMapper({ keyboard: f.keyboard, mouse: null, gamepad: null, touch: f.touch, bindings: BINDINGS, look });
  f.touch.stick.x = 0; f.touch.stick.y = -1;           // pushed up: forward
  f.touch.downs.add('aim'); f.touch.downs.add('attack'); f.touch.pp.add('attack');
  const it = mapper.sample(1 / 60);
  assert.ok(it.move.z < -0.99, 'touch stick up moves forward');
  assert.ok(it.held.aim && it.held.attack && it.pressed.attack);
  f.touch.stick.y = 0; f.touch.look.dx = 100;
  mapper.sample(1 / 60);
  assert.ok(Math.abs(look.yaw + 1) < 1e-9, 'a 100 px drag turns 1 rad at 0.01 rad/px');
  const it2 = mapper.sample(1 / 60);
  assert.ok(!it2.pressed.attack && it2.held.attack, 'the press is an edge, the hold stays');
});

test('invert Y flips mouse, stick and touch pitch together', () => {
  const f = fakes();
  const look = { yaw: 0, pitch: 0 };
  const mapper = createMapper({ ...f, bindings: BINDINGS, look, sensitivity: 0.001 });
  f.mouse.dy = 10;                                      // mouse down
  mapper.sample(1 / 60);
  assert.ok(look.pitch < 0, 'mouse down looks down');
  mapper.settings.invertY = true;
  look.pitch = 0; f.mouse.dy = 10; f.gamepad.axes.ry = 1;
  mapper.sample(1 / 60);
  assert.ok(look.pitch > 0, 'inverted: down looks up');
});
