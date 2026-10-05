/* Gravity Duel - weapons, projectiles, melee, damage and knockback.
 * Pure simulation: no DOM here so it runs in the Node tests.
 *
 * Every fighter carries one ranged and one melee weapon (switch key swaps them, with a
 * cooldown) plus the head vulcan on its own key. */
(function (GD) {
  'use strict';

  const C = GD.COMBAT;
  const A = GD.ARENA;

  function weaponById(id) {
    if (id === 'vulcan') return GD.VULCAN;
    return GD.WEAPONS.find((w) => w.id === id) || null;
  }
  GD.weaponById = weaponById;

  function normalizeLoadout(lo) {
    // Accept a bare weapon id for convenience: it fills its own slot, the other gets a default.
    if (typeof lo === 'string') {
      const w = weaponById(lo);
      return w && w.kind === 'melee' ? { ranged: 'beam', melee: lo } : { ranged: lo || 'beam', melee: 'saber' };
    }
    return { ranged: (lo && lo.ranged) || 'beam', melee: (lo && lo.melee) || 'saber' };
  }

  GD.initCombat = function (f, loadout) {
    const lo = normalizeLoadout(loadout);
    f.ranged = weaponById(lo.ranged) || GD.RANGED[0];
    f.meleeW = weaponById(lo.melee) || GD.MELEE[0];
    f.mode = 'ranged';
    f.ammo = { [f.ranged.id]: f.ranged.ammo, vulcan: GD.VULCAN.ammo };
    f.reloadT = 0;
    f.sinceFire = 99;
    f.cooldown = 0;          // main weapon
    f.subCooldown = 0;       // vulcan has its own rate of fire
    f.subFlash = 0;
    f.switchLag = 0;         // draw time after a swap
    f.switchCd = 0;          // time until the next swap is allowed
    f.switchDenied = 0;      // HUD flash when a swap is attempted too early
    f.energy = f.stats.energyMax;
    f.lowEnergy = 0;
    f.melee = null;          // active swing: { t, hit, range, w }
    f.invuln = 0;
    f.hitFlash = 0;
    f.recoil = 0;
    f.lastAim = 0;
    f.damageDealt = 0;
  };

  GD.activeWeapon = function (f) {
    return f.mode === 'melee' ? f.meleeW : f.ranged;
  };

  function emit(world, type, data) {
    world.events.push(Object.assign({ type }, data));
  }

  // Aim angle in degrees (negative = up). Grenades lob by default on Earth.
  GD.aimAngle = function (world, f, w, inp) {
    const earth = world.stage.gravity > 0;
    let base = earth && w.lob ? w.lob : 0;
    const spread = w.aimSpread || 30;
    if (inp.up) base -= spread;
    else if (inp.down) base += spread;
    if (earth && f.onGround && base > 0) base = 0;   // no point firing into the floor
    return Math.max(-75, Math.min(60, base));
  };

  function spawnProjectile(world, f, w, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    const jitter = w.spread ? (Math.random() - 0.5) * 2 * w.spread * Math.PI / 180 : 0;
    const a = rad + jitter;
    const muzzle = w.muzzle || [C.muzzleX, C.muzzleY];
    const p = {
      owner: f.player, weapon: w,
      x: f.x + f.facing * muzzle[0], y: f.y - muzzle[1],
      vx: Math.cos(a) * w.speed * f.facing, vy: Math.sin(a) * w.speed,
      g: w.g, r: w.radius, life: 0, dead: false,
      prevX: 0, prevY: 0,
    };
    p.prevX = p.x; p.prevY = p.y;
    world.projectiles.push(p);
    emit(world, 'fire', { player: f.player, weapon: w.id, x: p.x, y: p.y, dx: Math.cos(a) * f.facing, dy: Math.sin(a) });
    return p;
  }

  function busy(f) {
    return f.hitstun > 0 || !!f.melee || f.ko || f.guarding || f.landLag > 0;
  }

  function tryAttack(world, f, inp) {
    const w = GD.activeWeapon(f);
    if (f.cooldown > 0 || f.switchLag > 0 || busy(f)) return;
    const wants = w.auto ? inp.attack : f.atkBuf > 0;
    if (!wants) return;

    if (w.kind === 'melee') {
      const dashing = f.dashT > 0;
      f.atkBuf = 0;
      f.melee = { t: 0, hit: false, range: w.range + (dashing ? w.dashRange : 0), w };
      f.actionLock = w.windup + w.active;
      f.cooldown = w.windup + w.active + w.recovery;
      emit(world, 'melee', { player: f.player, weapon: w.id, x: f.x, y: f.y });
      return;
    }

    if (f.ammo[w.id] <= 0) return;
    if (w.energy > 0 && f.energy < w.energy) {
      if (inp.pressed.attack) f.lowEnergy = C.lowEnergyFlash;
      return;
    }
    const angle = GD.aimAngle(world, f, w, inp);
    f.lastAim = angle;
    f.atkBuf = 0;
    spawnProjectile(world, f, w, angle);
    if (w.ammo !== Infinity) f.ammo[w.id] -= 1;
    f.energy -= w.energy;
    f.cooldown = w.cooldown;
    f.sinceFire = 0;
    f.recoil = 1;
  }

  // Head vulcan: independent of the main weapon mode and its cooldown.
  function trySub(world, f, inp) {
    const w = GD.VULCAN;
    if (!inp.sub || f.subCooldown > 0 || busy(f) || f.ammo.vulcan <= 0) return;
    spawnProjectile(world, f, w, GD.aimAngle(world, f, w, inp));
    f.ammo.vulcan -= 1;
    f.subCooldown = w.cooldown;
    f.sinceFire = 0;
    f.subFlash = 0.06;
  }

  function trySwitch(world, f, inp) {
    // A press is denied (HUD flash) only when it is clearly early; one made in the last
    // moments of the cooldown waits in the buffer and goes through when the cooldown ends.
    if (inp.pressed.switch && f.switchCd > GD.TUNING.inputBuffer) f.switchDenied = 0.35;
    if (f.swBuf <= 0 || f.switchCd > 0 || f.melee || f.hitstun > 0 || f.ko) return;
    f.swBuf = 0;
    f.mode = f.mode === 'melee' ? 'ranged' : 'melee';
    f.switchLag = C.switchLag;
    f.switchCd = C.switchCooldown;
    emit(world, 'switch', { player: f.player, weapon: GD.activeWeapon(f).id, x: f.x, y: f.y });
  }

  function updateResources(f, dt) {
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.subCooldown = Math.max(0, f.subCooldown - dt);
    f.subFlash = Math.max(0, f.subFlash - dt);
    f.switchLag = Math.max(0, f.switchLag - dt);
    f.switchCd = Math.max(0, f.switchCd - dt);
    f.switchDenied = Math.max(0, f.switchDenied - dt);
    f.invuln = Math.max(0, f.invuln - dt);
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.lowEnergy = Math.max(0, f.lowEnergy - dt);
    f.recoil = Math.max(0, f.recoil - dt * 6);
    f.sinceFire += dt;
    f.energy = Math.min(f.stats.energyMax, f.energy + f.stats.energyRegen * dt);

    // Magazines refill slowly once both triggers have been released for a while.
    if (f.sinceFire >= C.reloadDelay) {
      f.reloadT += dt;
      for (const w of [f.ranged, GD.VULCAN]) {
        if (w.ammo === Infinity || f.ammo[w.id] >= w.ammo) continue;
        while (f.reloadT >= w.reload && f.ammo[w.id] < w.ammo) {
          f.ammo[w.id] += 1;
          f.reloadT -= w.reload;
        }
      }
      if (f.reloadT > 10) f.reloadT = 0;
    } else {
      f.reloadT = 0;
    }
  }

  function hitbox(f) {
    return { x0: f.x - f.w / 2, x1: f.x + f.w / 2, y0: f.y - f.h, y1: f.y };
  }

  function pointInBox(x, y, b, pad) {
    return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
  }

  // Apply damage with armor, guard, knockback and stun.
  // spec: { dmg, knock, stun, x, y, dx, dy, guardMul? } where (dx, dy) is the travel direction of the hit.
  GD.applyHit = function (world, target, source, spec) {
    if (target.ko || target.invuln > 0) return false;
    const fromFront = Math.sign(spec.dx || (spec.x - target.x)) === -target.facing;
    const blocked = target.guarding && fromFront;
    let dmg = spec.dmg * target.stats.damageTaken;
    let knock = spec.knock;
    let stun = spec.stun;
    if (blocked) {
      dmg *= spec.guardMul != null ? spec.guardMul : C.guardDamage;
      knock *= C.guardKnock;
      stun *= C.guardStun;
    }
    dmg = Math.max(1, Math.round(dmg));

    target.hp = Math.max(0, target.hp - dmg);
    target.hitFlash = 0.12;
    if (source && source !== target) source.damageDealt += dmg;

    const earth = world.stage.gravity > 0;
    const len = Math.hypot(spec.dx, spec.dy) || 1;
    const nx = spec.dx / len, ny = spec.dy / len;
    if (earth) {
      target.vx = nx * knock;
      if (!blocked) {
        target.vy = Math.min(target.vy, -knock * C.knockUpEarth);
        target.onGround = false;
      }
    } else {
      target.vx += nx * knock * C.spaceKnockMul;
      target.vy += ny * knock * C.spaceKnockMul;
    }
    if (!blocked) {
      target.hitstun = Math.max(target.hitstun, stun);
      target.guarding = false;
      target.melee = null;
      target.boosting = false;
      target.dashT = 0;
    }
    emit(world, 'hit', { player: target.player, by: source ? source.player : 0, x: spec.x, y: spec.y, dmg, blocked, dx: nx, dy: ny });

    if (target.hp <= 0) {
      target.ko = true;
      target.hitstun = C.koFallStun;
      if (!world.winner) {
        world.winner = target.player === 1 ? 2 : 1;
        emit(world, 'ko', { player: target.player, x: target.x, y: target.y });
      }
    }
    return true;
  };

  // direct: the fighter the shell struck, who takes the full direct damage.
  // Everyone else inside the radius takes blast damage with distance falloff.
  function explode(world, p, direct) {
    const w = p.weapon;
    p.dead = true;
    emit(world, 'explode', { x: p.x, y: p.y, r: w.blast, weapon: w.id });
    const owner = world.fighters[p.owner - 1];
    for (const f of world.fighters) {
      if (f === direct) {
        GD.applyHit(world, f, owner, { dmg: w.dmg, knock: w.knock, stun: w.stun, x: p.x, y: p.y, dx: p.vx || f.x - p.x, dy: p.vy });
        continue;
      }
      if (f.player === p.owner && !w.selfDamage) continue;
      const b = hitbox(f);
      const cx = Math.max(b.x0, Math.min(p.x, b.x1));
      const cy = Math.max(b.y0, Math.min(p.y, b.y1));
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d > w.blast) continue;
      const falloff = 1 - 0.5 * (d / w.blast);
      let dx = f.x - p.x, dy = (f.y - f.h / 2) - p.y;
      if (!dx && !dy) { dx = p.vx || f.facing; dy = -0.2; }
      GD.applyHit(world, f, owner, { dmg: w.blastDmg * falloff, knock: w.knock * falloff, stun: w.stun, x: cx, y: cy, dx, dy });
    }
  }

  function stepProjectiles(world, dt) {
    const earth = world.stage.gravity > 0;
    const g = world.stage.gravity * C.gravityScale;
    for (const p of world.projectiles) {
      if (p.dead) continue;
      p.prevX = p.x; p.prevY = p.y;
      p.vy += g * p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      const w = p.weapon;

      for (const f of world.fighters) {
        if (f.player === p.owner || f.ko) continue;
        if (!pointInBox(p.x, p.y, hitbox(f), p.r)) continue;
        if (w.blast) { explode(world, p, f); break; }
        const owner = world.fighters[p.owner - 1];
        GD.applyHit(world, f, owner, { dmg: w.dmg, knock: w.knock, stun: w.stun, x: p.x, y: p.y, dx: p.vx, dy: p.vy });
        p.dead = true;
        break;
      }
      if (p.dead) continue;

      if (earth) {
        if (p.y >= A.groundY) {
          p.y = A.groundY;
          if (w.blast) explode(world, p, null); else { p.dead = true; emit(world, 'ricochet', { x: p.x, y: p.y, color: w.color }); }
          continue;
        }
        if (!w.passPlatforms) {
          const plat = world.stage.platforms.find((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h + 4);
          if (plat) {
            if (w.blast) explode(world, p, null); else { p.dead = true; emit(world, 'ricochet', { x: p.x, y: p.y, color: w.color }); }
            continue;
          }
        }
      }
      // Grenades burst on the arena boundary: side walls, the top edge and, in space, the bottom.
      if (w.wallBurst) {
        const top = A.ceilingY, bottom = earth ? A.groundY : A.h;
        if (p.x <= 0 || p.x >= A.w || p.y <= top || p.y >= bottom) {
          p.x = Math.max(0, Math.min(A.w, p.x));
          p.y = Math.max(top, Math.min(bottom, p.y));
          explode(world, p, null);
          continue;
        }
      }
      if (w.fuse && !earth && p.life >= w.fuse) { explode(world, p, null); continue; }
      const off = p.x < -40 || p.x > A.w + 40 || p.y < -80 || p.y > A.h + 40;
      if (off || p.life > w.lifetime) p.dead = true;
    }

    // Small rounds can shoot down rockets and grenades.
    const shooters = world.projectiles.filter((p) => !p.dead && !p.weapon.blast);
    const targets = world.projectiles.filter((p) => !p.dead && p.weapon.shootable);
    for (const t of targets) {
      for (const s of shooters) {
        if (s.dead || s.owner === t.owner) continue;
        if (Math.hypot(s.x - t.x, s.y - t.y) <= s.r + t.r + C.projectileVsProjectile) {
          s.dead = true;
          explode(world, t, null);
          break;
        }
      }
    }
    world.projectiles = world.projectiles.filter((p) => !p.dead);
  }

  // Melee reach box in front of the attacker. Lances thrust in a narrow band, axes chop tall.
  GD.meleeBox = function (f, m) {
    const near = f.x + f.facing * 8, far = f.x + f.facing * (8 + m.range);
    const style = m.w.style;
    const y0 = style === 'lance' ? f.y - 74 : style === 'axe' ? f.y - f.h - 26 : f.y - f.h - 10;
    const y1 = style === 'lance' ? f.y - 26 : f.y + 4;
    return { x0: Math.min(near, far), x1: Math.max(near, far), y0, y1 };
  };

  function stepMelee(world, f, dt) {
    const m = f.melee;
    if (!m) return;
    const w = m.w;
    const wasWindup = m.t < w.windup;
    m.t += dt;
    if (wasWindup && m.t >= w.windup && w.iframes) f.invuln = Math.max(f.invuln, w.iframes);
    const active = m.t >= w.windup && m.t < w.windup + w.active;
    if (active && !m.hit) {
      const o = world.fighters[f.player === 1 ? 1 : 0];
      const b = hitbox(o);
      const r = GD.meleeBox(f, m);
      if (r.x1 > b.x0 && r.x0 < b.x1 && r.y1 > b.y0 && r.y0 < b.y1) {
        m.hit = true;
        GD.applyHit(world, o, f, { dmg: w.dmg, knock: w.knock, stun: w.stun, guardMul: w.guardMul,
          x: o.x - o.facing * 10, y: o.y - o.h * 0.6, dx: f.facing, dy: -0.15 });
      }
    }
    if (m.t >= w.windup + w.active) f.melee = null;
  }

  GD.stepCombat = function (world, inputs, dt) {
    for (const f of world.fighters) {
      const inp = (f.hitstun > 0 || f.ko) ? GD.IDLE_INPUT : inputs[f.player - 1];
      updateResources(f, dt);
      trySwitch(world, f, inp);
      tryAttack(world, f, inp);
      trySub(world, f, inp);
      stepMelee(world, f, dt);
    }
    stepProjectiles(world, dt);
  };

  GD.combatInternals = { hitbox, explode, spawnProjectile, normalizeLoadout };
})(globalThis.GD = globalThis.GD || {});
