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

// Weapon classes: what the player picks. Every mech carries the vulcan plus one ranged and one melee
// weapon; the class decides which ones. Armour trades one damage kind against the other.
export const WEAPON_CLASSES = {
  normal: { id: 'normal', zh: '普通', desc: '火箭砲與光劍，兩頭都能打' },
  ranged: { id: 'ranged', zh: '遠程', desc: '長距離步槍一擊 135，近戰只有短刀' },
  melee: { id: 'melee', zh: '近戰', desc: '巨劍一擊 280、起手有霸體，遠程只有會下墜的手砲' },
};
export const ARMORS = {
  normal: { id: 'normal', zh: '標準裝甲', desc: '沒有弱點，而且是最快的一套', ranged: 1, light: 1, melee: 1, speed: 1.08 },
  antiRanged: { id: 'antiRanged', zh: '防遠程', desc: '遠程 ×0.8、火神砲 ×0.7，近戰 ×1.45，慢', ranged: 0.8, light: 0.7, melee: 1.45, speed: 0.88 },
  antiMelee: { id: 'antiMelee', zh: '防近戰', desc: '近戰 ×0.6，遠程 ×1.05、火神砲 ×1.08', ranged: 1.05, light: 1.08, melee: 0.6, speed: 0.97 },
};
export const WEAPONS = {
  // Hip-fired straight ahead along the body, level: no aiming, so height differences beat it.
  // A stream of small rockets: visible in flight, a little pop on impact.
  vulcan: { id: 'vulcan', zh: '火神砲', kind: 'light', dmg: 8, rate: 8, spread: 0.05, range: 150, speed: 260, gravityScale: 0.15, heatTime: 3, cool: 0.6, overheatUntil: 0.4, stun: 0.04, knock: 4, color: 0xffb060, look: 'rocketS' },
  // Fired only while aiming in first person, along the view angles.
  ranged: {
    normal: { id: 'rocket', zh: '火箭砲', kind: 'ranged', dmg: 95, interval: 0.9, speed: 380, gravityScale: 0.1, energy: 30, energyMax: 100, regen: 18, zoomFov: 40, aimMoveMul: 0.6, ttl: 2.5, stun: 0.35, knock: 16, color: 0xff9a4a, look: 'rocketM' },
    ranged: { id: 'longrifle', zh: '長距離步槍', kind: 'ranged', dmg: 135, interval: 1.9, speed: 900, gravityScale: 0, energy: 38, energyMax: 100, regen: 18, zoomFov: 30, aimMoveMul: 0.4, ttl: 2, stun: 0.45, knock: 20, color: 0xa0ffea, look: 'bolt' },
    melee: { id: 'handcannon', zh: '手砲', kind: 'ranged', dmg: 36, interval: 0.5, speed: 260, gravityScale: 0.5, energy: 18, energyMax: 100, regen: 25, zoomFov: 45, aimMoveMul: 0.7, ttl: 3, stun: 0.15, knock: 8, color: 0xffd27a, look: 'shell' },
  },
  // Lock-on lunge then swing. combo lists the swings in order (style: how the arm moves, knock: how
  // far the hit throws); reach/width is the hit box ahead. Later swings step in so a combo connects.
  melee: {
    normal: { id: 'saber', zh: '光劍', kind: 'melee', combo: [{ dmg: 120, windup: 0.14, active: 0.14, recovery: 0.26, style: 'slashR', knock: 8 }, { dmg: 120, windup: 0.12, active: 0.14, recovery: 0.26, style: 'slashL', knock: 8 }, { dmg: 180, windup: 0.2, active: 0.16, recovery: 0.42, style: 'overhead', knock: 30 }], lungeRange: 45, lungeDist: 30, lungeSpeed: 120, stepSpeed: 40, reach: 14, width: 14, stun: 0.35, superArmor: false, guardBreak: false, color: 0x58e0ff, bladeScale: [1, 1, 1] },
    melee: { id: 'greatblade', zh: '巨劍', kind: 'melee', combo: [{ dmg: 280, windup: 0.38, active: 0.18, recovery: 0.55, style: 'overhead', knock: 34 }], lungeRange: 50, lungeDist: 40, lungeSpeed: 130, stepSpeed: 40, reach: 17, width: 18, stun: 0.6, superArmor: true, guardBreak: true, color: 0xff7a3d, bladeScale: [1.8, 1.25, 1.8] },
    ranged: { id: 'knife', zh: '短刀', kind: 'melee', combo: [{ dmg: 90, windup: 0.1, active: 0.12, recovery: 0.2, style: 'slashR', knock: 6 }, { dmg: 90, windup: 0.1, active: 0.12, recovery: 0.3, style: 'slashL', knock: 16 }], lungeRange: 30, lungeDist: 20, lungeSpeed: 110, stepSpeed: 40, reach: 11, width: 12, stun: 0.2, superArmor: false, guardBreak: false, color: 0xd9b24c, bladeScale: [0.7, 0.6, 0.7] },
  },
};
export const SLOTS = ['melee', 'vulcan', 'ranged'];      // the order the 1 / 2 / 3 keys and the HUD use
export const COMBAT = {
  hp: 1200,
  switchDraw: 0.3,        // seconds after a switch before the new weapon can attack
  switchCooldown: 2.5,    // seconds before switching again
  guardMul: 0.5,
  guardBreakStun: 0.8,
  muzzleHeight: 13,       // vulcan and rifle leave the body at chest height
  lockLose: 3,            // seconds without line of sight before lock-on drops
  lockRange: 500,
  maxStun: 1.0,
  separate: 10,           // push apart when fighters overlap (m/s)
};

export const STAGES = {
  // dusk: the match starts in late afternoon (start, 0 = noon … 1 = night) and reaches night after toNight seconds.
  city: { id: 'city', name: 'Skyline City', zh: '天際城', gravity: 32, blocks: 8, pitch: 120, street: 44, minHeight: 25, maxHeight: 130, stepHeight: 45, dusk: { start: 0.08, toNight: 150 } },
};

export const CAMERA = {
  tp: { distance: 44, pivotHeight: 14, radius: 2.5, fov: 55 },
  // Lock-on: behind and above the player, pulling back and up as the opponent gets farther so both stay in frame.
  lock: { distance: 42, height: 18, farDistance: 30, farHeight: 24, lookWeight: 0.42, pivotHeight: 14, fov: 58 },
  fp: { eyeHeight: 16, forward: 3, fov: 40 },
  blend: 0.22,
  pitchDefault: -0.32,
  sensitivity: 0.0012,          // radians per pixel at the 1.0 slider setting
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
    rematch: ['KeyR'],
    switch1: ['Digit1'], switch2: ['Digit2'], switch3: ['Digit3'],
    switchNext: ['WheelDown', 'KeyE'], switchPrev: ['WheelUp', 'KeyQ'],
    pause: ['Escape'],
  },
};

// Key hints shown on the start panel and in help; label → keys.
export const KEY_HINTS = [
  ['移動', 'W A S D'], ['鏡頭／準星', '滑鼠（或方向鍵）'], ['跳躍／噴射', 'Space（按住）'], ['衝刺', 'Shift / L'],
  ['攻擊', '左鍵 / J'], ['瞄準（第一人稱，遠程才能開火）', '右鍵 / K（按住）'], ['切換武器', '滾輪 / 1 2 3'],
  ['防禦', 'Ctrl / ;'], ['鎖定切換', 'F'], ['再戰', 'R'], ['暫停', 'Esc'],
];
