// Gravity Duel: Skyline — every tunable in one place. Units are metres and seconds; mechs are 18 m tall.

export const GAME = { id: 'skyline', name: 'Gravity Duel: Skyline', version: '0.1.0' };

export const BODY = { w: 10, h: 18, d: 10 };

export const MOVE = {
  run: 28,              // top speed on the ground
  accelGround: 140,
  decelGround: 170,
  accelAir: 36,         // air control
  airMax: 30,
  airBleed: 60,         // how fast speed above airMax decays in the air (after a dash)
  jump: 20,             // take-off speed when boost is pressed on the ground
  boostAccel: 58,       // thruster acceleration while boost is held (gravity still applies)
  maxRise: 45,
  fuelMax: 3,           // seconds of thrust
  fuelRegen: 1.6,       // per second, on the ground
  fuelRegenDelay: 0.4,
  terminal: 95,
  dash: 60,
  dashTime: 0.3,
  dashCooldown: 1.2,
  dashFuel: 0.8,
  stepUp: 2,
  snap: 1.2,
  turnRate: 10,         // rad/s, body turning toward the movement direction
  aimTurnRate: 18,      // rad/s, body following the view while aiming
  aimMoveMul: 0.6,      // movement speed while aiming
  landLagSpeed: 40,     // impact speed that costs a landing recovery
  landLag: 0.14,
  inputBuffer: 0.15,    // seconds a press stays valid
};

export const STAGES = {
  city: { id: 'city', name: 'Skyline City', zh: '天際城', gravity: 32, blocks: 8, pitch: 100, street: 30, minHeight: 25, maxHeight: 130, stepHeight: 45 },
};

export const CAMERA = {
  tp: { distance: 42, pivotHeight: 14, radius: 2.5, fov: 55 },
  fp: { eyeHeight: 16, forward: 3, fov: 40 },
  blend: 0.22,
  sensitivity: 0.0022,
  keyLookRate: { yaw: 2.4, pitch: 1.6 },
  pitchLimits: [-1.2, 1.1],
};

export const PALETTES = {
  steel: { armor: 0x4a5c80, armor2: 0x1f2638, trim: 0xd9b24c, glow: 0x58e0ff, dark: 0x15171c },
  crimson: { armor: 0x7a2330, armor2: 0x2a1418, trim: 0xe8e2cf, glow: 0xff7a3d, dark: 0x1a1214 },
};

// Keyboard + mouse. Mouse0 / Mouse2 are the left and right buttons; WheelUp / WheelDown the wheel.
export const BINDINGS = {
  move: { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  look: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
  actions: {
    boost: ['Space'],
    attack: ['KeyJ', 'Mouse0'],
    aim: ['KeyK', 'Mouse2'],
    dash: ['KeyL', 'ShiftLeft', 'ShiftRight'],
    guard: ['Semicolon', 'ControlLeft'],
    lock: ['KeyF'],
    switch1: ['Digit1'], switch2: ['Digit2'], switch3: ['Digit3'],
    switchNext: ['WheelDown', 'KeyE'], switchPrev: ['WheelUp', 'KeyQ'],
    pause: ['Escape'],
  },
};

// Key hints shown on the start panel and in help; label → keys.
export const KEY_HINTS = [
  ['移動', 'W A S D'], ['鏡頭／準星', '滑鼠（或方向鍵）'], ['跳躍／噴射', 'Space（按住）'], ['衝刺', 'Shift / L'],
  ['瞄準（第一人稱）', '右鍵 / K（按住）'], ['攻擊', '左鍵 / J'], ['切換武器', '滾輪 / 1 2 3'], ['鎖定', 'F'], ['暫停', 'Esc'],
];
