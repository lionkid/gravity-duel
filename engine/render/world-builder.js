// Builds the visible stage from Stage data: sky, lights, ground, roads, and every static box as a
// mesh. Buildings are one InstancedMesh whose windows are drawn in the shader from world position,
// so a whole city costs a handful of draw calls and needs no textures.

import * as THREE from 'three';

const DEFAULT_PALETTE = {
  sky: 0x0a0d18, fog: 0x0a0d18, ground: 0x15181f, road: 0x1d222c, lane: 0x7d8696, kerb: 0x2a3040,
  concrete: 0x4a5160, rail: 0x8893a6, fence: 0x58e0ff,
  buildings: [0x2b3346, 0x343c52, 0x3d4154, 0x283447, 0x3a3348],
};

// A small equirectangular gradient used as the environment map: metal armour needs something to
// reflect, and a night sky over a lit city is enough.
export function setNightEnvironment(renderer, scene, { top = '#0c1630', horizon = '#3a4f86', ground = '#07080c' } = {}) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, top); grad.addColorStop(0.5, horizon); grad.addColorStop(0.56, '#1a1a22'); grad.addColorStop(1, ground);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 32);
  // A few bright spots so highlights have something to catch.
  for (let i = 0; i < 12; i++) { g.fillStyle = i % 3 ? '#ffd9a0' : '#9fd4ff'; g.fillRect((i * 17) % 64, 17 + (i % 2), 2, 1); }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  scene.environmentIntensity = 1.0;
  tex.dispose(); pmrem.dispose();
}

export function buildStageVisual(scene, stage, options = {}) {
  const pal = Object.assign({}, DEFAULT_PALETTE, (stage.visual && stage.visual.palette) || {}, options.palette || {});
  const group = new THREE.Group();
  group.name = `stage:${stage.id}`;
  const b = stage.bounds;
  const groundY = stage.groundY || 0;

  scene.background = new THREE.Color(pal.sky);
  scene.fog = new THREE.FogExp2(pal.fog, options.fogDensity == null ? 0.0009 : options.fogDensity);
  group.add(new THREE.HemisphereLight(0x5f74ad, 0x0d1016, 1.6));
  const moon = new THREE.DirectionalLight(0xb4c2ff, 1.9);
  moon.position.set(-320, 520, 240);
  group.add(moon);

  // Ground.
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 3;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), new THREE.MeshStandardMaterial({ color: pal.ground, roughness: 0.95, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  group.add(ground);

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
      if (w >= d) {
        lines.push(r.x0, y, r.z0 + inset, r.x1, y, r.z0 + inset, r.x0, y, r.z1 - inset, r.x1, y, r.z1 - inset);
      } else {
        lines.push(r.x0 + inset, y, r.z0, r.x0 + inset, y, r.z1, r.x1 - inset, y, r.z0, r.x1 - inset, y, r.z1);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: pal.lane, transparent: true, opacity: 0.55 })));
  }

  // Static boxes by tag.
  const byTag = {};
  for (const s of stage.statics) (byTag[s.tag || 'building'] = byTag[s.tag || 'building'] || []).push(s);
  if (byTag.building) group.add(buildBuildings(byTag.building, pal));
  for (const tag of ['deck', 'kerb', 'rail', 'pillar', 'prop']) if (byTag[tag]) group.add(buildPlainBoxes(byTag[tag], tag, pal));

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
  return {
    group,
    dispose() {
      scene.remove(group);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    },
  };
}

function buildPlainBoxes(list, tag, pal) {
  const color = tag === 'rail' ? pal.rail : tag === 'kerb' ? pal.kerb : pal.concrete;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: tag === 'rail' ? 0.6 : 0.05 });
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
  mat.customProgramCacheKey = () => 'city-windows';
  mat.onBeforeCompile = (shader) => {
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
            float on = step(0.6, h);
            vec3 warm = vec3(1.0, 0.72, 0.42), cool = vec3(0.55, 0.82, 1.0);
            vec3 wc = mix(warm, cool, step(0.86, h));
            // Far away the grid is finer than a pixel: fade to its average glow instead of shimmering.
            float far = smoothstep(0.3, 1.2, max(fw.x, fw.y));
            float avgWin = 0.6 * 0.56;
            vec3 avgGlow = mix(warm, cool, 0.14) * 0.4 * avgWin;
            totalEmissiveRadiance += mix(wc * on * win, avgGlow, far) * 1.5;
            diffuseColor.rgb *= 1.0 - mix(win, avgWin, far) * 0.6;
          } else {
            // Roofs: a thin lit edge so building tops read against the dark sky.
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
    const seed = s.seed == null ? i * 0.618 : s.seed;
    seeds[i] = seed;
    mesh.setColorAt(i, color.setHex(pal.buildings[(s.tint == null ? i : s.tint) % pal.buildings.length]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.name = 'statics:building';
  return mesh;
}
