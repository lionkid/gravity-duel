// Bullseye boards for practice targets: a face of five coloured rings (gold, red, blue, black, white
// from the centre), a dark backing, a glowing rim that reads at night, a stand down to the ground or
// the roof, and a little rotor frame for the hovering kind. One InstancedMesh per part, so twenty
// boards cost a handful of draw calls. The simulation's target list drives it:
//
//   const boards = createTargetView(scene);
//   boards.sync(world.targets, alpha, dt);  // each frame
//   boards.hit(tid, heavy);                 // a flash and a wobble on impact

import * as THREE from 'three';

const RING_COLORS = [0xffcf3a, 0xe0393a, 0x3a7be0, 0x23262e, 0xf1efe6];
const FORWARD = new THREE.Vector3(0, 0, -1);

// The face: concentric bands of equal width in the XY plane, facing +Z (rotated to face along -Z below).
function faceGeometry(segments = 40) {
  const parts = [];
  const n = RING_COLORS.length;
  for (let i = 0; i < n; i++) {
    const g = i === 0 ? new THREE.CircleGeometry(1 / n, segments) : new THREE.RingGeometry(i / n, (i + 1) / n, segments, 1);
    const c = new THREE.Color(RING_COLORS[i]);
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let v = 0; v < count; v++) col.set([c.r, c.g, c.b], v * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.toNonIndexed());
  }
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.rotateY(Math.PI);           // the face looks along -Z, the way yaw 0 faces
  return geo;
}

export function createTargetView(scene, { max = 32, rimColor = 0x58e0ff } = {}) {
  const group = new THREE.Group();
  group.name = 'targets';
  scene.add(group);
  const mk = (geo, mat, name) => {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.count = 0; m.frustumCulled = false; m.name = name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  const face = mk(faceGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide, emissive: 0x222222 }), 'target-faces');
  face.setColorAt(0, new THREE.Color(1, 1, 1));            // allocate per-instance colours (hit flash)
  const back = mk(new THREE.CylinderGeometry(1.04, 1.04, 0.5, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7, metalness: 0.4 }), 'target-backs');
  const rim = mk(new THREE.TorusGeometry(1.06, 0.045, 6, 48), new THREE.MeshBasicMaterial({ color: rimColor }), 'target-rims');
  const post = mk(new THREE.BoxGeometry(0.7, 1, 0.7).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.6, metalness: 0.5 }), 'target-posts');
  const foot = mk(new THREE.CylinderGeometry(1.8, 2.2, 0.6, 16).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7, metalness: 0.5 }), 'target-feet');
  // The drone frame on top of the board: a body, two cross arms and four glowing rotor discs, in
  // board units (radius 1), so it scales with the board.
  const merge = (parts) => {
    const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0; for (const g of list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3); let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return geo;
  };
  const droneGeo = merge([
    new THREE.BoxGeometry(0.9, 0.28, 1.05).translate(0, 1.16, 0.8),
    new THREE.BoxGeometry(1.95, 0.1, 0.1).translate(0, 1.16, 0.35),
    new THREE.BoxGeometry(1.95, 0.1, 0.1).translate(0, 1.16, 1.25),
    new THREE.BoxGeometry(0.14, 0.24, 0.14).translate(0, 1.02, 0.5),
  ]);
  const drone = mk(droneGeo, new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.5, metalness: 0.6 }), 'target-drones');
  const rotorGeo = merge([[-0.95, 0.35], [0.95, 0.35], [-0.95, 1.25], [0.95, 1.25]].map(([x, z]) => new THREE.CircleGeometry(0.36, 16).rotateX(-Math.PI / 2).translate(x, 1.24, z)));
  const rotors = mk(rotorGeo, new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 'target-rotors');

  const state = new Map();               // tid → { flash, wobble, wobbleV, pop, alive }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0);
  let time = 0;

  return {
    group,
    hit(tid, heavy = false) {
      const st = state.get(tid);
      if (!st) return;
      st.flash = heavy ? 0.22 : 0.12;
      st.wobbleV += heavy ? 9 : 5;
    },
    sync(targets, alpha = 1, dt = 0) {
      time += dt;
      let nf = 0, nb = 0, nr = 0, np = 0, nd = 0, nt = 0, nfoot = 0;
      for (const tg of targets || []) {
        let st = state.get(tg.id);
        if (!st) { st = { flash: 0, wobble: 0, wobbleV: 0, pop: tg.alive ? 1 : 0, alive: tg.alive }; state.set(tg.id, st); }
        if (tg.alive && !st.alive) st.pop = 0;
        st.alive = tg.alive;
        if (!tg.alive) continue;
        st.pop = Math.min(1, st.pop + dt * 4);
        st.flash = Math.max(0, st.flash - dt);
        // A damped spring: knocked back on a hit, settling again.
        st.wobbleV += (-st.wobble * 120 - st.wobbleV * 9) * dt;
        st.wobble += st.wobbleV * dt;
        const pop = 1 - Math.pow(1 - st.pop, 3);
        const x = tg.prev.x + (tg.pos.x - tg.prev.x) * alpha, y = tg.prev.y + (tg.pos.y - tg.prev.y) * alpha, z = tg.prev.z + (tg.pos.z - tg.prev.z) * alpha;
        const r = tg.radius * pop;
        q.setFromAxisAngle(yAxis, tg.yaw);
        q2.setFromAxisAngle(xAxis, st.wobble * 0.12);
        q.multiply(q2);
        p.set(x, y, z);
        face.setMatrixAt(nf, m4.compose(p, q, s.set(r, r, r)));
        const f = 1 + st.flash * 10;
        face.setColorAt(nf, c.setRGB(f, f, f));
        nf++;
        // The backing sits just behind the face (along the board's +Z, away from the viewer it faces).
        const off = new THREE.Vector3(0, 0, 0.3 * r).applyQuaternion(q);       // in board units, like its thickness
        back.setMatrixAt(nb++, m4.compose(p.clone().add(off), q, s.set(r, r, r)));
        rim.setMatrixAt(nr++, m4.compose(p, q, s.set(r, r, r)));
        if (tg.kind === 'drone') {
          drone.setMatrixAt(nd++, m4.compose(p, q, s.set(r, r, r)));
          rotors.setMatrixAt(nt++, m4.compose(p, q, s.set(r, r, r)));
        } else {
          // The stand: from the floor (ground or roof) up to the bottom of the board.
          const floor = tg.floor || 0, bottom = y - r * 0.95, h = Math.max(0.1, bottom - floor);
          q2.setFromAxisAngle(yAxis, tg.yaw);
          post.setMatrixAt(np++, m4.compose(new THREE.Vector3(x, floor, z), q2, s.set(1, h, 1)));
          foot.setMatrixAt(nfoot++, m4.compose(new THREE.Vector3(x, floor, z), q2, s.set(1, 1, 1)));
        }
      }
      for (const [mesh, n] of [[face, nf], [back, nb], [rim, nr], [post, np], [foot, nfoot], [drone, nd], [rotors, nt]]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (face.instanceColor) face.instanceColor.needsUpdate = true;
      rotors.material.opacity = 0.4 + 0.2 * Math.sin(time * 40);
    },
    // Rims glow brighter at night, so the boards can be found in the dark.
    setNight(n) { rim.material.color.setHex(rimColor).multiplyScalar(0.6 + 1.6 * n); face.material.emissive.setScalar(0.08 + 0.25 * n); },
    clear() { state.clear(); for (const mesh of [face, back, rim, post, foot, drone, rotors]) mesh.count = 0; },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
  };
}
