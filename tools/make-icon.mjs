// Renders assets/icon.svg to PNG sizes with a headless browser and packs them into assets/icon.ico.
// ICO entries may hold PNG data directly (Windows Vista and later). Run: node tools/make-icon.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = await import(path.join(process.env.PLAYWRIGHT_GLOBAL || '/opt/node22/lib/node_modules', 'playwright/index.mjs')));
}
const svg = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const page = await browser.newPage();
const pngs = [];
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  pngs.push(await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
}
await browser.close();
fs.writeFileSync(path.join(root, 'assets/icon.png'), pngs[pngs.length - 1]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const e = i * 16;
  dir[e] = s >= 256 ? 0 : s; dir[e + 1] = s >= 256 ? 0 : s;     // 0 means 256
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, dir, ...pngs]));
console.log('wrote assets/icon.ico and assets/icon.png');
