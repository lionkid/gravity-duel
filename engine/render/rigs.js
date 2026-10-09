// Camera rigs. A rig places the camera for one view mode each frame; the blender eases the camera
// between rigs when the mode changes (third person ↔ first-person aiming). Cameras are local to each
// client and never part of the simulation: the simulation only sees the view angles in the Intent.

import * as THREE from 'three';
import { aimToDir, yawToDir } from '../core/math.js';
import { raycast } from '../sim/sweep.js';

const tmpTarget = new THREE.Vector3();

// Orbits around a pivot above the target's feet, at `distance` behind the view direction. A sphere
// sweep from the pivot shortens the boom so buildings never come between camera and mech; the boom
// shrinks at once and grows back smoothly.
export function createThirdPersonRig(camera, { distance = 42, pivotHeight = 14, radius = 2.5, minDistance = 6, grow = 6, fov = 55 } = {}) {
  let cur = distance, first = true;
  return {
    fov,
    reset() { first = true; },
    update(dt, target, look, statics) {
      const pivot = { x: target.x, y: target.y + pivotHeight, z: target.z };
      const dir = aimToDir(look.yaw, look.pitch);
      let d = distance;
      if (statics) {
        const far = { x: pivot.x - dir.x * d, y: pivot.y - dir.y * d, z: pivot.z - dir.z * d };
        const hit = raycast(statics, pivot, far, radius);
        if (hit) d = Math.max(minDistance, d * hit.t - 0.5);
      }
      if (first || d < cur) cur = d; else cur += (d - cur) * (1 - Math.exp(-grow * dt));
      first = false;
      camera.position.set(pivot.x - dir.x * cur, pivot.y - dir.y * cur, pivot.z - dir.z * cur);
      camera.lookAt(tmpTarget.set(pivot.x, pivot.y, pivot.z));
    },
  };
}

// Through the mech's eyes: at head height, a little forward, looking along the view angles.
export function createFirstPersonRig(camera, { eyeHeight = 16, forward = 3, fov = 40 } = {}) {
  return {
    fov,
    reset() {},
    update(dt, target, look) {
      const f = yawToDir(look.yaw), dir = aimToDir(look.yaw, look.pitch);
      camera.position.set(target.x + f.x * forward, target.y + eyeHeight, target.z + f.z * forward);
      camera.lookAt(tmpTarget.set(camera.position.x + dir.x, camera.position.y + dir.y, camera.position.z + dir.z));
    },
  };
}

// Runs the active rig and, after a switch, blends position, orientation and field of view from where
// the camera was to where the new rig wants it over `time` seconds.
export function createCameraBlender(camera, { time = 0.25 } = {}) {
  let rig = null, t = 1;
  const fromPos = new THREE.Vector3(), fromQuat = new THREE.Quaternion();
  let fromFov = camera.fov;
  const ease = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  return {
    get rig() { return rig; },
    get blending() { return t < 1; },
    use(next) {
      if (next === rig) return;
      if (rig) { fromPos.copy(camera.position); fromQuat.copy(camera.quaternion); fromFov = camera.fov; t = 0; }
      rig = next;
      rig.reset();
    },
    update(dt, target, look, statics) {
      if (!rig) return;
      rig.update(dt, target, look, statics);
      let fov = rig.fov;
      if (t < 1) {
        t = Math.min(1, t + dt / time);
        const k = ease(t);
        camera.position.lerpVectors(fromPos, camera.position, k);
        camera.quaternion.slerpQuaternions(fromQuat, camera.quaternion, k);
        fov = fromFov + (rig.fov - fromFov) * k;
      }
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    },
  };
}
