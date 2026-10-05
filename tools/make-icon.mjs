// Renders assets/icon.svg to PNG sizes with a headless browser and packs them into assets/icon.ico
// (Windows) and assets/icon.icns (macOS). Both formats may hold PNG data directly.
// Run: node tools/make-icon.mjs
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
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const browser = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const page = await browser.newPage();
const png = {};
for (const s of sizes) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  png[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
fs.writeFileSync(path.join(root, 'assets/icon.png'), png[256]);

// ICO: up to 256 px.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = icoSizes.map((s) => png[s]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
const dir = Buffer.alloc(16 * icoSizes.length);
let offset = 6 + dir.length;
icoSizes.forEach((s, i) => {
  const e = i * 16;
  dir[e] = s >= 256 ? 0 : s; dir[e + 1] = s >= 256 ? 0 : s;     // 0 means 256
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, dir, ...pngs]));

// ICNS: 'icns' + total length, then one (type, length, PNG) chunk per size. The @2x types share sizes.
const icnsTypes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512], ['ic10', 1024]];
const chunks = icnsTypes.map(([type, s]) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1'); head.writeUInt32BE(8 + png[s].length, 4);
  return Buffer.concat([head, png[s]]);
});
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'latin1');
icnsHead.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
fs.writeFileSync(path.join(root, 'assets/icon.icns'), Buffer.concat([icnsHead, ...chunks]));
console.log('wrote assets/icon.ico, assets/icon.icns and assets/icon.png');
