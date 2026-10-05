/* LAN sync helpers: input bitmasks, remote input buffering, snapshot round trip. Run: node tests/net.test.js */
'use strict';
for (const f of ['config', 'physics', 'combat', 'ai', 'net']) require(`../src/${f}.js`);
const GD = globalThis.GD;
const assert = require('assert');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok  ' + name); }

test('inputs survive the bitmask encoding', () => {
  const inp = { up: true, down: false, left: true, right: false, attack: true, sub: false, guard: false, switch: true, dash: false, pressed: { attack: true, switch: true } };
  const ri = GD.createRemoteInput();
  GD.remoteReceive(ri, GD.encodeInput(inp));
  const out = GD.remoteStep(ri);
  for (const k of GD.NET_KEYS) assert.strictEqual(out[k], !!inp[k], k);
  assert.deepStrictEqual(out.pressed, { attack: true, switch: true });
});

test('a press that arrives between physics steps is used once, never lost', () => {
  const ri = GD.createRemoteInput();
  GD.remoteReceive(ri, GD.encodeInput({ attack: true, pressed: { attack: true } }));
  GD.remoteReceive(ri, GD.encodeInput({ attack: false, pressed: {} }));   // released before the host stepped
  const first = GD.remoteStep(ri), second = GD.remoteStep(ri);
  assert.ok(first.pressed.attack && !first.attack);
  assert.deepStrictEqual(second.pressed, {});
});

test('a guest world mirrors the host world through snapshots (through JSON)', () => {
  const lo = { 1: { ranged: 'bazooka', melee: 'axe' }, 2: { ranged: 'mg', melee: 'lance' } };
  const host = GD.createWorld('moon', 'ax07', 'zr06', lo, 99);
  const guest = GD.createWorld('moon', 'ax07', 'zr06', lo, 1);
  const a1 = GD.createAI('hard', 1), a2 = GD.createAI('hard', 2);
  let shots = 0, events = 0;
  for (let i = 0; i < 600; i++) {
    GD.stepWorld(host, [GD.aiInput(a1, host, 1, GD.DT), GD.aiInput(a2, host, 2, GD.DT)], GD.DT);
    const snap = JSON.parse(JSON.stringify(GD.lanSnapshot(host, host.events)));
    host.events.length = 0;
    GD.lanApply(guest, snap);
    events += guest.events.length;
    guest.events.length = 0;
    shots = Math.max(shots, guest.projectiles.length);
    for (let k = 0; k < 2; k++) {
      const h = host.fighters[k], g = guest.fighters[k];
      assert.ok(Math.abs(h.x - g.x) < 0.01 && Math.abs(h.y - g.y) < 0.01, 'position');
      assert.strictEqual(g.hp, h.hp);
      assert.strictEqual(g.mode, h.mode);
      assert.strictEqual(!!g.melee, !!h.melee);
    }
    assert.strictEqual(guest.projectiles.length, host.projectiles.length);
    if (host.winner) break;
  }
  assert.ok(shots > 0 && events > 0, 'nothing happened');
  assert.strictEqual(guest.winner, host.winner);
});

test('snapshots stay small enough for 60 per second on a LAN', () => {
  const w = GD.createWorld('earth', 'ax01', 'zr06');
  for (let i = 0; i < 8; i++) GD.combatInternals.spawnProjectile(w, w.fighters[0], GD.weaponById('mg'), 0);
  const bytes = JSON.stringify(GD.lanSnapshot(w, [])).length;
  assert.ok(bytes < 3000, bytes + ' bytes');
});

console.log(`\n${passed} tests passed`);
