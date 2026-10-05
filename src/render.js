/* Gravity Duel - Canvas 2D renderer: stage backdrop, mechs, particles and HUD. */
(function (GD) {
  'use strict';

  const W = GD.ARENA.w;
  const H = GD.ARENA.h;
  const P_COLORS = { 1: '#e8453c', 2: '#3a7bff' };
  const MONO = '"Share Tech Mono", ui-monospace, Menlo, monospace';
  const DISPLAY = '"Russo One", "Noto Sans TC", sans-serif';

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, ((n >> 16) & 255) * k) | 0;
    const g = Math.min(255, ((n >> 8) & 255) * k) | 0;
    const b = Math.min(255, (n & 255) * k) | 0;
    return `rgb(${r},${g},${b})`;
  }

  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * this.dpr;
      canvas.height = H * this.dpr;
      this.particles = [];
      this.ghosts = [];
      this.blasts = [];     // expanding explosion rings
      this.texts = [];      // floating damage numbers
      this.shake = 0;
      this.fps = 60;
      this.time = 0;
      this.bg = null;
    }

    setStage(stage) {
      this.stage = stage;
      this.bg = this.buildBackground(stage);
      this.reset();
    }

    reset() {
      this.particles.length = 0;
      this.ghosts.length = 0;
      this.blasts.length = 0;
      this.texts.length = 0;
      this.shake = 0;
    }

    // Static backdrop is drawn once per stage into an offscreen canvas.
    buildBackground(stage) {
      const c = document.createElement('canvas');
      c.width = W * this.dpr;
      c.height = H * this.dpr;
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const rnd = seeded(stage.id === 'earth' ? 11 : 7);
      const gy = GD.ARENA.groundY;

      if (stage.gravity > 0) {
        const sky = g.createLinearGradient(0, 0, 0, gy);
        sky.addColorStop(0, '#0d1d38');
        sky.addColorStop(0.6, '#2f5f8f');
        sky.addColorStop(1, '#c98a55');
        g.fillStyle = sky;
        g.fillRect(0, 0, W, gy);

        // A crashed colony cylinder on the horizon.
        g.fillStyle = 'rgba(20,30,50,0.55)';
        g.beginPath();
        g.ellipse(720, gy - 40, 260, 34, -0.08, 0, Math.PI * 2);
        g.fill();

        // Ruined city skyline, two layers for depth.
        for (const [color, hMin, hMax] of [['rgba(25,38,62,0.75)', 40, 140], ['rgba(14,20,34,0.9)', 20, 90]]) {
          g.fillStyle = color;
          let x = -10;
          while (x < W) {
            const bw = 24 + rnd() * 50;
            const bh = hMin + rnd() * (hMax - hMin);
            g.beginPath();
            g.moveTo(x, gy);
            g.lineTo(x, gy - bh);
            g.lineTo(x + bw * 0.4, gy - bh + rnd() * 18);   // broken roofline
            g.lineTo(x + bw, gy - bh - rnd() * 10);
            g.lineTo(x + bw, gy);
            g.fill();
            x += bw + rnd() * 10;
          }
        }

        // Ground.
        const ground = g.createLinearGradient(0, gy, 0, H);
        ground.addColorStop(0, '#3a3120');
        ground.addColorStop(1, '#1b160c');
        g.fillStyle = ground;
        g.fillRect(0, gy, W, H - gy);
        g.strokeStyle = '#a08c5c';
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, gy + 1); g.lineTo(W, gy + 1); g.stroke();
        g.strokeStyle = 'rgba(160,140,92,0.18)';
        g.lineWidth = 1;
        for (let x = 0; x < W; x += 48) {
          g.beginPath(); g.moveTo(x, gy + 6); g.lineTo(x - 30, H); g.stroke();
        }

        // Platforms: steel girders on support pillars.
        for (const p of stage.platforms) {
          g.fillStyle = 'rgba(40,46,60,0.9)';
          g.fillRect(p.x + 16, p.y + p.h, 10, gy - p.y - p.h);
          g.fillRect(p.x + p.w - 26, p.y + p.h, 10, gy - p.y - p.h);
          g.fillStyle = '#4a5162';
          g.fillRect(p.x, p.y, p.w, p.h);
          g.fillStyle = '#aab3c6';
          g.fillRect(p.x, p.y, p.w, 3);
          g.strokeStyle = '#2b3040';
          g.beginPath();
          for (let x = p.x + 6; x < p.x + p.w - 6; x += 14) {
            g.moveTo(x, p.y + p.h); g.lineTo(x + 7, p.y + 4); g.lineTo(x + 14, p.y + p.h);
          }
          g.stroke();
        }
      } else {
        g.fillStyle = '#04050b';
        g.fillRect(0, 0, W, H);
        for (const [x, y, r, col] of [[260, 160, 320, 'rgba(90,50,140,0.22)'], [700, 120, 260, 'rgba(30,110,140,0.16)']]) {
          const n = g.createRadialGradient(x, y, 0, x, y, r);
          n.addColorStop(0, col);
          n.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = n;
          g.fillRect(0, 0, W, H);
        }
        for (let i = 0; i < 220; i++) {
          const s = rnd() < 0.12 ? 1.8 : 0.9;
          g.fillStyle = `rgba(210,220,255,${0.4 + rnd() * 0.6})`;
          g.fillRect(rnd() * W, rnd() * H, s, s);
        }
        // Earth rising at the bottom right.
        const ex = 830, ey = 720, er = 300;
        const glow = g.createRadialGradient(ex, ey, er * 0.95, ex, ey, er * 1.12);
        glow.addColorStop(0, 'rgba(120,190,255,0.45)');
        glow.addColorStop(1, 'rgba(120,190,255,0)');
        g.fillStyle = glow;
        g.beginPath(); g.arc(ex, ey, er * 1.12, 0, Math.PI * 2); g.fill();
        const planet = g.createRadialGradient(ex - 120, ey - 200, 20, ex, ey, er);
        planet.addColorStop(0, '#5aa7e0');
        planet.addColorStop(0.6, '#1f5a8f');
        planet.addColorStop(1, '#0a1f38');
        g.fillStyle = planet;
        g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill();
        // Arena bounds.
        g.strokeStyle = 'rgba(53,199,232,0.25)';
        g.setLineDash([6, 8]);
        g.strokeRect(1, GD.ARENA.ceilingY, W - 2, H - GD.ARENA.ceilingY - 1);
        g.setLineDash([]);
      }
      return c;
    }

    // Turn physics events into particles.
    consume(events) {
      for (const e of events) {
        if (e.type === 'land') {
          const n = Math.min(18, 4 + (e.impact / 60) | 0);
          for (let i = 0; i < n; i++) {
            const dir = i % 2 ? 1 : -1;
            this.spawn({ x: e.x + dir * 10, y: e.y - 2, vx: dir * (60 + Math.random() * 140), vy: -20 - Math.random() * 60,
              life: 0.5, size: 5 + Math.random() * 4, color: '#b3a47a', drag: 3, grow: true });
          }
        } else if (e.type === 'jump') {
          for (let i = 0; i < 6; i++) {
            this.spawn({ x: e.x, y: e.y - 2, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 40,
              life: 0.35, size: 4, color: '#b3a47a', drag: 4, grow: true });
          }
        } else if (e.type === 'dash') {
          for (let i = 0; i < 10; i++) {
            this.spawn({ x: e.x - e.dx * 20, y: e.y - 42 - e.dy * 20, vx: -e.dx * (120 + Math.random() * 200) + (Math.random() - 0.5) * 60,
              vy: -e.dy * (120 + Math.random() * 200) + (Math.random() - 0.5) * 60, life: 0.3, size: 5, color: '#7fe3ff', additive: true, drag: 5 });
          }
        } else if (e.type === 'fire') {
          const w = GD.weaponById(e.weapon) || GD.VULCAN;
          const col = e.weapon === 'vulcan' ? GD.VULCAN.color : w.color;
          const n = e.weapon === 'bazooka' ? 14 : e.weapon === 'grenade' ? 4 : 5;
          for (let i = 0; i < n; i++) {
            this.spawn({ x: e.x, y: e.y, vx: e.dx * (200 + Math.random() * 300) + (Math.random() - 0.5) * 120,
              vy: e.dy * (200 + Math.random() * 300) + (Math.random() - 0.5) * 120, life: 0.12 + Math.random() * 0.1, size: e.weapon === 'bazooka' ? 8 : 4,
              color: i % 3 ? col : '#ffffff', additive: true, drag: 6 });
          }
          if (e.weapon === 'bazooka') this.shake = Math.max(this.shake, 3);
        } else if (e.type === 'hit') {
          const n = e.blocked ? 6 : Math.min(22, 6 + e.dmg / 8);
          for (let i = 0; i < n; i++) {
            const a = Math.atan2(-e.dy, -e.dx) + (Math.random() - 0.5) * 1.6;
            const sp = 120 + Math.random() * 320;
            this.spawn({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25 + Math.random() * 0.2, size: 3,
              color: e.blocked ? '#7fe3ff' : (i % 2 ? '#ffd447' : '#ffffff'), additive: true, drag: 3, gravity: 400 });
          }
          this.texts.push({ x: e.x, y: e.y - 20, vy: -70, life: 0.8, max: 0.8, text: e.blocked ? `GUARD ${e.dmg}` : String(e.dmg),
            color: e.blocked ? '#7fe3ff' : (e.dmg >= 100 ? '#ff7a1a' : '#ffffff'), big: e.dmg >= 100 });
          this.shake = Math.max(this.shake, e.blocked ? 1 : Math.min(8, e.dmg / 18));
        } else if (e.type === 'explode') {
          this.blasts.push({ x: e.x, y: e.y, r: e.r, life: 0.35, max: 0.35 });
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 80 + Math.random() * 380;
            this.spawn({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.4, size: 4 + Math.random() * 6,
              color: i % 3 === 0 ? '#fff2b0' : i % 3 === 1 ? '#ff8a2a' : '#ff4d2a', additive: true, drag: 3 });
          }
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            this.spawn({ x: e.x, y: e.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 - 40, life: 0.9, size: 9, color: '#4a4a52', drag: 1.5, grow: true });
          }
          this.shake = Math.max(this.shake, 10);
        } else if (e.type === 'ricochet') {
          for (let i = 0; i < 5; i++) {
            this.spawn({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 260, vy: -60 - Math.random() * 180, life: 0.3, size: 2.5,
              color: e.color, additive: true, drag: 2, gravity: 600 });
          }
        } else if (e.type === 'ko') {
          this.shake = Math.max(this.shake, 14);
          for (let i = 0; i < 30; i++) {
            const a = Math.random() * Math.PI * 2;
            this.spawn({ x: e.x, y: e.y - 40, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200 - 80, life: 1.2, size: 6, color: '#ff7a1a', additive: true, drag: 1.5, gravity: 300 });
          }
        } else if (e.type === 'overheat') {
          for (let i = 0; i < 14; i++) {
            this.spawn({ x: e.x, y: e.y - 60, vx: (Math.random() - 0.5) * 220, vy: -60 - Math.random() * 160,
              life: 0.5, size: 2.5, color: '#ffcf5a', additive: true, drag: 2, gravity: 500 });
          }
        }
      }
    }

    spawn(p) {
      if (this.particles.length > 700) this.particles.shift();
      p.max = p.life;
      this.particles.push(p);
    }

    // Per-frame (not per-step) effects: thruster flames, smoke, dash ghosts.
    update(dt, world, alpha) {
      this.time += dt;
      if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
      for (const f of world.fighters) {
        const x = f.prevX + (f.x - f.prevX) * alpha;
        const y = f.prevY + (f.y - f.prevY) * alpha;
        const nx = x - 21 * f.facing;
        const ny = y - 44;
        if (f.thrusting) {
          const power = f.boosting ? 1.6 : 1;
          for (let i = 0; i < (f.boosting ? 3 : 2); i++) {
            const sp = (220 + Math.random() * 160) * power;
            this.spawn({ x: nx, y: ny, vx: -f.thrustX * sp + (Math.random() - 0.5) * 50, vy: -f.thrustY * sp + (Math.random() - 0.5) * 50,
              life: 0.18 + Math.random() * 0.1, size: 7 * power, color: Math.random() < 0.4 ? '#fff2b0' : '#ff8a2a', additive: true, drag: 4 });
          }
        }
        if (f.overheat && Math.random() < 0.35) {
          this.spawn({ x: nx, y: ny, vx: (Math.random() - 0.5) * 30, vy: -30 - Math.random() * 30,
            life: 0.8, size: 5, color: '#6b6b72', drag: 1, grow: true });
        }
        if (f.state === 'dash') this.ghosts.push({ f, x, y, facing: f.facing, life: 0.22, max: 0.22 });
      }
      for (const p of this.particles) {
        p.life -= dt;
        p.vx *= Math.max(0, 1 - (p.drag || 0) * dt);
        p.vy *= Math.max(0, 1 - (p.drag || 0) * dt);
        p.vy += (p.gravity || 0) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const gh of this.ghosts) gh.life -= dt;
      this.ghosts = this.ghosts.filter((gh) => gh.life > 0);
      for (const b of this.blasts) b.life -= dt;
      this.blasts = this.blasts.filter((b) => b.life > 0);
      for (const t of this.texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= 0.92; }
      this.texts = this.texts.filter((t) => t.life > 0);
      this.shake = Math.max(0, this.shake - dt * 40);
      // Rocket exhaust trails.
      for (const p of world.projectiles) {
        if (p.weapon.id === 'bazooka') {
          this.spawn({ x: p.x, y: p.y, vx: -p.vx * 0.1 + (Math.random() - 0.5) * 40, vy: -p.vy * 0.1 + (Math.random() - 0.5) * 40,
            life: 0.25, size: 6, color: Math.random() < 0.5 ? '#ff8a2a' : '#9a9aa2', additive: Math.random() < 0.5, drag: 2, grow: true });
        }
      }
    }

    draw(world, alpha, opts) {
      const ctx = this.ctx;
      if (opts.showcase) { this.drawShowcase(world, alpha, opts); return; }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.shake > 0.5 && !opts.paused) {
        ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      }
      ctx.drawImage(this.bg, -8, -8, W + 16, H + 16);

      for (const gh of this.ghosts) {
        ctx.globalAlpha = (gh.life / gh.max) * 0.45;
        this.drawMech(gh.f, gh.x, gh.y, gh.facing, '#7fe3ff');
      }
      ctx.globalAlpha = 1;

      for (const f of world.fighters) {
        const x = f.prevX + (f.x - f.prevX) * alpha;
        const y = f.prevY + (f.y - f.prevY) * alpha;
        this.drawMech(f, x, y, f.facing, null);
        if (f.hitFlash > 0) {
          ctx.globalAlpha = Math.min(1, f.hitFlash * 8);
          this.drawMech(f, x, y, f.facing, '#ffffff');
          ctx.globalAlpha = 1;
        }
        if (f.guarding) this.drawGuard(f, x, y);
        if (f.lowEnergy > 0) this.drawLowEnergy(f, x, y);
      }

      this.drawProjectiles(world, alpha);
      this.drawBlasts();
      this.drawParticles();
      this.drawTexts();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (opts.noHud) return;
      this.drawHud(world);
      if (world.winner) this.drawKo(world);
      if (opts.debug) this.drawDebug(world, alpha);
      if (opts.paused) this.drawPause(opts);
    }

    // Menu backdrop: the arena dimmed, with both frames enlarged side by side.
    drawShowcase(world, alpha, opts) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.bg, 0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(5,7,13,0.7)');
      g.addColorStop(1, 'rgba(5,7,13,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      const fs = world.fighters;
      const pos = fs.map((f) => ({ x: f.prevX + (f.x - f.prevX) * alpha, y: f.prevY + (f.y - f.prevY) * alpha }));
      const midX = (pos[0].x + pos[1].x) / 2;
      const footY = Math.max(pos[0].y, pos[1].y);
      const scale = opts.scale || 2.2;
      ctx.save();
      ctx.translate(W / 2 + (opts.offsetX || 0), H - 70);
      ctx.scale(scale, scale);
      ctx.translate(-midX, -footY);
      fs.forEach((f, i) => {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(pos[i].x, footY + 1, 26, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        this.drawMech(f, pos[i].x, pos[i].y, f.facing, f.silhouette ? '#1c2334' : null);
      });
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        const t = p.life / p.max;
        const r = p.grow ? p.size * (1 + (1 - t) * 1.5) : p.size * t;
        ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
        ctx.globalAlpha = p.grow ? t * 0.55 : Math.min(1, t * 1.4);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Geometric combat frame. Local origin = feet center, facing +x, 84px tall.
    drawMech(f, x, y, facing, ghostColor) {
      const ctx = this.ctx;
      const m = f.mech;
      const col = (hex, k) => ghostColor || (k ? shade(hex, k) : hex);
      const body = col(m.color);
      const dark = col(m.color, 0.62);
      const darker = col(m.color, 0.42);
      const accent = col(m.accent);
      const R = (x0, y0, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x0, y0, w, h); };

      const st = f.state;
      let lb = 0, lf = 0, liftB = 0, liftF = 0, armSwing = 0, lean = 0;
      if (st === 'walk') {
        const s = Math.sin(f.walkPhase);
        lf = s * 6; lb = -lf;
        liftF = Math.max(0, -Math.cos(f.walkPhase)) * 4;
        liftB = Math.max(0, Math.cos(f.walkPhase)) * 4;
        armSwing = -s * 3;
      } else if (st === 'rise' || st === 'fall' || st === 'boost' || st === 'drift' || st === 'thrust') {
        liftF = 7; lb = -3; lf = 3;
      }
      if (st === 'dash') lean = 0.22;
      if (st === 'hit') { lean = -0.35; liftF = 6; lf = 5; lb = -6; }
      if (st === 'attack') { lean = 0.12; armSwing = 4; }
      if (st === 'thrust' || st === 'boost') lean = (f.thrustX * facing) * 0.18 + (st === 'boost' && this.stage.gravity > 0 ? 0 : 0);
      if (st === 'drift') lean = Math.sin(this.time * 1.5 + f.player) * 0.04;
      const squash = 1 - f.landSquash * 0.12;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing, squash);
      if (st === 'down') {
        // Knocked out: lying on its back (or tumbling slowly in space).
        const spin = this.stage.gravity > 0 ? 0 : Math.sin(this.time * 0.8) * 0.2;
        ctx.translate(-20, -14);
        ctx.rotate(-Math.PI / 2 + spin);
        ctx.translate(0, 0);
      } else {
        ctx.translate(0, -36);
        ctx.rotate(lean);
        ctx.translate(0, 36);
      }

      // Back leg.
      R(-12 + lb, -34, 11, 30 - liftB, dark);
      R(-15 + lb, -4 - liftB, 15, 4, ghostColor || shade(m.accent, 0.7));
      // Backpack with nozzle.
      R(-27, -68, 11, 22, darker);
      R(-25, -46, 8, 5, ghostColor || '#59606e');
      // Back arm.
      R(-20, -68, 8, 24, dark);
      // Torso.
      R(-16, -70, 32, 32, body);
      R(-6, -66, 14, 10, accent);
      R(-12, -52, 6, 3, dark);
      R(-12, -47, 6, 3, dark);
      R(-13, -38, 26, 6, accent);
      // Front leg.
      R(1 + lf, -34, 11, 30 - liftF, body);
      R(0 + lf, -4 - liftF, 16, 4, accent);
      R(3 + lf, -26 - liftF * 0.5, 7, 4, dark); // knee
      // Head.
      R(-8, -84, 16, 14, body);
      R(0, -80, 8, 4, ghostColor || m.eye);
      ctx.fillStyle = ghostColor || '#f4d35e';
      ctx.beginPath();
      ctx.moveTo(-2, -82); ctx.lineTo(10, -92); ctx.lineTo(3, -82);
      ctx.fill();
      // Front arm and weapon.
      R(10, -70, 14, 12, body);
      const weapon = f.ranged ? GD.activeWeapon(f) : null;
      const metal = ghostColor || '#59606e';
      if (f.subFlash > 0 && !ghostColor) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#fff3a8';
        ctx.beginPath(); ctx.arc(12, -80, 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (st === 'guard') {
        R(18, -64, 20, 9, body);
        R(36, -64, 6, 9, dark);
      } else if (f.melee) {
        this.drawSwing2D(f.melee, body, metal, ghostColor);
      } else {
        const recoil = f.recoil ? f.recoil * 4 : 0;
        R(12 + armSwing, -58, 10, 18, body);
        R(12 + armSwing, -40, 10, 5, dark);
        if (weapon && weapon.kind === 'projectile') {
          // Rifle held at shoulder height; bigger silhouettes for heavy weapons.
          const aim = -(f.lastAim || 0) * Math.PI / 180 * 0.5;
          ctx.save();
          ctx.translate(14 - recoil, -62);
          ctx.rotate(-aim);
          if (weapon.id === 'bazooka') { R(-8, -6, 40, 10, metal); R(28, -8, 8, 14, ghostColor || '#2f333d'); }
          else if (weapon.id === 'grenade') { R(0, -4, 16, 8, metal); R(14, -5, 6, 10, ghostColor || '#3d4a3d'); }
          else { R(0, -4, 30, 6, metal); R(22, -6, 6, 10, ghostColor || weapon.color); }
          ctx.restore();
        } else if (weapon && weapon.kind === 'melee') {
          // Melee weapon at rest in the front hand.
          const hx = 17 + armSwing;
          if (weapon.style === 'axe') {
            R(hx - 2, -66, 4, 30, metal);
            R(hx - 2, -70, 14, 11, ghostColor || '#7a3328');
            R(hx + 10, -70, 3, 11, ghostColor || '#ff6a3a');
          } else if (weapon.style === 'lance') {
            R(hx - 28, -40, 70, 4, metal);
            R(hx + 40, -42, 8, 8, ghostColor || weapon.color);
          } else {
            R(hx - 2, -48, 4, 12, metal);
            R(hx - 3, -50, 6, 3, ghostColor || weapon.color);
          }
        }
      }
      ctx.restore();
    }

    // Melee swing in mech-local space (facing +x). Saber arcs, axe chops overhead, lance thrusts.
    drawSwing2D(m, body, metal, ghostColor) {
      const ctx = this.ctx;
      const w = m.w;
      const R = (x0, y0, ww, hh, c) => { ctx.fillStyle = c; ctx.fillRect(x0, y0, ww, hh); };
      const wind = m.t < w.windup;
      const p = wind ? m.t / w.windup : Math.min(1, (m.t - w.windup) / w.active);
      const glow = (x0, y0, ww, hh, outer, inner) => {
        if (ghostColor) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = outer; ctx.fillRect(x0, y0 - 4, ww, hh + 8);
        ctx.fillStyle = inner; ctx.fillRect(x0, y0, ww, hh);
        ctx.globalCompositeOperation = 'source-over';
      };
      ctx.save();
      ctx.translate(16, -62);
      if (w.style === 'lance') {
        const reach = wind ? -12 * p : -12 + (m.range * 0.55 + 12) * p;
        R(0, -4, 16, 8, body);
        R(reach - 14, -2, 40, 4, metal);
        glow(reach + 26, -3, m.range * 0.6, 6, 'rgba(90,210,255,0.35)', '#c8f3ff');
      } else if (w.style === 'axe') {
        ctx.rotate(wind ? -1.9 - 0.4 * p : -2.3 + 3.1 * p);
        R(0, -4, 14, 8, body);
        R(12, -2, 36, 4, metal);
        R(42, -11, 14, 22, ghostColor || '#7a3328');
        glow(54, -11, 4, 22, 'rgba(255,90,40,0.4)', '#ffb08a');
      } else {
        ctx.rotate(wind ? -0.9 + p * 0.9 : p * 0.6);
        R(0, -4, 14, 8, body);
        R(14, -3, 10, 6, metal);
        glow(22, -3, m.range - 6, 6, 'rgba(255,122,26,0.35)', '#ffd7a8');
      }
      ctx.restore();
    }

    drawProjectiles(world, alpha) {
      const ctx = this.ctx;
      for (const p of world.projectiles) {
        const x = p.prevX + (p.x - p.prevX) * alpha;
        const y = p.prevY + (p.y - p.prevY) * alpha;
        const w = p.weapon;
        const ang = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.globalCompositeOperation = 'lighter';
        if (w.id === 'beam') {
          const grad = ctx.createLinearGradient(-w.trail, 0, 0, 0);
          grad.addColorStop(0, 'rgba(255,90,214,0)');
          grad.addColorStop(1, w.color);
          ctx.fillStyle = grad;
          ctx.fillRect(-w.trail, -3, w.trail, 6);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-14, -1.5, 16, 3);
        } else if (w.id === 'bazooka') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#59606e';
          ctx.fillRect(-12, -5, 22, 10);
          ctx.fillStyle = w.color;
          ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(18, 0); ctx.lineTo(10, 5); ctx.fill();
          ctx.fillStyle = '#2f333d';
          ctx.fillRect(-14, -7, 4, 14);
        } else if (w.id === 'grenade') {
          ctx.globalCompositeOperation = 'source-over';
          ctx.rotate(-ang + this.time * 6);
          ctx.fillStyle = '#3d4a3d';
          ctx.fillRect(-7, -7, 14, 14);
          const blink = Math.floor((p.life + this.time) * 8) % 2 === 0;
          ctx.fillStyle = blink ? w.color : '#1d2a1d';
          ctx.fillRect(-3, -3, 6, 6);
        } else {
          // Tracer rounds: short bright streak.
          ctx.fillStyle = w.color;
          ctx.fillRect(-16, -1.2, 18, 2.4);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-4, -1.5, 6, 3);
        }
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    drawBlasts() {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.blasts) {
        const t = 1 - b.life / b.max;
        const r = b.r * (0.4 + t * 0.8);
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.fillStyle = t < 0.3 ? '#fff2b0' : 'rgba(255,138,42,0.6)';
        ctx.beginPath(); ctx.arc(b.x, b.y, r * (t < 0.3 ? 0.8 : 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    drawTexts() {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      for (const t of this.texts) {
        ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
        ctx.font = `${t.big ? 26 : 18}px ${DISPLAY}`;
        ctx.fillStyle = '#05070d';
        ctx.fillText(t.text, t.x + 2, t.y + 2);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    drawLowEnergy(f, x, y) {
      const ctx = this.ctx;
      ctx.font = `11px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5ad6';
      ctx.fillText('EN LOW', x, y - f.h - 10);
      ctx.textAlign = 'left';
    }

    drawKo(world) {
      const ctx = this.ctx;
      const winner = world.fighters[world.winner - 1];
      ctx.fillStyle = 'rgba(5,7,13,0.45)';
      ctx.fillRect(0, H / 2 - 70, W, 140);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7a1a';
      ctx.font = `64px ${DISPLAY}`;
      ctx.fillText('K.O.', W / 2, H / 2 - 4);
      ctx.fillStyle = '#e7ecf5';
      ctx.font = `16px ${MONO}`;
      ctx.fillText(`${winner.label || 'PLAYER ' + winner.player} · ${winner.mech.code} ${winner.mech.name} WINS`, W / 2, H / 2 + 26);
      ctx.textAlign = 'left';
    }

    drawGuard(f, x, y) {
      const ctx = this.ctx;
      const cx = x + f.facing * 30;
      const cy = y - 46;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(90,210,255,0.7)';
      ctx.fillStyle = 'rgba(90,210,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const a0 = f.facing > 0 ? -0.9 : Math.PI - 0.9;
      ctx.arc(cx - f.facing * 20, cy, 44, a0, a0 + 1.8);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    drawBar(x, y, w, h, ratio, color, fromRight) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = color;
      const fw = Math.max(0, Math.min(1, ratio)) * w;
      ctx.fillRect(fromRight ? x + w - fw : x, y, fw, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }

    drawHud(world) {
      const ctx = this.ctx;
      const barW = 360;
      ctx.textBaseline = 'alphabetic';
      for (const f of world.fighters) {
        const left = f.player === 1;
        const x = left ? 16 : W - 16 - barW;
        ctx.font = `13px ${MONO}`;
        ctx.fillStyle = '#e7ecf5';
        ctx.textAlign = left ? 'left' : 'right';
        const name = `${f.label || 'P' + f.player} · ${f.mech.code} ${f.mech.name}`;
        ctx.fillText(name, left ? x : x + barW, 20);
        ctx.fillStyle = '#8b95ad';
        ctx.textAlign = left ? 'right' : 'left';
        ctx.fillText(`HP ${Math.round(f.hp)}`, left ? x + barW : x, 20);

        this.drawBar(x, 26, barW, 12, f.hp / f.stats.hpMax, P_COLORS[f.player], !left);

        const blink = f.overheat && Math.floor(this.time * 6) % 2 === 0;
        const fuelColor = f.overheat ? (blink ? '#ff5d5d' : '#7a2a2a') : '#35c7e8';
        const fuelW = barW * 0.72;
        const fuelX = left ? x : x + barW - fuelW;
        this.drawBar(fuelX, 42, fuelW, 6, f.fuel / f.stats.fuelMax, fuelColor, !left);
        // Tick marks the fuel level where an overheated booster unlocks.
        const tick = fuelW * GD.TUNING.overheatRecover;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(left ? fuelX + tick : fuelX + fuelW - tick, 40, 1, 10);
        ctx.font = `10px ${MONO}`;
        ctx.fillStyle = f.overheat ? '#ff5d5d' : '#8b95ad';
        ctx.textAlign = left ? 'left' : 'right';
        ctx.fillText(f.overheat ? 'OVERHEAT' : 'BOOST FUEL', left ? fuelX + fuelW + 8 : fuelX - 8, 49);

        // Energy for beam weapons.
        const enFlash = f.lowEnergy > 0 && Math.floor(this.time * 10) % 2 === 0;
        this.drawBar(fuelX, 53, fuelW, 5, f.energy / f.stats.energyMax, enFlash ? '#ff5d5d' : '#ff5ad6', !left);
        ctx.fillStyle = enFlash ? '#ff5d5d' : '#8b95ad';
        ctx.fillText(`ENERGY ${Math.round(f.energy)}`, left ? fuelX + fuelW + 8 : fuelX - 8, 59);

        this.drawLoadoutReadout(f, left);
      }

      ctx.textAlign = 'center';
      ctx.font = `20px ${DISPLAY}`;
      ctx.fillStyle = '#e7ecf5';
      ctx.fillText(GD.VERSION, W / 2, 26);
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = '#8b95ad';
      ctx.fillText(world.stage.label, W / 2, 42);
      ctx.textAlign = 'left';
    }

    // Bottom-corner readout: ranged and melee slots (active one marked), vulcan, swap cooldown.
    drawLoadoutReadout(f, left) {
      const ctx = this.ctx;
      const keys = GD.BINDINGS[f.player];
      const k = (a) => (f.cpu ? 'AUTO' : GD.keyLabel(keys[a][0]));
      const ammoOf = (w) => {
        if (w.ammo === Infinity) return '∞';
        let t = `${f.ammo[w.id]}/${w.ammo}`;
        if (f.ammo[w.id] < w.ammo && f.sinceFire >= GD.COMBAT.reloadDelay) t += ' ↻';
        return t;
      };
      const rows = [
        { text: `${f.mode === 'ranged' ? '▶' : ' '} ${f.ranged.name} ${ammoOf(f.ranged)}`, color: f.mode === 'ranged' ? '#e7ecf5' : '#6c778f' },
        { text: `${f.mode === 'melee' ? '▶' : ' '} ${f.meleeW.name}`, color: f.mode === 'melee' ? '#e7ecf5' : '#6c778f' },
        { text: `  VULCAN ${ammoOf(GD.VULCAN)} [${k('sub')}]`, color: '#a9b3c9' },
      ];
      const ready = f.switchCd <= 0;
      const swText = ready ? `SWITCH [${k('switch')}] READY` : `SWITCH ${f.switchCd.toFixed(1)}s`;
      const swColor = f.switchDenied > 0 ? '#ff5d5d' : ready ? '#4cd48a' : '#8b95ad';
      ctx.font = `12px ${MONO}`;
      const tw = Math.max(150, ...rows.map((r) => ctx.measureText(r.text).width), ctx.measureText(swText).width) + 20;
      const x0 = left ? 12 : W - 12 - tw;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x0, H - 78, tw, 68);
      ctx.textAlign = left ? 'left' : 'right';
      const tx = left ? x0 + 8 : x0 + tw - 8;
      rows.forEach((r, i) => { ctx.fillStyle = r.color; ctx.fillText(r.text, tx, H - 62 + i * 14); });
      ctx.fillStyle = swColor;
      ctx.fillText(swText, tx, H - 20);
      // Swap cooldown bar fills up as the swap becomes available again.
      const frac = 1 - f.switchCd / GD.COMBAT.switchCooldown;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x0, H - 12, tw, 2);
      ctx.fillStyle = ready ? '#4cd48a' : '#ff7a1a';
      const bw = tw * Math.max(0, Math.min(1, frac));
      ctx.fillRect(left ? x0 : x0 + tw - bw, H - 12, bw, 2);
      ctx.textAlign = 'left';
    }

    drawDebug(world, alpha) {
      const ctx = this.ctx;
      ctx.lineWidth = 1;
      for (const p of world.stage.platforms) {
        ctx.strokeStyle = '#4cd48a';
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w, p.h);
      }
      for (const f of world.fighters) {
        const x = f.prevX + (f.x - f.prevX) * alpha;
        const y = f.prevY + (f.y - f.prevY) * alpha;
        ctx.strokeStyle = P_COLORS[f.player];
        ctx.strokeRect(x - f.w / 2 + 0.5, y - f.h + 0.5, f.w, f.h);
        ctx.strokeStyle = '#ffd447';
        ctx.beginPath();
        ctx.moveTo(x, y - f.h / 2);
        ctx.lineTo(x + f.vx * 0.15, y - f.h / 2 + f.vy * 0.15);
        ctx.stroke();
        ctx.font = `10px ${MONO}`;
        ctx.fillStyle = '#ffd447';
        ctx.textAlign = 'center';
        ctx.fillText(`${f.x.toFixed(0)},${f.y.toFixed(0)} fuel ${f.fuel.toFixed(0)}`, x, y - f.h - 14);
      }
      for (const p of world.projectiles) {
        ctx.strokeStyle = '#ff5ad6';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      }
      for (const f of world.fighters) {
        ctx.fillStyle = '#ffd447';
        ctx.textAlign = f.player === 1 ? 'left' : 'right';
        ctx.fillText(`${f.state.toUpperCase()} vx ${f.vx.toFixed(0)} vy ${f.vy.toFixed(0)} stun ${f.hitstun.toFixed(2)} dealt ${f.damageDealt}`, f.player === 1 ? 16 : W - 16, 76);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd447';
      ctx.fillText(`${this.fps.toFixed(0)} FPS · ${this.particles.length} particles · ${world.projectiles.length} shots`, W / 2, 58);
      ctx.textAlign = 'left';
    }

    drawPause() {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(5,7,13,0.6)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  GD.Renderer = Renderer;
})(globalThis.GD = globalThis.GD || {});
