// Visual effects that are not part of the simulation: the shadow disc under a mech, vulcan tracers,
// projectile bodies, spark bursts and melee slash arcs. Everything is pooled; nothing allocates per frame.

import * as THREE from 'three';
import { raycast } from '../sim/sweep.js';

let blobTexture = null;
function getBlobTexture() {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

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

const tmpColor = new THREE.Color();

// Short-lived glowing lines for vulcan rounds.
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

// Spark particles: bursts at impacts, dust on landings. CPU-simulated points with additive blending.
export function createSparks(scene, { max = 512 } = {}) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3), ttl = new Float32Array(max), life = new Float32Array(max), base = new Float32Array(max * 3), grav = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  points.frustumCulled = false;
  points.name = 'sparks';
  scene.add(points);
  let next = 0, rnd = Math.random;
  return {
    // n particles from (x, y, z), speeds up to `speed`, living `lifeSec`; gravity pulls them down.
    burst(x, y, z, color, n = 16, speed = 30, lifeSec = 0.5, gravity = 40) {
      tmpColor.setHex(color == null ? 0xffffff : color);
      for (let k = 0; k < n; k++) {
        const i = next; next = (next + 1) % max;
        pos.set([x, y, z], i * 3);
        const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), sp = speed * (0.3 + 0.7 * rnd());
        vel.set([Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp], i * 3);
        base.set([tmpColor.r, tmpColor.g, tmpColor.b], i * 3);
        life[i] = ttl[i] = lifeSec * (0.6 + 0.4 * rnd());
        grav[i] = gravity;
      }
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (ttl[i] <= 0) { col.fill(0, i * 3, i * 3 + 3); continue; }
        ttl[i] -= dt;
        vel[i * 3 + 1] -= grav[i] * dt;
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

// Glowing arcs for melee swings, in front of the attacker, fading over their short life.
export function createSlashes(scene, { max = 6, life = 0.2 } = {}) {
  const items = [];
  for (let i = 0; i < max; i++) {
    const geo = new THREE.RingGeometry(5, 15, 16, 1, -0.4, 2.4);
    const mat = new THREE.MeshBasicMaterial({ color: 0x58e0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.name = 'slash';
    scene.add(mesh);
    items.push({ mesh, ttl: 0 });
  }
  let next = 0;
  return {
    spawn(x, y, z, yaw, color, combo = 0) {
      const it = items[next]; next = (next + 1) % max;
      it.ttl = life;
      it.mesh.visible = true;
      it.mesh.material.color.setHex(color == null ? 0x58e0ff : color);
      it.mesh.position.set(x, y + 11, z);
      // Face the swing forward (-Z local → yaw), tilt alternately for successive swings.
      it.mesh.rotation.set(-Math.PI / 2 + (combo % 2 ? 0.5 : -0.5), yaw, 0, 'YXZ');
      it.mesh.scale.setScalar(0.6);
    },
    update(dt) {
      for (const it of items) {
        if (it.ttl <= 0) { if (it.mesh.visible) it.mesh.visible = false; continue; }
        it.ttl -= dt;
        const k = Math.max(0, it.ttl / life);
        it.mesh.material.opacity = k * 0.9;
        it.mesh.scale.setScalar(0.6 + (1 - k) * 0.6);
      }
    },
    clear() { for (const it of items) { it.ttl = 0; it.mesh.visible = false; } },
  };
}

// Meshes for the simulation's projectiles: elongated glowing bolts pointing along their velocity.
export function createProjectileView(scene) {
  const meshes = new Map();
  const pool = [];
  const geo = new THREE.BoxGeometry(0.9, 0.9, 9);
  const tmp = new THREE.Vector3();
  const get = () => {
    const m = pool.pop() || new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = true;
    scene.add(m);
    return m;
  };
  return {
    // alpha interpolates between the projectile's previous and current simulation positions.
    sync(projectiles, alpha) {
      const seen = new Set();
      for (const p of projectiles) {
        seen.add(p.id);
        let m = meshes.get(p.id);
        if (!m) { m = get(); m.material.color.setHex(p.color == null ? 0x58e0ff : p.color); m.scale.set(1, 1, p.kind === 'handcannon' ? 0.5 : 1); meshes.set(p.id, m); }
        m.position.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha);
        tmp.set(p.vel.x, p.vel.y, p.vel.z);
        if (tmp.lengthSq() > 1e-6) m.lookAt(m.position.clone().sub(tmp));
      }
      for (const [id, m] of meshes) {
        if (seen.has(id)) continue;
        meshes.delete(id);
        scene.remove(m);
        m.visible = false;
        pool.push(m);
      }
    },
    clear() { for (const [, m] of meshes) { scene.remove(m); pool.push(m); } meshes.clear(); },
  };
}
