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
  // ground: has a floor and walks; vacuum: no air (beams keep their power, blasts lose their shockwave,
  // heat leaves slowly); jumpScale: jump speed multiplier; recoil: how much firing pushes the shooter back.
  GD.STAGE_ORDER = ['earth', 'moon', 'space'];
  GD.STAGES = {
    earth: {
      id: 'earth', name: 'EARTH', zh: '地球', label: 'EARTH · 1.0 G', gravity: 1260,
      ground: true, vacuum: false, jumpScale: 1, recoil: { ground: 0, air: 0.3 },
      // One-way platforms: x = left edge, y = top surface.
      platforms: [
        { x: 230, y: 360, w: 150, h: 14 },
        { x: 580, y: 360, w: 150, h: 14 },
        { x: 415, y: 250, w: 130, h: 14 },
      ],
    },
    moon: {
      id: 'moon', name: 'MOON', zh: '月面基地', label: 'MOON · 0.17 G', gravity: 214,
      ground: true, vacuum: true, jumpScale: 0.6, recoil: { ground: 0.3, air: 0.7 },
      // Two tall towers and a high bridge: low gravity makes the upper level reachable with one jump.
      platforms: [
        { x: 130, y: 330, w: 140, h: 14 },
        { x: 690, y: 330, w: 140, h: 14 },
        { x: 390, y: 200, w: 180, h: 14 },
      ],
    },
    space: {
      id: 'space', name: 'SPACE', zh: '太空', label: 'SPACE · 0 G', gravity: 0,
      ground: false, vacuum: true, jumpScale: 1, recoil: { ground: 1, air: 1 },
      platforms: [],
    },
  };

  GD.START = {
    earth: { 1: { x: 170, y: 470 }, 2: { x: 790, y: 470 } },
    moon: { 1: { x: 170, y: 470 }, 2: { x: 790, y: 470 } },
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
  // st[stage] = { aff, pro, con }: every weapon has a concrete weakness on every stage (aff: good | even | bad).
  // recoil: px/s pushed back on the shooter, scaled by the stage recoil factor.
  GD.RANGED = [
    { id: 'beam', name: 'BEAM RIFLE', zh: '光束步槍', kind: 'projectile', dmg: 70, speed: 900, g: 0.0, cooldown: 0.55, energy: 30, ammo: Infinity,
      knock: 180, stun: 0.25, radius: 4, color: '#ff5ad6', trail: 46, passPlatforms: true, lifetime: 1.6, aimSpread: 30,
      falloff: 0.45, recoil: 60, note: '每發耗 30 能量，能量不夠就打不出來',
      st: {
        earth: { aff: 'even', pro: '不受重力，彈道最好預測', con: '大氣會削弱光束，越遠傷害越低' },
        moon:  { aff: 'good', pro: '真空不衰減，彈道筆直', con: '真空散熱慢，能量回復變慢' },
        space: { aff: 'even', pro: '真空不衰減，彈道筆直', con: '能量回復變慢，後座力讓你後退' },
      } },
    { id: 'bazooka', name: 'HYPER BAZOOKA', zh: '火箭砲', kind: 'projectile', dmg: 140, speed: 560, g: 1.0, cooldown: 1.0, energy: 0, ammo: 4, reload: 2.2,
      knock: 440, stun: 0.45, radius: 8, color: '#ffb347', blast: 120, blastDmg: 55, shootable: true, lifetime: 6, aimSpread: 30,
      recoil: 160, note: '爆風半徑 120，可以被子彈擊落',
      st: {
        earth: { aff: 'bad', pro: '爆風完整，打地面也能炸到人', con: '明顯下墜，要跳起來往上拋射' },
        moon:  { aff: 'even', pro: '幾乎直線飛行', con: '真空爆風變小，後座力會推動機體' },
        space: { aff: 'even', pro: '直線飛行，直擊傷害最高', con: '真空爆風變小，飛得慢會被火神砲攔截' },
      } },
    { id: 'mg', name: 'MACHINE GUN', zh: '機槍', kind: 'projectile', dmg: 10, speed: 720, g: 0.6, cooldown: 0.1, energy: 0, ammo: 45, reload: 0.15, auto: true,
      knock: 20, stun: 0.02, radius: 3, color: '#ffe066', spread: 5, lifetime: 3, aimSpread: 30, light: true,
      recoil: 16, note: '按住連射，45 發；小口徑對高裝甲吃虧',
      st: {
        earth: { aff: 'even', pro: '站在地上連射不受後座力影響', con: '小口徑被裝甲克制，打重裝機很痛苦' },
        moon:  { aff: 'even', pro: '彈道接近直線', con: '連射後座力會把你推離地面' },
        space: { aff: 'even', pro: '子彈直線飛行', con: '連射後座力會讓你一直往後飄' },
      } },
    { id: 'grenade', name: 'CRACKER', zh: '榴彈', kind: 'projectile', dmg: 80, speed: 560, g: 1.5, cooldown: 0.75, energy: 0, ammo: 6, reload: 1.8,
      knock: 340, stun: 0.45, radius: 7, color: '#7fff7f', blast: 150, blastDmg: 90, selfDamage: true, fuse: 3.0, lob: -35, lifetime: 6, aimSpread: 25,
      wallBurst: true, recoil: 90, note: '爆風半徑 150，碰到地面或邊界就爆，也會炸到自己；體積小打不下來',
      st: {
        earth: { aff: 'good', pro: '拋物線越過平台，爆風最大', con: '彈速慢容易被閃開，太近會炸到自己' },
        moon:  { aff: 'even', pro: '可以拋到很遠', con: '重力太小會拋過頭，要壓低射角' },
        space: { aff: 'even', pro: '撞到邊界或 3 秒後空爆', con: '無法拋投，真空爆風也變小' },
      } },
  ];
  GD.MELEE = [
    { id: 'saber', name: 'BEAM SABER', zh: '光束軍刀', kind: 'melee', style: 'saber', dmg: 190, windup: 0.10, active: 0.15, recovery: 0.41,
      range: 70, dashRange: 35, knock: 420, stun: 0.45, color: '#ff7a1a', iframes: 0.067, guardMul: 0.25, note: '出刀瞬間 4 幀無敵',
      st: {
        earth: { aff: 'good', pro: '出刀最快，跳斬好用', con: '距離最短，要貼身才打得到' },
        moon:  { aff: 'even', pro: '從上方跳斬切入', con: '滯空太久，落地前容易被射' },
        space: { aff: 'bad', pro: '衝刺斬最穩', con: '接近要燒燃料，被長槍拉開距離很吃虧' },
      } },
    { id: 'axe', name: 'HEAT AXE', zh: '熱能戰斧', kind: 'melee', style: 'axe', dmg: 280, windup: 0.2, active: 0.14, recovery: 0.48,
      range: 64, dashRange: 30, knock: 560, stun: 0.65, color: '#ff4d2a', iframes: 0, guardMul: 0.5, superArmor: true,
      note: '對方防禦也會吃一半傷害；揮動中被打不會中斷',
      st: {
        earth: { aff: 'even', pro: '站穩重擊，揮動中不會被打斷', con: '前搖長，軍刀可以先砍到你' },
        moon:  { aff: 'even', pro: '破防重擊', con: '前搖長加上慢速落地，時機難抓' },
        space: { aff: 'even', pro: '一擊傷害最高，霸體硬吃子彈', con: '漂移中前搖長，很容易揮空' },
      } },
    { id: 'lance', name: 'BEAM LANCE', zh: '光束長槍', kind: 'melee', style: 'lance', dmg: 195, windup: 0.15, active: 0.2, recovery: 0.4,
      range: 130, dashRange: 40, knock: 380, stun: 0.4, color: '#5ad2ff', iframes: 0, guardMul: 0.25, note: '攻擊距離 130，傷害較低',
      st: {
        earth: { aff: 'bad', pro: '距離最長，壓制落地點', con: '只刺得到中段，跳起來的對手刺不到' },
        moon:  { aff: 'even', pro: '距離長，等對手落下再刺', con: '對手跳得高，高度一錯開就刺空' },
        space: { aff: 'good', pro: '直線突刺配合慣性衝鋒', con: '刺擊範圍窄，上下錯開就落空' },
      } },
  ];
  GD.WEAPONS = GD.RANGED.concat(GD.MELEE);
  GD.aff = (w, stageId) => (w.st && w.st[stageId] ? w.st[stageId].aff : 'even');
  // Head vulcan: built into every frame, fired with its own key in either weapon mode.
  GD.VULCAN = { id: 'vulcan', name: 'VULCAN', zh: '火神砲', kind: 'projectile', dmg: 6, speed: 820, g: 0.5, cooldown: 0.07, energy: 0, ammo: 48, reload: 0.2, auto: true,
    knock: 12, stun: 0.04, radius: 2, color: '#fff3a8', spread: 4, lifetime: 2.5, aimSpread: 30, muzzle: [10, 80], light: true, recoil: 6 };

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
    beamFalloffRange: 700,             // in air, beam damage drops by `falloff` over this distance
    vacuumBlast: 0.65,                 // blast radius multiplier without air
    vacuumBlastDmg: 0.8,               // blast damage multiplier without air
    vacuumEnergyRegen: 0.5,            // energy recovers slower without air to carry heat away
    lightArmorMul: 1.6,                // armor counts this much more against light rounds (MG, vulcan)
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
