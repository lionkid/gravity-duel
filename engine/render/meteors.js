// Meteors: drifting rocks (lumpy, cratered, tumbling slowly; see-through while one hides the
// player's own mech or holds the camera, and a soft shadow on whatever is under each), falling
// meteors (a white-hot head and a long fiery tail that sheds smoke and sparks), the red circle where
// each one will land with a beam of light over it, and scorch marks left behind. The simulation's
// world.meteors drives it:
//
//   const view = createMeteorView(scene, { smoke, sparks });
//   view.sync(world.meteors, alpha, dt, camera, focus, statics);   // each frame; focus: the player's mech
//   view.scorch(x, y, z, r);                                         // after a burst

import * as THREE from 'three';
import { raycast } from '../sim/sweep.js';

const TAU = Math.PI * 2;

// A value noise on the unit sphere's directions, for the rock shapes (CPU side, built once).
function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, s);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// A rock of radius about 1 (never more): an icosphere pushed in and out by noise, with a few craters,
// flat-shaded so it reads as faceted stone. The surface stays between 0.86 and 1.0 of the radius,
// close to the simulation's sphere.
function rockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  let s = seed * 7919 + 17;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const craters = [];
  for (let i = 0; i < 7; i++) {
    const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z);
    craters.push({ x: r * Math.cos(a), y: z, z: r * Math.sin(a), size: 0.22 + rnd() * 0.35, depth: 0.035 + rnd() * 0.05 });
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let k = 0.95 + 0.07 * (noise3(v.x * 1.8 + 5, v.y * 1.8, v.z * 1.8, seed) - 0.5) * 2 + 0.03 * (noise3(v.x * 4.5, v.y * 4.5 + 9, v.z * 4.5, seed + 1) - 0.5) * 2;
    for (const c of craters) {
      const d = Math.acos(Math.max(-1, Math.min(1, v.x * c.x + v.y * c.y + v.z * c.z)));
      if (d < c.size) k -= c.depth * (1 - (d / c.size) ** 2);
      else if (d < c.size * 1.35) k += c.depth * 0.35 * Math.sin((d - c.size) / (c.size * 0.35) * Math.PI);
    }
    k = Math.max(0.86, Math.min(1, k));
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// Rocks dissolve with an ordered dither (no sorting, no depth trouble) where aFade is below one.
function rockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0.04 });
  mat.customProgramCacheKey = () => 'drift-rock';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFade;
        varying vec3 vObj;
        float rockHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
        float bayer4(vec2 p) {
          const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
          int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
          return (m[i] + 0.5) / 16.0;
        }`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.999 && vFade <= bayer4(floor(gl_FragCoord.xy))) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rn = rockHash(floor(vObj * 5.0)) * 0.6 + rockHash(floor(vObj * 13.0) + 3.0) * 0.4;
        diffuseColor.rgb *= 0.74 + 0.36 * rn;`);
  };
  return mat;
}

// The falling meteor's tail: a tapered tube along the flight, hottest at the head, fading behind.
function tailMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: `
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
        float along = pow(1.0 - vT, 1.6);
        float flick = 0.85 + 0.15 * sin(uTime * 40.0 + vT * 30.0);
        vec3 hot = mix(uColor, vec3(1.0, 0.95, 0.85), (1.0 - vT) * (1.0 - vT));
        gl_FragColor = vec4(hot * 2.2, face * along * flick * 0.9);
      }`,
  });
}
// The beam over a warning circle: a tall faint column, brightest at the foot.
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } },
    vertexShader: `varying float vT; void main() { vT = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying float vT; void main() { gl_FragColor = vec4(uColor * 1.6, pow(1.0 - vT, 2.0) * uK); }`,
  });
}
// A soft dark disc, per instance alpha: the shadows under the rocks.
function shadowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `
      attribute float aAlpha; varying float vA; varying vec2 vUv;
      void main() { vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying float vA; varying vec2 vUv;
      void main() { float d = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA; if (a < 0.004) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
  });
}

let scorchTexture = null;
function getScorchTexture() {
  if (scorchTexture) return scorchTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  grad.addColorStop(0, 'rgba(8,6,5,0.95)'); grad.addColorStop(0.45, 'rgba(14,10,8,0.7)'); grad.addColorStop(0.8, 'rgba(20,14,10,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  // Streaks thrown out from the centre.
  g.strokeStyle = 'rgba(10,8,6,0.35)';
  for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + (i % 3) * 0.2; g.lineWidth = 2 + (i % 4); g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * (42 + (i % 5) * 4), 64 + Math.sin(a) * (42 + (i % 5) * 4)); g.stroke(); }
  scorchTexture = new THREE.CanvasTexture(c);
  return scorchTexture;
}
let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

// Tints for the rocks: greys and browns, from each rock's id.
const ROCK_TINTS = [0x8a8278, 0x6f6a64, 0x9a8a76, 0x7a7068, 0x5f5a56, 0x8f7c66];

// blast: the radius of the warning circles (the simulation's blast radius).
export function createMeteorView(scene, { maxRocks = 24, maxStrikes = 8, smoke = null, sparks = null, blast = 22, color = 0xff8a3a, warn = 0xff3b30 } = {}) {
  const group = new THREE.Group();
  group.name = 'meteors';
  scene.add(group);
  // ---- rocks: three shapes, each an instanced mesh with a fade attribute per instance
  const rockMat = rockMaterial();
  const shapes = [11, 23, 37].map((seed) => {
    const geo = rockGeometry(seed);
    const fade = new Float32Array(maxRocks).fill(1);
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fade, 1));
    const mesh = new THREE.InstancedMesh(geo, rockMat, maxRocks);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'drift-rocks';
    group.add(mesh);
    return { mesh, fade };
  });
  const shadowGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const shadowAlpha = new Float32Array(maxRocks);
  shadowGeo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(shadowAlpha, 1));
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMaterial(), maxRocks);
  shadows.count = 0; shadows.frustumCulled = false; shadows.renderOrder = 1; shadows.name = 'rock-shadows';
  group.add(shadows);
  const fades = new Map();             // rock id → current fade
  const spin = new Map();              // rock id → { axis, rate }

  // ---- strikes: head, tail, warning circle and beam
  const tailGeo = new THREE.CylinderGeometry(0.18, 1, 1, 14, 1, true).translate(0, 0.5, 0);
  const ringGeo = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
  const innerGeo = new THREE.RingGeometry(0.3, 0.34, 48).rotateX(-Math.PI / 2);
  const fillGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
  const flat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const strikes = [];
  for (let i = 0; i < maxStrikes; i++) {
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(color).multiplyScalar(2.4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(0xfff2dc).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const tail = new THREE.Mesh(tailGeo, tailMaterial(color));
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, flat(warn, 0.8));
    const inner = new THREE.Mesh(innerGeo, flat(warn, 0.7));
    const fill = new THREE.Mesh(fillGeo, flat(warn, 0.22));
    const beam = new THREE.Mesh(beamGeo, beamMaterial(warn));
    beam.scale.set(1.3, 170, 1.3);
    marker.add(ring, inner, fill, beam);
    for (const o of [head, core, tail, marker]) { o.visible = false; group.add(o); }
    for (const o of [head, core, tail, ring, inner, fill, beam]) o.frustumCulled = false;
    head.renderOrder = core.renderOrder = tail.renderOrder = 5;
    strikes.push({ id: 0, head, core, tail, marker, ring, inner, fill, beam, acc: 0 });
  }
  // ---- scorch marks
  const scorches = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: getScorchTexture(), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.visible = false; m.renderOrder = 1; m.name = 'scorch';
    group.add(m);
    scorches.push({ mesh: m, ttl: 0 });
  }
  let nextScorch = 0, clock = 0;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), axis = new THREE.Vector3();
  const tint = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), cam = new THREE.Vector3();
  const segDist = (px, py, pz, a, b) => {
    // distance from p to the segment a→b
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / l2));
    return Math.hypot(px - a.x - abx * t, py - a.y - aby * t, pz - a.z - abz * t);
  };

  return {
    group,
    // alpha: interpolation between the last two simulation ticks (rocks and meteors move in straight
    // lines, so the previous position is the current one minus a tick of velocity).
    sync(m, alpha, dt, camera, focus, statics, tick = 1 / 60) {
      clock += dt;
      const rocks = m ? m.rocks : [];
      const counts = [0, 0, 0];
      let ns = 0;
      if (camera) camera.getWorldPosition(cam);
      const eye = focus ? { x: focus.x, y: focus.y + 12, z: focus.z } : null;
      for (const rk of rocks) {
        const back = (1 - alpha) * tick;
        const x = rk.x - rk.vx * back, y = rk.y - (rk.vy || 0) * back, z = rk.z - rk.vz * back;
        // See-through while the rock is between the camera and the player's mech, gone with the camera inside.
        let want = 1;
        if (camera) {
          const dc = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
          if (dc < rk.r + 6) want = 0;
          else if (eye && segDist(x, y, z, cam, eye) < rk.r + 1.5) want = 0.32;
        }
        const f0 = fades.has(rk.id) ? fades.get(rk.id) : want;
        const f = f0 + (want - f0) * (1 - Math.exp(-10 * dt));
        fades.set(rk.id, f);
        let sp = spin.get(rk.id);
        if (!sp) {
          const a = rk.id * 2.399, zz = ((rk.id * 0.618) % 1) * 2 - 1, rr = Math.sqrt(1 - zz * zz);
          sp = { axis: new THREE.Vector3(rr * Math.cos(a), zz, rr * Math.sin(a)), rate: 0.05 + ((rk.id * 0.37) % 1) * 0.1, start: rk.id * 1.7 };
          spin.set(rk.id, sp);
        }
        const k = rk.id % 3, sh = shapes[k], i = counts[k]++;
        if (i >= maxRocks) continue;
        q.setFromAxisAngle(sp.axis, sp.start + clock * sp.rate);
        m4.compose(pos.set(x, y, z), q, scl.set(rk.r, rk.r, rk.r));
        sh.mesh.setMatrixAt(i, m4);
        sh.mesh.setColorAt(i, tint.setHex(ROCK_TINTS[rk.id % ROCK_TINTS.length]));
        sh.fade[i] = f;
        // The shadow on the deck or roof below.
        if (statics && ns < maxRocks) {
          const hit = raycast(statics, { x, y: y - rk.r, z }, { x, y: -1, z });
          const gy = hit ? hit.y : statics.groundY;
          const h = Math.max(0, y - rk.r - gy);
          const a = 0.6 * (1 - Math.min(0.85, h / 160)) * f;
          if (a > 0.01) {
            m4.compose(pos.set(x, gy + 0.08, z), q.identity(), scl.setScalar(rk.r * (1.15 - Math.min(0.4, h / 300))));
            shadows.setMatrixAt(ns, m4);
            shadowAlpha[ns++] = a;
          }
        }
      }
      shapes.forEach((sh, k) => {
        sh.mesh.count = Math.min(maxRocks, counts[k]);
        sh.mesh.instanceMatrix.needsUpdate = true;
        if (sh.mesh.instanceColor) sh.mesh.instanceColor.needsUpdate = true;
        sh.mesh.geometry.attributes.aFade.needsUpdate = true;
      });
      shadows.count = ns;
      shadows.instanceMatrix.needsUpdate = true;
      shadows.geometry.attributes.aAlpha.needsUpdate = true;

      // Falling meteors and their warning circles.
      const list = m ? m.strikes : [];
      strikes.forEach((v, i) => {
        const s = list[i];
        const on = !!s;
        v.head.visible = v.core.visible = v.tail.visible = v.marker.visible = on;
        if (!on) { v.id = 0; return; }
        if (v.id !== s.id) { v.id = s.id; v.acc = 0; }
        const back = (1 - alpha) * tick;
        const x = s.x - s.vx * back, y = s.y - s.vy * back, z = s.z - s.vz * back;
        const flick = 0.85 + 0.3 * Math.random();
        v.head.position.set(x, y, z); v.head.scale.setScalar(22 * flick);
        v.core.position.set(x, y, z); v.core.scale.setScalar(8);
        const speed = Math.hypot(s.vx, s.vy, s.vz) || 1;
        dir.set(-s.vx / speed, -s.vy / speed, -s.vz / speed);
        v.tail.position.set(x, y, z);
        v.tail.quaternion.setFromUnitVectors(up, dir);
        v.tail.scale.set(4.2, 120, 4.2);
        v.tail.material.uniforms.uTime.value = clock;
        // Smoke and sparks shed along the way.
        if (dt > 0) {
          v.acc += dt * 70;
          while (v.acc >= 1) {
            v.acc -= 1;
            const u = Math.random() * 6;
            if (smoke) smoke.burst(x + dir.x * (4 + u), y + dir.y * (4 + u), z + dir.z * (4 + u), 0x7a7470, 1, 5, 1.8, -1, 1.1);
            if (sparks) sparks.burst(x, y, z, 0xffa040, 1, 26, 0.35, 10, 0, dir, 0.8);
          }
        }
        // The circle fills in as the meteor comes down, pulsing faster near the end.
        const p = Math.max(0, Math.min(1, s.t / Math.max(1e-3, s.t + s.eta)));
        const R = blast;
        v.marker.position.set(s.ax, s.ay + 0.25, s.az);
        v.ring.scale.setScalar(R);
        v.inner.scale.setScalar(R);
        v.fill.scale.setScalar(Math.max(0.01, R * p));
        const pulse = 0.5 + 0.5 * Math.sin(clock * (7 + 16 * p));
        v.ring.material.opacity = 0.45 + 0.5 * pulse;
        v.inner.material.opacity = 0.3 + 0.5 * pulse;
        v.fill.material.opacity = 0.12 + 0.18 * p;
        v.beam.material.uniforms.uK.value = 0.25 + 0.35 * pulse * (0.4 + 0.6 * p);
      });

      for (const sc of scorches) {
        if (sc.ttl <= 0) { if (sc.mesh.visible) sc.mesh.visible = false; continue; }
        sc.ttl -= dt;
        sc.mesh.material.opacity = Math.min(0.9, sc.ttl / 4) * 0.9;
      }
    },
    // A burnt patch where a meteor came down on a floor, fading out over about 14 s.
    scorch(x, y, z, r) {
      const sc = scorches[nextScorch]; nextScorch = (nextScorch + 1) % scorches.length;
      sc.ttl = 14;
      sc.mesh.position.set(x, y + 0.1, z);
      sc.mesh.rotation.y = Math.random() * TAU;
      sc.mesh.scale.setScalar(r);
      sc.mesh.visible = true;
    },
    clear() {
      for (const sh of shapes) sh.mesh.count = 0;
      shadows.count = 0;
      for (const v of strikes) { v.head.visible = v.core.visible = v.tail.visible = v.marker.visible = false; v.id = 0; }
      for (const sc of scorches) { sc.ttl = 0; sc.mesh.visible = false; }
      fades.clear();
    },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); },
  };
}
