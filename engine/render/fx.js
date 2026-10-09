// Visual effects that are not part of the simulation: the shadow disc under a mech, projectile bodies
// with flames and trails, flashes, spark and smoke particles, melee slash arcs and blade trails.
// Everything is pooled; nothing allocates per frame.

import * as THREE from 'three';
import { raycast } from '../sim/sweep.js';

const tmpColor = new THREE.Color();
const tmpVec = new THREE.Vector3();

function radialTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(0.3, mid); grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
let blobTexture = null, flashTexture = null;
const getBlobTexture = () => blobTexture || (blobTexture = radialTexture('rgba(0,0,0,0.9)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'));
const getFlashTexture = () => flashTexture || (flashTexture = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)'));

// A soft shadow disc under a body, projected onto whatever is below it. It is how the player judges
// a landing, so it stays visible from any height, shrinking and fading as the drop grows.
export function createBlobShadow(radius = 7) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: getBlobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  const down = { x: 0, y: 0, z: 0 };
  return {
    mesh,
    update(pos, statics) {
      down.x = pos.x; down.y = pos.y - 400; down.z = pos.z;
      const from = { x: pos.x, y: pos.y + 1, z: pos.z };
      const hit = raycast(statics, from, down);
      const y = hit ? hit.y : statics.groundY;
      const drop = Math.max(0, pos.y - y);
      const k = Math.max(0.3, 1 - drop / 160);
      mesh.position.set(pos.x, y + 0.12, pos.z);
      mesh.scale.setScalar(k);
      mesh.material.opacity = 0.75 * k;
      mesh.visible = true;
    },
  };
}

// Spark / smoke particles: CPU-simulated points with additive blending. `size` is in metres, so a
// second instance with a larger size serves as smoke and debris.
export function createSparks(scene, { max = 512, size = 1.4 } = {}) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3), ttl = new Float32Array(max), life = new Float32Array(max), base = new Float32Array(max * 3), grav = new Float32Array(max), drag = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, map: getFlashTexture() }));
  points.frustumCulled = false;
  points.name = 'sparks';
  scene.add(points);
  let next = 0;
  const rnd = Math.random;
  return {
    // n particles from (x, y, z), speeds up to `speed`, living about `lifeSec`; gravity pulls them down,
    // drag slows them (smoke hangs, sparks fly). `dir` biases the burst along a direction.
    burst(x, y, z, color, n = 16, speed = 30, lifeSec = 0.5, gravity = 40, dragK = 0, dir = null, bias = 0) {
      tmpColor.setHex(color == null ? 0xffffff : color);
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % max;
        pos.set([x, y, z], i * 3);
        const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), sp = speed * (0.3 + 0.7 * rnd());
        let vx = Math.sin(ph) * Math.cos(th) * sp, vy = Math.cos(ph) * sp, vz = Math.sin(ph) * Math.sin(th) * sp;
        if (dir) { vx += dir.x * speed * bias; vy += dir.y * speed * bias; vz += dir.z * speed * bias; }
        vel.set([vx, vy, vz], i * 3);
        base.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
        life[i] = ttl[i] = lifeSec * (0.6 + 0.4 * rnd());
        grav[i] = gravity;
        drag[i] = dragK;
      }
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (ttl[i] <= 0) { col.fill(0, i * 3, i * 3 + 3); continue; }
        ttl[i] -= dt;
        vel[i * 3 + 1] -= grav[i] * dt;
        if (drag[i]) { const d = Math.exp(-drag[i] * dt); vel[i * 3] *= d; vel[i * 3 + 1] *= d; vel[i * 3 + 2] *= d; }
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const k = Math.max(0, ttl[i] / life[i]) * 2;
        col[i * 3] = base[i * 3] * k; col[i * 3 + 1] = base[i * 3 + 1] * k; col[i * 3 + 2] = base[i * 3 + 2] * k;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    clear() { ttl.fill(0); },
  };
}

// Camera-facing flashes for muzzles and explosions: a sprite that blows up and fades in a few frames.
export function createFlashes(scene, { max = 32 } = {}) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getFlashTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.visible = false;
    s.name = 'flash';
    scene.add(s);
    items.push({ sprite: s, ttl: 0, life: 0.1, size: 1 });
  }
  let next = 0;
  return {
    spawn(x, y, z, color, size = 4, life = 0.1) {
      const it = items[next]; next = (next + 1) % max;
      it.ttl = it.life = life; it.size = size;
      it.sprite.position.set(x, y, z);
      it.sprite.material.color.setHex(color == null ? 0xffffff : color);
      it.sprite.visible = true;
    },
    update(dt) {
      for (const it of items) {
        if (it.ttl <= 0) { if (it.sprite.visible) it.sprite.visible = false; continue; }
        it.ttl -= dt;
        const k = Math.max(0, it.ttl / it.life);
        it.sprite.scale.setScalar(it.size * (0.7 + (1 - k) * 0.8));
        it.sprite.material.opacity = k * k;
      }
    },
    clear() { for (const it of items) { it.ttl = 0; it.sprite.visible = false; } },
  };
}

// Glowing arcs for melee swings, in front of the attacker, fading over their short life.
export function createSlashes(scene, { max = 6, life = 0.22 } = {}) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.RingGeometry(6, 19, 18, 1, -0.5, 2.6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x58e0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.name = 'slash';
    scene.add(mesh);
    items.push({ mesh, ttl: 0 });
  }
  let next = 0;
  return {
    // style: 'slashR' sweeps right to left, 'slashL' the other way, 'overhead' comes straight down.
    spawn(x, y, z, yaw, color, style = 'slashR') {
      const it = items[next]; next = (next + 1) % max;
      it.ttl = life;
      it.mesh.visible = true;
      it.mesh.material.color.setHex(color == null ? 0x58e0ff : color);
      it.mesh.position.set(x, y + 11, z);
      if (style === 'overhead') it.mesh.rotation.set(0, yaw + Math.PI / 2, 0, 'YXZ');
      else it.mesh.rotation.set(-Math.PI / 2 + (style === 'slashL' ? 0.55 : -0.55), yaw, style === 'slashL' ? Math.PI : 0, 'YXZ');
      it.mesh.scale.setScalar(0.7);
    },
    update(dt) {
      for (const it of items) {
        if (it.ttl <= 0) { if (it.mesh.visible) it.mesh.visible = false; continue; }
        it.ttl -= dt;
        const k = Math.max(0, it.ttl / life);
        it.mesh.material.opacity = k * 0.9;
        it.mesh.scale.setScalar(0.7 + (1 - k) * 0.7);
      }
    },
    clear() { for (const it of items) { it.ttl = 0; it.mesh.visible = false; } },
  };
}

// A ribbon left behind a blade: push the blade's base and tip each frame while it swings and the
// ribbon fades out behind it. One per mech.
export function createBladeTrail(scene, { color = 0x58e0ff, segments = 20, life = 0.16 } = {}) {
  const n = segments;
  const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3), age = new Float32Array(n).fill(Infinity);
  const index = [];
  for (let i = 0; i < n - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(index);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'blade-trail';
  scene.add(mesh);
  tmpColor.setHex(color);
  const base = [tmpColor.r, tmpColor.g, tmpColor.b];
  return {
    setColor(c) { tmpColor.setHex(c); base[0] = tmpColor.r; base[1] = tmpColor.g; base[2] = tmpColor.b; },
    // Newest sample goes to slot 0; older ones shift back.
    push(a, b) {
      for (let i = n - 1; i > 0; i--) { pos.copyWithin(i * 6, (i - 1) * 6, i * 6); age[i] = age[i - 1]; }
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], 0);
      age[0] = 0;
      mesh.visible = true;
    },
    update(dt) {
      if (!mesh.visible) return;
      let alive = false;
      for (let i = 0; i < n; i++) {
        age[i] += dt;
        const k = Math.max(0, 1 - age[i] / life);
        if (k > 0) alive = true;
        for (let v = 0; v < 2; v++) { col[i * 6 + v * 3] = base[0] * k * 1.6; col[i * 6 + v * 3 + 1] = base[1] * k * 1.6; col[i * 6 + v * 3 + 2] = base[2] * k * 1.6; }
      }
      if (!alive) { mesh.visible = false; age.fill(Infinity); return; }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    clear() { age.fill(Infinity); mesh.visible = false; },
  };
}

// Projectile bodies. `look` picks the shape: small rockets, a medium rocket, a sniper bolt, a shell.
// Rockets carry a flickering flame and leave smoke through the `smoke` particle system; bolts leave
// a glowing trail through `sparks`.
const LOOKS = {
  rocketS: { r: 0.4, len: 2.8, flame: 1.4, trail: 'smoke', rate: 90 },
  rocketM: { r: 1.0, len: 7.5, flame: 3.6, trail: 'smoke', rate: 180, fins: true },
  bolt: { r: 0.55, len: 14, flame: 0, trail: 'glow', rate: 240 },
  shell: { r: 0.7, len: 3.2, flame: 0.8, trail: 'smoke', rate: 50 },
};
export function createProjectileView(scene, { smoke, sparks } = {}) {
  const live = new Map();
  const pools = {};
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4150, metalness: 0.6, roughness: 0.45 });
  const makeBody = (lookName, color) => {
    const L = LOOKS[lookName] || LOOKS.rocketS;
    const g = new THREE.Group();
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    if (lookName === 'bolt') {
      const core = new THREE.Mesh(new THREE.BoxGeometry(L.r, L.r, L.len), glow);
      const halo = new THREE.Mesh(new THREE.BoxGeometry(L.r * 3, L.r * 3, L.len * 0.8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(core, halo);
    } else {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(L.r * 0.9, L.r, L.len, 10), bodyMat);
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(L.r * 0.9, L.r * 2, 10), glow);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -L.len / 2 - L.r;
      g.add(body, nose);
      if (L.fins) {
        for (let i = 0; i < 4; i++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, L.r * 1.6, L.r * 1.8), bodyMat);
          fin.position.set(0, L.r * 1.3, L.len / 2 - L.r);
          fin.rotation.z = i * Math.PI / 2;
          fin.position.applyAxisAngle(new THREE.Vector3(0, 0, 1), i * Math.PI / 2);
          g.add(fin);
        }
      }
      if (L.flame) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(L.r * 0.9, L.flame, 8), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
        flame.rotation.x = Math.PI / 2;
        flame.position.z = L.len / 2 + L.flame / 2;
        flame.name = 'flame';
        g.add(flame);
      }
    }
    g.userData.look = lookName;
    return g;
  };
  const acquire = (lookName, color) => {
    const pool = pools[lookName] || (pools[lookName] = []);
    const g = pool.pop() || makeBody(lookName, color);
    g.traverse((o) => { if (o.material && o.material.color && o !== g && o.material !== bodyMat && o.name !== 'flame') o.material.color.setHex(color); });
    g.visible = true;
    scene.add(g);
    return g;
  };
  const release = (g) => { scene.remove(g); g.visible = false; pools[g.userData.look].push(g); };

  return {
    // Builds one body of every look up front so their shaders compile at start-up, not on the first shot.
    warm() { for (const name of Object.keys(LOOKS)) release(acquire(name, 0xffffff)); },
    // alpha interpolates between the projectile's previous and current simulation positions; dt is
    // the frame time, used to emit trail particles at a steady rate.
    sync(projectiles, alpha, dt = 0) {
      const seen = new Set();
      for (const p of projectiles) {
        seen.add(p.id);
        let it = live.get(p.id);
        if (!it) { it = { g: acquire(p.look || 'rocketS', p.color == null ? 0x58e0ff : p.color), acc: 0 }; live.set(p.id, it); }
        const g = it.g;
        g.position.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha);
        tmpVec.set(p.vel.x, p.vel.y, p.vel.z);
        const speed = tmpVec.length();
        if (speed > 1e-6) g.lookAt(g.position.x - tmpVec.x, g.position.y - tmpVec.y, g.position.z - tmpVec.z);
        const L = LOOKS[p.look] || LOOKS.rocketS;
        const flame = g.getObjectByName('flame');
        if (flame) { const f = 0.8 + 0.5 * Math.random(); flame.scale.set(f, 0.7 + 0.6 * Math.random(), f); }
        if (dt > 0 && speed > 1e-6) {
          it.acc += dt * L.rate;
          const tail = { x: g.position.x + tmpVec.x / speed * (L.len / 2 + L.flame), y: g.position.y + tmpVec.y / speed * (L.len / 2 + L.flame), z: g.position.z + tmpVec.z / speed * (L.len / 2 + L.flame) };
          while (it.acc >= 1) {
            it.acc -= 1;
            if (L.trail === 'smoke' && smoke) smoke.burst(tail.x, tail.y, tail.z, 0xaab0bd, 1, 3, 1.1, -2, 1.5);
            else if (sparks) sparks.burst(tail.x, tail.y, tail.z, p.color, 1, 3, 0.25, 0, 0);
          }
        }
      }
      for (const [id, it] of live) {
        if (seen.has(id)) continue;
        live.delete(id);
        release(it.g);
      }
    },
    clear() { for (const [, it] of live) release(it.g); live.clear(); },
  };
}

// Kept for games that want hitscan tracers (thin lines that fade in a few frames).
export function createTracers(scene, { max = 96, life = 0.08 } = {}) {
  const pos = new Float32Array(max * 6), col = new Float32Array(max * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  lines.name = 'tracers';
  scene.add(lines);
  const ttl = new Float32Array(max), base = new Float32Array(max * 3);
  let next = 0;
  return {
    spawn(x0, y0, z0, x1, y1, z1, color) {
      const i = next; next = (next + 1) % max;
      pos.set([x0, y0, z0, x1, y1, z1], i * 6);
      tmpColor.setHex(color == null ? 0xffd080 : color);
      base.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
      ttl[i] = life;
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (ttl[i] <= 0) { col.fill(0, i * 6, i * 6 + 6); continue; }
        ttl[i] -= dt;
        const k = Math.max(0, ttl[i] / life) * 2.5;
        for (let v = 0; v < 2; v++) { col[i * 6 + v * 3] = base[i * 3] * k; col[i * 6 + v * 3 + 1] = base[i * 3 + 1] * k; col[i * 6 + v * 3 + 2] = base[i * 3 + 2] * k; }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    clear() { ttl.fill(0); },
  };
}
