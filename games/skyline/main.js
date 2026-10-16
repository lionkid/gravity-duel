// Gravity Duel: Skyline — wires the engine and the game together: city, two mechs, input, cameras,
// HUD, effects, sound and menus. The simulation lives in rules/; everything here only reads it and
// feeds it Intents.

import * as THREE from 'three';
import { createLoop } from '../../engine/core/loop.js';
import { drain } from '../../engine/core/events.js';
import { lerpAngle, dirToAim, distXZ, angleDiff, clamp } from '../../engine/core/math.js';
import { createKeyboard } from '../../engine/input/keyboard.js';
import { createMouse } from '../../engine/input/mouse.js';
import { createMapper } from '../../engine/input/bindings.js';
import { createGamepad } from '../../engine/input/gamepad.js';
import { createTouch } from '../../engine/input/touch.js';
import { IDLE_INTENT, createIntent, clearIntent } from '../../engine/input/intent.js';
import { createRenderApp } from '../../engine/render/app.js';
import { createThirdPersonRig, createFirstPersonRig, createLockOnRig, createCameraBlender, createShake } from '../../engine/render/rigs.js';
import { buildStageVisual, createEnvironments } from '../../engine/render/world-builder.js';
import { buildMech } from '../../engine/render/mech-builder.js';
import { animateMech } from '../../engine/render/mech-anim.js';
import { createBar, el, project } from '../../engine/render/hud.js';
import { createSky } from '../../engine/render/sky.js';
import { createBlobShadow, createSparks, createSlashes, createProjectileView, createFlashes, createBladeTrail, createRings, createTracers } from '../../engine/render/fx.js';
import { createPost } from '../../engine/render/post.js';
import { createTargetView } from '../../engine/render/targets.js';
import { createTwisterView } from '../../engine/render/twister.js';
import { createSynth } from '../../engine/audio/synth.js';
import { createScreens } from '../../engine/ui/screens.js';
import { createSocket } from '../../engine/net/socket.js';
import { createHostSync, createGuestSync } from '../../engine/net/sync.js';
import * as CFG from './config.js';
import { generateCity } from './stages/city.js';
import { createWorld, stepWorld, cloneWorld, serializeWorld, applySnapshot, hashWorld } from './rules/world.js';
import { weaponIn, meleeOf, rangedOf } from './rules/combat.js';
import { AX01, withPalette } from './mechs/ax01.js';
import { createAI, aiIntent, AI_LEVELS } from './ai/brain.js';
import { RECIPES, soundForEvent, updateThrusterLoops, updateTwisterLoops } from './sound.js';
import { defineScreens } from './screens.js';
import { createLobby } from './lobby.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 7;
const pick = (table, value, fallback) => (value && table[value] ? value : fallback);
const load = (key, fallback) => { try { return Object.assign(fallback, JSON.parse(localStorage.getItem(key) || 'null') || {}); } catch (e) { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } };

// Settings and the player's loadout live in this browser; the URL can override them (?weapon=&armor=&cpu=).
const settings = load('skyline.settings', { sens: 1, volume: 0.5, bloom: true, quality: '', invertY: false, fps: false, touch: 'auto', cpu: 'normal', stage: 'city', practiceMode: 'free', practiceDummy: 'stand' });
if (!CFG.PRACTICE.modes[settings.practiceMode]) settings.practiceMode = 'free';
if (!CFG.PRACTICE.dummies[settings.practiceDummy]) settings.practiceDummy = 'stand';
const practiceBest = load('skyline.practiceBest', {});          // stage id → { score, weapon, armor }
if (!CFG.QUALITY[settings.quality]) settings.quality = settings.bloom === false ? 'low' : 'medium';   // older saves only knew bloom on/off
if (!['auto', 'on', 'off'].includes(settings.touch)) settings.touch = 'auto';
settings.cpu = pick(AI_LEVELS, params.get('cpu') || settings.cpu, 'normal');
const storedLoadout = load('skyline.loadout', {});
const loadout = {
  weapon: pick(CFG.WEAPON_CLASSES, params.get('weapon') || storedLoadout.weapon, 'normal'),
  armor: pick(CFG.ARMORS, params.get('armor') || storedLoadout.armor, 'normal'),
};
// The opponent's loadout comes from the URL, otherwise it is rolled from the seed (and rerolled on request).
const wkeys = Object.keys(CFG.WEAPON_CLASSES), akeys = Object.keys(CFG.ARMORS);
const cpuLoadout = { weapon: 'normal', armor: 'normal' };
let cpuRoll = seed;
function rollCpu() {
  cpuLoadout.weapon = pick(CFG.WEAPON_CLASSES, params.get('cpuWeapon'), wkeys[cpuRoll % 3]);
  cpuLoadout.armor = pick(CFG.ARMORS, params.get('cpuArmor'), akeys[(cpuRoll >> 2) % 3]);
}
rollCpu();
const loadoutText = (l) => `${CFG.WEAPON_CLASSES[l.weapon].zh}武裝 · ${CFG.ARMORS[l.armor].zh}`;
const todOverride = params.has('tod') ? Number(params.get('tod')) : null;

// Stage and scene (built once; battles are restarted inside it).
let stageId = pick(CFG.STAGES, params.get('stage') || settings.stage, 'city');
let stage = generateCity(Object.assign({ seed }, CFG.STAGES[stageId]));
const canvas = document.getElementById('game');
const app = createRenderApp(canvas, { fov: CFG.CAMERA.tp.fov });
const environments = createEnvironments(app.renderer);
let stageVis = buildStageVisual(app.scene, stage, { environments, timeOfDay: CFG.STAGES[stageId].dusk.start });
const sky = createSky();
sky.set({ earth: stageVis.theme.earth || null });
app.scene.add(sky.mesh);
const post = params.get('bloom') === '0' ? null : createPost(app, { strength: 0.42, radius: 0.3, threshold: 1.0 });
const mechs = [buildMech(AX01), buildMech(withPalette(AX01, CFG.PALETTES.crimson, 'ax01-crimson'))];
for (const m of mechs) app.scene.add(m.group);
const shadows = mechs.map(() => { const s = createBlobShadow(7); app.scene.add(s.mesh); return s; });
const sparks = createSparks(app.scene, { max: 768, size: 1.4 });
const smoke = createSparks(app.scene, { max: 1024, size: 3.4 });
const debris = createSparks(app.scene, { max: 256, size: 2.2 });
const flashes = createFlashes(app.scene);
const slashes = createSlashes(app.scene);
const rings = createRings(app.scene);
const tracers = createTracers(app.scene, { life: 0.1 });
const bolts = createProjectileView(app.scene, { smoke, sparks });
const trails = mechs.map((m) => createBladeTrail(app.scene, { color: m.design.palette.glow }));
const boards = createTargetView(app.scene);
const twisterView = createTwisterView(app.scene, { height: CFG.TWISTER.height });
const RING_FX = [0xffd040, 0xff5a50, 0x5a9bff, 0xc8ccd6, 0xffffff];   // spark colours by ring, bullseye first
const shake = createShake();
// Warm up every material once so the first shot, flash, ring or trail does not stall on shader
// compilation: the effect pools start hidden, and compile() only sees visible objects.
bolts.warm();
function warmMaterials() {
  const hidden = [];
  app.scene.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
  app.renderer.compile(app.scene, app.camera);
  for (const o of hidden) o.visible = false;
}
warmMaterials();
// Per-mech presentation state the animator reads: time since the last hit / shot.
const mechFx = mechs.map(() => ({ hitT: Infinity, hitSide: 0, hitHeavy: false, firedT: Infinity, firedKind: '' }));
let hitstopT = 0;
const GUN_SCALE = { rocketM: [1.2, 1.2, 1.15], bolt: [0.75, 0.75, 1.6], shell: [1.1, 1.1, 0.7] };
const FLASH = { vulcan: 1.6, rocket: 4.5, longrifle: 4, handcannon: 3 };
const TRACER = { vulcan: 7, rocket: 16, longrifle: 320, handcannon: 12 };   // streak length from the muzzle
const BOOM = { rocketS: 5, rocketM: 12, bolt: 6, shell: 7 };

// Sound: synthesized, positioned around the camera. Browsers only start audio after a gesture.
const sfx = createSynth(RECIPES, { volume: settings.volume });
window.addEventListener('pointerdown', () => sfx.unlock());
window.addEventListener('keydown', () => sfx.unlock());

// Input and cameras.
const keyboard = createKeyboard();
const mouse = createMouse(canvas);
const gamepad = createGamepad(CFG.BINDINGS.pad);
const touchUi = createTouch(document.getElementById('touch'), { toggle: CFG.BINDINGS.touch.toggle, onInteract: () => sfx.unlock() });
const look = { yaw: 0, pitch: -0.18 };
const mapper = createMapper({ keyboard, mouse, gamepad, touch: touchUi, bindings: CFG.BINDINGS, look, sensitivity: CFG.CAMERA.sensitivity * settings.sens,
  keyLookRate: CFG.CAMERA.keyLookRate, pitchLimits: CFG.CAMERA.pitchLimits });
const tpRig = createThirdPersonRig(app.camera, CFG.CAMERA.tp);
const fpRig = createFirstPersonRig(app.camera, CFG.CAMERA.fp);
const lockRig = createLockOnRig(app.camera, CFG.CAMERA.lock);
const cam = createCameraBlender(app.camera, { time: CFG.CAMERA.blend });

// ---------------------------------------------------------------- HUD
const hud = document.getElementById('hud');
const top = el('div', 'top', hud);
const meBox = el('div', 'me', top);
const meName = el('div', 'name', meBox, 'AX-01 VANGUARD');
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
el('div', 'cdring', crosshair);
const sflash = el('div', 'sflash', hud);
const hitmark = el('div', 'hitmark', hud);
const vignette = el('div', 'vignette', hud);
const msg = el('div', 'msg', hud);
const ko = el('div', 'ko', hud);
const koResult = el('div', 'result', ko);
const debug = el('div', 'debug', hud);
const netBox = el('div', 'net', hud);
// Practice: the score panel, the clock, the big countdown, markers over the targets and a hint line.
const pBox = el('div', 'practice', hud);
const pTimer = el('div', 'ptimer', hud);
const pCount = el('div', 'pcount', hud);
const pHint = el('div', 'phint', hud);
const tMarks = Array.from({ length: 24 }, () => { const m = el('div', 'tmark', hud); el('span', '', m, ''); return m; });
const dmgNums = Array.from({ length: 14 }, () => el('div', 'dmgnum', hud));
let dmgNext = 0;
function showPopup(x, y, text, cls = '') {
  const d = dmgNums[dmgNext]; dmgNext = (dmgNext + 1) % dmgNums.length;
  d.textContent = text;
  d.className = `dmgnum ${cls}`;
  d.style.left = `${(x + (Math.random() - 0.5) * 30).toFixed(0)}px`;
  d.style.top = `${(y + (Math.random() - 0.5) * 16).toFixed(0)}px`;
  void d.offsetWidth;                                   // restart the animation
  d.classList.add('on');
}
const showDamage = (x, y, amount, heavy, mine) => showPopup(x, y, String(amount), `${heavy ? 'heavy' : ''} ${mine ? 'me' : ''}`);
let showDebug = params.has('debug');
let hitmarkT = 0, vignetteT = 0, msgT = 0, sflashT = 0, denyT = 0, countT = 0, hintT = 0, practiceEndT = 0, twWarnT = 0;
let lastPracticeText = '', lastTimerText = '';
let lastResult = null;                       // the last time attack, for the result screen
const showMsg = (text, t = 1.2) => { msg.textContent = text; msg.classList.add('on'); msgT = t; };

// ---------------------------------------------------------------- battle state
let world, me, enemy, prev, lastSeen = null, ai = null;
let inBattle = false, playing = false, koT = 0, pauseGraceT = 0, attractT = 0;
// Who runs the match: 'local' (the computer opponent), 'host' (seat 1 of a LAN room, authoritative)
// or 'guest' (seat 2: predicts ahead of the host's confirmed ticks). mySeat is the fighter I control.
let session = { kind: 'local', sync: null };
let mySeat = 1;
let practice = null;                         // { mode, dummy } while a practice session runs
let lastView = null;                         // the guest's previously rendered predicted world
const hostHashes = new Map();                // host, ?debug only: tick → state hash, for the LAN smoke test
// Switches the arena (solo: the player's pick; LAN: the host's). The scene is rebuilt in place.
function setStage(id, { fromPeer = false } = {}) {
  if (!CFG.STAGES[id] || id === stageId) return;
  stageId = id;
  settings.stage = id;
  stageVis.dispose();
  stage = generateCity(Object.assign({ seed }, CFG.STAGES[stageId]));
  stageVis = buildStageVisual(app.scene, stage, { environments, timeOfDay: CFG.STAGES[stageId].dusk.start });
  sky.set({ earth: stageVis.theme.earth || null });
  warmMaterials();
  if (!inBattle) setupWorld();
  if (!fromPeer) lobby.setStage(id);
}
// A fresh world with both mechs at their spawns; also what stands behind the title screen.
function setupWorld({ matchSeed = seed, loadouts = practice ? { 1: loadout, 2: { weapon: 'normal', armor: 'normal' } } : { 1: loadout, 2: cpuLoadout } } = {}) {
  world = createWorld({ stage, seed: matchSeed, loadouts, practice });
  me = world.fighters[mySeat - 1]; enemy = world.fighters[2 - mySeat];
  ai = createAI(settings.cpu, seed * 7 + 3);
  lastView = null;
  // Development: ?pos=x,y,z and ?look=yaw,pitch place the player and the camera for screenshots.
  if (params.get('pos')) { const [x, y, z] = params.get('pos').split(',').map(Number); Object.assign(me.pos, { x, y, z }); me.onGround = false; }
  look.yaw = stage.spawns[mySeat - 1].yaw; look.pitch = CFG.CAMERA.pitchDefault;
  if (params.get('look')) { const [yaw, pitch] = params.get('look').split(',').map(Number); look.yaw = yaw; look.pitch = pitch; }
  prev = world.fighters.map((f) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw }));
  world.fighters.forEach((f, i) => {
    const m = mechs[i];
    m.group.position.set(f.pos.x, f.pos.y, f.pos.z);
    m.group.rotation.set(0, f.yaw, 0);
    m.flash = 0;
    m.materials.glow.emissiveIntensity = 2.2;
  });
  for (const fx of [sparks, smoke, debris, flashes, slashes, rings, tracers, bolts, boards, twisterView, ...trails]) fx.clear();
  countT = 0; practiceEndT = 0; twWarnT = 0; pCount.textContent = ''; pTimer.classList.remove('urgent');
  for (const fx of mechFx) { fx.hitT = Infinity; fx.firedT = Infinity; }
  hitstopT = 0; koT = 0;
  lastSeen = null;
  ko.classList.remove('on');
  meName.textContent = mySeat === 1 ? 'AX-01 VANGUARD' : 'AX-01 VANGUARD · CRIMSON';
  meLoadout.textContent = loadoutText(me.loadout);
  enemyName.textContent = practice ? '練習假人' : session.kind === 'local' ? `對手 · ${loadoutText(enemy.loadout)} · ${AI_LEVELS[settings.cpu].zh}` : `對手 · ${loadoutText(enemy.loadout)} · 區網`;
  document.body.classList.toggle('practicing', !!practice);
  slotEls.forEach((s, i) => { s.querySelector('.wname').textContent = weaponIn(me, CFG.SLOTS[i]).zh; });
  tpRig.reset(); lockRig.reset();
  cam.use(tpRig);
}
setupWorld();

// Scripted stand-in opponents for testing (?dummy=idle|walk|shoot|melee|ranged|basic); without the
// parameter the real AI plays.
const dummyMode = params.get('dummy') || '';
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

// The practice dummy: stands still, or strafes along its street with a hop now and then. Never attacks.
const practiceDummy = createIntent();
function practiceDummyIntent() {
  clearIntent(practiceDummy);
  const d = world.fighters[1];
  if (!practice || practice.dummy !== 'move' || !d || d.dead) return practiceDummy;
  const t = world.time, sp = stage.spawns[1].pos;
  const tx = sp.x + Math.sin(t * 0.55) * 16, tz = sp.z + Math.sin(t * 0.21) * 12;
  practiceDummy.move.x = clamp((tx - d.pos.x) / 6, -1, 1);
  practiceDummy.move.z = clamp((tz - d.pos.z) / 6, -1, 1);
  const k = world.tick % 330;
  if (k === 0) practiceDummy.pressed.boost = true;
  if (k < 40) practiceDummy.held.boost = true;
  if (world.tick % 470 === 200) practiceDummy.pressed.dash = true;
  return practiceDummy;
}

// ---------------------------------------------------------------- menus, pause and KO
// `inBattle`: a match is on (or just ended); `playing`: the player's input drives it and the mouse is
// captured. Pausing releases the mouse and shows the pause screen; closing it captures the mouse again.
function setPlaying(on) {
  playing = on;
  document.body.classList.toggle('playing', on);
  keyboard.release();
  if (on) pauseGraceT = 0.3;             // the key that closed a menu must not pause again
}
// Solo: the computer plays seat 2.
function startBattle() {
  session = { kind: 'local', sync: null };
  mySeat = 1;
  practice = null;
  setupWorld();
  beginBattle();
}
// Practice: targets everywhere, a dummy in seat 2, a score; free, or a time attack.
function startPractice() {
  session = { kind: 'local', sync: null };
  mySeat = 1;
  practice = { mode: settings.practiceMode, dummy: settings.practiceDummy };
  setupWorld();
  beginBattle();
  hintT = 8;
  pHint.textContent = practice.mode === 'timed'
    ? '60 秒內盡量拿分：打中靶心分數最高，移動靶、浮空靶分數加倍 · Esc 選單'
    : '右鍵瞄準射擊鏢靶，靶心 10 分 · F 解除鎖定後火神砲朝身體正面射 · 假人可以練連段 · Esc 選單';
  if (practice.mode === 'timed') sfx.play('count');
}
// LAN: both browsers build the same world from the host's seed and loadouts; seat 1 runs it.
function startLan({ seed: matchSeed, loadouts, seat, stage: sid }) {
  if (sid) setStage(sid, { fromPeer: true });
  mySeat = seat;
  session = { kind: seat === 1 ? 'host' : 'guest', sync: null };
  setupWorld({ matchSeed, loadouts });
  const send = (m) => socket.send(m);
  session.sync = seat === 1
    ? createHostSync({ world, stepWorld, serializeWorld, send })
    : createGuestSync({ world, stepWorld, cloneWorld, applySnapshot, send, now: () => performance.now() });
  hostHashes.clear();
  beginBattle();
}
function beginBattle() {
  inBattle = true;
  ui.hide();
  setPlaying(true);
  mouse.requestLock();
}
// The menu over a running match. Solo matches stop; a LAN match goes on without this player's input.
function pause() {
  if (!inBattle || !playing || world.winner) return;
  setPlaying(false);
  mouse.exitLock();
  ui.show('pause');
}
function resume() {
  if (!inBattle) return;
  ui.hide();
  setPlaying(true);
  mouse.requestLock();
}
// Leaves the match. stay = true keeps the LAN room (the caller shows the room screen).
function quit(stay = false) {
  inBattle = false;
  session = { kind: 'local', sync: null };
  mySeat = 1;
  practice = null;
  setPlaying(false);
  mouse.exitLock();
  setupWorld();
  ui.hide();
  if (!stay) ui.show('title');
}
function onRematch() {
  if (practice) startPractice();
  else if (session.kind === 'local') startBattle();
  else lobby.again();
}
// The time attack is over: keep the record and show the result.
function showPracticeResult() {
  const P = world.practice;
  const prevBest = practiceBest[stageId] ? practiceBest[stageId].score : 0;
  const newBest = P.score > prevBest;
  if (newBest) { practiceBest[stageId] = { score: P.score, weapon: loadout.weapon, armor: loadout.armor }; save('skyline.practiceBest', practiceBest); }
  lastResult = { score: P.score, breaks: P.breaks, bulls: P.bulls, shots: P.shots, hits: P.hits, dummyDamage: P.dummyDamage, best: Math.max(prevBest, P.score), newBest,
    stage: CFG.STAGES[stageId].zh, loadout: loadoutText(loadout) };
  setPlaying(false);
  mouse.exitLock();
  ui.show('presult', lastResult);
}
function showKo() {
  const win = world.winner === me.id;
  const left = Math.max(0, Math.round(win ? me.hp : enemy.hp));
  const foe = session.kind === 'local' ? `${loadoutText(enemy.loadout)}（${AI_LEVELS[settings.cpu].zh}）` : `${loadoutText(enemy.loadout)}（區網對手）`;
  const text = `${win ? '擊破' : '敗給'} ${foe} · ${world.time.toFixed(0)} 秒 · 勝方剩餘 HP ${left}`;
  setPlaying(false);
  mouse.exitLock();
  ko.classList.remove('on');
  ui.show('ko', { win, text });
}
// LAN plumbing: the relay socket feeds the active sync first, then the lobby protocol.
const socket = createSocket({ onMessage: (m) => { if (session.sync && session.sync.receive(m)) return; lobby.receive(m); } });
// Lobby changes redraw the menu that shows them; the room browser only when its list really changed,
// so a two-second poll does not keep rebuilding the buttons under the player's hand.
let lanShown = '';
const lobby = createLobby({
  socket, loadout,
  onChange: (st) => {
    // The host picks the arena; the guest's background follows.
    if (!lobby.isHost && st.peerStage && st.peerStage !== stageId && !inBattle) setStage(st.peerStage, { fromPeer: true });
    if (ui.name === 'lan') {
      const sig = JSON.stringify([st.rooms, st.self, st.note, st.scanned, st.server]);
      if (sig === lanShown) return;
      lanShown = sig;
      ui.refresh();
    } else if (['title', 'room', 'ko', 'pause', 'lanlost'].includes(ui.name)) ui.refresh();
  },
  onStart: startLan,
  onPeerLeft: () => { if (inBattle) { quit(true); ui.show('lanlost'); } },
  onLobby: () => { if (inBattle) quit(true); ui.hide(); ui.show('room'); },
});
lobby.detectServer();
lobby.setStage(stageId);
const ui = createScreens(document.getElementById('screens'));
const ctx = {
  loadout, cpuLoadout, settings, sfx, version: CFG.GAME.version,
  get cpuLevel() { return settings.cpu; },
  set cpuLevel(v) { settings.cpu = pick(AI_LEVELS, v, 'normal'); },
  get note() { return mouse.state.supported ? '' : '這裡無法鎖定滑鼠：用方向鍵控制鏡頭與準星，Esc 暫停。'; },
  startBattle, resume, quit, startPractice,
  isPractice: () => !!practice,
  practiceBest: (id) => practiceBest[id] || null,
  practiceSetup() { quit(true); ui.show('title'); ui.show('practice'); },
  lan: lobby.state, lanDraft: '',
  get stageId() { return stageId; },
  setStage: (id) => setStage(id),
  get padConnected() { return gamepad.connected; },
  isLan: () => session.kind !== 'local',
  lanBrowse: () => { lanShown = ''; lobby.browse(); }, lanConnect: (base) => lobby.connect(base), lanLeave: () => lobby.leave(),
  lanReady: (on) => lobby.setReady(on), lanAgain: () => lobby.again(), lanLobby: () => lobby.goLobby(),
  lanPickChanged: () => lobby.pickChanged(), lanLinks: () => socket.links(location.pathname),
  rerollCpu() { cpuRoll = (cpuRoll * 7 + 5) % 997; rollCpu(); },
  saveSettings() { save('skyline.settings', settings); save('skyline.loadout', loadout); },
  applySettings() {
    const q = CFG.QUALITY[settings.quality] || CFG.QUALITY.medium;
    mapper.settings.sensitivity = CFG.CAMERA.sensitivity * settings.sens;
    mapper.settings.invertY = !!settings.invertY;
    sfx.setVolume(settings.volume);
    settings.bloom = q.bloom;
    if (post) post.setEnabled(q.bloom);
    app.setPixelRatioCap(q.pixelRatio);
    for (const fx of [sparks, smoke, debris]) fx.density = q.particles;
    twisterView.setDensity(q.particles);
    touchUi.setMode(settings.touch);
  },
};
defineScreens(ui, ctx);
ctx.applySettings();
ui.show('title');
canvas.addEventListener('click', () => { if (inBattle && playing) mouse.requestLock(); });
// Losing the pointer lock (Esc, alt-tab) pauses; so does the tab going to the background.
mouse.onLockChange((locked) => { if (!locked && playing && mouse.state.supported) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', (e) => { if (e.code === 'F3') { showDebug = !showDebug; e.preventDefault(); } });

// ---------------------------------------------------------------- events → effects
// Shake falls off with distance from the player's mech.
function shakeAt(x, y, z, amount) {
  const d = Math.hypot(x - me.pos.x, y - me.pos.y - 10, z - me.pos.z);
  shake.kick(amount * Math.min(1, 40 / Math.max(10, d)));
}
function handleEvent(e) {
  switch (e.t) {
    case 'shot': {
      // Muzzle: a coloured bloom with a white core, a streak along the shot, a blast ring, sparks and smoke.
      const size = FLASH[e.kind] || 4;
      flashes.spawn(e.x, e.y, e.z, e.color, size, 0.09);
      flashes.spawn(e.x, e.y, e.z, 0xffffff, size * 0.45, 0.05);
      const len = TRACER[e.kind] || 10;
      tracers.spawn(e.x, e.y, e.z, e.x + e.dx * len, e.y + e.dy * len, e.z + e.dz * len, e.kind === 'longrifle' ? 0xe0fff8 : e.color);
      if (e.kind !== 'vulcan') {
        rings.spawn(e.x + e.dx * 2, e.y + e.dy * 2, e.z + e.dz * 2, e.color, e.kind === 'longrifle' ? 9 : 6, 0.16, { x: e.dx, y: e.dy, z: e.dz });
        smoke.burst(e.x, e.y, e.z, 0x9aa0ad, 8, 7, 0.7, -3, 2);
      }
      sparks.burst(e.x, e.y, e.z, e.color, e.kind === 'vulcan' ? 4 : 14, 18, 0.22, 0, 0, { x: e.dx, y: e.dy, z: e.dz }, 1.6);
      const fx = mechFx[e.id - 1];
      if (fx) { fx.firedT = 0; fx.firedKind = e.kind; }
      if (e.id === me.id) shake.kick(e.kind === 'vulcan' ? 0.12 : e.kind === 'longrifle' ? 0.7 : 0.5);
      break;
    }
    case 'impact': {
      const size = BOOM[e.look] || 6;
      flashes.spawn(e.x, e.y, e.z, e.color, size * 0.7, 0.12);
      flashes.spawn(e.x, e.y, e.z, 0xfff0d0, size * 0.3, 0.05);
      sparks.burst(e.x, e.y, e.z, e.color, Math.round(size * 2.5), 12 + size * 2.5, 0.45, 50);
      smoke.burst(e.x, e.y, e.z, 0x8a8f9a, Math.round(size), 4 + size * 0.6, 0.9, -3, 2);
      if (!e.body) debris.burst(e.x, e.y, e.z, 0x6a7384, Math.round(size * 0.8), 14 + size, 0.8, 60);
      if (size >= 10) { const l = Math.hypot(e.dx, e.dy, e.dz) || 1; rings.spawn(e.x, e.y, e.z, e.color, size * 1.4, 0.35, { x: -e.dx / l, y: -e.dy / l, z: -e.dz / l }); }
      shakeAt(e.x, e.y, e.z, size * 0.05);
      break;
    }
    case 'slash': {
      slashes.spawn(e.x, e.y, e.z, e.yaw, e.color, e.style);
      const fwd = { x: -Math.sin(e.yaw), z: -Math.cos(e.yaw) };
      // The heavy swings shake the ground: a shock ring where the blade comes down, or all around a spin.
      if (e.style === 'overhead') rings.spawn(e.x + fwd.x * 9, e.y + 0.4, e.z + fwd.z * 9, e.color, 18, 0.4);
      else if (e.style === 'spin') rings.spawn(e.x, e.y + 8, e.z, e.color, 30, 0.35);
      sparks.burst(e.x + fwd.x * 6, e.y + 11, e.z + fwd.z * 6, e.color, 10, 24, 0.25, 0, 0, fwd, 1.2);
      if (e.id === me.id) shake.kick(e.style === 'overhead' || e.style === 'spin' ? 0.35 : 0.15);
      break;
    }
    case 'hit': {
      const victim = world.fighters[e.id - 1];
      const m = mechs[e.id - 1], fx = mechFx[e.id - 1];
      if (m) m.flash = 0.18;
      const heavy = e.final || e.amount >= 120;
      if (fx && !e.guard) { fx.hitT = 0; fx.hitHeavy = heavy; fx.hitSide = victim ? Math.sign(angleDiff(victim.yaw, e.fromYaw)) : 0; }
      const col = e.guard ? 0x8fb3ff : 0xffb070;
      flashes.spawn(e.x, e.y, e.z, col, heavy ? 6 : 3.5, 0.1);
      sparks.burst(e.x, e.y, e.z, col, e.guard ? 14 : heavy ? 60 : 30, heavy ? 55 : 38, 0.5, 45);
      if (!e.guard) debris.burst(e.x, e.y, e.z, 0x9aa3b5, heavy ? 16 : 6, 20, 0.9, 70);
      if (heavy || e.melee) rings.spawn(e.x, e.y, e.z, e.guard ? 0x8fb3ff : 0xfff0d0, heavy ? 22 : 10, heavy ? 0.4 : 0.25, victim ? { x: Math.sin(e.fromYaw), y: 0.2, z: Math.cos(e.fromYaw) } : null);
      if (e.melee) hitstopT = Math.max(hitstopT, e.final ? 0.13 : heavy ? 0.1 : 0.05);
      if (heavy && (e.by === me.id || e.id === me.id)) sflashT = 0.14;
      if (e.by === me.id) { hitmarkT = 0.12; shake.kick(e.melee ? (heavy ? 0.6 : 0.35) : 0.15); }
      if (e.id === me.id) { vignetteT = 0.4; shake.kick(heavy ? 1.2 : e.melee ? 0.7 : 0.3); }
      const p = project(app.camera, e.x, e.y, e.z, app.size.w, app.size.h);
      if (p.visible) showDamage(p.x, p.y, e.amount, heavy, e.id === me.id);
      if (e.broke) showMsg(e.id === me.id ? '防禦被打破' : '破防');
      break;
    }
    case 'target': {
      boards.hit(e.tid, e.broke);
      const col = e.ring >= 0 ? RING_FX[e.ring] : (mechs[e.by - 1] ? mechs[e.by - 1].design.palette.glow : 0xffffff);
      sparks.burst(e.x, e.y, e.z, col, e.broke ? 36 : 12, e.broke ? 42 : 24, 0.4, 40);
      flashes.spawn(e.x, e.y, e.z, col, e.broke ? 7 : 3, 0.08);
      if (e.broke) {
        debris.burst(e.x, e.y, e.z, 0xe8e2d2, 22, 34, 1.0, 50);
        debris.burst(e.x, e.y, e.z, 0xd0403a, 12, 28, 1.0, 50);
        smoke.burst(e.x, e.y, e.z, 0xa0a4ae, 10, 8, 0.8, -2, 2);
        rings.spawn(e.x, e.y, e.z, col, e.bull ? 18 : 11, 0.35, { x: -Math.sin(e.yaw), y: 0, z: -Math.cos(e.yaw) });
      }
      if (e.by === me.id) {
        hitmarkT = 0.1;
        const p = project(app.camera, e.x, e.y, e.z, app.size.w, app.size.h);
        if (p.visible && e.broke && e.points > 0) showPopup(p.x, p.y, e.bull ? `靶心 +${e.points}` : `+${e.points}`, e.bull ? 'score bull' : 'score');
        if (e.bull) { showMsg('靶心！', 0.8); sflashT = Math.max(sflashT, 0.06); }
      }
      break;
    }
    case 'targetUp': flashes.spawn(e.x, e.y, e.z, 0x9ff3ff, 5, 0.12); rings.spawn(e.x, e.y, e.z, 0x9ff3ff, 7, 0.3, null); break;
    case 'count':
      if (e.clock) pTimer.classList.add('urgent');
      else if (e.n === 0) countT = 0.8;                     // "GO!" for a moment once the clock starts
      break;
    case 'practiceEnd': showMsg('時間到！', 1.6); practiceEndT = 1.4; pTimer.classList.remove('urgent'); break;
    case 'revive': {
      const f = world.fighters[e.id - 1];
      flashes.spawn(f.pos.x, f.pos.y + 10, f.pos.z, 0x9ff3ff, 14, 0.25);
      rings.spawn(f.pos.x, f.pos.y + 0.5, f.pos.z, 0x9ff3ff, 20, 0.45);
      if (e.id !== me.id) showMsg('假人站起來了', 0.9);
      break;
    }
    case 'caught': {
      smoke.burst(e.x, e.y + 6, e.z, 0xc8a070, 24, 18, 0.9, -4, 1.5);
      if (e.id === me.id) { showMsg('被沙塵龍捲風捲起！按衝刺可以脫身', 1.8); shake.kick(0.8); }
      break;
    }
    case 'fling': case 'escape': {
      smoke.burst(e.x, e.y + 6, e.z, 0xc8a070, 16, 22, 0.8, -4, 1.5);
      if (e.id === me.id) shake.kick(e.t === 'escape' ? 0.4 : 0.6);
      if (e.id === me.id && e.t === 'escape') showMsg('脫身！', 0.8);
      break;
    }
    case 'twister': if (Math.hypot(e.x - me.pos.x, e.z - me.pos.z) < 280) showMsg('沙塵龍捲風出現了', 1.2); break;
    case 'ko': {
      const f = world.fighters[e.id - 1];
      flashes.spawn(f.pos.x, f.pos.y + 10, f.pos.z, 0xffe0a0, 30, 0.35);
      sparks.burst(f.pos.x, f.pos.y + 10, f.pos.z, 0xffe0a0, 220, 60, 1.4, 25);
      smoke.burst(f.pos.x, f.pos.y + 10, f.pos.z, 0x9aa0ad, 60, 18, 2.0, -2, 1.2);
      debris.burst(f.pos.x, f.pos.y + 10, f.pos.z, 0x8a93a6, 40, 40, 1.6, 60);
      rings.spawn(f.pos.x, f.pos.y + 1, f.pos.z, 0xffe0a0, 45, 0.6);
      rings.spawn(f.pos.x, f.pos.y + 10, f.pos.z, 0xffffff, 30, 0.4, { x: 0, y: 0.3, z: 1 });
      shake.kick(1.5);
      sflashT = 0.2;
      hitstopT = 0.12;
      if (e.practice) { showMsg(e.id === me.id ? '被擊倒了，馬上站起來' : `假人倒下 · ${CFG.PRACTICE.dummyRevive} 秒後站起來`, 1.6); break; }
      koResult.textContent = e.by === me.id ? 'WIN' : 'LOSE';
      ko.classList.toggle('lose', e.by !== me.id);
      ko.classList.add('on');
      koT = 1.8;                                          // the result screen follows the explosion
      break;
    }
    case 'land': if (e.hard) { smoke.burst(e.x, e.y + 0.5, e.z, 0x8a8f9a, 24, 16, 0.7, 10, 2); shakeAt(e.x, e.y, e.z, 0.3); } break;
    case 'dash': sparks.burst(e.x, e.y + 8, e.z, 0x58e0ff, 12, 15, 0.3, 0); break;
    case 'melee': if (e.lunge) {
      const f = world.fighters[e.id - 1], glow = mechs[e.id - 1] ? mechs[e.id - 1].design.palette.glow : 0x58e0ff;
      sparks.burst(f.pos.x, f.pos.y + 10, f.pos.z, glow, 24, 22, 0.3, 0);
      flashes.spawn(f.pos.x, f.pos.y + 10, f.pos.z, glow, 7, 0.08);
      rings.spawn(f.pos.x, f.pos.y + 0.5, f.pos.z, glow, 12, 0.3);
    } break;
    case 'dry': if (e.id === me.id) denyT = 0.14; break;
    case 'overheat': if (e.id === me.id) showMsg('火神砲過熱'); break;
    case 'lock': if (e.id === me.id && !e.auto) showMsg('鎖定'); break;
    case 'unlock': if (e.id === me.id) showMsg(e.lost ? '失去目標' : '解除鎖定'); break;
    default: break;
  }
}

// ---------------------------------------------------------------- loop
let frames = 0, fpsTime = 0, fps = 0;

let devFreeze = false;          // tooling: hold the simulation while the renderer keeps drawing
function simStep(dt) {
    // Input is sampled every tick so key edges are consumed; the view only follows it in play.
    const yaw = look.yaw, pitch = look.pitch;
    const intent = mapper.sample(dt);
    if (!playing) { look.yaw = yaw; look.pitch = pitch; }
    pauseGraceT -= dt;
    if (!inBattle) return;
    const over = !!(world.practice && world.practice.phase === 'over');
    if (intent.pressed.rematch && (world.winner || over)) { onRematch(); return; }
    if (intent.pressed.pause && playing && pauseGraceT <= 0) { pause(); return; }
    const mine = playing && !over ? intent : IDLE_INTENT;
    if (session.kind === 'guest') { session.sync.step(mine); return; }      // predicted in render
    if (session.kind === 'local' && !playing && !world.winner) return;      // paused (solo only)
    world.fighters.forEach((f, i) => { const p = prev[i]; p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.yaw = f.yaw; });
    if (session.kind === 'host') {
      session.sync.step(mine);
      if (showDebug) { hostHashes.set(world.tick, hashWorld(world)); if (hostHashes.size > 600) hostHashes.delete(hostHashes.keys().next().value); }
    } else {
      stepWorld(world, [mine, practice ? practiceDummyIntent() : dummyMode ? dummyStep(dt) : aiIntent(ai, world, 2, dt)], dt);
    }
    for (const e of drain(world)) { handleEvent(e); soundForEvent(sfx, e, world, me.id); }
}

const loop = createLoop({
  maxSteps: 10,                 // the simulation is cheap; let slow renderers keep real time
  step(dt) { if (!devFreeze) simStep(dt); },
  render(alpha, frameDt) {
    if (practiceEndT > 0) { practiceEndT -= frameDt; if (practiceEndT <= 0 && practice && inBattle) showPracticeResult(); }
    // LAN: the host sends this frame's ticks; the guest plays the confirmed events and rebuilds its view.
    if (session.kind === 'host') session.sync.flush();
    else if (session.kind === 'guest') {
      session.sync.flush();
      for (const e of session.sync.drainEvents()) { handleEvent(e); soundForEvent(sfx, e, world, mySeat); }
      const view = session.sync.predict();
      if (lastView && view.tick === lastView.tick + 1) {
        lastView.fighters.forEach((f, i) => { const p = prev[i]; p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.yaw = f.yaw; });
      } else if (!lastView || view.tick !== lastView.tick) {
        view.fighters.forEach((f, i) => { const p = prev[i]; p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.yaw = f.yaw; });
      }
      lastView = view;
      world = view; me = world.fighters[mySeat - 1]; enemy = world.fighters[2 - mySeat];
    }
    if (koT > 0) { koT -= frameDt; if (koT <= 0) showKo(); }
    // Hit stop: on a solid melee hit the picture holds for a few frames while the simulation goes on.
    const frozen = hitstopT > 0;
    if (frozen) hitstopT -= frameDt;
    const animDt = frozen ? 0 : frameDt;
    world.fighters.forEach((f, i) => {
      const p = prev[i], m = mechs[i], fx = mechFx[i];
      if (!frozen) {
        m.group.position.set(p.x + (f.pos.x - p.x) * alpha, p.y + (f.pos.y - p.y) * alpha, p.z + (f.pos.z - p.z) * alpha);
        m.group.rotation.y = lerpAngle(p.yaw, f.yaw, alpha);
        fx.hitT += frameDt; fx.firedT += frameDt;
      }
      shadows[i].update(m.group.position, world.statics);
      const mw = meleeOf(f);
      let melee = null;
      if (f.melee) {
        const sw = mw.combo[f.melee.combo] || mw.combo[0];
        // The blade is cocked over the wind-up time, also while lunging.
        const dur = f.melee.stage === 'lunge' ? sw.windup : sw[f.melee.stage] || 0.1;
        melee = { stage: f.melee.stage, progress: f.melee.t / dur, style: sw.style || 'slashR' };
        if (f.melee.stage === 'lunge' && !frozen) {
          // Afterimage: a stream of glow behind the charging mech.
          const vl = Math.hypot(f.vel.x, f.vel.z) || 1;
          sparks.burst(m.group.position.x, m.group.position.y + 9, m.group.position.z, m.design.palette.glow, 3, 14, 0.22, 0, 0, { x: -f.vel.x / vl, y: 0.15, z: -f.vel.z / vl }, 2.5);
        }
      }
      animateMech(m, {
        speed: Math.hypot(f.vel.x, f.vel.z), runSpeed: CFG.MOVE.run, onGround: f.onGround, boosting: f.boosting,
        dashing: f.dashTimer > 0, vy: f.vel.y, landLag: f.landLag, aiming: f.aiming, aimPitch: f.aim.pitch,
        active: f.active, melee, guard: f.guard, stun: f.stun, dead: f.dead,
        bladeScale: mw.bladeScale, gunScale: GUN_SCALE[rangedOf(f).look] || null,
        hitT: fx.hitT, hitSide: fx.hitSide, hitHeavy: fx.hitHeavy, firedT: fx.firedT, firedKind: fx.firedKind,
      }, animDt);
      // The swing's hop and spin sit on top of the simulated transform.
      if (!frozen) { m.group.rotation.y += m.rootYaw || 0; m.group.position.y += m.rootLift || 0; }
      // The blade leaves a ribbon while it sweeps.
      const sweeping = f.melee && (f.melee.stage === 'active' || (f.melee.stage === 'recovery' && f.melee.t < 0.05));
      if (sweeping && !frozen) {
        m.group.updateMatrixWorld(true);
        const base = m.nodes.get('bladeBaseR'), tip = m.nodes.get('bladeTipR');
        if (base && tip) trails[i].push(base.getWorldPosition(new THREE.Vector3()), tip.getWorldPosition(new THREE.Vector3()));
      }
      trails[i].update(animDt);
    });
    sparks.update(animDt); smoke.update(animDt); debris.update(animDt); flashes.update(animDt); slashes.update(animDt); rings.update(animDt); tracers.update(animDt);
    bolts.sync(world.projectiles, frozen ? 0 : alpha, animDt);
    boards.sync(world.targets, frozen ? 1 : alpha, animDt);
    twisterView.sync(world.twisters, animDt, app.camera, app.renderer);

    // Camera: a slow orbit over the city behind the menus; in play, first person while aiming, the
    // lock-on orbit while locked, free orbit otherwise.
    const myPos = mechs[mySeat - 1].group.position, enemyPos = mechs[2 - mySeat].group.position;
    if (!inBattle) {
      attractT += frameDt;
      const a = attractT * 0.05;
      app.camera.position.set(Math.cos(a) * 300, 175 + Math.sin(attractT * 0.17) * 10, Math.sin(a) * 300);
      app.camera.lookAt(0, 30, 0);
      if (app.camera.fov !== CFG.CAMERA.tp.fov) { app.camera.fov = CFG.CAMERA.tp.fov; app.camera.updateProjectionMatrix(); }
      mechs[0].group.visible = true; mechs[1].group.visible = true;
    } else {
      let rig = tpRig;
      if (me.aiming) { fpRig.fov = weaponIn(me, 'ranged').zoomFov; rig = fpRig; }
      else if (me.lock && !enemy.dead) rig = lockRig;
      cam.use(rig);
      mechs[mySeat - 1].group.visible = !(me.aiming && !cam.blending);
      cam.update(frameDt, myPos, look, world.statics, enemyPos);
      shake.apply(app.camera, frameDt);
    }
    sfx.listen(app.camera);
    updateThrusterLoops(sfx, world, inBattle && (playing || !!world.winner));
    updateTwisterLoops(sfx, world, inBattle);
    // Caught in a twister: the picture shudders.
    if (inBattle && me.caught) shake.kick(2.4 * frameDt);
    // Late afternoon into night over the course of the match (?tod=0..1 pins it for screenshots).
    const dk = CFG.STAGES[stageId].dusk;
    const phase = stageVis.setTimeOfDay(todOverride == null ? dk.start + (1 - dk.start) * world.time / dk.toNight : todOverride);
    sky.set({ top: phase.sky.top, horizon: phase.sky.horizon, bottom: phase.sky.bottom, stars: phase.stars, disc: stageVis.theme.sun ? { dir: phase.sunDir, color: phase.sunColor } : null });
    twisterView.setLight(phase);
    boards.setNight(phase.night);
    sky.update(app.camera);
    app.render();

    // HUD.
    hud.classList.toggle('hidden', !inBattle);
    hud.classList.toggle('practice-on', inBattle && !!practice);
    // Menus by gamepad (d-pad or stick flicks, A, B); touch controls only while playing.
    if (ui.name) { for (const b of gamepad.consumeMenu()) { if (b === 'Down') ui.moveFocus(1); else if (b === 'Up') ui.moveFocus(-1); else if (b === 'A') ui.activate(); else if (b === 'B' || b === 'Back' || b === 'Start') ui.escape(); } }
    else gamepad.consumeMenu();
    touchUi.setVisible(inBattle && playing && !ui.name);
    document.body.classList.toggle('touch', touchUi.shown);
    frames++; fpsTime += frameDt;
    if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
    if (!inBattle) return;
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
    crosshair.classList.toggle('cooling', me.aiming && me.fireCd > 0);
    crosshair.style.setProperty('--cd', (me.fireCd / rangedW.interval).toFixed(3));
    if (denyT > 0) { denyT -= frameDt; crosshair.classList.add('deny'); reticle.classList.add('deny'); } else { crosshair.classList.remove('deny'); reticle.classList.remove('deny'); }
    if (sflashT > 0) { sflashT -= frameDt; sflash.style.opacity = Math.min(0.45, sflashT * 3.5).toFixed(2); } else if (sflash.style.opacity !== '0') sflash.style.opacity = '0';

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

    // Practice: score panel, clock, countdown, target markers, hint.
    const P = world.practice;
    if (P) {
      const acc = P.shots ? Math.round(P.hits / P.shots * 100) : 0;
      const ptext = `練習模式 · ${CFG.PRACTICE.modes[P.mode].zh}\n得分 ${P.score}\n擊破 ${P.breaks} · 靶心 ${P.bulls}\n命中率 ${acc}%（${P.hits}/${P.shots}）\n假人傷害 ${P.dummyDamage}`;
      if (ptext !== lastPracticeText) { pBox.textContent = ptext; lastPracticeText = ptext; }
      const secs = Math.ceil(P.timeLeft);
      const ttext = P.mode !== 'timed' ? '' : P.phase === 'ready' ? `準備 ${Math.ceil(P.ready)}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      if (ttext !== lastTimerText) { pTimer.textContent = ttext; lastTimerText = ttext; }
      // The big countdown follows the simulation (3, 2, 1), then GO! briefly.
      if (countT > 0) countT -= frameDt;
      const ctext = P.mode !== 'timed' ? '' : P.phase === 'ready' ? String(Math.ceil(P.ready)) : countT > 0 ? 'GO!' : '';
      if (ctext !== pCount.textContent) {
        pCount.textContent = ctext;
        pCount.classList.remove('on'); void pCount.offsetWidth;
        if (ctext) pCount.classList.add('on');
      }
      let k = 0;
      for (const tg of world.targets) {
        if (!tg.alive || k >= tMarks.length) continue;
        const d = Math.hypot(tg.pos.x - me.pos.x, tg.pos.y - me.pos.y, tg.pos.z - me.pos.z);
        if (d > 460 || d < 18) continue;
        const pp = project(app.camera, tg.pos.x, tg.pos.y + tg.radius + 3, tg.pos.z, w, h);
        if (!pp.visible) continue;
        const mk = tMarks[k++];
        mk.style.transform = `translate(${pp.x.toFixed(0)}px, ${pp.y.toFixed(0)}px)`;
        mk.firstChild.textContent = `${Math.round(d)}m`;
        mk.dataset.kind = tg.kind;
        mk.classList.add('on');
      }
      for (; k < tMarks.length; k++) tMarks[k].classList.remove('on');
      if (hintT > 0) hintT -= frameDt;
      pHint.classList.toggle('on', hintT > 0 && !ui.name);
    }
    // Twisters: a warning when one is about to pull this mech in.
    if (world.twisters && world.twisters.length) {
      twWarnT -= frameDt;
      if (twWarnT <= 0 && !me.caught) {
        for (const tw of world.twisters) {
          if (tw.strength > 0.5 && Math.hypot(tw.x - me.pos.x, tw.z - me.pos.z) < CFG.TWISTER.reach + 25) { showMsg('沙塵龍捲風接近！', 1.2); twWarnT = 8; break; }
        }
      }
    }

    if (hitmarkT > 0) { hitmarkT -= frameDt; hitmark.classList.add('on'); } else hitmark.classList.remove('on');
    if (vignetteT > 0) { vignetteT -= frameDt; vignette.style.opacity = Math.min(1, vignetteT * 3).toFixed(2); } else if (vignette.style.opacity !== '0') vignette.style.opacity = '0';
    if (msgT > 0) { msgT -= frameDt; if (msgT <= 0) msg.classList.remove('on'); }

    if (showDebug) {
      debug.textContent = `${fps} fps  tick ${world.tick}  pos ${me.pos.x.toFixed(1)} ${me.pos.y.toFixed(1)} ${me.pos.z.toFixed(1)}` +
        `  vy ${me.vel.y.toFixed(1)}  ${me.onGround ? 'ground' : 'air'}${me.boosting ? ' boost' : ''}${me.dashTimer > 0 ? ' dash' : ''}${me.aiming ? ' aim' : ''}` +
        `  ${me.active}${me.melee ? ' ' + me.melee.stage : ''}  lock ${me.lock}/${me.lockLos ? 'los' : 'hidden'}  hp ${me.hp}/${enemy.hp}` +
        `  look ${look.yaw.toFixed(2)} ${look.pitch.toFixed(2)}  mouse ${mouse.state.locked}`;
    } else if (debug.textContent) debug.textContent = '';
    const info = [];
    if (settings.fps) info.push(`${fps} fps`);
    if (session.kind !== 'local') {
      const st = session.sync.stats;
      info.push(session.kind === 'host' ? `區網主機 · 對手輸入遲到 ${st.late}` : `區網 · 延遲 ${st.rtt.toFixed(0)} ms · 領先 ${st.lead} tick · 輸入延遲 ${st.delay} · 修正 ${st.corrections}`);
    }
    const infoText = info.join(' · ');
    if (netBox.textContent !== infoText) netBox.textContent = infoText;
  },
});
loop.start();

// Hooks for tests and tooling.
window.__skyline = {
  get world() { return world; }, look, mouse, gamepad, touch: touchUi, app, post, sfx, ui, settings, loadout, cpuLoadout, socket, lobby, mechs, cam,
  get stage() { return stage; }, get stageId() { return stageId; }, setStage,
  get playing() { return playing; }, get inBattle() { return inBattle; }, get mySeat() { return mySeat; },
  get net() {
    if (session.kind === 'local') return { kind: 'local' };
    const s = session.sync;
    return { kind: session.kind, tick: world.tick, confirmedTick: s.world.tick, confirmedHash: hashWorld(s.world), stats: { ...s.stats }, hostHashes: Object.fromEntries(hostHashes) };
  },
  setPlaying, startBattle, startPractice, pause, resume, quit, loop, version: CFG.GAME.version, boards, twisterView,
  get practice() { return practice; },
  // Tooling: freeze the simulation and advance it by hand (screenshots of a pose).
  freeze(on) { devFreeze = !!on; },
  tick(n = 1) { for (let i = 0; i < n; i++) simStep(1 / 60); },
};
