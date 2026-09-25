/* Gravity Duel - static game data and tuning constants.
 * Everything balance-related lives here so later milestones can tweak numbers in one place. */
(function (GD) {
  'use strict';

  GD.VERSION = 'M1';
  GD.DT = 1 / 60;                 // fixed physics step in seconds (60 Hz)
  GD.MAX_STEPS_PER_FRAME = 5;     // avoid spiral of death after a long frame

  // Logical arena size in pixels. The canvas is scaled to fit the page.
  GD.ARENA = { w: 960, h: 540, groundY: 470, ceilingY: 60 };  // ceilingY keeps mechs below the HUD

  // Gravity is in px/s^2. 1260 px/s^2 is our "1.0 G".
  GD.STAGES = {
    earth: {
      id: 'earth', name: 'EARTH', label: 'EARTH · 1.0 G', gravity: 1260,
      // One-way platforms: x = left edge, y = top surface.
      platforms: [
        { x: 230, y: 360, w: 150, h: 14 },
        { x: 580, y: 360, w: 150, h: 14 },
        { x: 415, y: 250, w: 130, h: 14 },
      ],
    },
    space: {
      id: 'space', name: 'SPACE', label: 'SPACE · 0 G', gravity: 0,
      platforms: [],
    },
  };

  GD.START = {
    earth: { 1: { x: 170, y: 470 }, 2: { x: 790, y: 470 } },
    space: { 1: { x: 200, y: 320 }, 2: { x: 760, y: 320 } },
  };

  // Five stats always sum to 20 (balance rule from the design doc).
  GD.MECHS = [
    { id: 'ax01', code: 'AX-01',   name: 'VANGUARD',  role: '全能型',   hp: 4, spd: 4, arm: 4, en: 4, bst: 4, color: '#e9eef5', accent: '#3a7bff', eye: '#7fffb0' },
    { id: 'ax07', code: 'AX-07',   name: 'BASTION',   role: '重裝型',   hp: 5, spd: 2, arm: 5, en: 4, bst: 4, color: '#d84a3a', accent: '#f4d35e', eye: '#7fffb0' },
    { id: 'zr06', code: 'ZR-06',   name: 'WRAITH',    role: '高機動型', hp: 3, spd: 5, arm: 2, en: 4, bst: 6, color: '#b4413a', accent: '#3a3a3a', eye: '#ff4d6d' },
    { id: 'lx79', code: 'LX-79',   name: 'LANCER',    role: '光束特化', hp: 3, spd: 4, arm: 3, en: 6, bst: 4, color: '#c9d3dd', accent: '#e8453c', eye: '#7fffb0' },
  ];

  GD.TUNING = {
    hitbox: { w: 44, h: 84 },
    groundAccel: 2600,        // px/s^2 toward target walk speed
    airAccel: 1300,
    maxFall: 900,
    coyoteTime: 0.08,         // can still jump shortly after walking off a ledge
    jumpBuffer: 0.10,         // a jump pressed just before landing still fires
    boostStartVy: -150,       // holding jump engages the booster near the jump apex
    boostRiseCap: -220,
    hoverCost: 38,            // fuel per second while boosting on Earth
    dashCost: 22,
    dashTime: 0.18,
    dashCooldown: 0.45,
    fuelRegenGround: 55,
    fuelRegenSpace: 14,
    spaceRegenDelay: 0.6,     // seconds without thrust before fuel regenerates in space
    overheatRecover: 0.3,     // overheated booster unlocks again at 30% fuel
    heavyLandVy: 720,         // landing faster than this causes landing lag
    landLag: 0.12,
    dropThroughTime: 0.25,
    softPushMax: 12,          // max px per step when two mechs overlap on Earth
    space: {
      drag: 0.15,             // light passive drag so matches stay readable
      overspeedDrag: 2.0,
      thrustCost: 10,
      boostCost: 30,
      boostMul: 1.8,
      brakeDecel: 700,
      brakeCost: 18,
      wallBounce: 0.4,
      mechBounce: 0.5,
    },
  };

  // Keyboard bindings use KeyboardEvent.code so they are layout independent.
  // P2 accepts both numpad keys and a laptop-friendly set at the same time.
  GD.BINDINGS = {
    1: {
      up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      attack: ['KeyF'], jump: ['KeyG'], guard: ['KeyH'], switch: ['KeyR'], dash: ['ShiftLeft'],
    },
    2: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      attack: ['Numpad1', 'KeyK'], jump: ['Numpad2', 'KeyL'], guard: ['Numpad3', 'Semicolon'],
      switch: ['Numpad5', 'KeyO'], dash: ['Numpad0', 'Slash'],
    },
  };

  GD.ACTIONS = [
    { id: 'up', label: '上' }, { id: 'down', label: '下' }, { id: 'left', label: '左' }, { id: 'right', label: '右' },
    { id: 'jump', label: '跳躍/推進' }, { id: 'dash', label: '衝刺' }, { id: 'guard', label: '防禦' },
    { id: 'attack', label: '攻擊' }, { id: 'switch', label: '切換' },
  ];

  GD.KEY_LABELS = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift',
    Semicolon: ';', Slash: '/',
  };
  GD.keyLabel = function (code) {
    if (GD.KEY_LABELS[code]) return GD.KEY_LABELS[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  };
})(globalThis.GD = globalThis.GD || {});
