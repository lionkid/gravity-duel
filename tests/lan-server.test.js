/* LAN server checks: seats, relay, full room, leave notice, static files. Run: node tests/lan-server.test.js
 * Needs Node 22+ (global WebSocket). */
'use strict';
const assert = require('assert');
const http = require('http');
const { createServer, setQuiet } = require('../server/lan-server.js');

if (typeof WebSocket === 'undefined') { console.log('  skip  Node has no global WebSocket'); process.exit(0); }
setQuiet(true);

function get(port, path) {
  return new Promise((resolve) => http.get({ host: '127.0.0.1', port, path }, (res) => {
    let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] }));
  }));
}
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); if (w) w(m); else inbox.push(m); };
  ws.next = () => new Promise((r) => (inbox.length ? r(inbox.shift()) : waiters.push(r)));
  ws.ready = new Promise((r) => { ws.onopen = r; });
  return ws;
}

(async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let passed = 0;
  const ok = (name) => { passed++; console.log('  ok  ' + name); };

  const page = await get(port, '/');
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.includes('GRAVITY DUEL') && page.type.startsWith('text/html'));
  const js = await get(port, '/src/main.js');
  assert.ok(js.status === 200 && js.type.startsWith('text/javascript'));
  assert.strictEqual((await get(port, '/.git/config')).status, 404);
  assert.strictEqual((await get(port, '/../../etc/passwd')).status, 404);
  ok('serves the game files, refuses dot-files and paths outside the project');

  const a = client(port);
  await a.ready;
  const ha = await a.next();
  assert.strictEqual(ha.t, 'hello'); assert.strictEqual(ha.player, 1); assert.strictEqual(ha.peer, false);
  assert.ok(Array.isArray(ha.addrs) && ha.addrs.every((u) => /^http:\/\/[\d.]+:\d+$/.test(u)), 'LAN addresses');
  const b = client(port);
  await b.ready;
  const hb = await b.next();
  assert.ok(hb.t === 'hello' && hb.player === 2 && hb.peer === true);
  assert.deepStrictEqual(await a.next(), { t: 'peer', on: true });
  ok('first browser is player 1 (host), second is player 2, both told about each other');

  a.send(JSON.stringify({ t: 'in', h: 5 }));
  assert.deepStrictEqual(await b.next(), { t: 'in', h: 5 });
  const big = { t: 'snap', pad: 'x'.repeat(70000) };   // exercises the 64-bit length frame path
  b.send(JSON.stringify(big));
  assert.strictEqual((await a.next()).pad.length, 70000);
  ok('relays messages both ways, including large snapshots');

  const c = client(port);
  await c.ready;
  assert.deepStrictEqual(await c.next(), { t: 'full' });
  ok('a third browser is turned away');

  b.close();
  assert.deepStrictEqual(await a.next(), { t: 'peer', on: false });
  const d = client(port);
  await d.ready;
  const hd = await d.next();
  assert.ok(hd.t === 'hello' && hd.player === 2 && hd.peer === true);
  ok('when a player leaves, the other is told and the seat opens again');

  a.close(); d.close(); c.close();
  server.close();
  console.log(`\n${passed} tests passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
