/* Gravity Duel - weapons, projectiles, melee, damage and knockback.
 * Pure simulation: no DOM here so it runs in the Node tests. */
(function (GD) {
  'use strict';

  const C = GD.COMBAT;
  const A = GD.ARENA;

  function weaponById(id) {
    return GD.WEAPONS.find((w) => w.id === id) || GD.WEAPONS[0];
  }
  GD.weaponById = weaponById;

  GD.initCombat = function (f, weaponId) {
    f.weapon = weaponById(weaponId);
    f.secondary = GD.VULCAN;
    f.usingSecondary = false;
    f.ammo = { [f.weapon.id]: f.weapon.ammo, vulcan: GD.VULCAN.ammo };
    f.reloadT = 0;
    f.sinceFire = 99;
    f.cooldown = 0;
    f.switchLag = 0;
    f.energy = f.stats.energyMax;
    f.lowEnergy = 0;
    f.melee = null;          // { t, hit, range }
    f.invuln = 0;
    f.hitFlash = 0;
    f.recoil = 0;
    f.lastAim = 0;
    f.damageDealt = 0;
  };

  GD.activeWeapon = function (f) {
    return f.usingSecondary ? f.secondary : f.weapon;
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
    const speed = w.speed;
    const p = {
      owner: f.player, weapon: w,
      x: f.x + f.facing * C.muzzleX, y: f.y - C.muzzleY,
      vx: Math.cos(a) * speed * f.facing, vy: Math.sin(a) * speed,
      g: w.g, r: w.radius, life: 0, dead: false,
      prevX: 0, prevY: 0,
    };
    p.prevX = p.x; p.prevY = p.y;
    world.projectiles.push(p);
    emit(world, 'fire', { player: f.player, weapon: w.id, x: p.x, y: p.y, dx: Math.cos(a) * f.facing, dy: Math.sin(a) });
    return p;
  }

  function tryFire(world, f, inp, dt) {
    const w = GD.activeWeapon(f);
    const canAct = f.cooldown <= 0 && f.switchLag <= 0 && f.hitstun <= 0 && !f.melee && !f.ko && !f.guarding && f.landLag <= 0;
    if (!canAct) return;
    const wants = w.auto ? inp.attack : !!inp.pressed.attack;
    if (!wants) return;

    if (w.kind === 'melee') {
      const dashing = f.dashT > 0;
      f.melee = { t: 0, hit: false, range: w.range + (dashing ? w.dashRange : 0), w };
      f.actionLock = w.windup + w.active;
      f.cooldown = w.windup + w.active + w.recovery;
      emit(world, 'melee', { player: f.player, x: f.x, y: f.y });
      return;
    }

    if (f.ammo[w.id] <= 0) return;
    if (w.energy > 0 && f.energy < w.energy) {
      if (inp.pressed.attack) f.lowEnergy = C.lowEnergyFlash;
      return;
    }
    const angle = GD.aimAngle(world, f, w, inp);
    f.lastAim = angle;
    spawnProjectile(world, f, w, angle);
    if (w.ammo !== Infinity) f.ammo[w.id] -= 1;
    f.energy -= w.energy;
    f.cooldown = w.cooldown;
    f.sinceFire = 0;
    f.recoil = 1;
  }

  function updateResources(f, dt) {
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.switchLag = Math.max(0, f.switchLag - dt);
    f.invuln = Math.max(0, f.invuln - dt);
    f.hitFlash = Math.max(0, f.hitFlash - dt);
    f.lowEnergy = Math.max(0, f.lowEnergy - dt);
    f.recoil = Math.max(0, f.recoil - dt * 6);
    f.sinceFire += dt;
    f.energy = Math.min(f.stats.energyMax, f.energy + f.stats.energyRegen * dt);

    // Both magazines refill slowly once the trigger has been released for a while.
    if (f.sinceFire >= C.reloadDelay) {
      f.reloadT += dt;
      for (const w of [f.weapon, f.secondary]) {
        if (w.kind !== 'projectile' || w.ammo === Infinity || f.ammo[w.id] >= w.ammo) continue;
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

  // Apply damage with armor, guard, knockback and stun. dir = unit vector of the hit travel.
  GD.applyHit = function (world, target, source, spec) {
    if (target.ko || target.invuln > 0) return false;
    const fromFront = Math.sign(spec.dx || (spec.x - target.x)) === -target.facing;
    const blocked = target.guarding && fromFront;
    let dmg = spec.dmg * target.stats.damageTaken;
    let knock = spec.knock;
    let stun = spec.stun;
    if (blocked) { dmg *= C.guardDamage; knock *= C.guardKnock; stun *= C.guardStun; }
    dmg = Math.max(1, Math.round(dmg));

    target.hp = Math.max(0, target.hp - dmg);
    target.hitFlash = 0.12;
    if (source && source !== target) source.damageDealt += dmg;

    const earth = world.stage.gravity > 0;
    const len = Math.hypot(spec.dx, spec.dy) || 1;
    const nx = spec.dx / len, ny = spec.dy / len;
    if (!blocked || knock > 0) {
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

  function explode(world, p) {
    const w = p.weapon;
    p.dead = true;
    emit(world, 'explode', { x: p.x, y: p.y, r: w.blast, weapon: w.id });
    const owner = world.fighters[p.owner - 1];
    for (const f of world.fighters) {
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

      // Fighters. Direct hit by a blast weapon also detonates it.
      for (const f of world.fighters) {
        if (f.player === p.owner || f.ko) continue;
        if (!pointInBox(p.x, p.y, hitbox(f), p.r)) continue;
        if (w.blast) { explode(world, p); break; }
        const owner = world.fighters[p.owner - 1];
        GD.applyHit(world, f, owner, { dmg: w.dmg, knock: w.knock, stun: w.stun, x: p.x, y: p.y, dx: p.vx, dy: p.vy });
        p.dead = true;
        break;
      }
      if (p.dead) continue;

      if (earth) {
        if (p.y >= A.groundY) {
          p.y = A.groundY;
          if (w.blast) explode(world, p); else { p.dead = true; emit(world, 'ricochet', { x: p.x, y: p.y, color: w.color }); }
          continue;
        }
        if (!w.passPlatforms) {
          const plat = world.stage.platforms.find((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h + 4);
          if (plat) {
            if (w.blast) explode(world, p); else { p.dead = true; emit(world, 'ricochet', { x: p.x, y: p.y, color: w.color }); }
            continue;
          }
        }
      }
      if (w.fuse && !earth && p.life >= w.fuse) { explode(world, p); continue; }
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
          explode(world, t);
          break;
        }
      }
    }
    world.projectiles = world.projectiles.filter((p) => !p.dead);
  }

  function stepMelee(world, f, dt) {
    const m = f.melee;
    if (!m) return;
    const w = m.w;
    const wasWindup = m.t < w.windup;
    m.t += dt;
    if (wasWindup && m.t >= w.windup) f.invuln = Math.max(f.invuln, w.iframes);
    const active = m.t >= w.windup && m.t < w.windup + w.active;
    if (active && !m.hit) {
      const o = world.fighters[f.player === 1 ? 1 : 0];
      const b = hitbox(o);
      const x0 = Math.min(f.x + f.facing * 8, f.x + f.facing * (8 + m.range));
      const x1 = Math.max(f.x + f.facing * 8, f.x + f.facing * (8 + m.range));
      const y0 = f.y - f.h - 10, y1 = f.y + 4;
      const overlap = x1 > b.x0 && x0 < b.x1 && y1 > b.y0 && y0 < b.y1;
      if (overlap) {
        m.hit = true;
        GD.applyHit(world, o, f, { dmg: w.dmg, knock: w.knock, stun: w.stun, x: o.x - o.facing * 10, y: o.y - o.h * 0.6, dx: f.facing, dy: -0.15 });
      }
    }
    if (m.t >= w.windup + w.active) f.melee = null;
  }

  GD.stepCombat = function (world, inputs, dt) {
    for (const f of world.fighters) {
      const inp = (f.hitstun > 0 || f.ko) ? GD.IDLE_INPUT : inputs[f.player - 1];
      updateResources(f, dt);
      if (inp.pressed.switch && !f.melee && f.hitstun <= 0 && !f.ko) {
        f.usingSecondary = !f.usingSecondary;
        f.switchLag = C.switchLag;
        emit(world, 'switch', { player: f.player, weapon: GD.activeWeapon(f).id });
      }
      tryFire(world, f, inp, dt);
      stepMelee(world, f, dt);
    }
    stepProjectiles(world, dt);
  };

  GD.combatInternals = { hitbox, explode, spawnProjectile };
})(globalThis.GD = globalThis.GD || {});
