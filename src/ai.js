/* Gravity Duel - computer opponent: loadout choice and per-step controls.
 * Pure simulation like physics/combat: no DOM, runs in the Node tests.
 * The AI drives a fighter through the same input object a keyboard produces. */
(function (GD) {
  'use strict';

  const A = GD.ARENA;
  const C = GD.COMBAT;
  const T = GD.TUNING;
  const KEYS = ['up', 'down', 'left', 'right', 'attack', 'sub', 'guard', 'switch', 'dash'];

  // think: seconds between decisions. aim: chance to pick the best firing angle.
  // guard / intercept / dodge: chance to react to a threat. smart: chance to swap weapons at the right range.
  GD.AI_LEVELS = {
    easy:   { id: 'easy',   label: '簡單', think: 0.55, aim: 0.35, guard: 0.1,  intercept: 0,    dodge: 0.05, smart: 0.25, dash: 0.1, trigger: 0.45,
      desc: '反應慢、常打歪、幾乎不防禦，機體與武器隨機挑選。' },
    normal: { id: 'normal', label: '普通', think: 0.22, aim: 0.8,  guard: 0.45, intercept: 0.45, dodge: 0.3,  smart: 0.75, dash: 0.35, trigger: 0.85,
      desc: '依場景挑有利的武器，會看距離切換遠程與近戰，偶爾防禦。' },
    hard:   { id: 'hard',   label: '困難', think: 0.12, aim: 0.95, guard: 0.75, intercept: 0.85, dodge: 0.5,  smart: 1,    dash: 0.6, trigger: 1,
      desc: '針對你的機體與武器配裝，會預判彈道、攔截火箭並在近身時防禦。' },
  };
  GD.AI_ORDER = ['easy', 'normal', 'hard'];

  // Park-Miller generator. Neighbouring seeds are scrambled first and the first outputs
  // discarded, otherwise seeds 1, 2, 3 would all start with almost the same number.
  function seeded(seed) {
    let s = (Math.imul(Math.abs(Math.floor(seed)) | 0, 2654435761) >>> 0) % 2147483646 + 1;
    const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
    next(); next(); next();
    return next;
  }
  function hash(str) {
    let h = 7;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 2147483647;
    return h;
  }

  // ---------------------------------------------------------------- loadout choice
  const AFF = { good: 2, even: 1, bad: -1 };

  // Returns { mech, ranged, melee, reasons[] }. Deterministic for the same inputs and seed,
  // so the stage screen preview always matches the frame that fights.
  GD.cpuChoose = function (level, stageId, foe, seed) {
    const L = GD.AI_LEVELS[level] ? level : 'normal';
    const rnd = seeded((seed || 1) + hash(`${L}|${stageId}|${foe.mech}|${foe.ranged}|${foe.melee}`));
    const pick = (list) => list[Math.floor(rnd() * list.length) % list.length];
    if (L === 'easy') {
      return { mech: pick(GD.MECHS).id, ranged: pick(GD.RANGED).id, melee: pick(GD.MELEE).id, reasons: ['隨機挑選機體與武器'] };
    }
    const foeMech = GD.MECHS.find((m) => m.id === foe.mech) || GD.MECHS[0];
    const foeRanged = GD.weaponById(foe.ranged) || GD.RANGED[0];
    const hard = L === 'hard';
    const noise = hard ? 0.3 : 1.2;
    const reasons = [];
    const best = (list, score) => {
      let top = null, topS = -Infinity;
      for (const w of list) {
        const s = score(w) + rnd() * noise;
        if (s > topS) { topS = s; top = w; }
      }
      return top;
    };

    const ranged = best(GD.RANGED, (w) => {
      let s = AFF[w[stageId]];
      if (hard && w.blast && foeMech.arm <= 2) s += 1.2;          // thin armor: splash punishes it
      if (hard && w.id === 'beam' && foeMech.arm >= 5) s -= 0.6;  // heavy armor shrugs off small hits
      if (hard && w.id === 'mg' && foeRanged.shootable) s += 0.4; // shoots their rockets down too
      return s;
    });
    const melee = best(GD.MELEE, (w) => {
      let s = AFF[w[stageId]];
      if (hard && w.id === 'axe' && foeMech.arm >= 4) s += 0.8;   // guard break against sturdy frames
      if (hard && w.id === 'lance' && foeMech.spd >= 5) s += 0.6; // reach against fast frames
      return s;
    });
    const mech = best(GD.MECHS, (m) => {
      let s = 0;
      if (stageId === 'space') s += (m.bst - 4) * 0.8 + (m.spd - 4) * 0.4;
      else s += (m.arm - 4) * 0.6 + (m.hp - 4) * 0.4;
      if (ranged.id === 'beam') s += (m.en - 4) * 0.5;
      if (hard && foeRanged.blast) s += (m.arm - 3) * 0.5;       // expect splash, bring armor
      return s;
    });

    reasons.push(`${stageId === 'space' ? '太空' : '地球'}${AFF[ranged[stageId]] > 1 ? '有利' : '穩定'}：${ranged.zh}，${ranged[stageId + 'Note']}`);
    if (hard) {
      if (ranged.blast && foeMech.arm <= 2) reasons.push(`你的 ${foeMech.name} 裝甲薄，用爆風武器針對`);
      else if (melee.id === 'axe' && foeMech.arm >= 4) reasons.push(`你的 ${foeMech.name} 耐打，用戰斧破防`);
      else if (foeRanged.blast && mech.arm >= 4) reasons.push(`你帶了${foeRanged.zh}，選裝甲較厚的機體`);
    }
    return { mech: mech.id, ranged: ranged.id, melee: melee.id, reasons };
  };

  // ---------------------------------------------------------------- controls
  GD.createAI = function (level, seed) {
    return {
      level: GD.AI_LEVELS[level] ? level : 'normal',
      P: GD.AI_LEVELS[level] || GD.AI_LEVELS.normal,
      rnd: seeded(seed || 12345),
      think: 0,
      plan: null,
      prev: {},
    };
  };

  function idealRange(w, earth) {
    switch (w.id) {
      case 'beam': return 360;
      case 'mg': return 230;
      case 'bazooka': return earth ? 300 : 420;
      case 'grenade': return earth ? 330 : 280;
      default: return 0;
    }
  }

  // Closest approach of a shot fired at angleDeg to where the target is heading.
  function shotMiss(world, me, foe, w, angleDeg) {
    const g = world.stage.gravity * C.gravityScale * w.g;
    const muzzle = w.muzzle || [C.muzzleX, C.muzzleY];
    let x = me.x + me.facing * muzzle[0], y = me.y - muzzle[1];
    const a = angleDeg * Math.PI / 180;
    let vx = Math.cos(a) * w.speed * me.facing, vy = Math.sin(a) * w.speed;
    const lead = world.stage.gravity > 0 ? 0.5 : 0.8;
    let best = Infinity;
    const dt = 1 / 30;
    for (let t = dt; t < 2.2; t += dt) {
      vy += g * dt; x += vx * dt; y += vy * dt;
      const tx = foe.x + foe.vx * t * lead;
      const ty = foe.y - foe.h / 2 + foe.vy * t * lead * (world.stage.gravity > 0 ? 0.3 : 1);
      const d = Math.hypot(x - tx, (y - ty) * 0.8);
      if (world.stage.gravity > 0 && y >= A.groundY) {
        best = Math.min(best, d - (w.blast || 0) * 0.7);
        break;
      }
      best = Math.min(best, d - (w.blast || 0) * 0.4);
      if (x < -40 || x > A.w + 40 || y < -80) break;
    }
    return best;
  }

  // The enemy shot that will reach us soonest, if any.
  function incoming(world, me) {
    let worst = null;
    for (const p of world.projectiles) {
      if (p.owner === me.player) continue;
      const rx = me.x - p.x;
      if (p.vx * rx <= 0) continue;                       // flying away
      const eta = Math.abs(rx) / Math.max(1, Math.abs(p.vx));
      if (eta > 0.5) continue;
      const yAt = p.y + p.vy * eta + 0.5 * world.stage.gravity * C.gravityScale * p.g * eta * eta;
      const pad = 30 + (p.weapon.blast || 0) * 0.5;
      if (yAt < me.y - me.h - pad || yAt > me.y + pad) continue;
      if (!worst || eta < worst.eta) worst = { p, eta };
    }
    return worst;
  }

  function decide(ai, world, me, foe) {
    const P = ai.P, r = ai.rnd;
    const earth = world.stage.gravity > 0;
    const plan = { mx: 0, my: 0, jet: false, drop: false, aim: 0, fire: false, sub: false, guard: false, sw: false, dash: false };
    if (foe.ko || me.ko) return plan;
    const dx = foe.x - me.x, adx = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
    const dy = foe.y - me.y;
    const w = GD.activeWeapon(me);
    const melee = w.kind === 'melee';

    // --- threats first: guard, intercept with the vulcan, or hop over low shots
    const threat = incoming(world, me);
    if (threat) {
      const shootable = threat.p.weapon.shootable;
      if (shootable && me.ammo.vulcan > 0 && threat.eta > 0.12 && r() < P.intercept) {
        plan.sub = true;
        plan.aim = threat.p.y < me.y - 75 ? -1 : threat.p.y > me.y - 20 ? 1 : 0;
      } else if (earth && me.onGround && r() < P.dodge) {
        plan.jet = true;
      } else if (r() < P.guard) {
        plan.guard = true;
      }
    }
    const foeSwing = foe.melee && foe.melee.t < foe.melee.w.windup + 0.05 && adx < foe.melee.range + 50;
    if (foeSwing && !plan.sub && r() < P.guard) plan.guard = true;

    // --- weapon mode by range
    const meleeReach = me.meleeW.range + 90;
    const rangedUsable = me.ranged.ammo === Infinity ? me.energy >= me.ranged.energy : me.ammo[me.ranged.id] > 0;
    const wantMelee = adx < meleeReach || !rangedUsable;
    if (wantMelee !== melee && me.switchCd <= 0 && me.switchLag <= 0 && r() < P.smart) plan.sw = true;

    // --- movement toward the preferred distance
    const ideal = melee ? Math.max(30, w.range * 0.6) : idealRange(w, earth);
    const nearWall = (d) => (d < 0 ? me.x < 90 : me.x > A.w - 90);
    let mx = 0;
    if (adx > ideal + 50) mx = dir;
    else if (adx < ideal - 70 && !melee) mx = nearWall(-dir) ? 0 : -dir;
    if (earth) {
      plan.mx = mx;
      const fuelOk = !me.overheat && me.fuel > me.stats.fuelMax * 0.35;
      if (dy < -70 && fuelOk && (melee || r() < 0.5)) plan.jet = true;       // opponent is above us
      if (!melee && mx === 0 && nearWall(-dir) && adx < ideal - 70 && fuelOk && r() < 0.4) plan.jet = true; // cornered: hop
      const onPlatform = me.onGround && me.groundRef && me.groundRef !== 'ground';
      if (dy > 70 && onPlatform && (melee || adx < 120)) plan.drop = true;      // opponent is below: drop through
    } else {
      // Zero G: steer a desired velocity toward a hold point beside the opponent.
      const tx = Math.max(70, Math.min(A.w - 70, foe.x - dir * ideal));
      const ty = Math.max(A.ceilingY + me.h + 10, Math.min(A.h - 10, foe.y + (melee ? 0 : (r() - 0.5) * 30)));
      const max = me.stats.maxSpaceSpeed * 0.75;
      const vx = Math.max(-max, Math.min(max, (tx - me.x) * 2.2));
      const vy = Math.max(-max, Math.min(max, (ty - me.y) * 2.2));
      plan.mx = vx - me.vx > 40 ? 1 : vx - me.vx < -40 ? -1 : 0;
      plan.my = vy - me.vy > 40 ? 1 : vy - me.vy < -40 ? -1 : 0;
      if (!plan.guard && !plan.sub && Math.hypot(me.vx, me.vy) > me.stats.maxSpaceSpeed * 0.95 && Math.hypot(tx - me.x, ty - me.y) < 120) plan.guard = true;
    }

    // --- attack
    if (!plan.guard && !plan.sub && !plan.sw && me.switchLag <= 0) {
      if (melee) {
        const reach = w.range + 22 + (me.dashT > 0 ? w.dashRange : 0);
        if (adx < reach && Math.abs(dy) < 70) plan.fire = true;
        else if (adx < 230 && adx > w.range && Math.abs(dy) < 60 && me.fuel > T.dashCost * 1.5 && r() < P.dash) { plan.dash = true; plan.mx = dir; }
      } else if (rangedUsable && me.cooldown <= 0.05 && r() < P.trigger) {
        const selfBlast = w.selfDamage && adx < w.blast + 30;
        if (!selfBlast || r() > P.smart) {
          let bestAim = 0, bestMiss = Infinity;
          for (const aim of [-1, 0, 1]) {
            const ang = GD.aimAngle(world, me, w, { up: aim < 0, down: aim > 0 });
            const miss = shotMiss(world, me, foe, w, ang);
            if (miss < bestMiss) { bestMiss = miss; bestAim = aim; }
          }
          const skilled = r() < P.aim;
          plan.aim = skilled ? bestAim : Math.floor(r() * 3) - 1;
          plan.fire = skilled ? bestMiss < 34 || (w.auto && bestMiss < 60) : r() < 0.7;
        }
      }
      // Close-range vulcan when the main weapon is busy or empty.
      if (!plan.fire && !melee && adx < 260 && me.ammo.vulcan > 8 && r() < P.trigger * 0.3) plan.sub = true;
    }
    return plan;
  }

  // One physics step of input for `player`.
  GD.aiInput = function (ai, world, player, dt) {
    const me = world.fighters[player - 1];
    const foe = world.fighters[2 - player];
    ai.think -= dt;
    if (!ai.plan || ai.think <= 0) {
      ai.plan = decide(ai, world, me, foe);
      ai.think = ai.P.think * (0.8 + 0.4 * ai.rnd());
    }
    const pl = ai.plan;
    const w = GD.activeWeapon(me);
    const held = {
      left: pl.mx < 0, right: pl.mx > 0,
      up: pl.aim < 0 || (pl.aim === 0 && (pl.my < 0 || pl.jet)),
      down: pl.aim > 0 || (pl.aim === 0 && (pl.my > 0 || pl.drop) && !pl.jet),
      guard: pl.guard,
      sub: pl.sub,
      // Semi-automatic weapons need a fresh press per shot: alternate press and release.
      attack: pl.fire && (w.auto || !ai.prev.attack),
      switch: pl.sw,
      dash: pl.dash,
    };
    // Jumping needs a fresh press: on the ground, let go of up for one step before pressing again.
    if (held.up && me.onGround && ai.prev.up && !pl.fire) held.up = false;
    // One-shot actions fire once per decision.
    pl.sw = false;
    pl.dash = false;
    const out = { pressed: {} };
    for (const k of KEYS) {
      out[k] = !!held[k];
      if (out[k] && !ai.prev[k]) out.pressed[k] = true;
    }
    ai.prev = held;
    return out;
  };

  GD.aiInternals = { decide, shotMiss, incoming, seeded };
})(globalThis.GD = globalThis.GD || {});
