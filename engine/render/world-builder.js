// Builds the visible stage from Stage data: sky, lights, ground, roads, and every static box as a
// mesh. Buildings are one InstancedMesh whose windows are drawn in the shader from world position,
// so a whole city costs a handful of draw calls and needs no textures. setTimeOfDay(t) moves the
// scene from day (0) through dusk (0.5) to night (1): sky, sun, fog, windows and lamps follow.

import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

const DEFAULT_PALETTE = {
  ground: 0x15181f, road: 0x1d222c, lane: 0x7d8696, kerb: 0x2a3040,
  concrete: 0x5a6378, rail: 0x8893a6, fence: 0x58e0ff, fenceOpacity: 0.08, lamp: 0xffe2b0, post: 0x1b1f2a,
  buildings: [0x2b3346, 0x343c52, 0x3d4154, 0x283447, 0x3a3348],
};

// Lighting keyframes: noon, dusk and night. Everything in between is interpolated.
const PHASES = [
  { t: 0, sky: [0x5f9ae6, 0xbfd8f5, 0x3b4654], sun: { color: 0xfff0d8, intensity: 2.6, dir: [-0.3, 0.9, 0.3] }, hemi: { sky: 0xa9c8ff, ground: 0x6a6f78, intensity: 1.1 }, fog: 0xb9cfe8, fogDensity: 0.00045, stars: 0, night: 0, envDay: 1 },
  { t: 0.5, sky: [0x2e3f7a, 0xff9c5c, 0x2a2430], sun: { color: 0xffb070, intensity: 1.7, dir: [-0.9, 0.22, 0.3] }, hemi: { sky: 0x6a6fb0, ground: 0x3a3038, intensity: 1.0 }, fog: 0x6b5a7a, fogDensity: 0.0006, stars: 0.3, night: 0.45, envDay: 0.5 },
  { t: 1, sky: [0x070b1a, 0x2a3a66, 0x05060a], sun: { color: 0xb4c2ff, intensity: 1.9, dir: [-0.5, 0.78, 0.36] }, hemi: { sky: 0x5f74ad, ground: 0x0d1016, intensity: 1.6 }, fog: 0x0a0d18, fogDensity: 0.0009, stars: 1, night: 1, envDay: 0 },
];

// Themes: a palette and lighting keyframes per kind of stage. The lunar theme is night at every time
// of day, lit hard by an unfiltered sun, with the Earth over the horizon and crater rings on the ground.
const LUNAR = { sky: [0x02030a, 0x0a1026, 0x020305], sun: { color: 0xfff6e8, intensity: 2.6, dir: [0.5, 0.8, -0.3] }, hemi: { sky: 0x3b4a7a, ground: 0x17181d, intensity: 0.9 }, fog: 0x05060c, fogDensity: 0.00012, stars: 1, night: 1, envDay: 0 };
export const THEMES = {
  city: { palette: DEFAULT_PALETTE, phases: PHASES },
  moon: {
    // Against a black sky the arena fence would read as a glowing horizon, so it is barely there.
    palette: Object.assign({}, DEFAULT_PALETTE, { ground: 0x44464c, road: 0x35373d, lane: 0x8d93a0, kerb: 0x3a3c42, concrete: 0x6b6f7a, rail: 0x9aa3b2, lamp: 0xd8ecff, rock: 0x55575d, fence: 0x2d8aa8, fenceOpacity: 0.025, buildings: [0x3b4250, 0x454c5c, 0x4d4a56, 0x3a4652, 0x50545f] }),
    phases: [Object.assign({ t: 0 }, LUNAR), Object.assign({ t: 0.5 }, LUNAR), Object.assign({ t: 1 }, LUNAR)],
    earth: { dir: [0.35, 0.5, -0.75], size: 0.1, sun: [0.5, 0.8, -0.3] },
    craters: 36,
  },
};

// The desert: a hazy afternoon that turns to an orange sunset and a violet night, adobe walls with
// small dark openings (a few lamps behind them after dark), layered sandstone mesas and boulders,
// rippled sand, dunes beyond the fence and the sun as a disc in the sky.
const DESERT_PHASES = [
  { t: 0, sky: [0x5f9bd8, 0xf2ddb0, 0xc89c68], sun: { color: 0xfff1d6, intensity: 3.0, dir: [-0.35, 0.86, 0.36] }, hemi: { sky: 0xffe7c4, ground: 0xb4865a, intensity: 1.15 }, fog: 0xe6cfa2, fogDensity: 0.00085, stars: 0, night: 0, envDay: 1 },
  { t: 0.5, sky: [0x4b4f8e, 0xff9448, 0x8c5034], sun: { color: 0xffa057, intensity: 2.3, dir: [-0.92, 0.17, 0.35] }, hemi: { sky: 0xc78f74, ground: 0x5c3b28, intensity: 1.0 }, fog: 0xd08a58, fogDensity: 0.00105, stars: 0.2, night: 0.42, envDay: 0.5 },
  { t: 1, sky: [0x0b0d24, 0x3c2c4e, 0x0b0907], sun: { color: 0xb6bcff, intensity: 1.7, dir: [0.45, 0.72, -0.4] }, hemi: { sky: 0x6c72a6, ground: 0x221a12, intensity: 1.35 }, fog: 0x1d1622, fogDensity: 0.0009, stars: 1, night: 1, envDay: 0 },
];
THEMES.desert = {
  palette: Object.assign({}, DEFAULT_PALETTE, { ground: 0xc9a46e, road: 0xbe9765, lane: 0xbe9765, kerb: 0xa98258, concrete: 0xb48a5e, rail: 0x9a8a78, rock: 0xa8704a, mesa: 0xb27449,
    lamp: 0xffd8a0, fence: 0xffc27a, fenceOpacity: 0.03, dune: 0xd2ae78, buildings: [0xc9a27a, 0xb98f66, 0xd5b68e, 0xa97f5a, 0xc39672] }),
  phases: DESERT_PHASES,
  windows: 'adobe', roadLines: false, strata: true, ripples: true, dunes: 44, sunDisc: true,
};

// The orbital deck: night in hard, unfiltered sunlight. Steel deck plates with dark seams and glowing
// lane edges, station modules with panel seams, lit portholes and light bands, cargo containers in
// four colours, blinking beacons on the masts, a deck that ends a little past the fence over the void,
// and in the sky (sky.js) a ringed gas giant, a faint nebula and stars all round.
const ORBIT = { sky: [0x000000, 0x03050c, 0x000000], sun: { color: 0xfff4e6, intensity: 3.1, dir: [-0.45, 0.62, 0.64] }, hemi: { sky: 0x42527a, ground: 0x3a3530, intensity: 0.95 }, fog: 0x010206, fogDensity: 0.00014, stars: 1.6, night: 1, envDay: 0 };
THEMES.space = {
  palette: Object.assign({}, DEFAULT_PALETTE, { ground: 0x59606e, road: 0x474d59, lane: 0x5fe6ff, kerb: 0x3a3f4a, concrete: 0x6a7180, rail: 0x9aa3b2, lamp: 0xd8f4ff, fence: 0x58e0ff, fenceOpacity: 0.004,
    beacon: 0xff3a30, edge: 0x2a2f38, crates: [0xd0662e, 0x2f6fb0, 0xc9cdd3, 0x7d8a52], buildings: [0x8c93a1, 0x9aa1ad, 0x7c8494, 0xa8adb6, 0x6f7889] }),
  phases: [Object.assign({ t: 0 }, ORBIT), Object.assign({ t: 0.5 }, ORBIT), Object.assign({ t: 1 }, ORBIT)],
  windows: 'station', plates: true, deck: 1.45, laneGlow: 2.6, fenceLine: 2.2, sunDisc: true,
  sky: {
    starsBelow: true,
    planet: { dir: [0.62, 0.16, -0.77], size: 0.22, sun: ORBIT.sun.dir, colorA: 0xb9824e, colorB: 0xf2dcb4, ring: { normal: [0.22, 0.95, 0.2], inner: 1.35, outer: 2.35, color: 0xd9c9a6 } },
    nebula: { strength: 0.45, axis: [0.82, 0.38, 0.43], colorA: 0x6a35a8, colorB: 0x2280b0 },
  },
};

// World position and normal for a material's fragment code (instanced or not), plus a hook for the
// fragment: `code` runs after the colour is known, with vWPos and vWNormal available.
function worldShade(mat, key, code, { uniforms = null } = {}) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    if (uniforms) Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * normal);
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${uniforms ? Object.keys(uniforms).map((u) => `uniform float ${u};`).join('\n') : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{ ${code} }`);
  };
  return mat;
}
// Sandstone: bands of strata, darker in the creases, bleached on top.
const STRATA = `
  float band = sin(vWPos.y * 0.55 + sin(vWPos.x * 0.031 + vWPos.z * 0.023) * 2.2);
  float ledge = step(0.72, fract(vWPos.y * 0.085 + 0.13 * sin(vWPos.x * 0.05)));
  diffuseColor.rgb *= 0.86 + 0.09 * band - 0.08 * ledge;
  if (vWNormal.y > 0.5) diffuseColor.rgb *= 1.14;`;
// Wind ripples in the sand, faded out where they would shimmer.
const RIPPLES = `
  vec2 q = vWPos.xz;
  float aa = clamp(1.0 - length(fwidth(q)) * 0.22, 0.0, 1.0);
  float rip = sin(dot(q, vec2(0.21, 0.13)) + sin(q.x * 0.011) * 3.0 + sin(q.y * 0.017) * 2.0);
  float rip2 = sin(dot(q, vec2(-0.08, 0.31)) * 1.7 + sin(q.x * 0.004) * 4.0);
  diffuseColor.rgb *= 1.0 + (0.05 * rip + 0.025 * rip2) * aa;`;

// Steel deck plates, 12 m square: dark seams and a slightly different sheen per plate, faded out
// where a plate is only a few pixels across.
const PLATES = `
  vec2 q = vWPos.xz / 12.0;
  vec2 cell = floor(q), f = fract(q), fw = fwidth(q);
  float aa = clamp(1.0 - max(fw.x, fw.y) * 2.0, 0.0, 1.0);
  vec2 e = smoothstep(vec2(0.0), fw * 1.5 + 0.015, f) * smoothstep(vec2(0.0), fw * 1.5 + 0.015, 1.0 - f);
  float seam = 1.0 - e.x * e.y;
  float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec2 g = fract(q * 3.0), gw = fw * 3.0;
  vec2 ge = smoothstep(vec2(0.0), gw * 1.5 + 0.02, g) * smoothstep(vec2(0.0), gw * 1.5 + 0.02, 1.0 - g);
  float grid = (1.0 - ge.x * ge.y) * clamp(1.0 - max(gw.x, gw.y) * 2.0, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, (0.86 + 0.18 * h) * (1.0 - 0.6 * seam) * (1.0 - 0.12 * grid), aa);`;
// Corrugated container walls: ribs along the long side, a paler lid.
const CRATE_RIBS = `
  vec3 an = abs(vWNormal);
  if (an.y < 0.5) {
    float u = an.x > an.z ? vWPos.z : vWPos.x;
    float fw = fwidth(u * 3.4);
    float rib = sin(u * 3.4 * 6.2832) * clamp(1.0 - fw * 2.5, 0.0, 1.0);
    diffuseColor.rgb *= 0.9 + 0.1 * rib;
  } else diffuseColor.rgb *= 1.12;`;

function gradientEnvironment(renderer, stops) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 32);
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 3 ? '#ffd9a0' : '#9fd4ff'; g.fillRect((i * 17) % 64, 17 + (i % 2), 2, 1); }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}

// Environment maps for reflections: a bright day sky and the night city. Returned so the stage can
// switch between them as the light changes.
export function createEnvironments(renderer) {
  return {
    day: gradientEnvironment(renderer, [[0, '#4d86d8'], [0.5, '#cfe2fa'], [0.56, '#6a6f78'], [1, '#2a2d33']]),
    night: gradientEnvironment(renderer, [[0, '#0c1630'], [0.5, '#3a4f86'], [0.56, '#1a1a22'], [1, '#07080c']]),
  };
}

// Kept for callers that only want the night look.
export function setNightEnvironment(renderer, scene) {
  scene.environment = createEnvironments(renderer).night;
  scene.environmentIntensity = 1.0;
}

export function buildStageVisual(scene, stage, options = {}) {
  const theme = THEMES[options.theme || stage.theme] || THEMES.city;
  const PH = theme.phases;
  const pal = Object.assign({}, theme.palette, (stage.visual && stage.visual.palette) || {}, options.palette || {});
  const group = new THREE.Group();
  group.name = `stage:${stage.id}`;
  const b = stage.bounds;
  const groundY = stage.groundY || 0;

  scene.background = new THREE.Color(PH[2].fog);
  scene.fog = new THREE.FogExp2(PH[2].fog, PH[2].fogDensity);
  const hemi = new THREE.HemisphereLight(PH[2].hemi.sky, PH[2].hemi.ground, PH[2].hemi.intensity);
  const sun = new THREE.DirectionalLight(PH[2].sun.color, PH[2].sun.intensity);
  sun.position.set(-320, 520, 240);
  group.add(hemi, sun);

  // Ground. A station's deck ends a little past the fence, over the void.
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (theme.deck || 3);
  const groundMat = theme.plates ? new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 0.62, metalness: 0.55 }) : new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 0.95, metalness: 0 });
  if (theme.ripples) worldShade(groundMat, 'sand-ground', RIPPLES);
  if (theme.plates) worldShade(groundMat, 'deck-plates', PLATES);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  group.add(ground);
  if (theme.deck) group.add(buildDeckEdge(extent, pal, groundY));
  if (theme.craters) group.add(buildCraters(stage, theme.craters, pal, groundY));
  if (theme.dunes) group.add(buildDunes(stage, theme.dunes, pal, groundY));

  // Roads: lighter strips with a pale line along each edge.
  const roads = (stage.visual && stage.visual.roads) || [];
  if (roads.length) {
    const roadMat = theme.plates ? new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.6, metalness: 0.55 }) : new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.9, metalness: 0 });
    if (theme.plates) worldShade(roadMat, 'lane-plates', PLATES);
    const lines = [];
    for (const r of roads) {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((r.x0 + r.x1) / 2, groundY + 0.03, (r.z0 + r.z1) / 2);
      group.add(m);
      const y = groundY + 0.06, inset = 1.5;
      if (w >= d) lines.push(r.x0, y, r.z0 + inset, r.x1, y, r.z0 + inset, r.x0, y, r.z1 - inset, r.x1, y, r.z1 - inset);
      else lines.push(r.x0 + inset, y, r.z0, r.x0 + inset, y, r.z1, r.x1 - inset, y, r.z0, r.x1 - inset, y, r.z1);
    }
    if (theme.roadLines !== false) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      // Glowing lane edges (a colour brighter than white, so the bloom picks them up) on the deck.
      const lineMat = new THREE.LineBasicMaterial({ color: pal.lane, transparent: true, opacity: theme.laneGlow ? 0.85 : 0.55 });
      if (theme.laneGlow) lineMat.color.multiplyScalar(theme.laneGlow);
      group.add(new THREE.LineSegments(lg, lineMat));
    }
  }

  // Static boxes by tag.
  const byTag = {};
  for (const s of stage.statics) (byTag[s.tag || 'building'] = byTag[s.tag || 'building'] || []).push(s);
  const buildings = byTag.building ? buildBuildings(byTag.building, pal, theme.windows === 'adobe' ? 1 : theme.windows === 'station' ? 2 : 0) : null;
  if (buildings) group.add(buildings.mesh);
  for (const tag of ['deck', 'kerb', 'rail', 'pillar', 'prop', 'rock', 'mesa']) if (byTag[tag]) group.add(buildPlainBoxes(byTag[tag], tag, pal, { strata: tag === 'mesa' || (tag === 'rock' && theme.strata) }));
  if (byTag.crate) group.add(buildCrates(byTag.crate, pal));
  for (const r of stage.ramps || []) group.add(buildRamp(r, pal));
  const vis = stage.visual || {};
  const lamps = vis.lamps && vis.lamps.length ? buildLamps(vis.lamps, pal) : null;
  if (lamps) group.add(lamps.group);
  const beacons = vis.beacons && vis.beacons.length ? buildBeacons(vis.beacons, pal) : null;
  if (beacons) group.add(beacons.mesh);
  if (vis.lanes && vis.lanes.length) group.add(buildDashes(vis.lanes, pal));

  // The arena fence: faint glowing walls at the bounds.
  const fenceMat = new THREE.MeshBasicMaterial({ color: pal.fence, transparent: true, opacity: pal.fenceOpacity == null ? 0.08 : pal.fenceOpacity, side: THREE.DoubleSide, depthWrite: false });
  const fh = 120;
  const fence = new THREE.Group();
  const addWall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, fh), fenceMat); m.position.set(x, groundY + fh / 2, z); m.rotation.y = ry; fence.add(m); };
  addWall(b.maxX - b.minX, (b.minX + b.maxX) / 2, b.minZ, 0);
  addWall(b.maxX - b.minX, (b.minX + b.maxX) / 2, b.maxZ, 0);
  addWall(b.maxZ - b.minZ, b.minX, (b.minZ + b.maxZ) / 2, Math.PI / 2);
  addWall(b.maxZ - b.minZ, b.maxX, (b.minZ + b.maxZ) / 2, Math.PI / 2);
  // Against a black sky the walls can hardly show, so a glowing line on the floor marks the fence too.
  if (theme.fenceLine) {
    const y = groundY + 0.08;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([b.minX, y, b.minZ, b.maxX, y, b.minZ, b.maxX, y, b.maxZ, b.minX, y, b.maxZ], 3));
    const lm = new THREE.LineBasicMaterial({ color: pal.fence, transparent: true, opacity: 0.9 });
    lm.color.multiplyScalar(theme.fenceLine);
    fence.add(new THREE.LineLoop(lg, lm));
  }
  group.add(fence);
  scene.add(group);

  // ---- time of day
  const envs = options.environments || null;
  const ca = new THREE.Color(), cb = new THREE.Color();
  const lerpColor = (a, b2, k) => ca.setHex(a).lerp(cb.setHex(b2), k);
  const phase = { sky: { top: new THREE.Color(), horizon: new THREE.Color(), bottom: new THREE.Color() }, stars: 1, night: 1, sunDir: [0, 1, 0], sunColor: new THREE.Color(), fog: new THREE.Color() };
  function setTimeOfDay(t) {
    t = Math.max(0, Math.min(1, t));
    const [p, q] = t < 0.5 ? [PH[0], PH[1]] : [PH[1], PH[2]];
    const k = (t - p.t) / (q.t - p.t);
    const num = (a, b2) => a + (b2 - a) * k;
    phase.sky.top.copy(lerpColor(p.sky[0], q.sky[0], k));
    phase.sky.horizon.copy(lerpColor(p.sky[1], q.sky[1], k));
    phase.sky.bottom.copy(lerpColor(p.sky[2], q.sky[2], k));
    phase.stars = num(p.stars, q.stars);
    phase.night = num(p.night, q.night);
    scene.fog.color.copy(lerpColor(p.fog, q.fog, k));
    scene.fog.density = num(p.fogDensity, q.fogDensity);
    scene.background.copy(scene.fog.color);
    sun.color.copy(lerpColor(p.sun.color, q.sun.color, k));
    sun.intensity = num(p.sun.intensity, q.sun.intensity);
    sun.position.set(num(p.sun.dir[0], q.sun.dir[0]), num(p.sun.dir[1], q.sun.dir[1]), num(p.sun.dir[2], q.sun.dir[2])).normalize().multiplyScalar(600);
    phase.sunDir = [sun.position.x / 600, sun.position.y / 600, sun.position.z / 600];
    phase.sunColor.copy(sun.color);
    phase.fog.copy(scene.fog.color);
    hemi.color.copy(lerpColor(p.hemi.sky, q.hemi.sky, k));
    hemi.groundColor.copy(lerpColor(p.hemi.ground, q.hemi.ground, k));
    hemi.intensity = num(p.hemi.intensity, q.hemi.intensity);
    if (buildings) buildings.setNight(phase.night);
    if (lamps) lamps.setNight(phase.night);
    if (envs) {
      const dayness = num(p.envDay, q.envDay);
      scene.environment = dayness > 0.5 ? envs.day : envs.night;
      scene.environmentIntensity = dayness > 0.5 ? 0.6 + 0.4 * dayness : 1.0;
    }
    return phase;
  }
  setTimeOfDay(options.timeOfDay == null ? 1 : options.timeOfDay);

  return {
    group, setTimeOfDay, phase,
    // Per frame: whatever on the stage moves by itself (the beacons blink).
    animate(time) { if (beacons) beacons.blink(time); },
    theme: { id: options.theme || stage.theme || 'city', earth: theme.earth || null, sun: !!theme.sunDisc,
      sky: Object.assign({ earth: theme.earth || null, planet: null, nebula: null, starsBelow: false }, theme.sky || {}) },
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    },
  };
}

// Street lamps: a dark post and an emissive head that comes on at dusk. Purely visual.
function buildLamps(lamps, pal) {
  const g = new THREE.Group();
  g.name = 'lamps';
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 8, 0.6), new THREE.MeshStandardMaterial({ color: pal.post, roughness: 0.7, metalness: 0.5 }), lamps.length);
  const headMat = new THREE.MeshStandardMaterial({ color: pal.lamp, emissive: pal.lamp, emissiveIntensity: 2.5, roughness: 0.4 });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), headMat, lamps.length);
  const m = new THREE.Matrix4();
  lamps.forEach((l, i) => {
    m.identity().setPosition(l.post[0], l.post[1] + 4, l.post[2]);
    posts.setMatrixAt(i, m);
    m.identity().setPosition(l.head[0], l.head[1], l.head[2]);
    heads.setMatrixAt(i, m);
  });
  posts.name = 'lamp-posts'; heads.name = 'lamp-heads';
  g.add(posts, heads);
  return { group: g, setNight(n) { headMat.emissiveIntensity = 2.5 * Math.max(0, Math.min(1, (n - 0.35) / 0.4)); } };
}

// Red beacons on the antenna masts, blinking slowly, each a little out of step with the others.
function buildBeacons(list, pal) {
  const geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const phase = new Float32Array(list.length);
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.beacon || 0xff3030).multiplyScalar(3) });
  const uTime = { value: 0 };
  mat.customProgramCacheKey = () => 'beacons';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPhase;\nvarying float vBlink;\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlink = 0.12 + 0.88 * step(0.72, fract(uTime * 0.55 + aPhase));');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBlink;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= vBlink;\n#include <opaque_fragment>');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); mesh.setMatrixAt(i, m); phase[i] = (i * 0.37) % 1; });
  mesh.name = 'beacons';
  return { mesh, blink(t) { uTime.value = t; } };
}

// The deck's edge: its thickness under the plates, a dark lip and a line of lights round the rim.
function buildDeckEdge(extent, pal, groundY) {
  const g = new THREE.Group();
  g.name = 'deck-edge';
  const h = extent / 2;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(extent, 26, extent), new THREE.MeshStandardMaterial({ color: pal.edge || 0x2a2f38, roughness: 0.7, metalness: 0.6 }));
  slab.position.set(0, groundY - 13.05, 0);
  g.add(slab);
  const lipMat = new THREE.MeshStandardMaterial({ color: pal.kerb, roughness: 0.6, metalness: 0.6 });
  for (const [x, z, w, d] of [[0, h, extent, 3], [0, -h, extent, 3], [h, 0, 3, extent], [-h, 0, 3, extent]]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), lipMat);
    lip.position.set(x, groundY + 0.8, z);
    g.add(lip);
  }
  const pts = [];
  for (let v = -h + 10; v <= h - 10; v += 20) pts.push(v, h - 3, -v, -h + 3, h - 3, v, -h + 3, v);
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.lane || 0x5fe6ff).multiplyScalar(2.2) }), pts.length / 2);
  const m = new THREE.Matrix4();
  for (let i = 0; i < pts.length / 2; i++) { m.makeTranslation(pts[i * 2], groundY + 0.3, pts[i * 2 + 1]); lights.setMatrixAt(i, m); }
  g.add(lights);
  return g;
}

// Cargo containers: one instanced mesh, coloured per container from the palette.
function buildCrates(list, pal) {
  const mat = worldShade(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.35 }), 'crate-ribs', CRATE_RIBS);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
  const m = new THREE.Matrix4(), color = new THREE.Color();
  const colors = pal.crates || [pal.concrete];
  list.forEach((s, i) => {
    m.makeScale(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]);
    m.setPosition((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(colors[(s.tint || 0) % colors.length]));
  });
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'statics:crate';
  return mesh;
}

// Dashed centre lines (6 m dash, 6 m gap) for roads and decks.
function buildDashes(lanes, pal) {
  const pts = [];
  for (const l of lanes) {
    const dx = l.x1 - l.x0, dz = l.z1 - l.z0, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    for (let d = 3; d + 6 <= len; d += 12) pts.push(l.x0 + ux * d, l.y + 0.06, l.z0 + uz * d, l.x0 + ux * (d + 6), l.y + 0.06, l.z0 + uz * (d + 6));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: pal.lamp, transparent: true, opacity: 0.7 }));
  lines.name = 'dashes';
  return lines;
}

// A ramp's walkable slope as a tilted slab whose top face is the surface the controller walks on.
function buildRamp(r, pal) {
  const alongX = r.axis === 'x';
  const len = alongX ? r.max[0] - r.min[0] : r.max[2] - r.min[2];
  const width = alongX ? r.max[2] - r.min[2] : r.max[0] - r.min[0];
  const rise = r.max[1] - r.min[1];
  const slope = Math.hypot(len, rise), angle = Math.atan2(rise, len), thick = 1.5;
  const geo = alongX ? new THREE.BoxGeometry(slope, thick, width) : new THREE.BoxGeometry(width, thick, slope);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal.concrete, roughness: 0.85, metalness: 0.05 }));
  if (alongX) mesh.rotation.z = r.up * angle; else mesh.rotation.x = -r.up * angle;
  const normal = new THREE.Vector3(0, 1, 0).applyEuler(mesh.rotation);
  mesh.position.set((r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2).addScaledVector(normal, -thick / 2);
  mesh.name = 'ramp';
  return mesh;
}

// Shallow crater rings on the ground (visual only), placed by the stage seed clear of buildings.
function buildCraters(stage, count, pal, groundY) {
  const g = new THREE.Group();
  g.name = 'craters';
  const rnd = makeRng((stage.seed || 1) * 7 + 5);
  const b = stage.bounds;
  const rimMat = new THREE.MeshStandardMaterial({ color: pal.concrete, roughness: 1, metalness: 0 });
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.ground).multiplyScalar(0.72), roughness: 1, metalness: 0 });
  const clearOf = (x, z, r) => !stage.statics.some((s) => s.tag === 'building' && x - r < s.max[0] && x + r > s.min[0] && z - r < s.max[2] && z + r > s.min[2]);
  for (let i = 0, tries = 0; i < count && tries < count * 10; tries++) {
    const r = rnd.range(6, 22);
    const x = rnd.range(b.minX + r, b.maxX - r), z = rnd.range(b.minZ + r, b.maxZ - r);
    if (!clearOf(x, z, r)) continue;
    const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.78, r, 28), rimMat);
    rim.rotation.x = -Math.PI / 2; rim.position.set(x, groundY + 0.05, z);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 28), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, groundY + 0.04, z);
    g.add(rim, floor);
    i++;
  }
  return g;
}

// Dunes: long low mounds of sand in a ring beyond the fence (scenery: nobody walks there).
function buildDunes(stage, count, pal, groundY) {
  const rnd = makeRng((stage.seed || 1) * 13 + 7);
  const b = stage.bounds, half = Math.min(b.maxX, b.maxZ);
  const mat = worldShade(new THREE.MeshStandardMaterial({ color: pal.dune || pal.ground, roughness: 0.95, metalness: 0 }), 'sand-dune', RIPPLES);
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 28, 12), mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = rnd.range(0, Math.PI * 2), r = half * rnd.range(1.12, 2.1);
    const sy = rnd.range(14, 55);
    pos.set(Math.cos(a) * r, groundY - sy * 0.35, Math.sin(a) * r);
    sc.set(rnd.range(80, 230), sy, rnd.range(60, 170));
    q.setFromEuler(e.set(0, a + rnd.range(-0.6, 0.6), 0));
    mesh.setMatrixAt(i, m.compose(pos, q, sc));
  }
  mesh.name = 'dunes';
  return mesh;
}

function buildPlainBoxes(list, tag, pal, { strata = false } = {}) {
  const color = tag === 'rail' ? pal.rail : tag === 'kerb' ? pal.kerb : tag === 'rock' ? (pal.rock || pal.concrete) : tag === 'mesa' ? (pal.mesa || pal.rock || pal.concrete) : pal.concrete;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: tag === 'rock' || tag === 'mesa' ? 1 : 0.8, metalness: tag === 'rail' ? 0.6 : 0.05 });
  if (strata) worldShade(mat, `strata-${tag}`, STRATA);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  list.forEach((s, i) => {
    m.makeScale(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]);
    m.setPosition((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    mesh.setMatrixAt(i, m);
  });
  mesh.name = `statics:${tag}`;
  return mesh;
}

// Fragment code for the building walls (see buildBuildings).
const CITY_WALLS = `
        {
          vec3 an = abs(vWNormal);
          if (an.y < 0.5) {
            // Window grid on the walls, 4 m wide and 3.6 m per floor, from world position.
            vec2 uv = an.x > an.z ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
            vec2 cuv = uv / vec2(4.0, 3.6);
            vec2 cell = floor(cuv);
            vec2 f = fract(cuv);
            vec2 fw = fwidth(cuv);                       // cells per pixel: anti-aliasing width
            vec2 lo = smoothstep(vec2(0.2, 0.22) - fw, vec2(0.2, 0.22) + fw, f);
            vec2 hi = 1.0 - smoothstep(vec2(0.8, 0.78) - fw, vec2(0.8, 0.78) + fw, f);
            float win = lo.x * hi.x * lo.y * hi.y;
            float h = cityHash(cell);
            // Lights come on one by one through dusk: the lowest hashes first.
            float on = smoothstep(h - 0.05, h + 0.05, uNight * 0.4 + 0.15) * step(0.3, h);
            vec3 warm = vec3(1.0, 0.72, 0.42), cool = vec3(0.55, 0.82, 1.0);
            vec3 wc = mix(warm, cool, step(0.86, h));
            // Far away the grid is finer than a pixel: fade to its average glow instead of shimmering.
            float far = smoothstep(0.3, 1.2, max(fw.x, fw.y));
            float avgWin = 0.6 * 0.4 * uNight;
            vec3 avgGlow = mix(warm, cool, 0.14) * 0.3 * avgWin;
            totalEmissiveRadiance += mix(wc * on * win, avgGlow, far) * 0.95;
            // Glass: dark at night, a pale sky reflection by day.
            diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - mix(win, avgWin, far) * 0.6), mix(diffuseColor.rgb, vec3(0.62, 0.72, 0.86), win * 0.55), 1.0 - uNight);
          } else {
            diffuseColor.rgb *= 0.8;
          }
        }`;
// Adobe: mud courses, small square openings on some cells (dark by day, a few lamp-lit at dusk),
// flat sun-bleached roofs.
const ADOBE_WALLS = `
        {
          vec3 an = abs(vWNormal);
          if (an.y < 0.5) {
            vec2 uv = an.x > an.z ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
            vec2 cuv = uv / vec2(6.0, 5.0);
            vec2 cell = floor(cuv);
            vec2 f = fract(cuv);
            vec2 fw = fwidth(cuv);
            float h = cityHash(cell);
            float hole = step(0.5, h)
              * smoothstep(0.32 - fw.x, 0.32 + fw.x, f.x) * (1.0 - smoothstep(0.64 - fw.x, 0.64 + fw.x, f.x))
              * smoothstep(0.34 - fw.y, 0.34 + fw.y, f.y) * (1.0 - smoothstep(0.74 - fw.y, 0.74 + fw.y, f.y));
            float far = smoothstep(0.08, 0.3, max(fw.x, fw.y));        // openings smaller than a few pixels fade out
            hole *= 1.0 - far;
            float course = 0.95 + 0.05 * sin(vWPos.y * 1.9 + cityHash(vec2(cell.x, 3.0)) * 6.0);
            diffuseColor.rgb *= course * (1.0 - hole * 0.78);
            float lit = step(0.84, h) * smoothstep(0.3, 0.8, uNight);
            totalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * hole * lit * 0.9 + vec3(1.0, 0.6, 0.28) * far * 0.04 * uNight;
          } else {
            diffuseColor.rgb *= 1.06;
          }
        }`;

// Station modules: steel panels with seams, a row of portholes on every third course (most of them
// lit), a thin light band every 12 m of height, and darker plated roofs.
const STATION_WALLS = `
        {
          vec3 an = abs(vWNormal);
          if (an.y < 0.5) {
            vec2 uv = an.x > an.z ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y);
            vec2 cuv = uv / vec2(8.0, 4.0);
            vec2 cell = floor(cuv), f = fract(cuv), fw = fwidth(cuv);
            float far = smoothstep(0.12, 0.4, max(fw.x, fw.y));
            vec2 e = smoothstep(vec2(0.0), fw * 1.2 + 0.03, f) * smoothstep(vec2(0.0), fw * 1.2 + 0.03, 1.0 - f);
            float seam = (1.0 - e.x * e.y) * (1.0 - far);
            float h = cityHash(cell);
            diffuseColor.rgb *= (0.88 + 0.14 * h) * (1.0 - 0.5 * seam);
            float row = step(1.5, mod(cell.y, 3.0)) * (1.0 - step(2.5, mod(cell.y, 3.0)));
            vec2 pm = (f - 0.5) * vec2(8.0, 4.0);
            float pd = length(pm * vec2(1.0, 1.3));
            float pw = max(fw.x * 8.0, fw.y * 4.0) * 1.5;
            float port = row * (1.0 - smoothstep(0.85 - pw, 0.85 + pw, pd)) * (1.0 - far);
            float lit = step(0.22, h);
            vec3 pc = mix(vec3(0.62, 0.9, 1.0), vec3(1.0, 0.8, 0.52), step(0.72, h));
            diffuseColor.rgb *= 1.0 - port * 0.75;
            totalEmissiveRadiance += pc * (port * lit * 1.7 + far * row * 0.05) * uNight;
            float yb = fract((vWPos.y - 10.7) / 12.0) * 12.0;
            float bw = fwidth(vWPos.y) * 1.5;
            float band = (1.0 - smoothstep(0.3, 0.3 + bw + 0.02, yb)) * (1.0 - far * 0.7);
            totalEmissiveRadiance += vec3(0.35, 0.9, 1.0) * band * 1.3 * uNight;
          } else {
            vec2 q = vWPos.xz / 6.0;
            vec2 f = fract(q), fw = fwidth(q);
            vec2 e = smoothstep(vec2(0.0), fw * 1.5 + 0.03, f) * smoothstep(vec2(0.0), fw * 1.5 + 0.03, 1.0 - f);
            float aa = clamp(1.0 - max(fw.x, fw.y) * 2.0, 0.0, 1.0);
            diffuseColor.rgb *= 0.7 * (1.0 - 0.35 * (1.0 - e.x * e.y) * aa);
          }
        }`;

// style 0: glass towers with a grid of windows; 1: adobe walls with small dark openings; 2: station modules.
function buildBuildings(list, pal, style = 0) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const seeds = new Float32Array(list.length);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const mat = style === 1 ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 })
    : style === 2 ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.5 })
      : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 });
  const uniforms = { uNight: { value: 1 } };
  mat.customProgramCacheKey = () => ['city-windows', 'adobe-walls', 'station-walls'][style];
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 cityWPos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vec4 cityWPos = modelMatrix * vec4(transformed, 1.0);
          vWNormal = normalize(mat3(modelMatrix) * normal);
        #endif
        vWPos = cityWPos.xyz;
        vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying float vSeed;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        // The seed is whole per building, but arrives interpolated: round it, or the hash turns tiny
        // differences across a wall into speckle.
        float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + floor(vSeed + 0.5) * 17.31) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${[CITY_WALLS, ADOBE_WALLS, STATION_WALLS][style]}`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  list.forEach((s, i) => {
    m.makeScale(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]);
    m.setPosition((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
    mesh.setMatrixAt(i, m);
    seeds[i] = s.seed == null ? i * 0.618 : s.seed;
    mesh.setColorAt(i, color.setHex(pal.buildings[(s.tint == null ? i : s.tint) % pal.buildings.length]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'statics:building';
  return { mesh, setNight(n) { uniforms.uNight.value = n; } };
}
