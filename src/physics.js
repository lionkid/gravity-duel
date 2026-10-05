/* Gravity Duel - deterministic fixed-step physics for two fighters.
 * No DOM access here so it can be unit tested in Node. */
(function (GD) {
  'use strict';

  const T = GD.TUNING;
  const A = GD.ARENA;

  function approach(v, target, delta) {
    if (v < target) return Math.min(v + delta, target);
    if (v > target) return Math.max(v - delta, target);
    return v;
  }

  // Convert 0-6 design stats into physical values.
  GD.deriveStats = function (mech) {
    return {
      hpMax: 400 + mech.hp * 100,
      walkSpeed: 150 + mech.spd * 35,
      airSpeed: 130 + mech.spd * 30,
      jumpVel: 540 + mech.bst * 10,
      fuelMax: 60 + mech.bst * 15,
      thrustEarth: 1480 + mech.bst * 40,
      thrustSpace: 420 + mech.bst * 60,
      maxSpaceSpeed: 220 + mech.spd * 25,
      dashSpeed: 460 + mech.spd * 30,
      energyMax: 60 + mech.en * 15,
      energyRegen: GD.COMBAT.energyRegenBase + mech.en * GD.COMBAT.energyRegenPerPoint,
      damageTaken: 1 - mech.arm * GD.COMBAT.armorPerPoint,
    };
  };

  GD.createFighter = function (player, mechId, stage) {
    const mech = GD.MECHS.find((m) => m.id === mechId) || GD.MECHS[0];
    const stats = GD.deriveStats(mech);
    const start = GD.START[stage.id][player];
    return {
      player, mech, stats,
      w: T.hitbox.w, h: T.hitbox.h,
      x: start.x, y: start.y,          // (x, y) is the center of the feet
      prevX: start.x, prevY: start.y,
      vx: 0, vy: 0,
      facing: player === 1 ? 1 : -1,
      onGround: stage.gravity > 0, groundRef: stage.gravity > 0 ? 'ground' : null,
      hp: stats.hpMax,
      fuel: stats.fuelMax, overheat: false,
      boosting: false, thrusting: false, thrustX: 0, thrustY: 0,
      guarding: false,
      dashT: 0, dashCd: 0, dashX: 0, dashY: 0,
      landLag: 0, coyote: 0, jumpBuf: 0, dropT: 0, regenDelay: 0, downHold: 0,
      atkBuf: 0, dashBuf: 0, swBuf: 0,   // buffered presses waiting for a cooldown to end
      walkPhase: 0, landSquash: 0,
      hitstun: 0, actionLock: 0, ko: false,
      state: 'idle',
    };
  };

  const IDLE_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, attack: false, sub: false,
    guard: false, switch: false, dash: false, pressed: Object.freeze({}) });
  GD.IDLE_INPUT = IDLE_INPUT;

  GD.DEFAULT_LOADOUT = { 1: { ranged: 'beam', melee: 'saber' }, 2: { ranged: 'bazooka', melee: 'axe' } };

  // loadout = { 1: { ranged, melee }, 2: { ranged, melee } }
  // Small seeded generator for in-match randomness (weapon spread), so a match replays the same way.
  function makeRng(seed) {
    let s = (Math.imul((seed | 0) || 1, 2654435761) >>> 0) % 2147483646 + 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  GD.createWorld = function (stageId, mech1, mech2, loadout, seed) {
    const stage = GD.STAGES[stageId];
    const lo = loadout || GD.DEFAULT_LOADOUT;
    const world = {
      rnd: makeRng(seed == null ? Math.floor(Math.random() * 1e9) : seed),
      stage,
      fighters: [GD.createFighter(1, mech1, stage), GD.createFighter(2, mech2, stage)],
      projectiles: [],
      time: 0,
      winner: 0,
      events: [],   // consumed by the renderer for particles and sound later
    };
    if (GD.initCombat) for (const f of world.fighters) GD.initCombat(f, lo[f.player]);
    return world;
  };

  function emit(world, type, f, data) {
    world.events.push(Object.assign({ type, player: f.player, x: f.x, y: f.y }, data));
  }

  function spendFuel(world, f, amount) {
    f.fuel -= amount;
    if (f.fuel <= 0) {
      f.fuel = 0;
      if (!f.overheat) emit(world, 'overheat', f);
      f.overheat = true;
      f.boosting = false;
    }
  }

  function tryDash(world, f, inp, dx, dy) {
    if (f.dashBuf <= 0 || f.dashCd > 0 || f.overheat || f.landLag > 0) return;
    if (f.fuel < T.dashCost) return;
    f.dashBuf = 0;
    f.dashT = T.dashTime;
    f.dashCd = T.dashCooldown;
    f.dashX = dx;
    f.dashY = dy;
    spendFuel(world, f, T.dashCost);
    f.regenDelay = T.spaceRegenDelay;
    emit(world, 'dash', f, { dx, dy });
  }

  function land(world, f, ref, wasGround) {
    if (!wasGround) {
      const impact = f.vy;
      if (impact > T.heavyLandVy) f.landLag = T.landLag;
      f.landSquash = Math.min(1, impact / 900);
      emit(world, 'land', f, { impact });
    }
    f.onGround = true;
    f.groundRef = ref;
    f.vy = 0;
    f.boosting = false;
  }

  function clampX(f) {
    const half = f.w / 2;
    if (f.x < half) { f.x = half; return -1; }
    if (f.x > A.w - half) { f.x = A.w - half; return 1; }
    return 0;
  }

  function updateEarth(world, f, inp, dt) {
    const g = world.stage.gravity;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (f.onGround) f.coyote = T.coyoteTime;

    tryDash(world, f, inp, dir || f.facing, 0);
    f.guarding = inp.guard && f.onGround && f.dashT <= 0 && f.actionLock <= 0;

    let jumped = false;
    if (f.dashT > 0) {
      // Dash ignores gravity for its short duration.
      f.dashT -= dt;
      f.vx = f.dashX * f.stats.dashSpeed;
      f.vy = 0;
      f.boosting = false;
    } else {
      const locked = f.guarding || f.landLag > 0 || f.actionLock > 0;
      const target = locked ? 0 : dir * (f.onGround ? f.stats.walkSpeed : f.stats.airSpeed);
      // Knockback should carry: much less friction while stunned.
      const friction = f.hitstun > 0 ? GD.COMBAT.hitstunFriction : 1;
      f.vx = approach(f.vx, target, (f.onGround ? T.groundAccel : T.airAccel) * friction * dt);

      // Holding down on a one-way platform drops through it. Firing or using the vulcan
      // while holding down aims downward instead, so it does not count.
      const onPlatform = f.onGround && f.groundRef && f.groundRef !== 'ground';
      if (onPlatform && inp.down && !inp.attack && !inp.sub && !locked) {
        f.downHold += dt;
        if (f.downHold >= T.dropHoldTime) {
          f.downHold = 0;
          f.dropT = T.dropThroughTime;
          f.onGround = false;
          f.y += 1;
        }
      } else {
        f.downHold = 0;
      }

      // Up jumps from the ground; holding it in the air fires the jet.
      if (f.jumpBuf > 0 && f.coyote > 0 && !locked) {
        f.jumpBuf = 0;
        f.coyote = 0;
        f.vy = -f.stats.jumpVel * (world.stage.jumpScale || 1);
        f.onGround = false;
        jumped = true;
        emit(world, 'jump', f);
      }

      // Jet latch: once engaged it stays on until up is released or fuel runs out.
      const canBoost = !f.onGround && inp.up && !f.overheat && f.fuel > 0;
      if (!canBoost) {
        f.boosting = false;
      } else if (!f.boosting && (f.vy > T.boostStartVy || (inp.pressed.up && !jumped))) {
        f.boosting = true;
      }

      if (f.boosting) {
        // Jet thrust is defined relative to Earth gravity, so the net climb feels the same on any stage.
        const thrust = g + (f.stats.thrustEarth - GD.STAGES.earth.gravity);
        f.vy += (g - thrust) * dt;
        if (f.vy < T.boostRiseCap) f.vy = T.boostRiseCap;
        f.thrustX = 0;
        f.thrustY = -1;
        spendFuel(world, f, T.hoverCost * dt);
      } else {
        f.vy = Math.min(f.vy + g * dt, T.maxFall);
      }
    }
    f.thrusting = f.boosting;

    if (f.onGround && !f.boosting && f.dashT <= 0) f.fuel += T.fuelRegenGround * dt;

    const prevBottom = f.y;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const wasGround = f.onGround;
    f.onGround = false;
    f.groundRef = null;
    if (f.vy >= 0) {
      if (f.dropT <= 0) {
        for (const p of world.stage.platforms) {
          const overlapX = f.x + f.w / 2 > p.x && f.x - f.w / 2 < p.x + p.w;
          if (overlapX && prevBottom <= p.y + 0.5 && f.y >= p.y) {
            f.y = p.y;
            land(world, f, p, wasGround);
            break;
          }
        }
      }
      if (!f.onGround && f.y >= A.groundY) {
        f.y = A.groundY;
        land(world, f, 'ground', wasGround);
      }
    }

    if (f.y - f.h < A.ceilingY) {
      f.y = A.ceilingY + f.h;
      if (f.vy < 0) f.vy = 0;
    }
    clampX(f);

    if (f.onGround) f.walkPhase += Math.abs(f.vx) * dt * 0.06;
  }

  function updateSpace(world, f, inp, dt) {
    const S = T.space;
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const len = Math.hypot(dx, dy);
    if (len) { dx /= len; dy /= len; }

    tryDash(world, f, inp, len ? dx : f.facing, len ? dy : 0);
    f.guarding = inp.guard && f.dashT <= 0 && f.actionLock <= 0;
    f.thrusting = false;
    f.boosting = false;

    if (f.dashT > 0) {
      f.dashT -= dt;
      f.vx = f.dashX * f.stats.dashSpeed;
      f.vy = f.dashY * f.stats.dashSpeed;
    } else {
      const fuelOk = !f.overheat && f.fuel > 0;
      if (fuelOk && len && !f.guarding) {
        // Every direction is a jet direction in zero G.
        const acc = f.stats.thrustSpace;
        f.vx += dx * acc * dt;
        f.vy += dy * acc * dt;
        f.thrusting = true;
        f.thrustX = dx;
        f.thrustY = dy;
        f.regenDelay = T.spaceRegenDelay;
        spendFuel(world, f, S.thrustCost * dt);
      } else if (fuelOk && f.guarding) {
        // Guarding braces the frame: retro thrusters bleed off momentum.
        const sp = Math.hypot(f.vx, f.vy);
        if (sp > 1) {
          const ns = Math.max(0, sp - S.brakeDecel * dt);
          f.thrustX = -f.vx / sp;
          f.thrustY = -f.vy / sp;
          f.vx *= ns / sp;
          f.vy *= ns / sp;
          f.thrusting = true;
          f.regenDelay = T.spaceRegenDelay;
          spendFuel(world, f, S.brakeCost * dt);
        }
      }

      const k = Math.max(0, 1 - S.drag * dt);
      f.vx *= k;
      f.vy *= k;
      const sp = Math.hypot(f.vx, f.vy);
      const max = f.stats.maxSpaceSpeed;
      if (sp > max) {
        const ns = sp - (sp - max) * Math.min(1, S.overspeedDrag * dt);
        f.vx *= ns / sp;
        f.vy *= ns / sp;
      }
    }

    if (f.regenDelay <= 0 && !f.thrusting && f.dashT <= 0) f.fuel += T.fuelRegenSpace * dt;

    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const half = f.w / 2;
    if (f.x < half) { f.x = half; f.vx = Math.abs(f.vx) * S.wallBounce; }
    if (f.x > A.w - half) { f.x = A.w - half; f.vx = -Math.abs(f.vx) * S.wallBounce; }
    if (f.y - f.h < A.ceilingY) { f.y = A.ceilingY + f.h; f.vy = Math.abs(f.vy) * S.wallBounce; }
    if (f.y > A.h) { f.y = A.h; f.vy = -Math.abs(f.vy) * S.wallBounce; }
    f.onGround = false;
  }

  function updateFighter(world, f, inp, dt) {
    f.dashCd = Math.max(0, f.dashCd - dt);
    f.landLag = Math.max(0, f.landLag - dt);
    f.coyote = Math.max(0, f.coyote - dt);
    f.jumpBuf = Math.max(0, f.jumpBuf - dt);
    f.dropT = Math.max(0, f.dropT - dt);
    f.regenDelay = Math.max(0, f.regenDelay - dt);
    f.landSquash = Math.max(0, f.landSquash - dt * 6);
    f.hitstun = Math.max(0, f.hitstun - dt);
    f.actionLock = Math.max(0, f.actionLock - dt);
    // A stunned or downed fighter ignores the controls but still obeys physics.
    if (f.hitstun > 0 || f.ko) inp = IDLE_INPUT;
    if (inp.pressed.up) f.jumpBuf = T.jumpBuffer;
    // Input buffer: a press made slightly early is kept until the action can happen.
    f.atkBuf = inp.pressed.attack ? T.inputBuffer : Math.max(0, f.atkBuf - dt);
    f.dashBuf = inp.pressed.dash ? T.inputBuffer : Math.max(0, f.dashBuf - dt);
    f.swBuf = inp.pressed.switch ? T.inputBuffer : Math.max(0, f.swBuf - dt);

    if (world.stage.gravity > 0) updateEarth(world, f, inp, dt);
    else updateSpace(world, f, inp, dt);

    if (f.overheat && f.fuel >= f.stats.fuelMax * T.overheatRecover) {
      f.overheat = false;
      emit(world, 'recover', f);
    }
    f.fuel = Math.min(f.fuel, f.stats.fuelMax);
  }

  function resolveFighters(world, a, b) {
    const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
    const oy = Math.min(a.y, b.y) - Math.max(a.y - a.h, b.y - b.h);
    if (ox <= 0 || oy <= 0) return;
    const earth = world.stage.gravity > 0;
    const bounce = T.space.mechBounce;

    if (earth || ox < oy) {
      // s is the direction a gets pushed.
      const s = a.x < b.x ? -1 : a.x > b.x ? 1 : (a.player === 1 ? -1 : 1);
      const push = earth ? Math.min(ox / 2, T.softPushMax) : ox / 2;
      a.x += s * push;
      b.x -= s * push;
      const wallA = clampX(a);
      const wallB = clampX(b);
      const rest = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
      if (rest > 0 && (wallA || wallB)) {
        if (wallA) b.x -= s * rest; else a.x += s * rest;
        clampX(a); clampX(b);
      }
      if (!earth && (a.vx - b.vx) * -s > 0) {
        const d = a.vx - b.vx;
        a.vx -= d * (1 + bounce) / 2;
        b.vx += d * (1 + bounce) / 2;
      }
    } else {
      const s = a.y < b.y ? -1 : 1;
      a.y += s * oy / 2;
      b.y -= s * oy / 2;
      if ((a.vy - b.vy) * -s > 0) {
        const d = a.vy - b.vy;
        a.vy -= d * (1 + bounce) / 2;
        b.vy += d * (1 + bounce) / 2;
      }
    }
  }

  function stateOf(world, f) {
    if (f.ko) return 'down';
    if (f.hitstun > 0) return 'hit';
    if (f.melee) return 'attack';
    if (f.dashT > 0) return 'dash';
    if (f.guarding) return 'guard';
    if (f.landLag > 0) return 'land';
    if (world.stage.gravity > 0) {
      if (f.onGround) return Math.abs(f.vx) > 15 ? 'walk' : 'idle';
      if (f.boosting) return 'boost';
      return f.vy < 0 ? 'rise' : 'fall';
    }
    if (f.thrusting) return 'thrust';
    return 'drift';
  }

  GD.stepWorld = function (world, inputs, dt) {
    const [a, b] = world.fighters;
    for (const f of world.fighters) { f.prevX = f.x; f.prevY = f.y; }
    updateFighter(world, a, inputs[0], dt);
    updateFighter(world, b, inputs[1], dt);
    resolveFighters(world, a, b);
    for (const [f, o] of [[a, b], [b, a]]) {
      const busy = f.dashT > 0 || f.melee || f.hitstun > 0 || f.ko;
      if (!busy && Math.abs(o.x - f.x) > 2) f.facing = o.x > f.x ? 1 : -1;
    }
    if (GD.stepCombat) GD.stepCombat(world, inputs, dt);
    for (const f of world.fighters) f.state = stateOf(world, f);
    world.time += dt;
  };

  GD.physicsInternals = { approach, resolveFighters };
})(globalThis.GD = globalThis.GD || {});
