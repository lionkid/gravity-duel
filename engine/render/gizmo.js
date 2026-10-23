// A transform gizmo for editors: three arrows to move along axes, three rings to turn about them, three
// cubes to resize along them. Each handle is oriented on its own, so the axes need not be orthogonal
// (an Euler rotation's three axes are not). It keeps a constant size on screen, draws over everything,
// and picks with fat invisible hit shapes. The dragging maths (where a mouse ray meets an axis or a
// plane, the angle of a point around an axis) are plain functions, shared with whoever drags.
//
//   const gizmo = createGizmo(); scene.add(gizmo.group);
//   gizmo.show('move', position, [xAxis, yAxis, zAxis]);   // world-space unit axes
//   gizmo.update(camera);                                  // each frame
//   const hit = gizmo.pick(raycaster);                     // { mode, axis } | null
//   gizmo.hover(hit); gizmo.hide();

import * as THREE from 'three';

export const AXIS_COLORS = [0xff5a5a, 0x7cff6b, 0x58a8ff];
const UP = new THREE.Vector3(0, 1, 0), OUT = new THREE.Vector3(0, 0, 1);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

export function createGizmo({ screenSize = 0.09 } = {}) {
  const group = new THREE.Group();
  group.name = 'gizmo';
  group.visible = false;
  group.renderOrder = 20;
  const handles = [];               // { mode, axis, node, meshes, hit }
  const mat = (color, opacity = 0.85) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const add = (mode, axis, meshes, hit) => {
    const node = new THREE.Group();
    for (const m of meshes) { m.renderOrder = 20; node.add(m); }
    hit.renderOrder = 20; hit.visible = false;
    node.add(hit);
    node.visible = false;
    group.add(node);
    handles.push({ mode, axis, node, meshes, hit, color: AXIS_COLORS[axis] });
  };
  for (let axis = 0; axis < 3; axis++) {
    const color = AXIS_COLORS[axis];
    // Arrow: a shaft and a tip along +Y; the handle is turned onto its axis.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 10).translate(0, 0.5, 0), mat(color));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 12).translate(0, 1.12, 0), mat(color));
    add('move', axis, [shaft, tip], new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.35, 8).translate(0, 0.7, 0), hitMat));
    // Ring in the XY plane (normal +Z), turned so its normal is the axis.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.028, 8, 56), mat(color));
    add('rotate', axis, [ring], new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 6, 40), hitMat));
    // Cube out along +Y, with a thin stem.
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 8).translate(0, 0.475, 0), mat(color, 0.6));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 1.0, 0), mat(color));
    add('size', axis, [stem, cube], new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.36).translate(0, 0.95, 0), hitMat));
  }
  let mode = null, hovered = null;
  const q = new THREE.Quaternion();
  return {
    group,
    get mode() { return mode; },
    // Shows the handles of `which` at `position`, each along its world-space axis.
    show(which, position, axes) {
      mode = which;
      group.visible = true;
      group.position.copy(position);
      for (const h of handles) {
        h.node.visible = h.mode === which;
        if (!h.node.visible) continue;
        const axis = tmpA.copy(axes[h.axis]).normalize();
        h.node.quaternion.copy(q.setFromUnitVectors(h.mode === 'rotate' ? OUT : UP, axis));
      }
    },
    hide() { group.visible = false; mode = null; this.hover(null); },
    // Keeps the gizmo the same size on screen, whatever the distance.
    update(camera) {
      if (!group.visible) return;
      const d = camera.position.distanceTo(group.position);
      group.scale.setScalar(Math.max(0.01, d * screenSize));
    },
    // The handle under a ray, nearest first: { mode, axis } or null.
    pick(raycaster) {
      if (!group.visible) return null;
      let best = null;
      for (const h of handles) {
        if (!h.node.visible) continue;
        const hits = raycaster.intersectObject(h.hit, false);
        if (hits.length && (!best || hits[0].distance < best.distance)) best = { mode: h.mode, axis: h.axis, distance: hits[0].distance };
      }
      return best ? { mode: best.mode, axis: best.axis } : null;
    },
    // Lights up the handle the pointer is over (or none).
    hover(hit) {
      const next = hit ? handles.find((h) => h.mode === hit.mode && h.axis === hit.axis) : null;
      if (next === hovered) return;
      if (hovered) for (const m of hovered.meshes) { m.material.color.setHex(hovered.color); m.material.opacity = m.material.userData.base ?? 0.85; }
      hovered = next || null;
      if (hovered) for (const m of hovered.meshes) { m.material.userData.base = m.material.opacity; m.material.color.setHex(0xffffff); m.material.opacity = 1; }
    },
    dispose() { group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
  };
}

// ---------------------------------------------------------------- dragging maths
// The parameter t of the point origin + axis * t closest to the ray (axis a unit vector); NaN when the
// ray runs along the axis.
export function rayAxisParam(ray, origin, axis) {
  // Closest points between two lines: P(t) = o + a t, Q(s) = r + d s.
  const w = tmpA.copy(ray.origin).sub(origin);         // from the axis origin to the ray origin
  const d = ray.direction;
  const ad = axis.dot(d), aw = axis.dot(w), dw = d.dot(w);
  const denom = 1 - ad * ad;
  if (Math.abs(denom) < 1e-9) return NaN;
  return (aw - ad * dw) / denom;
}

// Where the ray meets the plane through `origin` with unit `normal`, as a new Vector3, or null when it
// runs parallel to it.
export function rayPlanePoint(ray, origin, normal) {
  const denom = ray.direction.dot(normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = tmpB.copy(origin).sub(ray.origin).dot(normal) / denom;
  if (t < 0) return null;
  return new THREE.Vector3().copy(ray.direction).multiplyScalar(t).add(ray.origin);
}

// Unit vectors u, v perpendicular to `axis` with (u, v, axis) right-handed, so that a turn by +θ about
// the axis takes u toward v.
export function planeBasis(axis) {
  const a = tmpC.copy(axis).normalize();
  const pick = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(pick, a).normalize();
  const v = new THREE.Vector3().crossVectors(a, u).normalize();
  return { u, v };
}

// The angle of `point` around `origin` in the plane spanned by u and v.
export function angleInPlane(point, origin, u, v) {
  const r = tmpA.copy(point).sub(origin);
  return Math.atan2(r.dot(v), r.dot(u));
}

// Difference between two angles, in (-π, π].
export function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

// The world-space axes an XYZ Euler rotation turns about when one component changes: x about the
// parent's X, y about the X-turned Y, z about the object's own Z.
export function eulerAxes(parentQuaternion, euler) {
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(parentQuaternion);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), euler.x);
  const y = new THREE.Vector3(0, 1, 0).applyQuaternion(qx).applyQuaternion(parentQuaternion);
  const qxy = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler.x, euler.y, euler.z, 'XYZ'));
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(qxy).applyQuaternion(parentQuaternion);
  return [x, y, z];
}
