/* Gravity Duel - 2.5D renderer. The fight stays on one plane; the picture gets depth.
 * Mechs, platforms and scenery are boxes projected through a perspective camera, flat-shaded and
 * painter-sorted on Canvas 2D (no library). Extends the 2D renderer so particles, HUD and overlays
 * are shared. Everything the game simulates still lives in the 2D gameplay coordinates. */
(function (GD) {
  'use strict';

  const W = GD.ARENA.w, H = GD.ARENA.h, GY = GD.ARENA.groundY, CX = W / 2;
  const NEAR = 24;
  const MONO = '"Share Tech Mono", ui-monospace, Menlo, monospace';
  const P_COLORS = { 1: '#e8453c', 2: '#3a7bff' };

  // ---- small 3x3 matrix helpers (row-major) ----
  const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  function mul(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return r;
  }
  const apply = (m, p) => [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Box faces: corner index bit0 = +x, bit1 = +y, bit2 = +z. idx[0] and idx[2] are a diagonal.
  const FACES = [
    { idx: [1, 3, 7, 5], n: [1, 0, 0] }, { idx: [0, 4, 6, 2], n: [-1, 0, 0] },
    { idx: [2, 6, 7, 3], n: [0, 1, 0] }, { idx: [0, 1, 5, 4], n: [0, -1, 0] },
    { idx: [4, 5, 7, 6], n: [0, 0, 1] }, { idx: [0, 2, 3, 1], n: [0, 0, -1] },
  ];

  const rgbCache = new Map();
  function rgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      rgbCache.set(hex, v);
    }
    return v;
  }
  function shadeHex(hex, k) {
    const [r, g, b] = rgb(hex);
    return `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
  }
  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  // Gameplay (x right, y down, ground at GY) -> world (X right, Y up, Z toward camera, fight plane Z = 0).
  const toWorld = (x, y, z) => [x - CX, GY - y, z || 0];

  class Camera {
    constructor() {
      this.mode = 'duel';            // 'duel' | 'side' | 'free'
      this.f = 900;
      this.yaw = 0; this.pitch = 0.1; this.dist = 1000;
      this.target = [0, 110, 0];
      this.pos = [0, 210, 1000];
      this.freeYaw = 0.55; this.freePitch = 0.22; this.freeDist = 900;
      this.right = [1, 0, 0]; this.up = [0, 1, 0]; this.fwd = [0, 0, -1];
      this.hy = H / 2;
    }
    place() {
      const { yaw, pitch, dist, target } = this;
      this.pos = [
        target[0] + dist * Math.sin(yaw) * Math.cos(pitch),
        target[1] + dist * Math.sin(pitch),
        target[2] + dist * Math.cos(yaw) * Math.cos(pitch),
      ];
      this.fwd = norm([target[0] - this.pos[0], target[1] - this.pos[1], target[2] - this.pos[2]]);
      this.right = norm(cross(this.fwd, [0, 1, 0]));
      this.up = cross(this.right, this.fwd);
    }
    toCam(p) {
      const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
      return [
        dx * this.right[0] + dy * this.right[1] + dz * this.right[2],
        dx * this.up[0] + dy * this.up[1] + dz * this.up[2],
        dx * this.fwd[0] + dy * this.fwd[1] + dz * this.fwd[2],
      ];
    }
    project(p) {
      const c = this.toCam(p);
      if (c[2] < NEAR) return null;
      const s = this.f / c[2];
      return { x: CX + c[0] * s, y: this.hy - c[1] * s, z: c[2], s };
    }
    // Segment with near-plane clipping. Returns null when fully behind the camera.
    segment(a, b) {
      let ca = this.toCam(a), cb = this.toCam(b);
      if (ca[2] < NEAR && cb[2] < NEAR) return null;
      if (ca[2] < NEAR || cb[2] < NEAR) {
        const t = (NEAR - ca[2]) / (cb[2] - ca[2]);
        const m = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR];
        if (ca[2] < NEAR) ca = m; else cb = m;
      }
      const sa = this.f / ca[2], sb = this.f / cb[2];
      return { ax: CX + ca[0] * sa, ay: this.hy - ca[1] * sa, bx: CX + cb[0] * sb, by: this.hy - cb[1] * sb, z: (ca[2] + cb[2]) / 2 };
    }
  }

  class Renderer3D extends GD.Renderer {
    constructor(canvas) {
      super(canvas);
      this.cam = new Camera();
      this.vis = new Map();      // per-fighter visual state: smoothed yaw, tumble, weapon side
      this.items = [];           // depth-sorted draw list, rebuilt every frame
      this.scene = null;
      this.koT = 0;
      this.snap = true;
    }

    setStage(stage) {
      this.stage = stage;
      this.scene = this.buildScene(stage);
      this.reset();
      this.vis.clear();
      this.koT = 0;
      this.snap = true;
    }

    // ---- static scenery ----
    buildScene(stage) {
      const rnd = seeded(stage.id === 'earth' ? 23 : 5);
      const scene = { boxes: [], asteroids: [], stars: [], ridges: [] };
      if (stage.gravity > 0) {
        this.lights = [{ dir: norm([-0.5, 0.8, 0.55]), col: [0.80, 0.70, 0.56] }];
        this.ambient = [0.40, 0.42, 0.50];
        this.fogColor = [168, 128, 108];
        // Ruined skyline in two depth bands, plus low rubble just behind the fight plane.
        const palette = ['#1a2740', '#1f2d47', '#16213a', '#243352'];
        for (let i = 0; i < 38; i++) {
          const far = i % 2 === 0;
          const x = -1500 + rnd() * 3000;
          const z = far ? -800 - rnd() * 500 : -420 - rnd() * 300;
          const w = 40 + rnd() * 90, d = 40 + rnd() * 70, h = (far ? 120 : 60) + rnd() * (far ? 260 : 190);
          const c = palette[(rnd() * palette.length) | 0];
          scene.boxes.push({ p: [x, h / 2, z], s: [w, h, d], c });
          if (rnd() < 0.45) scene.boxes.push({ p: [x + (rnd() - 0.5) * w * 0.4, h + 12 + rnd() * 30, z], s: [8 + rnd() * 14, 24 + rnd() * 60, 8 + rnd() * 14], c });
        }
        for (let i = 0; i < 9; i++) {
          const x = -560 + rnd() * 1120;
          scene.boxes.push({ p: [x, 10 + rnd() * 12, -150 - rnd() * 120], s: [30 + rnd() * 60, 20 + rnd() * 26, 24 + rnd() * 30], c: '#3b3a3a', ry: rnd() * 0.6 });
        }
        // Mountain ridges (polylines at fixed depth).
        for (const [z, base, amp, col] of [[-2600, 60, 240, '#4d4350'], [-1900, 30, 150, '#3a3240']]) {
          const pts = [];
          for (let x = -7000; x <= 7000; x += 350) pts.push([x, base + rnd() * amp, z]);
          scene.ridges.push({ pts, col });
        }
      } else {
        this.lights = [
          { dir: norm([0.55, 0.5, 0.65]), col: [0.85, 0.9, 1.0] },
          { dir: norm([0.6, -0.7, 0.4]), col: [0.12, 0.28, 0.42] },   // earth-glow fill from below right
        ];
        this.ambient = [0.20, 0.23, 0.32];
        this.fogColor = [4, 5, 11];
        for (let i = 0; i < 460; i++) {
          const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
          scene.stars.push({ p: [r * Math.cos(t) * 6000, Math.abs(u) * 6000 - 1200, r * Math.sin(t) * 6000], b: 0.45 + rnd() * 0.55, big: rnd() < 0.12 });
        }
        for (let i = 0; i < 8; i++) {
          const s = 18 + rnd() * 40;
          scene.asteroids.push({ p: [-1000 + rnd() * 2000, -60 + rnd() * 520, -420 - rnd() * 600], s: [s, s * (0.6 + rnd() * 0.6), s * (0.6 + rnd() * 0.6)],
            c: '#4a4452', rx: rnd() * 3, ry: rnd() * 3, wx: (rnd() - 0.5) * 0.4, wy: (rnd() - 0.5) * 0.4, vx: (rnd() - 0.5) * 12 });
        }
      }
      return scene;
    }

    visFor(f) {
      let v = this.vis.get(f.player);
      if (!v) {
        v = { yaw: f.facing > 0 ? 0 : Math.PI, tumble: 0, side: f.facing > 0 ? 1 : -1 };
        this.vis.set(f.player, v);
      }
      return v;
    }

    update(dt, world, alpha) {
      super.update(dt, world, alpha);
      for (const f of world.fighters) {
        const v = this.visFor(f);
        const target = f.facing > 0 ? 0 : Math.PI;
        let d = target - v.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        v.yaw += d * Math.min(1, dt * 10);
        v.side = Math.cos(v.yaw) >= 0 ? 1 : -1;      // keep the weapon arm toward the camera
        if (f.ko && this.stage.gravity === 0) v.tumble += dt * 0.9;
      }
      for (const a of this.scene.asteroids) {
        a.rx += a.wx * dt; a.ry += a.wy * dt; a.p[0] += a.vx * dt;
        if (a.p[0] > 1000) a.p[0] = -1000; if (a.p[0] < -1000) a.p[0] = 1000;
      }
      this.updateCamera(dt, world, alpha);
    }

    updateCamera(dt, world, alpha) {
      const cam = this.cam;
      const [a, b] = world.fighters;
      const ax = lerp(a.prevX, a.x, alpha), ay = lerp(a.prevY, a.y, alpha);
      const bx = lerp(b.prevX, b.x, alpha), by = lerp(b.prevY, b.y, alpha);
      const midX = (ax + bx) / 2 - CX;
      const gap = Math.abs(ax - bx);
      const topY = GY - Math.min(ay, by) + 84;
      const botY = GY - Math.max(ay, by);
      const spread = topY - botY;
      let tYaw, tPitch, tDist, tTarget;
      if (cam.mode === 'showcase') {
        // Character and loadout screens: close two-shot that slowly sways.
        tYaw = Math.sin(this.time * 0.35) * 0.4;
        tPitch = 0.1;
        tDist = 360;
        tTarget = [midX, botY + 52, 0];
      } else if (cam.mode === 'title') {
        // Title: the pair sits right of center, leaving the left side for the logo and menu.
        tYaw = Math.sin(this.time * 0.15) * 0.45;
        tPitch = 0.12;
        tDist = 520;
        tTarget = [midX - 150, botY + 70, 0];
      } else if (cam.mode === 'side') {
        // 1:1 with the 2D build: f / dist = 1, so world X maps to screen X exactly on the fight plane.
        tYaw = 0; tPitch = 0; tDist = 900; tTarget = [0, GY - H / 2, 0];
      } else if (cam.mode === 'free') {
        tYaw = cam.freeYaw; tPitch = cam.freePitch; tDist = cam.freeDist;
        tTarget = [midX, clamp((topY + botY) / 2, 40, 300), 0];
      } else {
        tYaw = clamp(midX / 480, -1, 1) * 0.17;
        tPitch = 0.10;
        tDist = Math.max(600, 1.05 * gap + 320, 1.7 * spread + 330);
        tTarget = [midX, clamp((topY + botY) / 2 + 10, 70, 260), 0];
        if (world.winner) {
          this.koT += dt;
          const w = world.fighters[world.winner - 1];
          const wx = lerp(w.prevX, w.x, alpha) - CX, wy = GY - lerp(w.prevY, w.y, alpha) + 45;
          const k = Math.min(1, this.koT / 1.2);
          tTarget = [lerp(tTarget[0], wx, k), lerp(tTarget[1], wy, k), 0];
          tDist = lerp(tDist, 460, k);
          tYaw += Math.min(0.32, this.koT * 0.15) * w.facing;
          tPitch = lerp(tPitch, 0.17, k);
        }
      }
      const r = this.snap ? 1 : Math.min(1, dt * 5);
      cam.yaw += (tYaw - cam.yaw) * r;
      cam.pitch += (tPitch - cam.pitch) * r;
      cam.dist += (tDist - cam.dist) * r;
      for (let i = 0; i < 3; i++) cam.target[i] += (tTarget[i] - cam.target[i]) * r;
      this.snap = false;
      cam.place();
    }

    fogAt(z) {
      return clamp((z - 900) / 2600, 0, 0.82);
    }

    shade(hex, n, o) {
      const base = rgb(o.ghost || hex);
      let r, g, b;
      if (o.glow) {
        r = base[0] * 1.08; g = base[1] * 1.08; b = base[2] * 1.08;
      } else {
        let lr = this.ambient[0], lg = this.ambient[1], lb = this.ambient[2];
        for (const L of this.lights) {
          const d = Math.max(0, n[0] * L.dir[0] + n[1] * L.dir[1] + n[2] * L.dir[2]);
          lr += L.col[0] * d; lg += L.col[1] * d; lb += L.col[2] * d;
        }
        r = base[0] * lr; g = base[1] * lg; b = base[2] * lb;
      }
      if (o.flash) { r += (255 - r) * o.flash; g += (255 - g) * o.flash; b += (255 - b) * o.flash; }
      if (o.fog) { const F = this.fogColor; r += (F[0] - r) * o.fog; g += (F[1] - g) * o.fog; b += (F[2] - b) * o.fog; }
      return `rgb(${Math.min(255, r) | 0},${Math.min(255, g) | 0},${Math.min(255, b) | 0})`;
    }

    // part: { p, s, c, pivot?, rx?, ry?, rz?, glow?, add? }. rootM/rootT place the whole object.
    addBox(part, rootM, rootT, o) {
      const cam = this.cam;
      const [px, py, pz] = part.p;
      const hx = part.s[0] / 2, hy = part.s[1] / 2, hz = part.s[2] / 2;
      let m = null;
      if (part.rx || part.ry || part.rz) {
        m = IDENT;
        if (part.ry) m = mul(m, rotY(part.ry));
        if (part.rx) m = mul(m, rotX(part.rx));
        if (part.rz) m = mul(m, rotZ(part.rz));
      }
      const pivot = part.pivot || part.p;
      const world = new Array(8), cs = new Array(8), scr = new Array(8);
      let zsum = 0;
      for (let i = 0; i < 8; i++) {
        let lx = px + (i & 1 ? hx : -hx), ly = py + (i & 2 ? hy : -hy), lz = pz + (i & 4 ? hz : -hz);
        if (m) {
          const q = apply(m, [lx - pivot[0], ly - pivot[1], lz - pivot[2]]);
          lx = q[0] + pivot[0]; ly = q[1] + pivot[1]; lz = q[2] + pivot[2];
        }
        const w = rootM ? apply(rootM, [lx, ly, lz]) : [lx, ly, lz];
        w[0] += rootT[0]; w[1] += rootT[1]; w[2] += rootT[2];
        const c = cam.toCam(w);
        if (c[2] < NEAR) return;
        world[i] = w; cs[i] = c; zsum += c[2];
        const s = cam.f / c[2];
        scr[i] = [CX + c[0] * s, cam.hy - c[1] * s];
      }
      const fullM = rootM ? (m ? mul(rootM, m) : rootM) : m;
      const fog = o.fogged ? this.fogAt(zsum / 8) : 0;
      const shadeOpts = { ghost: o.ghost, glow: part.glow, flash: o.flash, fog };
      for (const face of FACES) {
        const n = fullM ? apply(fullM, face.n) : face.n;
        const c0 = world[face.idx[0]], c2 = world[face.idx[2]];
        const vx = (c0[0] + c2[0]) / 2 - cam.pos[0], vy = (c0[1] + c2[1]) / 2 - cam.pos[1], vz = (c0[2] + c2[2]) / 2 - cam.pos[2];
        if (n[0] * vx + n[1] * vy + n[2] * vz >= 0) continue;     // back face
        const z = (cs[face.idx[0]][2] + cs[face.idx[1]][2] + cs[face.idx[2]][2] + cs[face.idx[3]][2]) / 4;
        this.items.push({ z, pts: [scr[face.idx[0]], scr[face.idx[1]], scr[face.idx[2]], scr[face.idx[3]]],
          fill: this.shade(part.c, n, shadeOpts), alpha: o.alpha, add: part.add || o.add });
      }
    }

    addSprite(z, fn) { this.items.push({ z, fn }); }

    flushItems() {
      const ctx = this.ctx;
      this.items.sort((a, b) => b.z - a.z);
      for (const it of this.items) {
        if (it.fn) { it.fn(ctx); continue; }
        ctx.globalCompositeOperation = it.add ? 'lighter' : 'source-over';
        ctx.globalAlpha = it.alpha == null ? 1 : it.alpha;
        ctx.fillStyle = it.fill;
        ctx.beginPath();
        ctx.moveTo(it.pts[0][0], it.pts[0][1]);
        ctx.lineTo(it.pts[1][0], it.pts[1][1]);
        ctx.lineTo(it.pts[2][0], it.pts[2][1]);
        ctx.lineTo(it.pts[3][0], it.pts[3][1]);
        ctx.closePath();
        ctx.fill();
        if (!it.add && it.alpha == null) { ctx.strokeStyle = it.fill; ctx.lineWidth = 0.8; ctx.stroke(); }   // hide seams
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      this.items.length = 0;
    }

    // ---- frame ----
    draw(world, alpha, opts) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.shake > 0.5 && !opts.paused) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

      if (this.stage.gravity > 0) this.drawEarthBackdrop(world); else this.drawSpaceBackdrop(world);

      for (const b of this.scene.boxes) this.addBox(b, null, [0, 0, 0], { fogged: true });
      for (const a of this.scene.asteroids) this.addBox(a, null, [0, 0, 0], { fogged: true });
      if (!opts.showcase) this.addPlatforms();

      for (const gh of this.ghosts) this.drawMech(gh.f, gh.x, gh.y, gh.facing, '#7fe3ff', { alpha: (gh.life / gh.max) * 0.45 });
      for (const f of world.fighters) {
        const x = lerp(f.prevX, f.x, alpha), y = lerp(f.prevY, f.y, alpha);
        if (this.stage.gravity > 0) this.addShadow(x, y);
        this.drawMech(f, x, y, f.facing, null, { flash: Math.min(1, f.hitFlash * 8), silhouette: f.silhouette });
        if (f.guarding) this.drawGuard(f, x, y);
      }
      this.drawProjectiles(world, alpha);
      this.drawBlasts();
      this.drawParticles();
      this.flushItems();
      this.drawTexts();
      for (const f of world.fighters) if (f.lowEnergy > 0) this.drawLowEnergy(f, lerp(f.prevX, f.x, alpha), lerp(f.prevY, f.y, alpha));

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (opts.showcase || opts.noHud) return;
      this.drawHud(world);
      if (opts.debug) this.drawCameraTag();
      if (world.winner) this.drawKo(world);
      if (opts.debug) this.drawDebug(world, alpha);
      if (opts.paused) this.drawPause(opts);
    }

    drawCameraTag() {
      const ctx = this.ctx;
      const label = { duel: 'CAM · DUEL', side: 'CAM · SIDE 2D', free: 'CAM · FREE', showcase: 'CAM · SHOWCASE', title: 'CAM · TITLE' }[this.cam.mode];
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#8b95ad';
      ctx.fillText(`${label}   yaw ${(this.cam.yaw * 180 / Math.PI).toFixed(0)}°   dist ${this.cam.dist.toFixed(0)}`, CX, 56);
      ctx.textAlign = 'left';
    }

    horizonY() {
      const cam = this.cam;
      const fg = norm([cam.fwd[0], 0, cam.fwd[2]]);
      const p = cam.project([cam.pos[0] + fg[0] * 60000, 0, cam.pos[2] + fg[2] * 60000]);
      return p ? p.y : H * 0.4;
    }

    drawEarthBackdrop() {
      const ctx = this.ctx, cam = this.cam;
      const hy = this.horizonY();
      const sky = ctx.createLinearGradient(0, -20, 0, hy);
      sky.addColorStop(0, '#0b1a33'); sky.addColorStop(0.55, '#2f5f8f'); sky.addColorStop(1, '#d99a5e');
      ctx.fillStyle = sky;
      ctx.fillRect(-20, -20, W + 40, Math.max(hy, 0) + 22);

      const sun = cam.project([1700, 110, -3900]);
      if (sun) {
        const r = 300 * sun.s;
        const g = ctx.createRadialGradient(sun.x, sun.y, r * 0.5, sun.x, sun.y, r * 3);
        g.addColorStop(0, 'rgba(255,190,110,0.9)'); g.addColorStop(0.4, 'rgba(255,150,80,0.25)'); g.addColorStop(1, 'rgba(255,150,80,0)');
        ctx.fillStyle = g; ctx.fillRect(sun.x - r * 3, sun.y - r * 3, r * 6, r * 6);
        ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(sun.x, sun.y, r, 0, Math.PI * 2); ctx.fill();
      }

      for (const ridge of this.scene.ridges) {
        const pts = ridge.pts.map((p) => cam.project(p)).filter(Boolean);
        if (pts.length < 2) continue;
        ctx.fillStyle = ridge.col;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, hy + 40);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.lineTo(pts[pts.length - 1].x, hy + 40);
        ctx.closePath();
        ctx.fill();
      }

      // Ground: a camera-aligned quad on Y = 0, so its near edge is always in front of the lens.
      const fg = norm([cam.fwd[0], 0, cam.fwd[2]]), rg = norm([cam.right[0], 0, cam.right[2]]);
      const base = [cam.pos[0], 0, cam.pos[2]];
      const corner = (fwdD, sideD) => cam.project([base[0] + fg[0] * fwdD + rg[0] * sideD, 0, base[2] + fg[2] * fwdD + rg[2] * sideD]);
      const q = [corner(60, -4000), corner(60, 4000), corner(9000, 4000), corner(9000, -4000)];
      if (q.every(Boolean)) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(q[i].x, q[i].y);
        ctx.closePath();
        ctx.clip();
        const g = ctx.createLinearGradient(0, hy, 0, H + 20);
        g.addColorStop(0, '#8a7a66'); g.addColorStop(0.25, '#4a3f2c'); g.addColorStop(1, '#1e1810');
        ctx.fillStyle = g;
        ctx.fillRect(-20, hy - 2, W + 40, H - hy + 40);
        ctx.restore();
      }
      // Grid on the ground reads depth and speed.
      ctx.lineWidth = 1;
      const nearZ = cam.pos[2] + 400;
      for (let x = -2000; x <= 2000; x += 100) {
        const s = cam.segment([x, 0.3, -3200], [x, 0.3, nearZ]);
        if (!s) continue;
        ctx.strokeStyle = 'rgba(200,170,120,0.16)';
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
      for (let z = -3200; z <= nearZ; z += 100) {
        const s = cam.segment([-2000, 0.3, z], [2000, 0.3, z]);
        if (!s) continue;
        ctx.strokeStyle = `rgba(200,170,120,${(0.2 * clamp(1 - s.z / 3200, 0, 1)).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
      }
      // Fight line: where the duel actually happens.
      const fl = cam.segment([-CX, 0.6, 0], [CX, 0.6, 0]);
      if (fl) { ctx.strokeStyle = 'rgba(255,200,140,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(fl.ax, fl.ay); ctx.lineTo(fl.bx, fl.by); ctx.stroke(); }
    }

    drawSpaceBackdrop() {
      const ctx = this.ctx, cam = this.cam;
      ctx.fillStyle = '#04050b';
      ctx.fillRect(-20, -20, W + 40, H + 40);
      for (const [p, r0, col] of [[[-1800, 900, -5200], 2600, 'rgba(90,50,140,0.22)'], [[2200, 600, -5600], 2200, 'rgba(30,110,140,0.16)']]) {
        const c = cam.project(p);
        if (!c) continue;
        const r = r0 * c.s;
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      }
      for (const st of this.scene.stars) {
        const c = cam.project(st.p);
        if (!c) continue;
        ctx.fillStyle = `rgba(210,220,255,${st.b})`;
        const s = st.big ? 2.6 : 1.4;
        ctx.fillRect(c.x, c.y, s, s);
      }
      // Home planet low in the bottom-right corner, far enough that it never crowds the fighters.
      const pl = cam.project([1100, -2100, -4600]);
      if (pl) {
        const r = 1700 * pl.s;
        const glow = ctx.createRadialGradient(pl.x, pl.y, r * 0.97, pl.x, pl.y, r * 1.1);
        glow.addColorStop(0, 'rgba(110,180,255,0.35)'); glow.addColorStop(1, 'rgba(110,180,255,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(pl.x, pl.y, r * 1.1, 0, Math.PI * 2); ctx.fill();
        const body = ctx.createRadialGradient(pl.x - r * 0.3, pl.y - r * 0.7, r * 0.05, pl.x, pl.y, r);
        body.addColorStop(0, '#2f6ea8'); body.addColorStop(0.5, '#153f69'); body.addColorStop(1, '#07182c');
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(pl.x, pl.y, r, 0, Math.PI * 2); ctx.fill();
      }
      // Arena bounds on the fight plane, with short depth ticks at the corners.
      const yTop = GY - GD.ARENA.ceilingY, yBot = GY - H;
      ctx.save();
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = 'rgba(53,199,232,0.3)';
      ctx.lineWidth = 1;
      const edges = [[[-CX, yBot, 0], [CX, yBot, 0]], [[CX, yBot, 0], [CX, yTop, 0]], [[CX, yTop, 0], [-CX, yTop, 0]], [[-CX, yTop, 0], [-CX, yBot, 0]]];
      for (const [a, b] of edges) {
        const s = cam.segment(a, b);
        if (s) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(53,199,232,0.18)';
      for (const [x, y] of [[-CX, yBot], [CX, yBot], [-CX, yTop], [CX, yTop]]) {
        const s = cam.segment([x, y, 0], [x, y, -160]);
        if (s) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
      }
      ctx.restore();
    }

    addPlatforms() {
      for (const p of this.stage.platforms) {
        const cx = p.x + p.w / 2 - CX, top = GY - p.y;
        this.addBox({ p: [cx, top - p.h / 2, 0], s: [p.w, p.h, 72], c: '#4a5162' }, null, [0, 0, 0], {});
        this.addBox({ p: [cx, top + 1, 0], s: [p.w, 2, 72], c: '#aab3c6' }, null, [0, 0, 0], {});
        const ph = top - p.h;
        for (const dx of [-p.w / 2 + 20, p.w / 2 - 20]) {
          this.addBox({ p: [cx + dx, ph / 2, 0], s: [10, ph, 10], c: '#2e3442' }, null, [0, 0, 0], {});
        }
      }
    }

    addShadow(x, y) {
      const cam = this.cam;
      const wx = x - CX, h = Math.max(0, GY - y);
      const k = 1 / (1 + h / 220);
      const r = 27 * k;
      const pts = [];
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        const p = cam.project([wx + Math.cos(a) * r * 1.1, 0.8, Math.sin(a) * r * 0.9]);
        if (!p) return;
        pts.push(p);
      }
      const center = cam.toCam([wx, 0.8, 0]);
      this.addSprite(center[2] + 0.5, (ctx) => {
        ctx.globalAlpha = 0.42 * k;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    // ---- mechs ----
    drawMech(f, x, y, facing, ghostColor, opts) {
      opts = opts || {};
      const vis = this.visFor(f);
      const st = ghostColor ? 'dash' : f.state;
      const yaw = ghostColor ? (facing > 0 ? 0 : Math.PI) : vis.yaw;
      const earth = this.stage.gravity > 0;
      let lean = 0;
      if (st === 'walk') lean = -0.07;
      if (st === 'dash') lean = -0.3;
      if (st === 'hit') lean = 0.32;
      if (st === 'attack') lean = -0.1;
      if (st === 'boost' && earth) lean = -0.05;
      if (st === 'drift') lean = Math.sin(this.time * 1.5 + f.player) * 0.05;
      if (st === 'thrust' || (st === 'boost' && !earth)) lean = -(f.thrustX * facing) * 0.28 + Math.sin(this.time * 1.5) * 0.02;

      let rootM = rotY(yaw);
      if (st === 'down') {
        rootM = mul(rootM, rotZ(1.45));
        if (!earth) rootM = mul(rootM, rotX(vis.tumble));
      } else if (lean) {
        rootM = mul(rootM, rotZ(lean));
      }
      const rootT = toWorld(x, y, 0);
      if (st === 'down' && !earth) rootT[1] -= 20;
      const squash = f.landSquash || 0;
      if (squash > 0 && st !== 'down') rootM = mul(rootM, [1 + squash * 0.1, 0, 0, 0, 1 - squash * 0.12, 0, 0, 0, 1 + squash * 0.1]);

      const o = { ghost: ghostColor || (opts.silhouette ? '#1c2334' : null), alpha: opts.alpha, flash: opts.flash };
      for (const part of this.mechParts(f, st, vis.side)) this.addBox(part, rootM, rootT, o);
    }

    mechParts(f, st, side) {
      const m = f.mech;
      const col = m.color, acc = m.accent;
      const dark = shadeHex(col, 0.72), darker = shadeHex(col, 0.5);
      const metal = '#59606e', metalDark = '#2f333d';
      const airborne = st === 'rise' || st === 'fall' || st === 'boost' || st === 'drift' || st === 'thrust';
      let legA = 0, legB = 0, armA = 0, armB = 0;     // A = weapon side
      if (st === 'walk') {
        const s = Math.sin(f.walkPhase);
        legA = s * 0.55; legB = -s * 0.55; armA = -s * 0.3; armB = s * 0.3;
      }
      if (airborne) { legA = -0.2; legB = -0.45; armB = -0.3; }
      if (st === 'dash') { legA = 0.5; legB = -0.6; armB = -0.8; }
      if (st === 'down') { legA = 0.25; legB = -0.1; }
      const w = f.ranged ? GD.activeWeapon(f) : null;
      const ranged = !!(w && w.kind === 'projectile');
      const recoil = (f.recoil || 0) * 5;
      const aim = -(f.lastAim || 0) * Math.PI / 180;
      const zA = 21 * side, zB = -21 * side;
      const parts = [
        { p: [0, 77, 0], s: [16, 14, 16], c: col },
        { p: [8.6, 79, 0], s: [1.6, 4, 10], c: m.eye, glow: true },
        { p: [4, 86.5, 0], s: [8, 4, 2], c: '#f4d35e' },
        { p: [0, 54, 0], s: [30, 32, 24], c: col },
        { p: [15.6, 58, 0], s: [1.6, 10, 14], c: acc },
        { p: [0, 36.5, 0], s: [26, 7, 20], c: acc },
        { p: [0, 67, 19 * side], s: [14, 12, 12], c: col },
        { p: [0, 67, -19 * side], s: [14, 12, 12], c: col },
        { p: [-19, 60, 0], s: [8, 22, 18], c: darker },
        { p: [-25, 50, 6], s: [4, 6, 6], c: metal },
        { p: [-25, 50, -6], s: [4, 6, 6], c: metal },
        { p: [0, 18, 8 * side], s: [12, 36, 11], c: col, pivot: [0, 36, 8 * side], rz: legA },
        { p: [3, 2.5, 8 * side], s: [18, 5, 12], c: acc, pivot: [0, 36, 8 * side], rz: legA },
        { p: [0, 18, -8 * side], s: [12, 36, 11], c: dark, pivot: [0, 36, -8 * side], rz: legB },
        { p: [3, 2.5, -8 * side], s: [18, 5, 12], c: acc, pivot: [0, 36, -8 * side], rz: legB },
        { p: [1, 51, zB], s: [10, 24, 10], c: dark, pivot: [0, 63, zB], rz: armB },
      ];
      if (st === 'guard') {
        parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: [0, 63, zA], rz: 1.15 });
        parts.push({ p: [22, 48, zA * 0.85], s: [3, 58, 30], c: '#9aa3b8' });
      } else if (f.melee) {
        const mm = f.melee, mw = mm.w;
        const wind = mm.t < mw.windup;
        const p = wind ? mm.t / mw.windup : Math.min(1, (mm.t - mw.windup) / mw.active);
        const piv = [0, 63, zA];
        if (mw.style === 'lance') {
          // Thrust: arm level, the lance slides forward along the arm axis.
          const ang = wind ? 1.57 - 0.25 * p : 1.32 + 0.25 * p;
          const d = wind ? -8 * p : -8 + 34 * p;
          const beam = mm.range * 0.6;
          parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: piv, rz: ang });
          parts.push({ p: [0, 28 - d, zA], s: [4, 44, 4], c: metal, pivot: piv, rz: ang });
          parts.push({ p: [0, 6 - d - beam / 2, zA], s: [3, beam, 3], c: '#c8f3ff', glow: true, add: true, pivot: piv, rz: ang });
        } else if (mw.style === 'axe') {
          // Overhead chop: wind far back, then a long arc down in front.
          const ang = wind ? 2.9 + 0.3 * p : 3.2 - 2.6 * p;
          parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: piv, rz: ang });
          parts.push({ p: [0, 24, zA], s: [4, 32, 4], c: metal, pivot: piv, rz: ang });
          parts.push({ p: [-5, 12, zA], s: [14, 18, 6], c: '#7a3328', pivot: piv, rz: ang });
          parts.push({ p: [-12.5, 12, zA], s: [2, 18, 6], c: '#ff6a3a', glow: true, add: !wind, pivot: piv, rz: ang });
        } else {
          const ph = wind ? p : 1 + p;
          const ang = ph <= 1 ? 2.7 - ph * 1.1 : 1.6 - (ph - 1) * 0.9;     // raise, then slash down and forward
          parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: piv, rz: ang });
          parts.push({ p: [0, 34, zA], s: [5, 10, 5], c: metal, pivot: piv, rz: ang });
          parts.push({ p: [0, 29 - mm.range / 2, zA], s: [4, mm.range, 4], c: '#ffd7a8', glow: true, add: true, pivot: piv, rz: ang });
        }
      } else if (ranged && w.id === 'bazooka') {
        parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: [0, 63, zA], rz: 0.6 + armA * 0.3 });
        parts.push({ p: [10 - recoil, 73, zA], s: [50, 10, 10], c: metal, pivot: [-6, 73, zA], rz: aim * 0.7 });
        parts.push({ p: [-16 - recoil, 73, zA], s: [6, 13, 13], c: metalDark, pivot: [-6, 73, zA], rz: aim * 0.7 });
      } else if (ranged) {
        parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: [0, 63, zA], rz: 1.25 });
        const len = w.id === 'grenade' ? 12 : 34;
        parts.push({ p: [22 + len / 2 - 4 - recoil, 55, zA], s: [len, 6, 6], c: w.id === 'grenade' ? '#3d4a3d' : metal, pivot: [22, 55, zA], rz: aim });
        if (w.id !== 'grenade') parts.push({ p: [22 + len - 4 - recoil, 55, zA], s: [5, 8, 8], c: w.color, glow: true, pivot: [22, 55, zA], rz: aim });
      } else {
        // Melee weapon at rest in the front hand.
        const piv = [0, 63, zA];
        const rest = w && w.style === 'lance' ? 0.9 : armA;
        parts.push({ p: [1, 51, zA], s: [10, 24, 10], c: col, pivot: piv, rz: rest });
        if (w && w.style === 'axe') {
          parts.push({ p: [0, 26, zA], s: [4, 30, 4], c: metal, pivot: piv, rz: rest });
          parts.push({ p: [-5, 14, zA], s: [14, 14, 6], c: '#7a3328', pivot: piv, rz: rest });
        } else if (w && w.style === 'lance') {
          parts.push({ p: [0, 12, zA], s: [4, 76, 4], c: metal, pivot: piv, rz: rest });
          parts.push({ p: [0, -29, zA], s: [6, 8, 6], c: w.color, glow: true, pivot: piv, rz: rest });
        } else if (w) {
          parts.push({ p: [0, 35, zA], s: [4, 10, 4], c: metal, pivot: piv, rz: rest });
          parts.push({ p: [0, 29.5, zA], s: [5, 2, 5], c: w.color, glow: true, pivot: piv, rz: rest });
        }
      }
      if (f.subFlash > 0) {
        parts.push({ p: [10, 81, 5], s: [6, 4, 4], c: '#fff3a8', glow: true, add: true }, { p: [10, 81, -5], s: [6, 4, 4], c: '#fff3a8', glow: true, add: true });
      }
      return parts;
    }

    drawGuard(f, x, y) {
      const vis = this.visFor(f);
      const rootT = toWorld(x, y, 0);
      this.addBox({ p: [30, 48, 0], s: [3, 76, 48], c: '#5ad2ff', add: true, glow: true }, rotY(vis.yaw), rootT, { alpha: 0.22 });
    }

    // ---- projectiles, effects ----
    drawProjectiles(world, alpha) {
      const cam = this.cam;
      for (const p of world.projectiles) {
        const x = lerp(p.prevX, p.x, alpha), y = lerp(p.prevY, p.y, alpha);
        const w = p.weapon;
        const ang = Math.atan2(-p.vy, p.vx);
        const pos = toWorld(x, y, 0);
        if (w.id === 'bazooka') {
          this.addBox({ p: [0, 0, 0], s: [24, 10, 10], c: metalOf(w), rz: ang }, null, pos, {});
          this.addBox({ p: [14, 0, 0], s: [6, 6, 6], c: w.color, rz: ang, pivot: [0, 0, 0], glow: true }, null, pos, {});
          this.addBox({ p: [-13, 0, 0], s: [3, 16, 16], c: '#2f333d', rz: ang, pivot: [0, 0, 0] }, null, pos, {});
        } else if (w.id === 'grenade') {
          const blink = Math.floor((p.life + this.time) * 8) % 2 === 0;
          this.addBox({ p: [0, 0, 0], s: [13, 13, 13], c: '#3d4a3d', rx: this.time * 5, ry: p.life * 4 }, null, pos, {});
          this.addBox({ p: [0, 0, 0], s: [6, 6, 15], c: blink ? w.color : '#1d2a1d', rx: this.time * 5, ry: p.life * 4, glow: blink }, null, pos, {});
        } else {
          // Beams and tracers: a streak from the current position back along the velocity.
          const len = w.id === 'beam' ? w.trail : 18;
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const tail = toWorld(x - p.vx / sp * len, y - p.vy / sp * len, 0);
          const s = cam.segment(tail, pos);
          if (!s) continue;
          const head = cam.project(pos);
          const scale = head ? head.s : 1;
          this.addSprite(s.z, (ctx) => {
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            const g = ctx.createLinearGradient(s.ax, s.ay, s.bx, s.by);
            g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, w.color);
            ctx.strokeStyle = g; ctx.lineWidth = (w.id === 'beam' ? 6 : 2.6) * scale;
            ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke();
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = (w.id === 'beam' ? 2.4 : 1.2) * scale;
            ctx.beginPath(); ctx.moveTo((s.ax + s.bx) / 2, (s.ay + s.by) / 2); ctx.lineTo(s.bx, s.by); ctx.stroke();
            ctx.lineCap = 'butt';
            ctx.globalCompositeOperation = 'source-over';
          });
        }
      }
      function metalOf() { return '#59606e'; }
    }

    drawBlasts() {
      const cam = this.cam;
      for (const b of this.blasts) {
        const t = 1 - b.life / b.max;
        const r = b.r * (0.4 + t * 0.8);
        const c = toWorld(b.x, b.y, 0);
        const ring = [];
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2;
          const p = cam.project([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, 0]);
          if (!p) { ring.length = 0; break; }
          ring.push(p);
        }
        if (!ring.length) continue;
        const z = cam.toCam(c)[2];
        this.addSprite(z, (ctx) => {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.fillStyle = t < 0.3 ? '#fff2b0' : 'rgba(255,138,42,0.6)';
          ctx.beginPath();
          ctx.moveTo(ring[0].x, ring[0].y); for (const p of ring) ctx.lineTo(p.x, p.y); ctx.closePath();
          ctx.save(); ctx.globalAlpha *= t < 0.3 ? 0.9 : 0.5; ctx.fill(); ctx.restore();
          ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 3 * (1 - t) + 1; ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        });
      }
    }

    drawParticles() {
      const cam = this.cam;
      for (const p of this.particles) {
        const s = cam.project(toWorld(p.x, p.y, 0));
        if (!s) continue;
        const t = p.life / p.max;
        const r = (p.grow ? p.size * (1 + (1 - t) * 1.5) : p.size * t) * s.s;
        if (r < 0.4) continue;
        this.addSprite(s.z, (ctx) => {
          ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
          ctx.globalAlpha = p.grow ? t * 0.55 : Math.min(1, t * 1.4);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        });
      }
    }

    drawTexts() {
      const ctx = this.ctx, cam = this.cam;
      ctx.textAlign = 'center';
      for (const t of this.texts) {
        const s = cam.project(toWorld(t.x, t.y, 0));
        if (!s) continue;
        ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
        ctx.font = `${Math.round((t.big ? 26 : 18) * clamp(s.s, 0.7, 1.6))}px "Russo One", "Noto Sans TC", sans-serif`;
        ctx.fillStyle = '#05070d'; ctx.fillText(t.text, s.x + 2, s.y + 2);
        ctx.fillStyle = t.color; ctx.fillText(t.text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    drawLowEnergy(f, x, y) {
      const s = this.cam.project(toWorld(x, y - f.h - 10, 0));
      if (!s) return;
      const ctx = this.ctx;
      ctx.font = `11px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ff5ad6';
      ctx.fillText('EN LOW', s.x, s.y);
      ctx.textAlign = 'left';
    }

    drawDebug(world, alpha) {
      const ctx = this.ctx, cam = this.cam;
      ctx.lineWidth = 1;
      const rect = (x0, y0, x1, y1, color) => {
        const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => cam.project(toWorld(x, y, 0)));
        if (!pts.every(Boolean)) return;
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts) ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.stroke();
      };
      for (const p of world.stage.platforms) rect(p.x, p.y, p.x + p.w, p.y + p.h, '#4cd48a');
      for (const f of world.fighters) {
        const x = lerp(f.prevX, f.x, alpha), y = lerp(f.prevY, f.y, alpha);
        rect(x - f.w / 2, y - f.h, x + f.w / 2, y, P_COLORS[f.player]);
        ctx.font = `10px ${MONO}`; ctx.fillStyle = '#ffd447'; ctx.textAlign = f.player === 1 ? 'left' : 'right';
        ctx.fillText(`${f.state.toUpperCase()} vx ${f.vx.toFixed(0)} vy ${f.vy.toFixed(0)} stun ${f.hitstun.toFixed(2)}`, f.player === 1 ? 16 : W - 16, 76);
      }
      for (const p of world.projectiles) {
        const s = cam.project(toWorld(p.x, p.y, 0));
        if (!s) continue;
        ctx.strokeStyle = '#ff5ad6'; ctx.beginPath(); ctx.arc(s.x, s.y, p.r * s.s, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffd447';
      ctx.fillText(`${this.fps.toFixed(0)} FPS · ${this.particles.length} particles · ${world.projectiles.length} shots`, CX, 68);
      ctx.textAlign = 'left';
    }
  }

  GD.Renderer3D = Renderer3D;
})(globalThis.GD = globalThis.GD || {});
