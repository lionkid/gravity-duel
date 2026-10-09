/* Builds the Windows release from Linux, macOS or Windows:
 *   dist/GravityDuel-Setup-<version>.exe       installer (NSIS)
 *   dist/GravityDuel-<version>-win-x64.zip      portable version
 * Steps: download the official Windows node.exe of this exact Node version, pack app/launcher.js
 * into it as a single executable app, set its icon and version info, then stage the game files
 * next to it and run makensis. Needs: Node 20+, curl, unzip, zip, makensis, `npm install` done.
 * makensis: `brew install makensis` (macOS) or `sudo apt install nsis` (Debian/Ubuntu). Homebrew's
 * NSIS has no 64-bit stubs, so a macOS build makes a 32-bit installer; it works the same on 64-bit Windows.
 * Run: npm run build:win */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const VERSION = pkg.version;
const NODE = process.version;                 // the SEA blob must come from the same Node version
const build = path.join(root, 'build');
const cache = path.join(build, 'cache');
const stage = path.join(build, 'stage');
const dist = path.join(root, 'dist');
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
const step = (msg) => console.log(`\n== ${msg}`);

// Check the tools first, so a missing one stops the build with a hint instead of halfway through.
const has = (cmd) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? [cmd] : ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
};
const INSTALL_HINT = {
  darwin: { makensis: 'brew install makensis' },
  linux: { makensis: 'sudo apt install nsis', zip: 'sudo apt install zip', unzip: 'sudo apt install unzip', curl: 'sudo apt install curl' },
};
const missing = ['curl', 'unzip', 'zip', 'makensis'].filter((t) => !has(t));
for (const mod of ['postject/dist/cli.js', 'resedit']) {
  try { require.resolve(mod); } catch (e) { missing.push(`npm:${mod.split('/')[0]}`); }
}
if (missing.length) {
  console.error('缺少建置 Windows 版需要的工具：');
  for (const t of missing) {
    const hint = t.startsWith('npm:') ? 'npm install' : (INSTALL_HINT[process.platform] || {})[t];
    console.error(`  - ${t.replace('npm:', '')}${hint ? `：請執行 ${hint}` : ''}`);
  }
  if (process.platform === 'win32') console.error('在 Windows 上建議用 WSL，或到 GitHub Actions 執行 Release workflow。');
  process.exit(1);
}

for (const d of [build, cache, dist]) fs.mkdirSync(d, { recursive: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 1. Official Windows Node runtime.
const zipName = `node-${NODE}-win-x64.zip`;
const zipPath = path.join(cache, zipName);
const nodeExe = path.join(cache, `node-${NODE}.exe`);
const nodeLicense = path.join(cache, `node-${NODE}-LICENSE`);
if (!fs.existsSync(nodeExe) || !fs.existsSync(nodeLicense)) {
  step(`download ${zipName}`);
  if (!fs.existsSync(zipPath)) run('curl', ['-fL', '--retry', '3', '-o', zipPath, `https://nodejs.org/dist/${NODE}/${zipName}`]);
  run('unzip', ['-o', '-j', zipPath, `node-${NODE}-win-x64/node.exe`, `node-${NODE}-win-x64/LICENSE`, '-d', cache]);
  fs.renameSync(path.join(cache, 'node.exe'), nodeExe);
  fs.renameSync(path.join(cache, 'LICENSE'), nodeLicense);
}

// 2. Single executable application blob from the launcher.
step('build SEA blob');
const seaConfig = path.join(build, 'sea-config.json');
const blob = path.join(build, 'sea-prep.blob');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(root, 'app', 'launcher.js'),
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,         // keep the blob platform-neutral so Linux can build for Windows
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfig]);

// 3. Inject the blob into a copy of the official node.exe (its signature no longer applies after this).
step('inject launcher into GravityDuel.exe');
const exePath = path.join(stage, 'GravityDuel.exe');
fs.copyFileSync(nodeExe, exePath);
run(process.execPath, [require.resolve('postject/dist/cli.js'), exePath, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite']);

// 4. Icon and version info. Done after injection: resedit keeps the NODE_SEA_BLOB resource.
step('set icon and version info');
const ResEdit = require('resedit');
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets', 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, glang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, ico.icons.map((i) => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
const [a, b, c] = VERSION.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
const lang = vi.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
vi.setStringValues(lang, {
  ProductName: 'Gravity Duel', FileDescription: 'Gravity Duel', CompanyName: 'Gravity Duel',
  InternalName: 'GravityDuel', OriginalFilename: 'GravityDuel.exe', LegalCopyright: 'Gravity Duel',
  FileVersion: VERSION, ProductVersion: VERSION,
});
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
const check = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true }));
const sea = check.entries.find((e) => e.type === 10 && e.id === 'NODE_SEA_BLOB');
if (!sea || sea.bin.byteLength !== fs.statSync(blob).size) throw new Error('SEA blob missing after editing resources');
if (!fs.readFileSync(exePath).includes('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1')) throw new Error('SEA fuse not set');
console.log('SEA blob and fuse verified');

// 5. Game files next to the executable.
step('stage game files');
const copy = (rel) => {
  const from = path.join(root, rel), to = path.join(stage, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};
['index.html', 'hub.html', 'src', 'engine', 'games', 'vendor', 'server/lan-server.js', 'assets/icon.ico', 'assets/icon.png', 'README.md'].forEach(copy);
// GravityDuel.exe is built from Node.js, so its license travels with it.
fs.copyFileSync(nodeLicense, path.join(stage, 'node-LICENSE.txt'));

// 6. Installer and portable zip.
step('makensis');
const setup = path.join(dist, `GravityDuel-Setup-${VERSION}.exe`);
run('makensis', ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${VERSION}`, `-DSTAGE=${stage}`, `-DOUTFILE=${setup}`,
  `-DICON=${path.join(root, 'assets', 'icon.ico')}`, path.join(root, 'installer', 'gravity-duel.nsi')]);
step('portable zip');
const portable = path.join(dist, `GravityDuel-${VERSION}-win-x64.zip`);
fs.rmSync(portable, { force: true });
run('zip', ['-qr', portable, '.'], { cwd: stage });

for (const f of [setup, portable]) console.log(`${path.relative(root, f)}  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
