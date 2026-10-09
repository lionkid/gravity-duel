/* Builds the claude.ai artifact variant of Gravity Duel: Skyline. The artifact page sits at the root
 * of its own origin (not at games/skyline/), and the publisher wraps it in a document skeleton, so this
 * strips the html/head/body shell and the ../../ prefixes. Also prints the list of files to publish
 * with it. Usage: node tools/skyline-artifact.js [out.html] */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'build', 'artifact', 'skyline.html');
const src = fs.readFileSync(path.join(root, 'games', 'skyline', 'index.html'), 'utf8');
let head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'));
head = head.replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '').replace(/<link rel="icon"[^>]*>\s*/, '');
// Import map values must be URLs: "./vendor/..." works, a bare "vendor/..." is silently ignored.
const page = (head.trim() + '\n' + body.trim() + '\n')
  .replace(/\.\.\/\.\.\//g, './')
  .replace('src="./main.js"', 'src="./games/skyline/main.js"');
const importMap = JSON.parse(page.match(/<script type="importmap">\s*([\s\S]*?)<\/script>/)[1]);
for (const [k, v] of Object.entries(importMap.imports)) {
  if (!/^(\.\/|\.\.\/|\/|https?:)/.test(v)) throw new Error(`import map entry ${k} → ${v} is not a URL`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);

// Every module the page can import, plus the vendored Three.js (tests excluded).
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { if (name !== 'tests') walk(p); } else if (name.endsWith('.js')) files.push(path.relative(root, p));
  }
};
walk(path.join(root, 'engine'));
walk(path.join(root, 'games', 'skyline'));
files.push('vendor/three/three.module.js', 'vendor/three/addons.js');
console.log(out);
console.log(JSON.stringify(files.map((p) => ({ path: p }))));
