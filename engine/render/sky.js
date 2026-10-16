// A gradient sky dome with stars, drawn around the camera. No textures: colours come from the stage
// palette and the stars from a hash of the view direction. Optional extras: a planet with blocky
// clouds (the Earth over the moon), the sun as a disc, and for deep space a ringed gas giant, a faint
// nebula and stars all the way round, below the horizon too.

import * as THREE from 'three';

export function createSky({ top = 0x070b1a, horizon = 0x2a3a66, bottom = 0x05060a, stars = 0.9 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, bottom: { value: new THREE.Color(bottom) }, stars: { value: stars },
      starsBelow: { value: 0 },
      earthOn: { value: 0 }, earthDir: { value: new THREE.Vector3(0.35, 0.55, -0.75).normalize() }, earthSize: { value: 0.09 }, sunDir: { value: new THREE.Vector3(0.5, 0.8, -0.3).normalize() },
      discOn: { value: 0 }, discDir: { value: new THREE.Vector3(-0.8, 0.4, 0.4).normalize() }, discColor: { value: new THREE.Color(0xfff0d0) }, discSize: { value: 0.045 },
      planetOn: { value: 0 }, planetDir: { value: new THREE.Vector3(0.62, 0.16, -0.77).normalize() }, planetSize: { value: 0.22 },
      planetColA: { value: new THREE.Color(0xb9824e) }, planetColB: { value: new THREE.Color(0xf2dcb4) },
      ringOn: { value: 0 }, ringNormal: { value: new THREE.Vector3(0.22, 0.95, 0.2).normalize() }, ringIn: { value: 1.35 }, ringOut: { value: 2.35 }, ringColor: { value: new THREE.Color(0xd9c9a6) },
      nebula: { value: 0 }, nebulaAxis: { value: new THREE.Vector3(0.3, 0.6, -0.74).normalize() }, nebulaA: { value: new THREE.Color(0x5a2f8f) }, nebulaB: { value: new THREE.Color(0x1f6f9a) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;            // always at the far plane
      }`,
    fragmentShader: `
      uniform vec3 top, horizon, bottom; uniform float stars, starsBelow;
      uniform float earthOn, earthSize; uniform vec3 earthDir, sunDir;
      uniform float discOn, discSize; uniform vec3 discDir, discColor;
      uniform float planetOn, planetSize, ringOn, ringIn, ringOut; uniform vec3 planetDir, planetColA, planetColB, ringNormal, ringColor;
      uniform float nebula; uniform vec3 nebulaAxis, nebulaA, nebulaB;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        float a = mix(mix(hash(i), hash(i + vec3(1, 0, 0)), u.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), u.x), u.y);
        float b = mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), u.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), u.x), u.y);
        return mix(a, b, u.z);
      }
      // One star per cell of an n-cell grid over the sphere, about a share \`share\` of cells lit.
      float starLayer(vec3 d, float n, float share, float size) {
        vec3 cell = floor(d * n);
        float h = hash(cell);
        vec3 centre = (cell + 0.5 + vec3(hash(cell + 1.0), hash(cell + 2.0), hash(cell + 3.0)) - 0.5) / n;
        float dist = length(d - normalize(centre)) * n;
        return smoothstep(size, 0.05, dist) * step(1.0 - share, h) * (0.6 + 0.4 * hash(cell + 7.0));
      }
      void main() {
        vec3 d = normalize(vDir);
        float t = d.y;
        vec3 c = t >= 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.6, t), 0.7)) : mix(horizon, bottom, smoothstep(0.0, -0.25, t));
        // Stars above the horizon haze (or everywhere, out in space); deep space adds a fainter, denser layer.
        float above = mix(smoothstep(0.02, 0.25, t), 1.0, starsBelow);
        c += vec3(0.8, 0.85, 1.0) * starLayer(d, 220.0, 0.015 + stars * 0.01, 0.35) * above;
        if (starsBelow > 0.0) {
          float tint = hash(floor(d * 520.0) + 5.0);
          c += mix(vec3(1.0, 0.85, 0.7), vec3(0.7, 0.8, 1.0), tint) * starLayer(d, 520.0, 0.09, 0.4) * 0.32 * starsBelow;
        }
        // A nebula: soft clouds along a band of the sky.
        if (nebula > 0.0) {
          float across = dot(d, normalize(nebulaAxis));
          float band = exp(-across * across * 16.0);
          if (band > 0.02) {
            float n = noise3(d * 3.0) * 0.55 + noise3(d * 7.0 + 11.0) * 0.3 + noise3(d * 15.0 + 5.0) * 0.15;
            float cloud = smoothstep(0.42, 0.9, n) * band;
            c += mix(nebulaA, nebulaB, smoothstep(-0.3, 0.3, across)) * cloud * nebula;
          }
        }
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
        // A gas giant with rings: a sphere of radius 1 at the distance where it spans planetSize, and a
        // ring plane through its centre, both traced from the eye. Bands follow the ring plane (its
        // equator); the planet's shadow falls across the rings.
        if (planetOn > 0.0) {
          vec3 C = normalize(planetDir) / sin(planetSize);
          vec3 L = normalize(sunDir), N = normalize(ringNormal);
          // (b > 0: the planet is in front of the eye, not behind it.)
          float b = dot(d, C), disc = b * b - (dot(C, C) - 1.0);
          bool front = disc > 0.0 && b > 0.0;
          float tS = front ? b - sqrt(disc) : 1e9;
          float body = b > 0.0 ? clamp(disc / max(fwidth(disc) * 1.5, 1e-6), 0.0, 1.0) : 0.0;
          vec3 pc = vec3(0.0);
          if (front) {
            vec3 n = normalize(d * tS - C);
            float lat = dot(n, N);
            float w = sin(lat * 17.0 + sin(lat * 6.0 + n.x * 2.3 + n.z * 1.7) * 1.4 + noise3(n * 4.0) * 1.2);
            vec3 base = mix(planetColA, planetColB, 0.5 + 0.5 * w);
            float l = max(0.0, dot(n, L));
            pc = base * (0.025 + 0.975 * pow(l, 0.75));
            pc += planetColB * pow(1.0 - max(0.0, dot(n, -d)), 3.0) * 0.45 * (0.15 + 0.85 * l);
          }
          float dn = dot(d, N), tR = abs(dn) > 1e-5 ? dot(C, N) / dn : -1.0;
          float ringA = 0.0; vec3 rc = vec3(0.0);
          if (ringOn > 0.0 && tR > 0.0) {
            vec3 H = d * tR;
            float rho = length(H - C);
            float u = (rho - ringIn) / (ringOut - ringIn);
            if (u > 0.0 && u < 1.0) {
              float bands = 0.55 + 0.45 * sin(u * 41.0) * sin(u * 13.0 + 1.3);
              float gap = smoothstep(0.015, 0.05, abs(u - 0.63));
              ringA = bands * gap * smoothstep(0.0, 0.04, u) * smoothstep(1.0, 0.9, u) * 0.85;
              vec3 o = H - C; float bb = dot(o, L), dd = bb * bb - (dot(o, o) - 1.0);
              float shade = (dd > 0.0 && -bb - sqrt(dd) > 0.0) ? 0.12 : 1.0;
              rc = ringColor * (0.3 + 0.7 * shade) * (0.55 + 0.45 * abs(dot(N, L)));
            }
          }
          if (tR > 0.0 && tR < tS) { c = mix(c, pc, body * planetOn); c = mix(c, rc, ringA * planetOn); }
          else { c = mix(c, rc, ringA * planetOn); c = mix(c, pc, body * planetOn); }
        }
        // The sun (or the moon) as a disc with a soft halo, sinking into the horizon haze.
        if (discOn > 0.0) {
          float ang = acos(clamp(dot(d, normalize(discDir)), -1.0, 1.0));
          float core = 1.0 - smoothstep(discSize * 0.82, discSize, ang);
          // No air out in space: a tight glare instead of a wide halo.
          float halo = exp(-ang / (discSize * 2.2)) * 0.5 + exp(-ang / (discSize * 9.0)) * 0.22 * (1.0 - 0.9 * starsBelow);
          float haze = mix(smoothstep(-0.02, 0.12, d.y), 1.0, starsBelow);
          c += discColor * (core * 2.0 * haze + halo) * discOn;
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(1000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  const U = mat.uniforms;
  const vec = (v, a) => v.set(a[0], a[1], a[2]).normalize();
  return {
    mesh,
    // Keep the dome centred on the camera so it never gets closer or farther.
    update(camera) { mesh.position.copy(camera.position); },
    // Recolour for a time of day; colours are THREE.Color or hex. `earth`: null hides the planet,
    // { dir: [x, y, z], size: radians, sun: [x, y, z] } shows it. `disc`: null hides the sun disc,
    // { dir: [x, y, z], color, size } shows it. `planet`: null hides the gas giant, { dir, size,
    // colorA, colorB, ring: { normal, inner, outer, color } | null } shows it. `nebula`: null or
    // { strength, axis, colorA, colorB }. `starsBelow`: stars below the horizon too.
    set({ top: t, horizon: h, bottom: b, stars: s, earth, disc, planet, nebula, starsBelow }) {
      if (disc === null) U.discOn.value = 0;
      else if (disc) {
        U.discOn.value = 1;
        if (disc.dir) vec(U.discDir.value, disc.dir);
        if (disc.color != null) U.discColor.value.set(disc.color);
        if (disc.size) U.discSize.value = disc.size;
      }
      if (t != null) U.top.value.set(t);
      if (h != null) U.horizon.value.set(h);
      if (b != null) U.bottom.value.set(b);
      if (s != null) U.stars.value = s;
      if (starsBelow != null) U.starsBelow.value = starsBelow ? 1 : 0;
      if (earth === null) U.earthOn.value = 0;
      else if (earth) {
        U.earthOn.value = 1;
        if (earth.dir) vec(U.earthDir.value, earth.dir);
        if (earth.size) U.earthSize.value = earth.size;
        if (earth.sun) vec(U.sunDir.value, earth.sun);
      }
      if (planet === null) U.planetOn.value = 0;
      else if (planet) {
        U.planetOn.value = 1;
        if (planet.dir) vec(U.planetDir.value, planet.dir);
        if (planet.size) U.planetSize.value = planet.size;
        if (planet.colorA != null) U.planetColA.value.set(planet.colorA);
        if (planet.colorB != null) U.planetColB.value.set(planet.colorB);
        if (planet.sun) vec(U.sunDir.value, planet.sun);
        U.ringOn.value = planet.ring ? 1 : 0;
        if (planet.ring) {
          if (planet.ring.normal) vec(U.ringNormal.value, planet.ring.normal);
          if (planet.ring.inner) U.ringIn.value = planet.ring.inner;
          if (planet.ring.outer) U.ringOut.value = planet.ring.outer;
          if (planet.ring.color != null) U.ringColor.value.set(planet.ring.color);
        }
      }
      if (nebula === null) U.nebula.value = 0;
      else if (nebula) {
        U.nebula.value = nebula.strength == null ? 0.3 : nebula.strength;
        if (nebula.axis) vec(U.nebulaAxis.value, nebula.axis);
        if (nebula.colorA != null) U.nebulaA.value.set(nebula.colorA);
        if (nebula.colorB != null) U.nebulaB.value.set(nebula.colorB);
      }
    },
    // Light for the planet: the direction the sun shines from.
    setSun(dir) { if (dir) vec(U.sunDir.value, dir); },
  };
}
