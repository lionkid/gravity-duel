// A gradient sky dome with stars, drawn around the camera. No textures: colours come from the stage
// palette and the stars from a hash of the view direction.

import * as THREE from 'three';

export function createSky({ top = 0x070b1a, horizon = 0x2a3a66, bottom = 0x05060a, stars = 0.9 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom) }, stars: { value: stars },
      earthOn: { value: 0 }, earthDir: { value: new THREE.Vector3(0.35, 0.55, -0.75).normalize() }, earthSize: { value: 0.09 }, sunDir: { value: new THREE.Vector3(0.5, 0.8, -0.3).normalize() },
      discOn: { value: 0 }, discDir: { value: new THREE.Vector3(-0.8, 0.4, 0.4).normalize() }, discColor: { value: new THREE.Color(0xfff0d0) }, discSize: { value: 0.045 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;            // always at the far plane
      }`,
    fragmentShader: `
      uniform vec3 top, horizon, bottom; uniform float stars;
      uniform float earthOn, earthSize; uniform vec3 earthDir, sunDir;
      uniform float discOn, discSize; uniform vec3 discDir, discColor;
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
        // A planet: a shaded disc with blocky clouds and a thin atmosphere rim (the Earth over the moon).
        if (earthOn > 0.0) {
          float cosA = dot(d, earthDir);
          float ang = acos(clamp(cosA, -1.0, 1.0));
          if (ang < earthSize * 1.08) {
            float u = ang / earthSize;
            vec3 perp = normalize(d - earthDir * cosA + vec3(1e-5));
            float uu = min(u, 1.0);
            vec3 n = normalize(perp * uu + earthDir * sqrt(max(0.0, 1.0 - uu * uu)));
            float l = max(0.0, dot(n, sunDir));
            float cloud = smoothstep(0.5, 0.85, hash(floor(n * 11.0)) * 0.55 + hash(floor(n * 23.0)) * 0.45);
            vec3 surf = mix(vec3(0.07, 0.28, 0.72), vec3(0.93, 0.96, 1.0), cloud * 0.85);
            vec3 earth = surf * (0.02 + 0.98 * l);
            earth += vec3(0.35, 0.6, 1.0) * smoothstep(0.78, 1.0, u) * (0.3 + 0.7 * l) * 0.6;
            float disc = 1.0 - smoothstep(1.0, 1.08, u);
            c = mix(c, earth, disc * earthOn);
          }
        }
        // The sun (or the moon) as a disc with a soft halo, sinking into the horizon haze.
        if (discOn > 0.0) {
          float ang = acos(clamp(dot(d, normalize(discDir)), -1.0, 1.0));
          float core = 1.0 - smoothstep(discSize * 0.82, discSize, ang);
          float halo = exp(-ang / (discSize * 2.2)) * 0.5 + exp(-ang / (discSize * 9.0)) * 0.22;
          float haze = smoothstep(-0.02, 0.12, d.y);
          c += discColor * (core * 2.0 * haze + halo) * discOn;
        }
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
    // Recolour for a time of day; colours are THREE.Color or hex. `earth`: null hides the planet,
    // { dir: [x, y, z], size: radians, sun: [x, y, z] } shows it. `disc`: null hides the sun disc,
    // { dir: [x, y, z], color, size } shows it.
    set({ top: t, horizon: h, bottom: b, stars: s, earth, disc }) {
      if (disc === null) mat.uniforms.discOn.value = 0;
      else if (disc) {
        mat.uniforms.discOn.value = 1;
        if (disc.dir) mat.uniforms.discDir.value.set(disc.dir[0], disc.dir[1], disc.dir[2]).normalize();
        if (disc.color != null) mat.uniforms.discColor.value.set(disc.color);
        if (disc.size) mat.uniforms.discSize.value = disc.size;
      }
      if (t != null) mat.uniforms.top.value.set(t);
      if (h != null) mat.uniforms.horizon.value.set(h);
      if (b != null) mat.uniforms.bottom.value.set(b);
      if (s != null) mat.uniforms.stars.value = s;
      if (earth === null) mat.uniforms.earthOn.value = 0;
      else if (earth) {
        mat.uniforms.earthOn.value = 1;
        if (earth.dir) mat.uniforms.earthDir.value.set(earth.dir[0], earth.dir[1], earth.dir[2]).normalize();
        if (earth.size) mat.uniforms.earthSize.value = earth.size;
        if (earth.sun) mat.uniforms.sunDir.value.set(earth.sun[0], earth.sun[1], earth.sun[2]).normalize();
      }
    },
  };
}
