// Two browsers, one LAN server: the host creates a room, the guest joins it on the same server, both
// ready up, the match runs and the guest's confirmed world is checked against the host's.
// Development tool, not part of npm test. Usage: node tools/skyline-lan-smoke.mjs [outDir]
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'build', 'smoke-lan');
fs.mkdirSync(outDir, { recursive: true });
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(path.join(process.env.PLAYWRIGHT_GLOBAL || '/opt/node22/lib/node_modules', 'playwright')));
}
const { createServer, setQuiet } = require(path.join(root, 'server', 'lan-server.js'));
setQuiet(true);
const server = createServer(0, { discovery: false });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-proxy-server', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
// Software rendering is slow, so pages are small and the host's loop rests while the guest page loads.
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) errors.push(`${name} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&debug&bloom=0`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title' && window.__skyline.lobby.state.server, null, { timeout: 120000 });
  return page;
};
const shot = async (page, name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(`  saved ${name}.png`); };
const t0 = Date.now();
const host = await open('host');
await host.evaluate(() => window.__skyline.loop.stop());
const guest = await open('guest');
await host.evaluate(() => window.__skyline.loop.start());
console.log(`pages ready in ${Date.now() - t0} ms`);

// Host: title → LAN → create a room on this server.
await host.click('[data-act="lan"]');
await host.waitForSelector('.room[data-act="join"][data-url=""]');
await shot(host, '20-rooms');
await host.click('.room[data-act="join"][data-url=""]');
await host.waitForFunction(() => window.__skyline.lobby.state.phase === 'waiting', null, { timeout: 60000 });
await shot(host, '21-waiting');
console.log('  host waits; links:', await host.evaluate(() => window.__skyline.socket.links(location.pathname)));

// Guest: title → LAN → the list shows this server's room with one player → join.
await guest.click('[data-act="lan"]');
await guest.waitForFunction(() => window.__skyline.lobby.state.self && window.__skyline.lobby.state.self.players === 1, null, { timeout: 60000 });
await guest.waitForSelector('.room[data-act="join"][data-url=""]:not(.primary)');
await guest.click('.room[data-act="join"][data-url=""]');
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__skyline.lobby.state.phase === 'lobby' && window.__skyline.lobby.state.peerLoadout, null, { timeout: 60000 })));
console.log('  both in the room; seats', await host.evaluate(() => window.__skyline.lobby.state.seat), await guest.evaluate(() => window.__skyline.lobby.state.seat));
// The guest picks the melee class, then both ready up.
await guest.click('.opt[data-kind="weapon"][data-id="melee"]');
await host.waitForFunction(() => window.__skyline.lobby.state.peerLoadout.weapon === 'melee', null, { timeout: 30000 });
await shot(host, '22-room');
await host.click('[data-act="ready"]');
await guest.waitForFunction(() => window.__skyline.lobby.state.peerReady, null, { timeout: 30000 });
await guest.click('[data-act="ready"]');
await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__skyline.inBattle && window.__skyline.world.tick > 10, null, { timeout: 90000 })));
console.log('  match started; seats', await host.evaluate(() => window.__skyline.mySeat), await guest.evaluate(() => window.__skyline.mySeat),
  'loadouts', await guest.evaluate(() => JSON.stringify(window.__skyline.world.fighters.map((f) => f.loadout.weapon))));

// Both run forward for a while; the guest also fires the vulcan.
await host.keyboard.down('KeyW'); await guest.keyboard.down('KeyW'); await guest.keyboard.down('KeyJ');
await host.waitForTimeout(2500);
await host.keyboard.up('KeyW'); await guest.keyboard.up('KeyW'); await guest.keyboard.up('KeyJ');
await host.waitForTimeout(600);
await shot(host, '23-host-view');
await shot(guest, '24-guest-view');
const hn = await host.evaluate(() => window.__skyline.net), gn = await guest.evaluate(() => window.__skyline.net);
const hostHashAtGuestTick = hn.hostHashes[gn.confirmedTick];
console.log(`  host tick ${hn.tick}, guest predicted ${gn.tick}, confirmed ${gn.confirmedTick}; lead ${gn.stats.lead}, delay ${gn.stats.delay}, rtt ${gn.stats.rtt.toFixed(1)} ms, corrections ${gn.stats.corrections}, snapshots ${gn.stats.snapshots}; host saw ${hn.stats.late} late inputs`);
console.log(`  confirmed state ${hostHashAtGuestTick === gn.confirmedHash ? 'MATCHES' : 'DIFFERS FROM'} the host at tick ${gn.confirmedTick}`);
const pos = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__skyline.world.fighters.map((f) => [Math.round(f.pos.x), Math.round(f.pos.z), f.hp]))));
console.log('  host sees', JSON.stringify(pos[0]), ' guest sees', JSON.stringify(pos[1]));
if (hostHashAtGuestTick !== gn.confirmedHash) errors.push('guest confirmed world differs from the host');
if (gn.stats.corrections > 5) console.log(`  note: ${gn.stats.corrections} corrections (software rendering drops ticks; a real machine keeps 60 Hz)`);

// Menu on the guest does not stop the match; leaving tells the host.
await guest.keyboard.press('Escape');
await guest.waitForFunction(() => window.__skyline.ui.name === 'pause', null, { timeout: 30000 });
const t1 = await host.evaluate(() => window.__skyline.world.tick);
await host.waitForTimeout(400);
const t2 = await host.evaluate(() => window.__skyline.world.tick);
console.log(`  guest opened the menu; host kept running ${t1} → ${t2}`);
await shot(guest, '25-guest-menu');
await guest.click('[data-act="quit"]');
await host.waitForFunction(() => window.__skyline.ui.name === 'lanlost', null, { timeout: 30000 });
await shot(host, '26-host-lost');
console.log('  guest left; host shows the lost-peer screen');
console.log(errors.length ? `problems:\n  ${errors.join('\n  ')}` : 'no console errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
