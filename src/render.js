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
    }

    draw(world, alpha, opts) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.bg, 0, 0, W, H);

      for (const gh of this.ghosts) {
        ctx.globalAlpha = (gh.life / gh.max) * 0.45;
        this.drawMech(gh.f, gh.x, gh.y, gh.facing, '#7fe3ff');
      }
      ctx.globalAlpha = 1;

      for (const f of world.fighters) {
        const x = f.prevX + (f.x - f.prevX) * alpha;
        const y = f.prevY + (f.y - f.prevY) * alpha;
        this.drawMech(f, x, y, f.facing, null);
        if (f.guarding) this.drawGuard(f, x, y);
      }

      this.drawParticles();
      this.drawHud(world);
      if (opts.debug) this.drawDebug(world, alpha);
      if (opts.paused) this.drawPause(opts);
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
      if (st === 'thrust' || st === 'boost') lean = (f.thrustX * facing) * 0.18 + (st === 'boost' && this.stage.gravity > 0 ? 0 : 0);
      if (st === 'drift') lean = Math.sin(this.time * 1.5 + f.player) * 0.04;
      const squash = 1 - f.landSquash * 0.12;

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing, squash);
      ctx.translate(0, -36);
      ctx.rotate(lean);
      ctx.translate(0, 36);

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
      // Front arm.
      R(10, -70, 14, 12, body);
      if (st === 'guard') {
        R(18, -64, 20, 9, body);
        R(36, -64, 6, 9, dark);
      } else {
        R(12 + armSwing, -58, 10, 18, body);
        R(12 + armSwing, -40, 10, 5, dark);
      }
      ctx.restore();
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
        const name = `P${f.player} · ${f.mech.code} ${f.mech.name}`;
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

        // State readout along the bottom.
        ctx.font = `11px ${MONO}`;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        const label = `${f.state.toUpperCase()}   VX ${f.vx.toFixed(0).padStart(4)}   VY ${f.vy.toFixed(0).padStart(4)}`;
        const tw = ctx.measureText(label).width + 16;
        ctx.fillRect(left ? 12 : W - 12 - tw, H - 30, tw, 20);
        ctx.fillStyle = '#e7ecf5';
        ctx.fillText(label, left ? 20 : W - 20, H - 16);
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
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd447';
      ctx.fillText(`${this.fps.toFixed(0)} FPS · ${this.particles.length} particles`, W / 2, 58);
      ctx.textAlign = 'left';
    }

    drawPause(opts) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(5,7,13,0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff7a1a';
      ctx.font = `44px ${DISPLAY}`;
      ctx.fillText(opts.focusLost ? 'CLICK TO FOCUS' : 'PAUSED', W / 2, H / 2 - 40);
      ctx.font = `15px ${MONO}`;
      ctx.fillStyle = '#e7ecf5';
      const lines = opts.focusLost
        ? ['點一下遊戲畫面，讓鍵盤輸入回到遊戲']
        : ['Esc 繼續   ·   Enter 重置位置', '1 地球   ·   2 太空   ·   ` 除錯資訊'];
      lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + 4 + i * 26));
      ctx.textAlign = 'left';
    }
  }

  GD.Renderer = Renderer;
})(globalThis.GD = globalThis.GD || {});
