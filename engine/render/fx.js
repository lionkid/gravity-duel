// Small visual effects that are not part of the simulation.

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
