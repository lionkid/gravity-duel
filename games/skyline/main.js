// Gravity Duel: Skyline — wires the engine and the game together: city, two mechs, input, cameras, HUD.
// M0: run, jump, boost and dash through the city with a third-person camera; hold aim for first person.

import * as THREE from 'three';
import { createLoop } from '../../engine/core/loop.js';
import { drain } from '../../engine/core/events.js';
import { lerpAngle } from '../../engine/core/math.js';
import { createKeyboard } from '../../engine/input/keyboard.js';
import { createMouse } from '../../engine/input/mouse.js';
import { createMapper } from '../../engine/input/bindings.js';
import { IDLE_INTENT } from '../../engine/input/intent.js';
import { createRenderApp } from '../../engine/render/app.js';
import { createThirdPersonRig, createFirstPersonRig, createCameraBlender } from '../../engine/render/rigs.js';
import { buildStageVisual, setNightEnvironment } from '../../engine/render/world-builder.js';
import { buildMech } from '../../engine/render/mech-builder.js';
import { animateMech } from '../../engine/render/mech-anim.js';
import { createBar, el } from '../../engine/render/hud.js';
import { createSky } from '../../engine/render/sky.js';
import { createBlobShadow } from '../../engine/render/fx.js';
import * as CFG from './config.js';
import { generateCity } from './stages/city.js';
import { createWorld, stepWorld } from './rules/world.js';
import { AX01, withPalette } from './mechs/ax01.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 7;

// World.
const stage = generateCity(Object.assign({ seed }, CFG.STAGES.city));
const world = createWorld({ stage, seed });
const me = world.fighters[0];
// Development: ?pos=x,y,z and ?look=yaw,pitch place the player and the camera for screenshots.
if (params.get('pos')) { const [x, y, z] = params.get('pos').split(',').map(Number); Object.assign(me.pos, { x, y, z }); me.onGround = false; }

// Scene.
const canvas = document.getElementById('game');
const app = createRenderApp(canvas, { fov: CFG.CAMERA.tp.fov });
setNightEnvironment(app.renderer, app.scene);
buildStageVisual(app.scene, stage);
const sky = createSky();
app.scene.add(sky.mesh);
const shadows = world.fighters.map(() => { const s = createBlobShadow(7); app.scene.add(s.mesh); return s; });
const mechs = world.fighters.map((f, i) => {
  const mech = buildMech(i === 0 ? AX01 : withPalette(AX01, CFG.PALETTES.crimson, 'ax01-crimson'));
  mech.group.position.set(f.pos.x, f.pos.y, f.pos.z);
  mech.group.rotation.y = f.yaw;
  app.scene.add(mech.group);
  return mech;
});

// Input and cameras.
const keyboard = createKeyboard();
const mouse = createMouse(canvas);
const look = { yaw: stage.spawns[0].yaw, pitch: -0.18 };
if (params.get('look')) { const [yaw, pitch] = params.get('look').split(',').map(Number); look.yaw = yaw; look.pitch = pitch; }
const mapper = createMapper({ keyboard, mouse, bindings: CFG.BINDINGS, look, sensitivity: CFG.CAMERA.sensitivity,
  keyLookRate: CFG.CAMERA.keyLookRate, pitchLimits: CFG.CAMERA.pitchLimits });
const tpRig = createThirdPersonRig(app.camera, CFG.CAMERA.tp);
const fpRig = createFirstPersonRig(app.camera, CFG.CAMERA.fp);
const cam = createCameraBlender(app.camera, { time: CFG.CAMERA.blend });
cam.use(tpRig);

// HUD.
const hud = document.getElementById('hud');
const gauges = hud.querySelector('.gauges');
const fuelBar = createBar(gauges, 'FUEL', 'fuel');
const debug = hud.querySelector('.debug');
const crosshair = hud.querySelector('.crosshair');
const overlay = document.getElementById('overlay');
const note = overlay.querySelector('.note');
const keys = overlay.querySelector('.keys');
for (const [label, key] of CFG.KEY_HINTS) { el('dt', '', keys, label); el('dd', '', keys, key); }
let showDebug = params.has('debug');

// Start / pause overlay. Clicking the canvas captures the mouse; releasing it (Esc) brings the panel back.
let playing = false;
function setPlaying(on) {
  playing = on;
  overlay.classList.toggle('hidden', on);
  document.body.classList.toggle('playing', on);
  if (!on) keyboard.release();
}
overlay.addEventListener('click', () => { setPlaying(true); mouse.requestLock(); });
canvas.addEventListener('click', () => { if (!playing) setPlaying(true); mouse.requestLock(); });
mouse.onLockChange((locked) => {
  if (!locked && playing && mouse.state.supported) setPlaying(false);
  if (!mouse.state.supported) note.textContent = '這裡無法鎖定滑鼠：用方向鍵控制鏡頭與準星。';
});
if (!mouse.state.supported) note.textContent = '這個瀏覽器沒有滑鼠鎖定：用方向鍵控制鏡頭與準星。';

// Interpolation state: where each fighter was before the last simulation step.
const prev = world.fighters.map((f) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z, yaw: f.yaw }));
let frames = 0, fpsTime = 0, fps = 0;

const loop = createLoop({
  step(dt) {
    world.fighters.forEach((f, i) => { const p = prev[i]; p.x = f.pos.x; p.y = f.pos.y; p.z = f.pos.z; p.yaw = f.yaw; });
    const intent = playing ? mapper.sample(dt) : (mapper.sample(dt), IDLE_INTENT);
    stepWorld(world, [intent, IDLE_INTENT], dt);
    drain(world);                                   // events feed sound and effects in later milestones
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
      }, frameDt);
    });
    cam.use(me.aiming ? fpRig : tpRig);
    mechs[0].group.visible = !(me.aiming && !cam.blending);
    cam.update(frameDt, mechs[0].group.position, look, world.statics);
    crosshair.classList.toggle('on', me.aiming);
    sky.update(app.camera);
    app.render();

    fuelBar.set(me.fuel / CFG.MOVE.fuelMax, me.fuel < CFG.MOVE.dashFuel ? 'low' : '');
    frames++; fpsTime += frameDt;
    if (fpsTime >= 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
    if (showDebug) {
      debug.textContent = `${fps} fps  tick ${world.tick}  pos ${me.pos.x.toFixed(1)} ${me.pos.y.toFixed(1)} ${me.pos.z.toFixed(1)}` +
        `  vy ${me.vel.y.toFixed(1)}  ${me.onGround ? 'ground' : 'air'}${me.boosting ? ' boost' : ''}${me.dashTimer > 0 ? ' dash' : ''}${me.aiming ? ' aim' : ''}` +
        `  look ${look.yaw.toFixed(2)} ${look.pitch.toFixed(2)}  lock ${mouse.state.locked}`;
    } else if (debug.textContent) debug.textContent = '';
  },
});
window.addEventListener('keydown', (e) => { if (e.code === 'F3') { showDebug = !showDebug; e.preventDefault(); } });
loop.start();

// Hooks for tests and tooling.
window.__skyline = { world, look, mouse, app, get playing() { return playing; }, setPlaying, stage, version: CFG.GAME.version };
