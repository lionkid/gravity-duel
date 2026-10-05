#!/usr/bin/env node
/* Gravity Duel - LAN server. Zero dependencies: needs only Node.js 16 or newer.
 *
 *   node server/lan-server.js [port]        (default port 8080, or PORT env)
 *
 * Serves the game over HTTP and relays messages between two players over a WebSocket at /ws.
 * The first browser to connect is player 1 (host, runs the simulation); the second is player 2.
 * Open the printed address on both computers, which must be on the same network. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 20;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------- static files
function serveFile(req, res) {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  // Stay inside the project and never serve dot-files such as .git.
  const rel = path.relative(ROOT, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((s) => s.startsWith('.'))) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------------------------------------------------------- minimal WebSocket (RFC 6455, text frames)
class Peer {
  constructor(socket, onText, onClose) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.onText = onText;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    const end = () => { if (!this.closed) { this.closed = true; onClose(this); } };
    socket.on('close', end);
    socket.on('end', end);
    socket.on('error', end);
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_FRAME) { this.close(); return; }
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = Buffer.from(b.subarray(off, off + len));
      if (masked) {
        const mask = b.subarray(off - 4, off);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = b.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xA, payload); continue; }       // ping -> pong
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        this.frag = this.frag ? Buffer.concat([this.frag, payload]) : payload;
        if (fin) { const text = this.frag.toString('utf8'); this.frag = null; this.onText(this, text); }
      }
    }
  }

  frame(op, data) {
    if (this.closed) return;
    const n = data.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([head, data]));
  }

  send(text) { this.frame(0x1, Buffer.from(text, 'utf8')); }

  close() {
    if (this.closed) return;
    try { this.frame(0x8, Buffer.alloc(0)); } catch (e) { /* socket already gone */ }
    this.socket.end();
  }
}

// ---------------------------------------------------------------- room: two seats, messages relayed as-is
function createServer(port) {
  const seats = { 1: null, 2: null };
  const other = (p) => seats[p === 1 ? 2 : 1];
  const server = http.createServer(serveFile);

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (req.url.split('?')[0] !== '/ws' || !key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const peer = new Peer(socket, (from, text) => {
      const to = other(from.player);
      if (to) to.send(text);
    }, (gone) => {
      if (seats[gone.player] === gone) seats[gone.player] = null;
      const to = other(gone.player);
      if (to) to.send(JSON.stringify({ t: 'peer', on: false }));
      log(`player ${gone.player} left`);
    });
    const seat = !seats[1] ? 1 : !seats[2] ? 2 : 0;
    if (!seat) { peer.send(JSON.stringify({ t: 'full' })); peer.close(); return; }
    peer.player = seat;
    seats[seat] = peer;
    const mate = other(seat);
    // Tell the browser the LAN addresses, so a host that opened localhost can show the right link.
    const addrs = lanAddresses(port || server.address().port);
    peer.send(JSON.stringify({ t: 'hello', player: seat, peer: !!mate, addrs }));
    if (mate) mate.send(JSON.stringify({ t: 'peer', on: true }));
    log(`player ${seat} joined from ${socket.remoteAddress}`);
  });
  return server;
}

let quiet = false;
function log(msg) { if (!quiet) console.log(`[lan] ${msg}`); }

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

if (require.main === module) {
  const server = createServer(PORT);
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Gravity Duel LAN server is running.');
    console.log(`  This computer:   http://localhost:${PORT}`);
    for (const u of lanAddresses(PORT)) console.log(`  Other computers: ${u}`);
    console.log('Open the address on both computers. The first one to connect hosts the match. Ctrl+C to stop.');
  });
  server.on('error', (e) => { console.error(`Cannot start on port ${PORT}: ${e.message}`); process.exit(1); });
}

module.exports = { createServer, lanAddresses, setQuiet: (q) => { quiet = q; } };
