// Renderer, scene and camera setup shared by every 3D game: colour management, tone mapping, pixel
// ratio cap and resizing. Games add their own lights and meshes to `scene`.

import * as THREE from 'three';

export function createRenderApp(canvas, { fov = 55, near = 0.5, far = 4000, pixelRatioCap = 1.5, antialias = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  let composer = null;
  let cap = pixelRatioCap;
  const size = { w: 1, h: 1 };

  function resize() {
    size.w = canvas.clientWidth || window.innerWidth;
    size.h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    if (composer) composer.setSize(size.w, size.h);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    THREE, renderer, scene, camera, size, resize,
    render() { if (composer) composer.render(); else renderer.render(scene, camera); },
    // A post-processing composer (engine/render/post.js) takes over rendering when set.
    setComposer(c) { composer = c; resize(); },
    // Quality setting: the most device pixels per CSS pixel the renderer will use.
    setPixelRatioCap(v) { cap = Math.max(0.5, v || 1); resize(); },
    get pixelRatioCap() { return cap; },
    dispose() { window.removeEventListener('resize', resize); renderer.dispose(); },
  };
}
