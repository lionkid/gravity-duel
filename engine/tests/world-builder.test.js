// The stage visuals are built from Stage data with plain Three.js objects, so they can be checked in
// Node without a renderer: every static box becomes an instance placed at its box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildStageVisual } from '../render/world-builder.js';

const stage = {
  id: 't', groundY: 0, bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100, ceiling: 300 },
  statics: [
    { min: [-35, 0, -35], max: [35, 60, 35], tag: 'building', tint: 1, seed: 3 },
    { min: [-100, 20.5, 40], max: [100, 22, 70], tag: 'deck' },
    { min: [-100, 22, 69], max: [100, 23.5, 70], tag: 'rail' },
    { min: [-2, 0, 53], max: [2, 20.5, 57], tag: 'pillar' },
  ],
  ramps: [{ min: [-15, 0, -80], max: [15, 22, 0], axis: 'z', up: 1 }],
  spawns: [], visual: { roads: [{ x0: -15, z0: -100, x1: 15, z1: 100 }] },
};

test('every static box becomes a correctly placed instance', () => {
  const scene = new THREE.Scene();
  const { group } = buildStageVisual(scene, stage);
  const byName = {};
  group.traverse((o) => { if (o.name) byName[o.name] = o; });
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const tag of ['building', 'deck', 'rail', 'pillar']) {
    const mesh = byName[`statics:${tag}`];
    assert.ok(mesh && mesh.isInstancedMesh, `${tag} mesh exists`);
    const boxes = stage.statics.filter((b) => b.tag === tag);
    assert.equal(mesh.count, boxes.length);
    boxes.forEach((b, i) => {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, s);
      assert.deepEqual([p.x, p.y, p.z], [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
      assert.deepEqual([s.x, s.y, s.z], [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]);
    });
    mesh.computeBoundingSphere();
    assert.ok(mesh.boundingSphere.radius > 1, 'bounding sphere covers the instances, not the unit box');
  }
});

test('a ramp is a tilted slab whose top face lies on the walkable surface', () => {
  const scene = new THREE.Scene();
  const { group } = buildStageVisual(scene, stage);
  const ramp = group.children.find((o) => o.name === 'ramp');
  assert.ok(ramp);
  ramp.updateMatrixWorld(true);
  // The slab's top-face centre must sit at the ramp's surface midpoint (0, 11, -40).
  const top = new THREE.Vector3(0, 0.75, 0).applyMatrix4(ramp.matrixWorld);
  assert.ok(Math.abs(top.x) < 1e-6 && Math.abs(top.y - 11) < 1e-6 && Math.abs(top.z + 40) < 1e-6, `top centre ${top.toArray().map((v) => v.toFixed(2))}`);
  // And it rises toward +z: a point at the slab's +z end is higher.
  const far = new THREE.Vector3(0, 0.75, Math.hypot(80, 22) / 2).applyMatrix4(ramp.matrixWorld);
  assert.ok(Math.abs(far.y - 22) < 1e-6 && Math.abs(far.z) < 1e-6, `far end ${far.toArray().map((v) => v.toFixed(2))}`);
});
