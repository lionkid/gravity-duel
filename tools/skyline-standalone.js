/* Builds Gravity Duel: Skyline as one self-contained HTML file that plays straight from the disk:
 * double-click it and it opens in the browser, with no server and nothing to install (only the web
 * fonts come from the internet; offline the page falls back to system fonts). Opened as a page of its
 * own it can capture the mouse, which embedded pages may refuse.
 *
 * Every module rides inside the import map as a data: URL. A data: module cannot resolve a relative
 * path, so relative imports are rewritten to "@skyline/<path from the repository root>" names that the
 * map resolves. LAN play needs the Gravity Duel server, so the file offers single player and practice.
 * Usage: node tools/skyline-standalone.js [out.html] */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'build', 'standalone', 'GravityDuel-Skyline.html');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Every module the page can import (tests excluded), by its path from the repository root.
const modules = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
    const p = `${dir}/${name}`;
    if (fs.statSync(path.join(root, p)).isDirectory()) { if (name !== 'tests') walk(p); } else if (name.endsWith('.js')) modules.push(p);
  }
};
walk('engine');
walk('games/skyline');

const nameOf = (p) => `@skyline/${p}`;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
const RELATIVE = /(\b(?:import|export)\b[^'";]*?\bfrom\s*)(['"])(\.\.?\/[^'"]+)\2/g;
const imports = {
  three: dataUrl(read('vendor/three/three.module.js')),
  'three-addons': dataUrl(read('vendor/three/addons.js')),
};
for (const m of modules) {
  const code = read(m).replace(RELATIVE, (all, head, q, spec) => {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(m), spec));
    if (!modules.includes(target)) throw new Error(`${m} imports ${spec}, which is not part of the build`);
    return `${head}${q}${nameOf(target)}${q}`;
  });
  if (RELATIVE.test(code)) throw new Error(`${m}: a relative import was left behind`);
  RELATIVE.lastIndex = 0;
  imports[nameOf(m)] = dataUrl(code);
}

let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* not a checkout */ }
const version = (read('games/skyline/config.js').match(/version:\s*'([^']+)'/) || [])[1] || '';
const icon = fs.existsSync(path.join(root, 'assets/icon.png')) ? `data:image/png;base64,${fs.readFileSync(path.join(root, 'assets/icon.png')).toString('base64')}` : '';

const src = read('games/skyline/index.html');
const swap = (text, pattern, replacement) => {
  if (!pattern.test(text)) throw new Error(`index.html: ${pattern} not found`);
  return text.replace(pattern, () => replacement);
};
let page = src;
page = swap(page, /<!doctype html>\n/i, `<!doctype html>\n<!-- Gravity Duel: Skyline ${version}${commit ? ` (${commit})` : ''}: single-file build by tools/skyline-standalone.js. Double-click to play. -->\n`);
page = icon ? swap(page, /<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}">`) : page.replace(/<link rel="icon"[^>]*>\n?/, '');
page = swap(page, /<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${JSON.stringify({ imports })}\n</script>`);
page = swap(page, /<script type="module" src="\.\/main\.js" id="boot"><\/script>/, `<script type="module" id="boot">import '${nameOf('games/skyline/main.js')}';</script>`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out}  ${(page.length / 1048576).toFixed(2)} MB, ${modules.length + 2} modules`);
