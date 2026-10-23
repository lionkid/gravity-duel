// Camera rigs without a renderer: the lock-on rig keeps both mechs framed, lets the player's mouse
// orbit the view around the player, and drifts back behind once the hand rests.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLockOnRig } from '../render/rigs.js';
import { angleDiff } from '../core/math.js';

const DT = 1 / 60;
const camera = () => new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 4000);
const player = { x: 0, y: 0, z: 100 }, target = { x: 0, y: 0, z: 0 };

test('the lock-on camera sits behind the player and writes the view angles it looks along', () => {
  const cam = camera();
  const rig = createLockOnRig(cam);
  const look = { yaw: 0, pitch: 0 };
  rig.reset();
  for (let i = 0; i < 60; i++) rig.update(DT, player, look, null, target);
  assert.ok(cam.position.z > player.z + 30 && Math.abs(cam.position.x) < 1e-6, `behind the player: ${cam.position.z.toFixed(1)}`);
  assert.ok(cam.position.y > 20, 'and above');
  assert.ok(Math.abs(look.yaw) < 1e-6, 'looking down -z, so yaw 0');
  assert.ok(look.pitch < 0, 'looking down at the mechs');
});

test('a mouse nudge orbits the camera around the player by that angle, then it eases back', () => {
  const cam = camera();
  const rig = createLockOnRig(cam);
  const look = { yaw: 0, pitch: 0 };
  rig.reset();
  for (let i = 0; i < 60; i++) rig.update(DT, player, look, null, target);
  const yaw0 = look.yaw, x0 = cam.position.x;
  // The mapper turns the view left by 0.5 rad over a few frames.
  for (let i = 0; i < 5; i++) { look.yaw += 0.1; rig.update(DT, player, look, null, target); }
  assert.ok(Math.abs(angleDiff(yaw0, look.yaw) - 0.5) < 1e-3, `the view turned by the nudge: ${angleDiff(yaw0, look.yaw).toFixed(3)}`);
  assert.ok(Math.abs(rig.orbit.yaw - 0.5) < 1e-3);
  assert.ok(cam.position.x !== x0, 'the camera moved around the player');
  const d = Math.hypot(cam.position.x - player.x, cam.position.z - player.z);
  for (let i = 0; i < 30; i++) rig.update(DT, player, look, null, target);
  assert.ok(Math.abs(Math.hypot(cam.position.x - player.x, cam.position.z - player.z) - d) < 0.5, 'orbiting keeps the distance');
  // Hands off: within two seconds the view is back behind the player.
  for (let i = 0; i < 120; i++) rig.update(DT, player, look, null, target);
  assert.ok(Math.abs(rig.orbit.yaw) < 0.02, `orbit returned to ${rig.orbit.yaw.toFixed(3)}`);
  assert.ok(Math.abs(angleDiff(yaw0, look.yaw)) < 0.02, 'and the view angle with it');
});

test('the orbit is clamped, and a pitch nudge up lowers the camera', () => {
  const cam = camera();
  const rig = createLockOnRig(cam, { orbitYaw: 1.0, orbitPitch: 0.4 });
  const look = { yaw: 0, pitch: 0 };
  rig.reset();
  for (let i = 0; i < 60; i++) rig.update(DT, player, look, null, target);
  const y0 = cam.position.y;
  for (let i = 0; i < 40; i++) { look.yaw += 0.1; look.pitch += 0.05; rig.update(DT, player, look, null, target); }
  assert.ok(Math.abs(rig.orbit.yaw - 1.0) < 1e-6 && Math.abs(rig.orbit.pitch - 0.4) < 1e-6, `clamped at ${rig.orbit.yaw}, ${rig.orbit.pitch}`);
  assert.ok(cam.position.y < y0, `looking up: the camera dropped from ${y0.toFixed(1)} to ${cam.position.y.toFixed(1)}`);
});

test('a dead-still hand does not count as a nudge, and a reset clears the orbit', () => {
  const cam = camera();
  const rig = createLockOnRig(cam);
  const look = { yaw: 0, pitch: 0 };
  rig.reset();
  for (let i = 0; i < 120; i++) rig.update(DT, player, look, null, target);
  assert.equal(rig.orbit.yaw, 0);
  look.yaw += 0.3; rig.update(DT, player, look, null, target);
  assert.ok(rig.orbit.yaw > 0.29);
  rig.reset();
  assert.equal(rig.orbit.yaw, 0);
});
