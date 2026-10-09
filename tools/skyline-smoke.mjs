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
  await p3.evaluate(() => { window.__skyline.world.fighters[1].hp = 1; });
  await p3.keyboard.press('Digit1');
  await p3.waitForFunction(() => window.__skyline.world.fighters[0].switchTimer === 0 && window.__skyline.world.fighters[0].active === 'melee', null, { timeout: 10000 });
  await p3.keyboard.press('KeyJ');
  await p3.waitForFunction(() => { const m = window.__skyline.world.fighters[0].melee; return m && (m.stage === 'active' || m.stage === 'recovery'); }, null, { timeout: 10000 }).catch(() => {});
  await p3.screenshot({ path: path.join(outDir, '10-melee.png') });
  console.log('  saved 10-melee.png');
  console.log(`  opponent hp after melee: ${await p3.evaluate(() => window.__skyline.world.fighters[1].hp)}`);
  await p3.waitForFunction(() => window.__skyline.ui.name === 'ko', null, { timeout: 10000 }).catch(() => {});
  await p3.screenshot({ path: path.join(outDir, '12-ko.png') });
  console.log(`  saved 12-ko.png (screen ${await p3.evaluate(() => window.__skyline.ui.name)})`);
  await p3.close();
}

// Touch controls on a touch device: the overlay shows during play, a tapped button fires the vulcan.
{
  const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 1024, height: 600 } });
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
    await new Promise((res) => setTimeout(res, 700));
    const heat = window.__skyline.world.fighters[0].heat;
    btn.dispatchEvent(ev('pointerup'));
    return { down, heat: +heat.toFixed(2), shown: !document.getElementById('touch').hidden };
  });
  await pt.screenshot({ path: path.join(outDir, '15-touch.png') });
  console.log('  saved 15-touch.png; touch attack:', fired);
  if (!fired.down || !(fired.heat > 0)) errors.push(`touch attack did not fire (${JSON.stringify(fired)})`);
  await ctx.close();
}

// Postcard views (with bloom): the north ramp and deck from the street, the skyline from above, and the moon.
for (const [name, q] of [['06-highway', 'pos=0,0,40&look=3.14159,-0.05'], ['07-skyline', 'pos=-60,180,120&look=0.6,-0.55'], ['13-moon', 'stage=moon&pos=0,0,40&look=3.14159,-0.02'], ['14-moon-sky', 'stage=moon&pos=-40,90,120&look=0.5,-0.3']]) {
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
