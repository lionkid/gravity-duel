// The gizmo's picking and dragging maths, without a renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGizmo, rayAxisParam, rayPlanePoint, planeBasis, angleInPlane, angleDelta, eulerAxes } from '../render/gizmo.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ray = (ox, oy, oz, dx, dy, dz) => new THREE.Ray(new THREE.Vector3(ox, oy, oz), new THREE.Vector3(dx, dy, dz).normalize());

test('a ray meets an axis at the parameter of the closest point, and a plane where it crosses it', () => {
  const origin = new THREE.Vector3(0, 0, 0), x = new THREE.Vector3(1, 0, 0);
  // Looking from +z at the point (3, 0, 0) on the axis.
  assert.ok(near(rayAxisParam(ray(3, 0, 10, 0, 0, -1), origin, x), 3));
  // A ray passing above the axis at x = -2.
  assert.ok(near(rayAxisParam(ray(-2, 5, 10, 0, 0, -1), origin, x), -2));
  assert.ok(Number.isNaN(rayAxisParam(ray(0, 0, 10, 1, 0, 0), origin, x)), 'along the axis: undefined');
  const p = rayPlanePoint(ray(1, 2, 10, 0, 0, -1), origin, new THREE.Vector3(0, 0, 1));
  assert.ok(p && near(p.x, 1) && near(p.y, 2) && near(p.z, 0));
  assert.equal(rayPlanePoint(ray(0, 0, 10, 1, 0, 0), origin, new THREE.Vector3(0, 0, 1)), null, 'parallel');
  assert.equal(rayPlanePoint(ray(0, 0, -10, 0, 0, -1), origin, new THREE.Vector3(0, 0, 1)), null, 'behind the eye');
});

test('angles around an axis are right-handed and their differences wrap', () => {
  const axis = new THREE.Vector3(0, 1, 0);
  const { u, v } = planeBasis(axis);
  assert.ok(near(u.dot(axis), 0) && near(v.dot(axis), 0) && near(u.dot(v), 0));
  assert.ok(near(new THREE.Vector3().crossVectors(u, v).dot(axis), 1), '(u, v, axis) right-handed');
  const o = new THREE.Vector3(0, 0, 0);
  const a0 = angleInPlane(u.clone(), o, u, v);
  const turned = u.clone().applyAxisAngle(axis, 0.7);
  assert.ok(near(angleDelta(a0, angleInPlane(turned, o, u, v)), 0.7), 'a +0.7 turn about the axis reads as +0.7');
  assert.ok(near(angleDelta(3.0, -3.0), 2 * Math.PI - 6.0));
  assert.ok(near(angleDelta(-3.0, 3.0), -(2 * Math.PI - 6.0)));
});

test('the Euler axes are the ones a component change really turns about', () => {
  const parent = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  const e = new THREE.Euler(0.3, -0.5, 0.8, 'XYZ');
  const [ax, ay, az] = eulerAxes(parent, e);
  const world = (euler) => new THREE.Quaternion().copy(parent).multiply(new THREE.Quaternion().setFromEuler(euler));
  const probe = new THREE.Vector3(0.3, 0.5, 0.7).normalize();
  for (const [i, axis] of [[0, ax], [1, ay], [2, az]]) {
    const e2 = e.clone(); e2[['x', 'y', 'z'][i]] += 0.25;
    const before = probe.clone().applyQuaternion(world(e));
    const after = probe.clone().applyQuaternion(world(e2));
    const expected = before.clone().applyAxisAngle(axis, 0.25);
    assert.ok(after.distanceTo(expected) < 1e-9, `component ${i}: changing it turns about its axis`);
  }
});

test('the gizmo shows one mode at a time, picks its handles and scales with distance', () => {
  const g = createGizmo();
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  g.show('move', new THREE.Vector3(0, 0, 0), axes);
  g.group.updateMatrixWorld(true);
  const visible = g.group.children.filter((c) => c.visible).length;
  assert.equal(visible, 3);
  const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 0, 20);
  g.update(cam);
  assert.ok(near(g.group.scale.x, 20 * 0.09));
  g.group.updateMatrixWorld(true);
  // A ray down -z through the tip of the x arrow (at x ≈ 1.1 × scale).
  const rc = new THREE.Raycaster(new THREE.Vector3(1.1 * g.group.scale.x, 0, 10), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(g.pick(rc), { mode: 'move', axis: 0 });
  const miss = new THREE.Raycaster(new THREE.Vector3(5, 5, 10), new THREE.Vector3(0, 0, -1));
  assert.equal(g.pick(miss), null);
  g.show('rotate', new THREE.Vector3(0, 0, 0), axes);
  g.update(cam); g.group.updateMatrixWorld(true);
  // The z ring lies in the xy plane: a ray down -z through a point of it off both other rings hits it.
  const r45 = 1.15 * g.group.scale.x * Math.SQRT1_2;
  const rz = new THREE.Raycaster(new THREE.Vector3(r45, r45, 10), new THREE.Vector3(0, 0, -1));
  assert.deepEqual(g.pick(rz), { mode: 'rotate', axis: 2 });
  g.hover({ mode: 'rotate', axis: 2 });
  g.hide();
  assert.ok(!g.group.visible && g.mode === null);
  g.dispose();
});
