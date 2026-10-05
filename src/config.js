/* Gravity Duel - static game data and tuning constants.
 * Everything balance-related lives here so later milestones can tweak numbers in one place. */
(function (GD) {
  'use strict';

  GD.VERSION = 'M3';
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
    { id: 'ax01', code: 'AX-01',   name: 'VANGUARD',  role: '全能型',   hp: 4, spd: 4, arm: 4, en: 4, bst: 4, color: '#e9eef5', accent: '#3a7bff', eye: '#7fffb0',
      weak: '沒有突出強項，勝負看配裝與場景判斷。' },
    { id: 'ax07', code: 'AX-07',   name: 'BASTION',   role: '重裝型',   hp: 5, spd: 2, arm: 5, en: 4, bst: 4, color: '#d84a3a', accent: '#f4d35e', eye: '#7fffb0',
      weak: '速度最慢，太空中很容易被繞到背後。' },
    { id: 'zr06', code: 'ZR-06',   name: 'WRAITH',    role: '高機動型', hp: 3, spd: 5, arm: 2, en: 4, bst: 6, color: '#b4413a', accent: '#3a3a3a', eye: '#ff4d6d',
      weak: '裝甲最薄，被爆風擦到就掉一大截。' },
    { id: 'lx79', code: 'LX-79',   name: 'LANCER',    role: '光束特化', hp: 3, spd: 4, arm: 3, en: 6, bst: 4, color: '#c9d3dd', accent: '#e8453c', eye: '#7fffb0',
      weak: '能量最多但 HP 低，被貼身時很難反制。' },
  ];

  GD.TUNING = {
    hitbox: { w: 44, h: 84 },
    groundAccel: 2600,        // px/s^2 toward target walk speed
    airAccel: 1300,
    maxFall: 900,
    coyoteTime: 0.08,         // can still jump shortly after walking off a ledge
    jumpBuffer: 0.10,         // a jump pressed just before landing still fires
    boostStartVy: -150,       // holding up engages the jet near the jump apex
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
    dropHoldTime: 0.2,        // hold down this long on a platform to drop through it
    inputBuffer: 0.15,        // attack, dash and swap pressed this early still fire the moment they are ready
    softPushMax: 12,          // max px per step when two mechs overlap on Earth
    space: {
      drag: 0.15,             // light passive drag so matches stay readable
      overspeedDrag: 2.0,
      thrustCost: 10,
      brakeDecel: 700,          // guarding in space fires retro thrusters
      brakeCost: 18,
      wallBounce: 0.4,
      mechBounce: 0.5,
    },
  };

  // ---- Combat ----
  // Each frame carries one ranged and one melee weapon and swaps between them in battle.
  // Gravity coefficient g: projectile fall = stage gravity × COMBAT.gravityScale × g. Speeds px/s, times s.
  // earth / space: 'good' | 'even' | 'bad' affinity shown on the loadout screen.
  GD.RANGED = [
    { id: 'beam', name: 'BEAM RIFLE', zh: '光束步槍', kind: 'projectile', dmg: 70, speed: 900, g: 0.0, cooldown: 0.55, energy: 30, ammo: Infinity,
      knock: 180, stun: 0.25, radius: 4, color: '#ff5ad6', trail: 46, passPlatforms: true, lifetime: 1.6, aimSpread: 30,
      earth: 'even', space: 'even', earthNote: '不受重力，彈道最好預測', spaceNote: '不受重力，彈道最好預測', note: '每發耗 30 能量，能量不夠就打不出來' },
    { id: 'bazooka', name: 'HYPER BAZOOKA', zh: '火箭砲', kind: 'projectile', dmg: 130, speed: 520, g: 1.0, cooldown: 1.1, energy: 0, ammo: 4, reload: 2.4,
      knock: 440, stun: 0.45, radius: 8, color: '#ffb347', blast: 120, blastDmg: 55, shootable: true, lifetime: 6, aimSpread: 30,
      earth: 'bad', space: 'good', earthNote: '明顯下墜，要跳起來往上拋射', spaceNote: '直線飛行，最強遠距武器', note: '爆風半徑 120，可以被子彈擊落' },
    { id: 'mg', name: 'MACHINE GUN', zh: '機槍', kind: 'projectile', dmg: 15, speed: 720, g: 0.6, cooldown: 0.09, energy: 0, ammo: 60, reload: 0.12, auto: true,
      knock: 35, stun: 0.08, radius: 3, color: '#ffe066', spread: 3, lifetime: 3, aimSpread: 30,
      earth: 'good', space: 'even', earthNote: '略微下墜，近中距離壓制', spaceNote: '直線飛行，但單發傷害低', note: '按住連射，60 發' },
    { id: 'grenade', name: 'CRACKER', zh: '榴彈', kind: 'projectile', dmg: 90, speed: 560, g: 1.5, cooldown: 0.9, energy: 0, ammo: 6, reload: 2.0,
      knock: 340, stun: 0.4, radius: 7, color: '#7fff7f', blast: 150, blastDmg: 75, selfDamage: true, fuse: 3.0, lob: -35, shootable: true, lifetime: 6, aimSpread: 25,
      wallBurst: true,
      earth: 'good', space: 'bad', earthNote: '拋物線越過平台，落地爆炸', spaceNote: '無法拋投，撞到場地邊界才爆', note: '爆風半徑 150，碰到地面或邊界就爆，也會炸到自己' },
  ];
  GD.MELEE = [
    { id: 'saber', name: 'BEAM SABER', zh: '光束軍刀', kind: 'melee', style: 'saber', dmg: 220, windup: 0.10, active: 0.15, recovery: 0.30,
      range: 70, dashRange: 30, knock: 420, stun: 0.45, color: '#ff7a1a', iframes: 0.067, guardMul: 0.25,
      earth: 'even', space: 'even', earthNote: '出刀最快，跳斬好用', spaceNote: '衝刺斬最穩', note: '出刀瞬間 4 幀無敵' },
    { id: 'axe', name: 'HEAT AXE', zh: '熱能戰斧', kind: 'melee', style: 'axe', dmg: 300, windup: 0.24, active: 0.14, recovery: 0.50,
      range: 58, dashRange: 26, knock: 560, stun: 0.65, color: '#ff4d2a', iframes: 0, guardMul: 0.5,
      earth: 'good', space: 'bad', earthNote: '站穩重擊，破防最強', spaceNote: '前搖長，漂移中容易揮空', note: '對方防禦也會吃一半傷害' },
    { id: 'lance', name: 'BEAM LANCE', zh: '光束長槍', kind: 'melee', style: 'lance', dmg: 170, windup: 0.14, active: 0.18, recovery: 0.38,
      range: 120, dashRange: 40, knock: 380, stun: 0.4, color: '#5ad2ff', iframes: 0, guardMul: 0.25,
      earth: 'even', space: 'good', earthNote: '長距離刺擊，壓制落地點', spaceNote: '直線突刺，配合慣性衝鋒', note: '攻擊距離 120，傷害較低' },
  ];
  GD.WEAPONS = GD.RANGED.concat(GD.MELEE);
  // Head vulcan: built into every frame, fired with its own key in either weapon mode.
  GD.VULCAN = { id: 'vulcan', name: 'VULCAN', zh: '火神砲', kind: 'projectile', dmg: 6, speed: 820, g: 0.5, cooldown: 0.07, energy: 0, ammo: 48, reload: 0.2, auto: true,
    knock: 12, stun: 0.04, radius: 2, color: '#fff3a8', spread: 4, lifetime: 2.5, aimSpread: 30, muzzle: [10, 80] };

  GD.COMBAT = {
    muzzleX: 30, muzzleY: 52,          // offset from feet center
    gravityScale: 0.5,                 // projectiles feel half the stage gravity; the mech jump tuning stays separate
    reloadDelay: 1.0,                  // seconds without firing before rounds come back
    switchLag: 0.3,                    // weapon draw time after a swap, cannot attack
    switchCooldown: 3.0,               // seconds before the next ranged ⇄ melee swap
    armorPerPoint: 0.06,               // damage × (1 - armor × this)
    guardDamage: 0.25, guardStun: 0.3, guardKnock: 0.3,  // melee weapons may override guardDamage via guardMul
    knockUpEarth: 0.35,                // fraction of knockback that lifts the target on Earth
    spaceKnockMul: 1.25,
    hitstunFriction: 0.3,
    energyRegenBase: 12, energyRegenPerPoint: 3,
    lowEnergyFlash: 0.4,
    projectileVsProjectile: 20,        // extra hit radius when shooting down rockets (vulcan fires from head height)
    koFallStun: 1.0,
  };

  // Keyboard bindings use KeyboardEvent.code so they are layout independent.
  // Each player's actions sit in one compact 2x3 block next to their movement keys, same shape for both:
  //   switch dash      P1  R T     P2  Num4 Num5  or  O P
  //   attack vulcan        F G         Num1 Num2      L ;
  //   guard                V           Num0           .
  // P2 accepts the numpad block and the laptop block at the same time.
  GD.BINDINGS = {
    1: {
      up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
      attack: ['KeyF'], sub: ['KeyG'], switch: ['KeyR'], dash: ['KeyT'], guard: ['KeyV'],
    },
    2: {
      up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
      attack: ['Numpad1', 'KeyL'], sub: ['Numpad2', 'Semicolon'], switch: ['Numpad4', 'KeyO'],
      dash: ['Numpad5', 'KeyP'], guard: ['Numpad0', 'Period'],
    },
  };

  GD.ACTIONS = [
    { id: 'up', label: '上・噴射' }, { id: 'down', label: '下' }, { id: 'left', label: '左' }, { id: 'right', label: '右' },
    { id: 'attack', label: '攻擊・確認' }, { id: 'sub', label: '火神砲・返回' }, { id: 'switch', label: '切換武器' },
    { id: 'guard', label: '防禦' }, { id: 'dash', label: '衝刺' },
  ];

  GD.KEY_LABELS = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift',
    Semicolon: ';', Slash: '/', Period: '.',
  };
  GD.keyLabel = function (code) {
    if (GD.KEY_LABELS[code]) return GD.KEY_LABELS[code];
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  };
})(globalThis.GD = globalThis.GD || {});
