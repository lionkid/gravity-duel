// A gradient sky dome with stars, drawn around the camera. No textures: colours come from the stage
// palette and the stars from a hash of the view direction.

import * as THREE from 'three';

export function createSky({ top = 0x070b1a, horizon = 0x2a3a66, bottom = 0x05060a, stars = 0.9 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom) }, stars: { value: stars } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;            // always at the far plane
      }`,
    fragmentShader: `
      uniform vec3 top, horizon, bottom; uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float t = d.y;
        vec3 c = t >= 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, t), 0.7)) : mix(horizon, bottom, smoothstep(0.0, -0.25, t));
        // Stars: one per cell of a 220-cell grid over the sphere, only above the horizon haze.
        vec3 cell = floor(d * 220.0);
        float h = hash(cell);
        vec3 centre = (cell + 0.5 + vec3(hash(cell + 1.0), hash(cell + 2.0), hash(cell + 3.0)) - 0.5) / 220.0;
        float dist = length(d - normalize(centre)) * 220.0;
        float star = smoothstep(0.35, 0.05, dist) * step(0.985 - stars * 0.01, h) * smoothstep(0.02, 0.25, t);
        c += vec3(0.8, 0.85, 1.0) * star * (0.6 + 0.4 * hash(cell + 7.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(1000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return {
    mesh,
    // Keep the dome centred on the camera so it never gets closer or farther.
    update(camera) { mesh.position.copy(camera.position); },
    // Recolour for a time of day; colours are THREE.Color or hex.
    set({ top: t, horizon: h, bottom: b, stars: s }) {
      if (t != null) mat.uniforms.top.value.set(t);
      if (h != null) mat.uniforms.horizon.value.set(h);
      if (b != null) mat.uniforms.bottom.value.set(b);
      if (s != null) mat.uniforms.stars.value = s;
    },
  };
}
