/* Copies the Three.js runtime the 3D games use into vendor/three/ as two minified ES modules:
 *   vendor/three/three.module.js   the library (three.module.js + three.core.js bundled into one file)
 *   vendor/three/addons.js         the addons we use (post-processing), importing 'three' through the import map
 * The games load them through an import map, so LAN play needs no internet and the pinned version lives in git.
 * Run after changing the three version in package.json: npm run vendor */
'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const threeDir = path.join(root, 'node_modules', 'three');
const out = path.join(root, 'vendor', 'three');
const build = path.join(root, 'build');
const version = require(path.join(threeDir, 'package.json')).version;
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(build, { recursive: true });

// Addons are listed here; add to this list when a game needs another one.
const ADDONS = {
  'postprocessing/EffectComposer.js': ['EffectComposer'],
  'postprocessing/RenderPass.js': ['RenderPass'],
  'postprocessing/UnrealBloomPass.js': ['UnrealBloomPass'],
  'postprocessing/OutputPass.js': ['OutputPass'],
  'postprocessing/ShaderPass.js': ['ShaderPass'],
};
const entry = path.join(build, 'vendor-addons-entry.js');
fs.writeFileSync(entry, Object.entries(ADDONS).map(([file, names]) =>
  `export { ${names.join(', ')} } from ${JSON.stringify(path.join(threeDir, 'examples', 'jsm', file))};`).join('\n') + '\n');

const banner = `/* three.js r${version} — MIT License, see LICENSE in this folder. Bundled by tools/vendor-three.js */`;
esbuild.buildSync({
  entryPoints: [path.join(threeDir, 'build', 'three.module.js')],
  bundle: true, format: 'esm', minify: true, legalComments: 'none', banner: { js: banner },
  outfile: path.join(out, 'three.module.js'),
});
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true, format: 'esm', minify: true, legalComments: 'none', banner: { js: banner },
  external: ['three'],              // the addons keep importing 'three' so both files share one copy
  outfile: path.join(out, 'addons.js'),
});
fs.copyFileSync(path.join(threeDir, 'LICENSE'), path.join(out, 'LICENSE'));
fs.writeFileSync(path.join(out, 'VERSION'), `${version}\n`);

const addons = fs.readFileSync(path.join(out, 'addons.js'), 'utf8');
if (!/from\s*"three"/.test(addons)) throw new Error('addons.js does not import "three": the bundle duplicated the library');
for (const f of ['three.module.js', 'addons.js']) {
  console.log(`vendor/three/${f}  ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`);
}
console.log(`three r${version}`);
