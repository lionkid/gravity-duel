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
await page.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&debug`);
await page.waitForFunction(() => window.__skyline && window.__skyline.world.tick > 5, null, { timeout: 30000 });
console.log(`page ready in ${Date.now() - t0} ms`);
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(`  saved ${name}.png`); };
const state = () => page.evaluate(() => { const f = window.__skyline.world.fighters[0]; return { tick: window.__skyline.world.tick, x: +f.pos.x.toFixed(1), y: +f.pos.y.toFixed(1), z: +f.pos.z.toFixed(1), ground: f.onGround, fuel: +f.fuel.toFixed(2) }; });

await shot('01-title');
await page.evaluate(() => window.__skyline.setPlaying(true));
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await shot('02-running');
console.log('  after running:', await state());
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
// Postcard views: the north ramp and deck from the street, and the skyline from above.
for (const [name, q] of [['06-highway', 'pos=0,0,40&look=3.14159,-0.05'], ['07-skyline', 'pos=-60,180,120&look=0.6,-0.55']]) {
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await p2.goto(`http://127.0.0.1:${port}/games/skyline/?seed=7&${q}`);
  await p2.waitForFunction(() => window.__skyline && window.__skyline.world.tick > 3, null, { timeout: 30000 });
  await p2.evaluate(() => window.__skyline.setPlaying(true));
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`  saved ${name}.png`);
  await p2.close();
}
const fps = await page.evaluate(() => document.querySelector('#hud .debug').textContent.split(' fps')[0]);
console.log(`  headless fps ≈ ${fps} (SwiftShader; real GPUs are far faster)`);
console.log(errors.length ? `console problems:\n  ${errors.join('\n  ')}` : 'no console errors or warnings');
await browser.close();
server.close();
