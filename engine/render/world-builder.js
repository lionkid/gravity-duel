// Builds the visible stage from Stage data: sky, lights, ground, roads, and every static box as a
// mesh. Buildings are one InstancedMesh whose windows are drawn in the shader from world position,
// so a whole city costs a handful of draw calls and needs no textures. setTimeOfDay(t) moves the
// scene from day (0) through dusk (0.5) to night (1): sky, sun, fog, windows and lamps follow.

import * as THREE from 'three';
import { makeRng } from '../core/rng.js';

const DEFAULT_PALETTE = {
  ground: 0x15181f, road: 0x1d222c, lane: 0x7d8696, kerb: 0x2a3040,
  concrete: 0x5a6378, rail: 0x8893a6, fence: 0x58e0ff, lamp: 0xffe2b0, post: 0x1b1f2a,
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
    palette: Object.assign({}, DEFAULT_PALETTE, { ground: 0x44464c, road: 0x35373d, lane: 0x8d93a0, kerb: 0x3a3c42, concrete: 0x6b6f7a, rail: 0x9aa3b2, lamp: 0xd8ecff, rock: 0x55575d, buildings: [0x3b4250, 0x454c5c, 0x4d4a56, 0x3a4652, 0x50545f] }),
    phases: [Object.assign({ t: 0 }, LUNAR), Object.assign({ t: 0.5 }, LUNAR), Object.assign({ t: 1 }, LUNAR)],
    earth: { dir: [0.35, 0.5, -0.75], size: 0.1, sun: [0.5, 0.8, -0.3] },
    craters: 36,
  },
};

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

  // Ground.
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 3;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  group.add(ground);
  if (theme.craters) group.add(buildCraters(stage, theme.craters, pal, groundY));

  // Roads: lighter strips with a pale line along each edge.
  const roads = (stage.visual && stage.visual.roads) || [];
  if (roads.length) {
    const roadMat = new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.9, metalness: 0 });
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
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: pal.lane, transparent: true, opacity: 0.55 })));
  }

  // Static boxes by tag.
  const byTag = {};
  for (const s of stage.statics) (byTag[s.tag || 'building'] = byTag[s.tag || 'building'] || []).push(s);
  const buildings = byTag.building ? buildBuildings(byTag.building, pal) : null;
  if (buildings) group.add(buildings.mesh);
  for (const tag of ['deck', 'kerb', 'rail', 'pillar', 'prop', 'rock']) if (byTag[tag]) group.add(buildPlainBoxes(byTag[tag], tag, pal));
  for (const r of stage.ramps || []) group.add(buildRamp(r, pal));
  const vis = stage.visual || {};
  const lamps = vis.lamps && vis.lamps.length ? buildLamps(vis.lamps, pal) : null;
  if (lamps) group.add(lamps.group);
  if (vis.lanes && vis.lanes.length) group.add(buildDashes(vis.lanes, pal));

  // The arena fence: faint glowing walls at the bounds.
  const fenceMat = new THREE.MeshBasicMaterial({ color: pal.fence, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const fh = 120;
  const fence = new THREE.Group();
  const addWall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, fh), fenceMat); m.position.set(x, groundY + fh / 2, z); m.rotation.y = ry; fence.add(m); };
  addWall(b.maxX - b.minX, (b.minX + b.maxX) / 2, b.minZ, 0);
  addWall(b.maxX - b.minX, (b.minX + b.maxX) / 2, b.maxZ, 0);
  addWall(b.maxZ - b.minZ, b.minX, (b.minZ + b.maxZ) / 2, Math.PI / 2);
  addWall(b.maxZ - b.minZ, b.maxX, (b.minZ + b.maxZ) / 2, Math.PI / 2);
  group.add(fence);
  scene.add(group);

  // ---- time of day
  const envs = options.environments || null;
  const ca = new THREE.Color(), cb = new THREE.Color();
  const lerpColor = (a, b2, k) => ca.setHex(a).lerp(cb.setHex(b2), k);
  const phase = { sky: { top: new THREE.Color(), horizon: new THREE.Color(), bottom: new THREE.Color() }, stars: 1, night: 1 };
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
    theme: { id: options.theme || stage.theme || 'city', earth: theme.earth || null },
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

function buildPlainBoxes(list, tag, pal) {
  const color = tag === 'rail' ? pal.rail : tag === 'kerb' ? pal.kerb : tag === 'rock' ? (pal.rock || pal.concrete) : pal.concrete;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: tag === 'rock' ? 1 : 0.8, metalness: tag === 'rail' ? 0.6 : 0.05 });
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

function buildBuildings(list, pal) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const seeds = new Float32Array(list.length);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 });
  const uniforms = { uNight: { value: 1 } };
  mat.customProgramCacheKey = () => 'city-windows';
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
        float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 17.31) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
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
        }`);
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
