// Dust twisters: two nested funnel shells (an open cylinder bent into a funnel in the vertex shader,
// banded with scrolling noise in the fragment shader, denser at the silhouette) and a cloud of dust
// motes that spiral up the column and skirt the ground. Everything moves on the GPU from a clock, so
// the CPU only places each column. The simulation's twister list drives it:
//
//   const tw = createTwisterView(scene);
//   tw.sync(world.twisters, dt, camera, renderer);   // each frame
//   tw.setLight(phase);                               // tint with the time of day

import * as THREE from 'three';

// The column's axis snakes sideways more the higher it goes; the dust follows the same curve.
const SWAY = `
  vec2 twSway(float h, float t, float seed) {
    float sw = h * h;
    return vec2(sin(t * 0.6 + h * 2.6 + seed) * 14.0 + sin(t * 1.7 - h * 6.0 + seed * 0.5) * 3.0,
                cos(t * 0.5 + h * 2.2 + seed * 1.3) * 12.0) * sw;
  }`;
const NOISE = `
  float twHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float twNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(twHash(i), twHash(i + vec2(1.0, 0.0)), u.x), mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }`;

function funnelMaterial({ r0, r1, skirt, spin, opacity }) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uStrength: { value: 0 }, uSeed: { value: 0 }, uH: { value: 170 },
      uR0: { value: r0 }, uR1: { value: r1 }, uSkirt: { value: skirt }, uSpin: { value: spin }, uOpacity: { value: opacity },
      uColorA: { value: new THREE.Color(0x8a6a48) }, uColorB: { value: new THREE.Color(0xd8b88a) },
    }]),
    vertexShader: `
      uniform float uTime, uStrength, uSeed, uH, uR0, uR1, uSkirt;
      varying float vH; varying float vU; varying vec3 vNormalV; varying vec3 vViewPos;
      #include <fog_pars_vertex>
      ${SWAY}
      void main() {
        float h = clamp(position.y, 0.0, 1.0);
        vH = h; vU = uv.x;
        float r = mix(uR0, uR1, pow(h, 1.5)) + uSkirt * (1.0 - smoothstep(0.0, 0.09, h));
        r *= mix(0.35, 1.0, uStrength) * (1.0 + 0.07 * sin(uTime * 3.1 + h * 12.0 + uSeed));
        vec3 p = vec3(position.x * r, h * uH * mix(0.12, 1.0, uStrength), position.z * r);
        p.xz += twSway(h, uTime, uSeed) * uStrength;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        vViewPos = mvPosition.xyz;
        vNormalV = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime, uStrength, uSeed, uSpin, uOpacity; uniform vec3 uColorA, uColorB;
      varying float vH; varying float vU; varying vec3 vNormalV; varying vec3 vViewPos;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 q = vec2(vU * 6.0 + uTime * uSpin + vH * 4.0 + uSeed, vH * 10.0 - uTime * 1.3);
        float n = twNoise(q) * 0.6 + twNoise(q * 2.3 + 7.0) * 0.4;
        float streak = smoothstep(0.3, 0.78, n);
        float rim = 1.0 - abs(dot(normalize(vNormalV), normalize(-vViewPos)));
        float a = mix(0.16, 0.8, pow(rim, 1.4)) * (0.4 + 0.6 * streak);
        a *= smoothstep(0.0, 0.05, vH) * (1.0 - smoothstep(0.72, 1.0, vH));
        a *= uStrength * uOpacity;
        vec3 col = mix(uColorA, uColorB, streak * 0.65 + vH * 0.35);
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
}

function dustMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uStrength: { value: 0 }, uSeed: { value: 0 }, uH: { value: 170 }, uScale: { value: 400 },
      uColor: { value: new THREE.Color(0xc8a678) },
    }]),
    vertexShader: `
      uniform float uTime, uStrength, uSeed, uH, uScale;
      attribute vec4 aSeed;
      varying float vAlpha;
      #include <fog_pars_vertex>
      ${SWAY}
      void main() {
        bool skirt = aSeed.z > 0.68;                     // a third of the motes stay low, round the foot
        float speed = skirt ? 0.07 + 0.05 * aSeed.y : 0.045 + 0.05 * aSeed.y;
        float life = fract(aSeed.x + uTime * speed);
        float h = skirt ? life * 0.07 : life;
        float r = skirt ? mix(9.0, 42.0, fract(aSeed.w * 7.31)) : mix(5.0, 40.0, pow(h, 1.4)) * (0.65 + 0.7 * fract(aSeed.z * 3.7));
        float ang = aSeed.w * 6.2832 + uTime * (skirt ? 0.9 : 2.2) * 12.0 / max(r, 6.0);
        vec3 p = vec3(cos(ang) * r, h * uH * mix(0.12, 1.0, uStrength) + (skirt ? 2.0 + 6.0 * aSeed.y : 0.0), sin(ang) * r);
        p.xz *= mix(0.4, 1.0, uStrength);
        p.xz += twSway(h, uTime, uSeed) * uStrength;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float size = skirt ? 12.0 + 8.0 * aSeed.y : 6.0 + 6.0 * aSeed.y;
        gl_PointSize = size * uScale / max(1.0, -mvPosition.z);
        vAlpha = uStrength * smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.7, 1.0, life)) * (skirt ? 0.28 : 0.32);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - d * d) * vAlpha;               // a soft puff, densest in the middle
        if (a < 0.008) discard;
        gl_FragColor = vec4(uColor, a);
        #include <fog_fragment>
      }`,
  });
}

export function createTwisterView(scene, { max = 4, motes = 520, height = 170 } = {}) {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 40, 36, true).translate(0, 0.5, 0);
  const columns = [];
  for (let i = 0; i < max; i++) {
    const group = new THREE.Group();
    group.name = 'twister';
    group.visible = false;
    const outer = new THREE.Mesh(cyl, funnelMaterial({ r0: 7, r1: 50, skirt: 18, spin: 0.35, opacity: 0.72 }));
    const inner = new THREE.Mesh(cyl, funnelMaterial({ r0: 3.5, r1: 30, skirt: 8, spin: 0.8, opacity: 0.85 }));
    outer.renderOrder = 2; inner.renderOrder = 3;
    const seeds = new Float32Array(motes * 4);
    let s = (i + 1) * 9301;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < motes * 4; k++) seeds[k] = rnd();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(motes * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const dust = new THREE.Points(geo, dustMaterial());
    dust.renderOrder = 4;
    for (const o of [outer, inner, dust]) { o.frustumCulled = false; o.material.uniforms.uH.value = height; o.material.uniforms.uSeed.value = i * 1.7 + 0.4; }
    group.add(outer, inner, dust);
    scene.add(group);
    columns.push({ group, outer, inner, dust, time: i * 11.3, density: 1 });
  }
  const sandA = new THREE.Color(0xa07c55), sandB = new THREE.Color(0xe6caa0), dustC = new THREE.Color(0xd9bb8e), tmp = new THREE.Color();
  return {
    columns,
    // The quality setting: share of dust motes drawn.
    setDensity(k) { for (const c of columns) c.dust.geometry.setDrawRange(0, Math.max(1, Math.round(motes * k))); },
    sync(twisters, dt, camera, renderer) {
      const fovScale = renderer && camera ? renderer.getDrawingBufferSize(new THREE.Vector2()).y * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) : 400;
      columns.forEach((c, i) => {
        const tw = twisters && twisters[i];
        const on = !!tw && tw.strength > 0.001;
        c.group.visible = on;
        if (!on) return;
        c.time += dt;
        c.group.position.set(tw.x, 0, tw.z);
        for (const o of [c.outer, c.inner, c.dust]) {
          const u = o.material.uniforms;
          u.uTime.value = c.time; u.uStrength.value = tw.strength;
          if (u.uScale) u.uScale.value = fovScale;
        }
      });
    },
    // Dust takes the light of the hour: bright tan at noon, orange at sunset, dark at night.
    setLight(phase) {
      const light = 1 - 0.72 * (phase.night || 0);
      for (const c of columns) {
        c.outer.material.uniforms.uColorA.value.copy(tmp.copy(sandA).lerp(phase.fog || sandA, 0.25)).multiplyScalar(light);
        c.outer.material.uniforms.uColorB.value.copy(tmp.copy(sandB).lerp(phase.fog || sandB, 0.2)).multiplyScalar(light);
        c.inner.material.uniforms.uColorA.value.copy(c.outer.material.uniforms.uColorA.value).multiplyScalar(0.9);
        c.inner.material.uniforms.uColorB.value.copy(c.outer.material.uniforms.uColorB.value);
        c.dust.material.uniforms.uColor.value.copy(tmp.copy(dustC).lerp(phase.fog || dustC, 0.2)).multiplyScalar(0.25 + 0.75 * light);
      }
    },
    clear() { for (const c of columns) c.group.visible = false; },
    dispose() { for (const c of columns) { scene.remove(c.group); c.outer.material.dispose(); c.inner.material.dispose(); c.dust.material.dispose(); c.dust.geometry.dispose(); } cyl.dispose(); },
  };
}
