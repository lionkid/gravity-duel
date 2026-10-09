// Post-processing: bloom for everything emissive (glow seams, thruster flames, beams, windows, lamps).
// Rendering goes through an EffectComposer with a multisampled HDR target so edges stay smooth.

import * as THREE from 'three';
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } from 'three-addons';

export function createPost(app, { strength = 0.5, radius = 0.4, threshold = 0.85, samples = 4 } = {}) {
  const { renderer, scene, camera } = app;
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x / 2), Math.max(1, size.y / 2)), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  app.setComposer(composer);
  let enabled = true;
  return {
    composer, bloom,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; app.setComposer(enabled ? composer : null); },
  };
}
