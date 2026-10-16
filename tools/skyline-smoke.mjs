// Opens Gravity Duel: Skyline in headless Chromium, plays for a few seconds and saves screenshots.
// Reports console errors and the fighter's state. Development tool, not part of npm test.
// Usage: node tools/skyline-smoke.mjs [outDir]   (needs Playwright; uses the global install when present)
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'build', 'smoke');
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
// The web fonts come from the internet; the test runs offline, with the fallback fonts.
const noFonts = (target) => target.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const openPage = browser.newPage.bind(browser);
browser.newPage = async (...args) => { const p = await openPage(...args); await noFonts(p); return p; };
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&debug&bloom=0`);
await page.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title', null, { timeout: 30000 });
console.log(`page ready in ${Date.now() - t0} ms`);
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(`  saved ${name}.png`); };
const state = () => page.evaluate(() => { const f = window.__skyline.world.fighters[0]; return { tick: window.__skyline.world.tick, x: +f.pos.x.toFixed(1), y: +f.pos.y.toFixed(1), z: +f.pos.z.toFixed(1), ground: f.onGround, fuel: +f.fuel.toFixed(2) }; });

// Through the menus: title → difficulty → loadout → battle.
await page.waitForTimeout(600);
await shot('01-title');
await page.click('[data-act="solo"]');
await page.click('[data-act="pick"][data-level="hard"]');
await shot('01b-loadout');
await page.click('[data-act="start"]');
await page.waitForFunction(() => window.__skyline.inBattle && window.__skyline.world.tick > 5, null, { timeout: 30000 });
console.log(`  battle started; screen ${await page.evaluate(() => window.__skyline.ui.name)}, playing ${await page.evaluate(() => window.__skyline.playing)}`);
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await shot('02-running');
console.log('  after running:', await state());
await page.keyboard.up('KeyW');
// Esc pauses (no pointer lock in headless Chromium, so the key itself does it); Esc again resumes.
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__skyline.ui.name === 'pause', null, { timeout: 5000 });
await shot('11-pause');
const tickPaused = await page.evaluate(() => window.__skyline.world.tick);
await page.waitForTimeout(300);
console.log(`  paused: tick stays ${tickPaused} → ${await page.evaluate(() => window.__skyline.world.tick)}`);
await page.keyboard.press('Escape');
await page.waitForFunction(() => window.__skyline.playing && window.__skyline.ui.name === null, null, { timeout: 5000 });
console.log('  resumed');
// Vulcan from the street: locked on, level with the opponent, in range.
await page.keyboard.down('KeyJ');
await page.waitForTimeout(1500);
await shot('08-vulcan');
await page.keyboard.up('KeyJ');
console.log(`  opponent hp after vulcan: ${await page.evaluate(() => window.__skyline.world.fighters[1].hp)}`);
// Beam from first person.
await page.keyboard.press('Digit3');
await page.waitForFunction(() => window.__skyline.world.fighters[0].switchTimer === 0 && window.__skyline.world.fighters[0].active === 'ranged', null, { timeout: 10000 });
await page.keyboard.down('KeyK');
await page.waitForTimeout(400);
await page.keyboard.press('KeyJ');
await page.waitForTimeout(200);
await shot('09-beam');
await page.waitForTimeout(600);
await page.keyboard.up('KeyK');
console.log(`  opponent hp after beam: ${await page.evaluate(() => window.__skyline.world.fighters[1].hp)}`);
await page.keyboard.down('KeyW');
await page.keyboard.down('Space');
await page.waitForTimeout(1200);
await shot('03-boosting');
console.log('  while boosting:', await state());
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowLeft');
await page.keyboard.down('KeyK');
await page.waitForTimeout(600);
await shot('04-aiming');
await page.keyboard.up('KeyK');
await page.waitForTimeout(2500);
await shot('05-landed');
console.log('  at the end:', await state());
// Melee up close on a fresh page.
const fps = await page.evaluate(() => document.querySelector('#hud .debug').textContent.split(' fps')[0]);
await page.close();
{
  const p3 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p3.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await p3.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&pos=0,0,-48&bloom=0`, { timeout: 60000 });
  await p3.waitForFunction(() => window.__skyline, null, { timeout: 30000 });
  await p3.evaluate(() => window.__skyline.startBattle());
  await p3.waitForFunction(() => window.__skyline.world.tick > 3, null, { timeout: 30000 });
  await p3.keyboard.press('Digit1');
  await p3.waitForFunction(() => window.__skyline.world.fighters[0].switchTimer === 0 && window.__skyline.world.fighters[0].active === 'melee', null, { timeout: 10000 });
  // Three presses chain the saber combo: a shot of the first cut, then of the spinning finisher.
  const stage = () => p3.evaluate(() => { const m = window.__skyline.world.fighters[0].melee; return m ? `${m.combo}:${m.stage}` : 'none'; });
  const t0m = Date.now();
  await p3.keyboard.press('KeyJ');
  await p3.waitForFunction(() => { const m = window.__skyline.world.fighters[0].melee; return m && m.stage === 'active'; }, null, { timeout: 10000 }).catch(() => {});
  console.log(`  first cut active after ${Date.now() - t0m} ms wall (${await p3.evaluate(() => window.__skyline.world.fighters[0].melee && window.__skyline.world.fighters[0].melee.t.toFixed(3))} s into the stage)`);
  await p3.screenshot({ path: path.join(outDir, '10-melee.png') });
  console.log('  saved 10-melee.png', await stage());
  for (let i = 0; i < 2; i++) {
    await p3.waitForFunction(() => { const m = window.__skyline.world.fighters[0].melee; return !m || m.stage === 'recovery'; }, null, { timeout: 10000 }).catch(() => {});
    await p3.keyboard.press('KeyJ');
    await p3.waitForFunction((c) => { const m = window.__skyline.world.fighters[0].melee; return m && m.combo === c && m.stage !== 'windup'; }, i + 1, { timeout: 10000 }).catch(() => {});
  }
  await p3.waitForFunction(() => { const m = window.__skyline.world.fighters[0].melee; return m && m.combo === 2 && m.stage === 'active' && m.t > 0.06; }, null, { timeout: 10000 }).catch(() => {});
  await p3.screenshot({ path: path.join(outDir, '10b-spin.png') });
  console.log('  saved 10b-spin.png', await stage());
  console.log(`  opponent hp after the combo: ${await p3.evaluate(() => window.__skyline.world.fighters[1].hp)}`);
  // Then a finishing blow for the KO screen.
  await p3.waitForFunction(() => !window.__skyline.world.fighters[0].melee, null, { timeout: 10000 }).catch(() => {});
  await p3.evaluate(() => { window.__skyline.world.fighters[1].hp = 1; });
  await p3.keyboard.press('KeyJ');
  console.log(`  opponent hp after melee: ${await p3.evaluate(async () => { await new Promise((r) => setTimeout(r, 1200)); return window.__skyline.world.fighters[1].hp; })}`);
  await p3.waitForFunction(() => window.__skyline.ui.name === 'ko', null, { timeout: 10000 }).catch(() => {});
  await p3.screenshot({ path: path.join(outDir, '12-ko.png') });
  console.log(`  saved 12-ko.png (screen ${await p3.evaluate(() => window.__skyline.ui.name)})`);
  await p3.close();
}

// Touch controls on a touch device: the overlay shows during play, a tapped button fires the vulcan.
{
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 1024, height: 600 } });
  await noFonts(ctx);
  const pt = await ctx.newPage();
  pt.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await pt.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&dummy=idle&bloom=0`, { timeout: 60000 });
  await pt.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title', null, { timeout: 30000 });
  await pt.evaluate(() => { window.__skyline.settings.touch = 'on'; window.__skyline.touch.setMode('on'); window.__skyline.startBattle(); });
  await pt.waitForFunction(() => window.__skyline.world.tick > 3 && !document.getElementById('touch').hidden, null, { timeout: 30000 });
  const fired = await pt.evaluate(async () => {
    const btn = document.querySelector('#touch [data-action="attack"]');
    const r = btn.getBoundingClientRect();
    const ev = (type) => new PointerEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    btn.dispatchEvent(ev('pointerdown'));
    const down = window.__skyline.touch.isDown('attack');
    // Hold for 20 simulation ticks (a slow software renderer may take a few seconds for that).
    const t0 = window.__skyline.world.tick;
    await new Promise((res) => { const iv = setInterval(() => { if (window.__skyline.world.tick - t0 >= 20) { clearInterval(iv); res(); } }, 50); setTimeout(() => { clearInterval(iv); res(); }, 10000); });
    const heat = window.__skyline.world.fighters[0].heat;
    btn.dispatchEvent(ev('pointerup'));
    return { down, heat: +heat.toFixed(2), shown: !document.getElementById('touch').hidden };
  });
  await pt.screenshot({ path: path.join(outDir, '15-touch.png') });
  console.log('  saved 15-touch.png; touch attack:', fired);
  if (!fired.down || !(fired.heat > 0)) errors.push(`touch attack did not fire (${JSON.stringify(fired)})`);
  await ctx.close();
}

// Practice mode through the menus: an aimed rocket into the nearest board, with the simulation held
// still and stepped by hand so slow software rendering cannot miss the moment.
{
  const pp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pp.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await pp.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&bloom=0`, { timeout: 60000 });
  await pp.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title', null, { timeout: 30000 });
  await pp.click('[data-act="practice"]');
  await pp.click('.opt[data-kind="pmode"][data-id="free"]');
  await pp.click('[data-act="start"]');
  await pp.waitForFunction(() => window.__skyline.inBattle && window.__skyline.practice, null, { timeout: 30000 });
  const press = async (code, ticks = 1) => { await pp.keyboard.down(code); await pp.evaluate((n) => window.__skyline.tick(n), ticks); await pp.keyboard.up(code); };
  await pp.evaluate(() => { const S = window.__skyline; S.freeze(true); S.tick(20); });
  // A firing spot 60 m from the nearest standing board, along a street axis, with a clear line to it.
  const tg = await pp.evaluate(() => {
    const w = window.__skyline.world, me = w.fighters[0];
    const solid = (x, y, z, r) => { const b = { min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] };
      return w.statics.query(b).some((s) => b.min[0] < s.max[0] && b.max[0] > s.min[0] && b.min[1] < s.max[1] && b.max[1] > s.min[1] && b.min[2] < s.max[2] && b.max[2] > s.min[2]); };
    const clear = (a, b) => { for (let i = 1; i < 40; i++) { const u = i / 40; if (solid(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u, 0.6)) return false; } return true; };
    const boards = w.targets.filter((x) => x.kind === 'stand').sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z) - Math.hypot(b.pos.x - me.pos.x, b.pos.z - me.pos.z));
    for (const t of boards) {
      for (const [ox, oz] of [[0, 60], [0, -60], [60, 0], [-60, 0]]) {
        const p = { x: t.pos.x + ox, y: 0, z: t.pos.z + oz };
        if (solid(p.x, 9, p.z, 6) || !clear({ x: p.x, y: 15, z: p.z }, t.pos)) continue;
        me.pos.x = p.x; me.pos.z = p.z; me.pos.y = 0;
        return { x: t.pos.x, y: t.pos.y, z: t.pos.z, count: w.targets.length };
      }
    }
    return null;
  });
  if (!tg) errors.push('practice: no clear firing spot found');
  else {
  await press('Digit3', 14);
  await pp.keyboard.down('KeyK');
  await pp.evaluate((t) => { const S = window.__skyline, me = S.world.fighters[0]; const dx = t.x - me.pos.x, dy = t.y - (me.pos.y + 15), dz = t.z - me.pos.z;
    for (let i = 0; i < 20; i++) { S.look.yaw = Math.atan2(-dx, -dz); S.look.pitch = Math.atan2(dy, Math.hypot(dx, dz)); S.tick(1); } }, tg);
  await pp.waitForTimeout(1200);                          // let the aim camera settle before the shot
  await press('KeyJ', 10);
  await pp.waitForTimeout(500);
  await pp.screenshot({ path: path.join(outDir, '16-practice.png') });
  await pp.keyboard.up('KeyK');
  const P = await pp.evaluate(() => window.__skyline.world.practice);
  console.log(`  saved 16-practice.png; ${tg.count} targets, score ${P.score}, bullseyes ${P.bulls}, shots ${P.shots}`);
  if (!(P.score > 0)) errors.push('practice: the aimed rocket did not score');
  }
  await pp.close();
}

// The desert with a twister picking the player up.
{
  const pd = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pd.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await pd.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&stage=desert&dummy=idle&tod=0.3`, { timeout: 60000 });
  await pd.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title', null, { timeout: 30000 });
  await pd.evaluate(() => { const S = window.__skyline; S.startBattle(); S.freeze(true); S.tick(5);
    const w = S.world, me = w.fighters[0];
    for (const tw of w.twisters) { tw.phase = 'rest'; tw.dur = 1e6; tw.strength = 0; }
    Object.assign(w.twisters[0], { phase: 'live', t: 0, dur: 1e6, strength: 1, x: me.pos.x + 30, z: me.pos.z - 60, heading: 0 });
    S.tick(1); me.pos.x = w.twisters[0].x + 2; me.pos.z = w.twisters[0].z; S.tick(75); });
  // Free camera looking at the column; give the camera a few frames to catch up after the jump.
  await pd.keyboard.down('KeyF'); await pd.evaluate(() => window.__skyline.tick(1)); await pd.keyboard.up('KeyF');
  await pd.evaluate(() => { const S = window.__skyline; S.look.yaw = 0.2; S.look.pitch = 0.05; });
  await pd.waitForTimeout(2500);
  await pd.screenshot({ path: path.join(outDir, '17-desert-twister.png') });
  const st = await pd.evaluate(() => { const f = window.__skyline.world.fighters[0]; return { y: Math.round(f.pos.y), caught: f.caught }; });
  console.log(`  saved 17-desert-twister.png; player at ${st.y} m, caught ${st.caught}`);
  if (!st.caught || st.y < 20) errors.push('desert: the twister did not lift the player');
  await pd.close();
}

// The orbital deck: the station under the ringed planet, then a meteor coming down on the open
// crossing, watched from the side, and its burst.
{
  const ps = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Each drawn frame is 1/60 s of animation however slowly SwiftShader draws it, so the short-lived
  // burst effects are still on screen when the picture is taken.
  await ps.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let t = 0; window.requestAnimationFrame = (cb) => raf(() => { t += 1000 / 60; cb(t); }); });
  ps.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await ps.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&stage=space&dummy=idle`, { timeout: 90000 });
  await ps.waitForFunction(() => window.__skyline && window.__skyline.ui.name === 'title', null, { timeout: 90000 });
  const frames = (n) => ps.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  await ps.evaluate(() => { const S = window.__skyline; S.startBattle(); S.freeze(true); S.tick(3);
    const me = S.world.fighters[0]; me.lock = 0; me.autoLock = false;
    S.look.yaw = Math.atan2(-0.62, 0.77); S.look.pitch = 0.16; });
  await ps.waitForTimeout(1500); await frames(3);
  await ps.screenshot({ path: path.join(outDir, '18-space-deck.png') });
  const deck = await ps.evaluate(() => ({ rocks: window.__skyline.world.meteors.rocks.length, planet: window.__skyline.sky.mesh.material.uniforms.planetOn.value }));
  console.log(`  saved 18-space-deck.png; ${deck.rocks} drifting rocks, planet ${deck.planet ? 'on' : 'off'}`);
  if (!deck.rocks || !deck.planet) errors.push('space: no rocks or no planet');
  const flight = await ps.evaluate(() => {
    const S = window.__skyline, w = S.world, me = w.fighters[0];
    w.meteors.next = 0; S.tick(1); w.meteors.next = 1e9;
    const st = w.meteors.strikes[0];
    Object.assign(st, { ax: 0, ay: 0, az: 0 });
    Object.assign(st, { x: -st.vx * st.eta, y: 2.5 - st.vy * st.eta, z: -st.vz * st.eta });
    S.tick(Math.round(st.eta * 60) - 30);
    const h = Math.hypot(st.vx, st.vz), ux = st.vx / h, uz = st.vz / h;
    Object.assign(me.pos, { x: -uz * 150, y: 0, z: ux * 150 });
    const dx = st.x / 2 - me.pos.x, dz = st.z / 2 - me.pos.z;
    S.look.yaw = Math.atan2(-dx, -dz) + 0.12; S.look.pitch = Math.atan2(st.y / 2 - 14, Math.hypot(dx, dz)) * 0.8;
    return { eta: +st.eta.toFixed(2), height: Math.round(st.y), strikes: w.meteors.strikes.length };
  });
  await ps.waitForTimeout(1500); await frames(3);
  await ps.screenshot({ path: path.join(outDir, '19-space-meteor.png') });
  console.log(`  saved 19-space-meteor.png; meteor ${flight.height} m up, ${flight.eta} s from the deck`);
  if (flight.strikes !== 1) errors.push('space: the strike did not launch');
  const boom = await ps.evaluate(() => {
    const S = window.__skyline, w = S.world;
    let n = 0;
    while (w.meteors.strikes.length && n < 120) { S.tick(1); n++; }
    return { landed: !w.meteors.strikes.length, ticks: n };
  });
  if (!boom.landed) errors.push('space: the meteor never landed');
  // Toward the burst, turned a little so the mech does not stand in front of it.
  await ps.evaluate(() => { const S = window.__skyline; const d = { x: -S.world.fighters[0].pos.x, z: -S.world.fighters[0].pos.z }; S.look.yaw = Math.atan2(-d.x, -d.z) - 0.3; S.look.pitch = 0.08; });
  await frames(6);
  await ps.screenshot({ path: path.join(outDir, '20-space-burst.png') });
  console.log(`  saved 20-space-burst.png; landed after ${boom.ticks} more ticks`);
  await ps.close();
}

// Postcard views (with bloom): the north ramp and deck from the street, the skyline from above, and the moon.
for (const [name, q] of [['06-highway', 'pos=0,0,40&look=3.14159,-0.05'], ['07-skyline', 'pos=-60,180,120&look=0.6,-0.55'], ['13-moon', 'stage=moon&pos=0,0,40&look=3.14159,-0.02'], ['14-moon-sky', 'stage=moon&dummy=idle&pos=480,100,480&look=0.25,0.5']]) {
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await p2.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&${q}`, { timeout: 60000 });
  await p2.waitForFunction(() => window.__skyline, null, { timeout: 30000 });
  await p2.evaluate(() => window.__skyline.startBattle());
  await p2.waitForFunction(() => window.__skyline.world.tick > 3, null, { timeout: 30000 });
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`  saved ${name}.png`);
  await p2.close();
}
console.log(`  headless fps ≈ ${fps} without bloom (SwiftShader; real GPUs are far faster)`);
console.log(errors.length ? `console problems:\n  ${errors.join('\n  ')}` : 'no console errors or warnings');
await browser.close();
server.close();
