// Gravity Duel: Skyline — wires the engine and the game together: city, two mechs, input, cameras,
// HUD, effects. The simulation lives in rules/; everything here only reads it and feeds it Intents.

import * as THREE from 'three';
import { createLoop } from '../../engine/core/loop.js';
import { drain } from '../../engine/core/events.js';
import { lerpAngle, dirToAim, distXZ } from '../../engine/core/math.js';
import { createKeyboard } from '../../engine/input/keyboard.js';
import { createMouse } from '../../engine/input/mouse.js';
import { createMapper } from '../../engine/input/bindings.js';
import { IDLE_INTENT, createIntent, clearIntent } from '../../engine/input/intent.js';
import { createRenderApp } from '../../engine/render/app.js';
import { createThirdPersonRig, createFirstPersonRig, createLockOnRig, createCameraBlender } from '../../engine/render/rigs.js';
import { buildStageVisual, setNightEnvironment } from '../../engine/render/world-builder.js';
import { buildMech } from '../../engine/render/mech-builder.js';
import { animateMech } from '../../engine/render/mech-anim.js';
import { createBar, el, project } from '../../engine/render/hud.js';
import { createSky } from '../../engine/render/sky.js';
import { createBlobShadow, createTracers, createSparks, createSlashes, createProjectileView } from '../../engine/render/fx.js';
import { createPost } from '../../engine/render/post.js';
import * as CFG from './config.js';
import { generateCity } from './stages/city.js';
import { createWorld, stepWorld } from './rules/world.js';
import { weaponIn } from './rules/combat.js';
import { AX01, withPalette } from './mechs/ax01.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 7;
const pick = (table, value, fallback) => (value && table[value] ? value : fallback);

// Loadouts: the player's from the URL, then the last choice saved in this browser, then the defaults.
// The opponent's comes from the URL or the seed.
let stored = null;
try { stored = JSON.parse(localStorage.getItem('skyline.loadout') || 'null'); } catch (e) { stored = null; }
const loadout = {
  weapon: pick(CFG.WEAPON_CLASSES, params.get('weapon') || (stored && stored.weapon), 'normal'),
  armor: pick(CFG.ARMORS, params.get('armor') || (stored && stored.armor), 'normal'),
};
const wkeys = Object.keys(CFG.WEAPON_CLASSES), akeys = Object.keys(CFG.ARMORS);
const cpuLoadout = {
  weapon: pick(CFG.WEAPON_CLASSES, params.get('cpuWeapon'), wkeys[seed % 3]),
  armor: pick(CFG.ARMORS, params.get('cpuArmor'), akeys[(seed >> 2) % 3]),
};
const loadoutText = (l) => `${CFG.WEAPON_CLASSES[l.weapon].zh}武裝 · ${CFG.ARMORS[l.armor].zh}`;

// Stage and scene (built once; battles are restarted inside it).
const stage = generateCity(Object.assign({ seed }, CFG.STAGES.city));
const canvas = document.getElementById('game');
const app = createRenderApp(canvas, { fov: CFG.CAMERA.tp.fov });
setNightEnvironment(app.renderer, app.scene);
buildStageVisual(app.scene, stage);
const sky = createSky();
app.scene.add(sky.mesh);
const post = params.get('bloom') === '0' ? null : createPost(app, { strength: 0.42, radius: 0.3, threshold: 1.0 });
const mechs = [buildMech(AX01), buildMech(withPalette(AX01, CFG.PALETTES.crimson, 'ax01-crimson'))];
for (const m of mechs) app.scene.add(m.group);
const shadows = mechs.map(() => { const s = createBlobShadow(7); app.scene.add(s.mesh); return s; });
const tracers = createTracers(app.scene);
const sparks = createSparks(app.scene);
const slashes = createSlashes(app.scene);
const bolts = createProjectileView(app.scene);

// Input and cameras.
const keyboard = createKeyboard();
const mouse = createMouse(canvas);
const look = { yaw: 0, pitch: -0.18 };
const mapper = createMapper({ keyboard, mouse, bindings: CFG.BINDINGS, look, sensitivity: CFG.CAMERA.sensitivity,
  keyLookRate: CFG.CAMERA.keyLookRate, pitchLimits: CFG.CAMERA.pitchLimits });
const tpRig = createThirdPersonRig(app.camera, CFG.CAMERA.tp);
const fpRig = createFirstPersonRig(app.camera, CFG.CAMERA.fp);
const lockRig = createLockOnRig(app.camera, { distance: CFG.CAMERA.tp.distance, pivotHeight: CFG.CAMERA.tp.pivotHeight, fov: CFG.CAMERA.tp.fov });
const cam = createCameraBlender(app.camera, { time: CFG.CAMERA.blend });

// ---------------------------------------------------------------- HUD
const hud = document.getElementById('hud');
const top = el('div', 'top', hud);
const meBox = el('div', 'me', top);
el('div', 'name', meBox, 'AX-01 VANGUARD');
const meLoadout = el('div', 'loadout', meBox);
const hpBar = createBar(meBox, 'HP', 'hp');
const gauges = el('div', 'gauges', hud);
const fuelBar = createBar(gauges, 'FUEL', 'fuel');
const energyBar = createBar(gauges, 'ENERGY', 'energy');
const heatBar = createBar(gauges, 'HEAT', 'heat');
const weaponsBox = el('div', 'weapons', hud);
const slotEls = CFG.SLOTS.map((slot, i) => {
  const s = el('div', 'slot', weaponsBox);
  s.dataset.slot = slot;
  el('span', 'key', s, String(i + 1));
  el('span', 'wname', s, '');
  return s;
});
const enemyBox = el('div', 'enemy', hud);
const enemyName = el('div', 'name', enemyBox, '對手');
const enemyHp = createBar(enemyBox, '', 'hp');
const reticle = el('div', 'reticle', hud);
el('span', '', reticle, 'LOCK');
const lost = el('div', 'lost', hud);
const crosshair = el('div', 'crosshair', hud);
const hitmark = el('div', 'hitmark', hud);
const vignette = el('div', 'vignette', hud);
const msg = el('div', 'msg', hud);
const ko = el('div', 'ko', hud);
const koResult = el('div', 'result', ko);
el('div', 'hint', ko, '按 R 再戰');
const debug = el('div', 'debug', hud);
let showDebug = params.has('debug');
let hitmarkT = 0, vignetteT = 0, msgT = 0;
const showMsg = (text, t = 1.2) => { msg.textContent = text; msg.classList.add('on'); msgT = t; };

// Start panel with the loadout picker.
const overlay = document.getElementById('overlay');
const note = overlay.querySelector('.note');
const keys = overlay.querySelector('.keys');
for (const [label, key] of CFG.KEY_HINTS) { el('dt', '', keys, label); el('dd', '', keys, key); }
const picker = overlay.querySelector('.picker');
const pickerDesc = overlay.querySelector('.pickdesc');
let loadoutDirty = false;
function buildPicker() {
  picker.innerHTML = '';
  for (const [kind, table, zh] of [['weapon', CFG.WEAPON_CLASSES, '武裝'], ['armor', CFG.ARMORS, '裝甲']]) {
    const row = el('div', 'row', picker);
    el('span', 'rowlabel', row, zh);
    for (const [id, def] of Object.entries(table)) {
      const b = el('button', 'opt', row, def.zh);
      b.type = 'button';
      b.title = def.desc;
      b.classList.toggle('on', loadout[kind] === id);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        loadout[kind] = id;
        loadoutDirty = true;
        try { localStorage.setItem('skyline.loadout', JSON.stringify(loadout)); } catch (err) { /* private mode */ }
        buildPicker();
      });
    }
  }
  pickerDesc.textContent = `${CFG.WEAPON_CLASSES[loadout.weapon].desc}。${CFG.ARMORS[loadout.armor].desc}。`;
}
buildPicker();
overlay.querySelector('.cpu').textContent = `對手：${loadoutText(cpuLoadout)}`;

// ---------------------------------------------------------------- battle state
let world, me, enemy, prev, lastSeen = null;
function startBattle() {
  world = createWorld({ stage, seed, loadouts: { 1: loadout, 2: cpuLoadout } });
  me = world.fighters[0]; enemy = world.fighters[1];
  // Development: ?pos=x,y,z and ?look=yaw,pitch place the player and the camera for screenshots.
  if (params.get('pos')) { const [x, y, z] = params.get('pos').split(',').map(Number); Object.assign(me.pos, { x, y, z }); me.onGround = false; }
  look.yaw = stage.spawns[0].yaw; look.pitch = -0.18;
  if (params.get('look')) { const [yaw, pitch] = params.get('look').split(',').map(Number); look.yaw = yaw; look.pitch = pitch; }
  prev = world.fighters.map((f) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw }));
  world.fighters.forEach((f, i) => {
    const m = mechs[i];
    m.group.position.set(f.pos.x, f.pos.y, f.pos.z);
    m.group.rotation.set(0, f.yaw, 0);
    m.flash = 0;
    m.materials.glow.emissiveIntensity = 2.2;
  });
  for (const fx of [tracers, sparks, slashes, bolts]) fx.clear();
  lastSeen = null;
  loadoutDirty = false;
  ko.classList.remove('on');
  meLoadout.textContent = loadoutText(loadout);
  enemyName.textContent = `對手 · ${loadoutText(cpuLoadout)}`;
  slotEls.forEach((s, i) => { s.querySelector('.wname').textContent = weaponIn(me, CFG.SLOTS[i]).zh; });
  tpRig.reset(); lockRig.reset();
  cam.use(tpRig);
}
startBattle();

// Stand-in opponent until the real AI arrives in M3: paces the street and fires the vulcan whenever it
// sees the player. ?dummy=idle|walk|shoot|melee|ranged picks a single behaviour for testing.
const dummyMode = params.get('dummy') || 'basic';
const dummyIntent = createIntent();
let dummyT = 0;
function dummyStep(dt) {
  clearIntent(dummyIntent);
  dummyT += dt;
  if (enemy.dead || dummyMode === 'idle') return dummyIntent;
  const tick = world.tick;
  if (dummyMode === 'walk' || dummyMode === 'basic') dummyIntent.move.z = Math.sin(dummyT * 0.7) > 0 ? 1 : -1;
  if (dummyMode === 'shoot' || dummyMode === 'basic') dummyIntent.held.attack = enemy.lockLos && enemy.active === 'vulcan';
  if (dummyMode === 'melee') {
    if (enemy.active !== 'melee') dummyIntent.pressed.switch1 = tick % 30 === 0;
    else if (enemy.lock && !enemy.melee && distXZ(enemy.pos, me.pos) < 42) dummyIntent.pressed.attack = tick % 20 === 0;
  }
  if (dummyMode === 'ranged') {
    if (enemy.active !== 'ranged') dummyIntent.pressed.switch3 = tick % 30 === 0;
    else if (enemy.lockLos) {
      dummyIntent.held.aim = true;
      Object.assign(dummyIntent.aim, dirToAim({ x: me.pos.x - enemy.pos.x, y: me.pos.y + 11 - (enemy.pos.y + CFG.COMBAT.muzzleHeight + 2), z: me.pos.z - enemy.pos.z }));
      dummyIntent.pressed.attack = tick % 50 === 0;
    }
  }
  return dummyIntent;
}

// Start / pause overlay. Clicking the canvas captures the mouse; releasing it (Esc) brings the panel back.
let playing = false;
function setPlaying(on) {
  playing = on;
  overlay.classList.toggle('hidden', on);
  document.body.classList.toggle('playing', on);
  if (!on) keyboard.release();
  if (on && loadoutDirty) startBattle();
}
overlay.addEventListener('click', () => { setPlaying(true); mouse.requestLock(); });
canvas.addEventListener('click', () => { if (!playing) setPlaying(true); mouse.requestLock(); });
mouse.onLockChange((locked) => {
  if (!locked && playing && mouse.state.supported) setPlaying(false);
  if (!mouse.state.supported) note.textContent = '這裡無法鎖定滑鼠：用方向鍵控制鏡頭與準星。';
});
if (!mouse.state.supported) note.textContent = '這個瀏覽器沒有滑鼠鎖定：用方向鍵控制鏡頭與準星。';
window.addEventListener('keydown', (e) => { if (e.code === 'F3') { showDebug = !showDebug; e.preventDefault(); } });

// ---------------------------------------------------------------- events → effects
function handleEvent(e) {
  switch (e.t) {
    case 'tracer':
      tracers.spawn(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1, e.color);
      if (e.wall) sparks.burst(e.x1, e.y1, e.z1, 0xffd080, 3, 12, 0.25);
      break;
    case 'shot': sparks.burst(e.x, e.y, e.z, e.color, 8, 10, 0.2, 0); break;
    case 'impact': sparks.burst(e.x, e.y, e.z, e.color, e.body ? 28 : 16, e.body ? 40 : 25, 0.5); break;
    case 'slash': slashes.spawn(e.x, e.y, e.z, e.yaw, e.color, e.combo); break;
    case 'hit': {
      const m = mechs[e.id - 1];
      if (m) m.flash = 0.18;
      sparks.burst(e.x, e.y, e.z, e.guard ? 0x8fb3ff : 0xffb070, e.guard ? 10 : 22, 35, 0.45);
      if (e.by === me.id) hitmarkT = 0.12;
      if (e.id === me.id) vignetteT = 0.35;
      if (e.broke) showMsg(e.id === me.id ? '防禦被打破' : '破防');
      break;
    }
    case 'ko': {
      const f = world.fighters[e.id - 1];
      sparks.burst(f.pos.x, f.pos.y + 10, f.pos.z, 0xffe0a0, 180, 60, 1.4, 25);
      koResult.textContent = e.by === me.id ? 'WIN' : 'LOSE';
      ko.classList.toggle('lose', e.by !== me.id);
      ko.classList.add('on');
      break;
    }
    case 'land': if (e.hard) sparks.burst(e.x, e.y + 0.5, e.z, 0x8a8f9a, 24, 18, 0.6, 20); break;
    case 'dash': sparks.burst(e.x, e.y + 8, e.z, 0x58e0ff, 12, 15, 0.3, 0); break;
    case 'overheat': if (e.id === me.id) showMsg('火神砲過熱'); break;
    case 'lock': if (e.id === me.id && !e.auto) showMsg('鎖定'); break;
    case 'unlock': if (e.id === me.id) showMsg(e.lost ? '失去目標' : '解除鎖定'); break;
    default: break;
  }
}

// ---------------------------------------------------------------- loop
let frames = 0, fpsTime = 0, fps = 0;

const loop = createLoop({
  maxSteps: 10,                 // the simulation is cheap; let slow renderers keep real time
  step(dt) {
    world.fighters.forEach((f, i) => { const p = prev[i]; p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.yaw = f.yaw; });
    const intent = mapper.sample(dt);
    if (intent.pressed.rematch && world.winner) { startBattle(); return; }
    stepWorld(world, [playing ? intent : IDLE_INTENT, dummyStep(dt)], dt);
    for (const e of drain(world)) handleEvent(e);
  },
  render(alpha, frameDt) {
    world.fighters.forEach((f, i) => {
      const p = prev[i], m = mechs[i];
      m.group.position.set(p.x + (f.pos.x - p.x) * alpha, p.y + (f.pos.y - p.y) * alpha, p.z + (f.pos.z - p.z) * alpha);
      m.group.rotation.y = lerpAngle(p.yaw, f.yaw, alpha);
      shadows[i].update(m.group.position, world.statics);
      animateMech(m, {
        speed: Math.hypot(f.vel.x, f.vel.z), runSpeed: CFG.MOVE.run, onGround: f.onGround, boosting: f.boosting,
        dashing: f.dashTimer > 0, vy: f.vel.y, landLag: f.landLag, aiming: f.aiming, aimPitch: f.aim.pitch,
        active: f.active, melee: f.melee, guard: f.guard, stun: f.stun, dead: f.dead,
      }, frameDt);
    });
    tracers.update(frameDt); sparks.update(frameDt); slashes.update(frameDt);
    bolts.sync(world.projectiles, alpha);

    // Camera: first person while aiming, the lock-on orbit while locked, free orbit otherwise.
    const myPos = mechs[0].group.position, enemyPos = mechs[1].group.position;
    let rig = tpRig;
    if (me.aiming) { fpRig.fov = weaponIn(me, 'ranged').zoomFov; rig = fpRig; }
    else if (me.lock && !enemy.dead) rig = lockRig;
    cam.use(rig);
    mechs[0].group.visible = !(me.aiming && !cam.blending);
    cam.update(frameDt, myPos, look, world.statics, enemyPos);
    sky.update(app.camera);
    app.render();

    // HUD.
    const { w, h } = app.size;
    const rangedW = weaponIn(me, 'ranged');
    hpBar.set(me.hp / me.hpMax, me.hp <= 300 ? 'low' : '');
    fuelBar.set(me.fuel / CFG.MOVE.fuelMax, me.fuel < CFG.MOVE.dashFuel ? 'low' : '');
    energyBar.set(me.energy / rangedW.energyMax, me.energy < rangedW.energy ? 'low' : '');
    heatBar.set(me.heat, me.overheated ? 'hot' : '');
    slotEls.forEach((s, i) => s.classList.toggle('active', me.active === CFG.SLOTS[i]));
    weaponsBox.style.setProperty('--cd', (me.switchCd / CFG.COMBAT.switchCooldown).toFixed(3));
    weaponsBox.classList.toggle('cooling', me.switchCd > 0);
    crosshair.classList.toggle('on', me.aiming);
    crosshair.classList.toggle('ready', me.aiming && me.active === 'ranged' && me.fireCd <= 0 && me.energy >= rangedW.energy);

    // The opponent's health floats over its head, but only while it can be seen; otherwise an arrow
    // points at where it was last seen, so hiding between buildings works.
    const seen = me.lockLos && !enemy.dead;
    if (seen) lastSeen = { x: enemyPos.x, y: enemyPos.y, z: enemyPos.z };
    const head = seen ? project(app.camera, enemyPos.x, enemyPos.y + 22, enemyPos.z, w, h) : null;
    if (head && head.visible) {
      enemyBox.classList.add('on');
      enemyBox.style.transform = `translate(${head.x.toFixed(0)}px, ${head.y.toFixed(0)}px)`;
      enemyHp.set(enemy.hp / enemy.hpMax, enemy.hp <= 300 ? 'low' : '');
    } else enemyBox.classList.remove('on');
    const ret = me.lock && seen && !me.aiming ? project(app.camera, enemyPos.x, enemyPos.y + 12, enemyPos.z, w, h) : null;
    if (ret && ret.visible) {
      reticle.classList.add('on');
      reticle.style.transform = `translate(${ret.x.toFixed(0)}px, ${ret.y.toFixed(0)}px)`;
    } else reticle.classList.remove('on');
    if (!seen && lastSeen && !enemy.dead) {
      const p = project(app.camera, lastSeen.x, lastSeen.y + 12, lastSeen.z, w, h);
      let x = p.x, y = p.y;
      if (p.depth > 1) { x = w - x; y = h - y; }                      // behind the camera: flip
      const onScreen = p.depth < 1 && x > 40 && x < w - 40 && y > 40 && y < h - 40;
      let angle = Math.PI / 2;                                           // on screen: point down at the spot
      if (!onScreen) {
        const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy;
        angle = Math.atan2(dy, dx);
        const k = Math.min((w / 2 - 50) / Math.abs(dx || 1e-6), (h / 2 - 50) / Math.abs(dy || 1e-6));
        x = cx + dx * k; y = cy + dy * k;
      } else y -= 30;
      lost.classList.add('on');
      lost.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${angle.toFixed(3)}rad)`;
    } else lost.classList.remove('on');

    if (hitmarkT > 0) { hitmarkT -= frameDt; hitmark.classList.add('on'); } else hitmark.classList.remove('on');
    if (vignetteT > 0) { vignetteT -= frameDt; vignette.style.opacity = Math.min(1, vignetteT * 3).toFixed(2); } else if (vignette.style.opacity !== '0') vignette.style.opacity = '0';
    if (msgT > 0) { msgT -= frameDt; if (msgT <= 0) msg.classList.remove('on'); }

    frames++; fpsTime += frameDt;
    if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
    if (showDebug) {
      debug.textContent = `${fps} fps  tick ${world.tick}  pos ${me.pos.x.toFixed(1)} ${me.pos.y.toFixed(1)} ${me.pos.z.toFixed(1)}` +
        `  vy ${me.vel.y.toFixed(1)}  ${me.onGround ? 'ground' : 'air'}${me.boosting ? ' boost' : ''}${me.dashTimer > 0 ? ' dash' : ''}${me.aiming ? ' aim' : ''}` +
        `  ${me.active}${me.melee ? ' ' + me.melee.stage : ''}  lock ${me.lock}/${me.lockLos ? 'los' : 'hidden'}  hp ${me.hp}/${enemy.hp}` +
        `  look ${look.yaw.toFixed(2)} ${look.pitch.toFixed(2)}  mouse ${mouse.state.locked}`;
    } else if (debug.textContent) debug.textContent = '';
  },
});
loop.start();

// Hooks for tests and tooling.
window.__skyline = {
  get world() { return world; }, look, mouse, app, post, get playing() { return playing; }, setPlaying, startBattle, stage, loadout, cpuLoadout,
  version: CFG.GAME.version,
};
