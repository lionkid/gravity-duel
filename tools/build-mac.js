/* Builds the macOS release from Linux or macOS:
 *   dist/GravityDuel-<version>-mac.dmg    disk image with "Gravity Duel.app" (Apple silicon and Intel)
 * The app bundle holds the official, Apple-notarized Node binaries for arm64 and x64 unchanged, plus
 * the game files; Contents/MacOS/GravityDuel is a small shell script that starts app/launcher.js with
 * the Node binary that matches the Mac. Nothing inside the bundle is modified binary code, so no
 * re-signing is needed. The bundle itself is unsigned: the first launch needs "Open Anyway".
 * Needs: Node 20+, curl, tar, genisoimage (or mkisofs / xorrisofs) and the `dmg` tool from
 * libdmg-hfsplus (on PATH, or DMG_TOOL=/path/to/dmg). On macOS, hdiutil is used instead.
 * Run: npm run build:mac */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const VERSION = pkg.version;
const NODE = process.version;
const APP = 'Gravity Duel';
const build = path.join(root, 'build');
const cache = path.join(build, 'cache');
const dmgRoot = path.join(build, 'mac');
const dist = path.join(root, 'dist');
const ARCHES = ['arm64', 'x64'];
const run = (cmd, args, opts) => execFileSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
const step = (msg) => console.log(`\n== ${msg}`);
const has = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }); return true; } catch (e) { return false; } };

for (const d of [build, cache, dist]) fs.mkdirSync(d, { recursive: true });
fs.rmSync(dmgRoot, { recursive: true, force: true });

// 1. Official macOS Node runtimes, checked against the release's SHASUMS256.txt.
const sums = path.join(cache, `SHASUMS256-${NODE}.txt`);
if (!fs.existsSync(sums)) run('curl', ['-fsSL', '--retry', '3', '-o', sums, `https://nodejs.org/dist/${NODE}/SHASUMS256.txt`]);
const expected = Object.fromEntries(fs.readFileSync(sums, 'utf8').trim().split('\n').map((l) => l.split(/\s+/).reverse()));
const nodeBin = {};
for (const arch of ARCHES) {
  const name = `node-${NODE}-darwin-${arch}`;
  const tgz = path.join(cache, `${name}.tar.gz`);
  nodeBin[arch] = path.join(cache, name);
  if (fs.existsSync(path.join(nodeBin[arch], 'bin', 'node'))) continue;
  step(`download ${name}.tar.gz`);
  if (!fs.existsSync(tgz)) run('curl', ['-fL', '--retry', '3', '-o', tgz, `https://nodejs.org/dist/${NODE}/${name}.tar.gz`]);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  if (sha !== expected[`${name}.tar.gz`]) { fs.rmSync(tgz); throw new Error(`checksum mismatch for ${name}.tar.gz`); }
  run('tar', ['-xzf', tgz, '-C', cache, `${name}/bin/node`, `${name}/LICENSE`]);
}

// 2. The app bundle.
step(`assemble ${APP}.app`);
const contents = path.join(dmgRoot, `${APP}.app`, 'Contents');
const res = path.join(contents, 'Resources');
const game = path.join(res, 'game');
const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(to, from), { recursive: true });
for (const d of [path.join(contents, 'MacOS'), game]) fs.mkdirSync(d, { recursive: true });
for (const f of ['index.html', 'src', 'server/lan-server.js', 'app/launcher.js', 'README.md']) copy(f, game);
fs.copyFileSync(path.join(root, 'assets', 'icon.icns'), path.join(res, 'icon.icns'));
for (const arch of ARCHES) {
  fs.mkdirSync(path.join(res, 'node', arch), { recursive: true });
  fs.copyFileSync(path.join(nodeBin[arch], 'bin', 'node'), path.join(res, 'node', arch, 'node'));
  fs.chmodSync(path.join(res, 'node', arch, 'node'), 0o755);
}
fs.copyFileSync(path.join(nodeBin.arm64, 'LICENSE'), path.join(res, 'node', 'LICENSE'));

// The bundle executable. It starts the launcher in the background and returns at once, so macOS does
// not keep the app "running": every double-click runs it again, and a second launch only reopens the
// game window. The server quits by itself 5 minutes after the last game window closes.
const launcher = path.join(contents, 'MacOS', 'GravityDuel');
fs.writeFileSync(launcher, `#!/bin/sh
# ${APP} for macOS: start the game with the bundled Node runtime that fits this Mac.
res="$(cd "$(dirname "$0")/../Resources" && pwd)"
arch="$(uname -m)"
# Under Rosetta uname reports x86_64; use the native runtime whenever the chip is Apple silicon.
[ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] && arch=arm64
if [ "$arch" = "arm64" ]; then node="$res/node/arm64/node"; else node="$res/node/x64/node"; fi
log="$HOME/Library/Logs/Gravity Duel.log"
mkdir -p "$HOME/Library/Logs"
nohup "$node" "$res/game/app/launcher.js" --idle-exit 300 "$@" >>"$log" 2>&1 &
`);
fs.chmodSync(launcher, 0o755);

const plist = {
  CFBundleDevelopmentRegion: 'zh_TW',
  CFBundleName: APP,
  CFBundleDisplayName: APP,
  CFBundleIdentifier: 'io.github.lionkid.gravityduel',
  CFBundleExecutable: 'GravityDuel',
  CFBundleIconFile: 'icon',
  CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: VERSION,
  CFBundleVersion: VERSION,
  LSApplicationCategoryType: 'public.app-category.action-games',
  LSMinimumSystemVersion: '11.0',
  LSUIElement: true,               // no Dock icon: the game itself runs in a browser window
  NSHighResolutionCapable: true,
  NSLocalNetworkUsageDescription: 'Gravity Duel 會在區域網路上廣播與尋找對戰房間，讓同一個網路的玩家可以連線對打。',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const entries = Object.entries(plist).map(([k, v]) =>
  `\t<key>${k}</key>\n\t${typeof v === 'boolean' ? `<${v}/>` : `<string>${esc(v)}</string>`}`).join('\n');
fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>
`);
fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????');

// 3. Disk image contents: the app, a link to /Applications to drag it onto, and a short guide.
fs.symlinkSync('/Applications', path.join(dmgRoot, 'Applications'));
fs.writeFileSync(path.join(dmgRoot, 'README.txt'), '﻿' + `${APP} ${VERSION} for macOS

安裝
  把「${APP}」拖到「Applications」（應用程式）資料夾。

第一次開啟
  這個 App 沒有經過 Apple 公證，第一次開啟會被擋下：
  1. 在「應用程式」資料夾雙擊 ${APP}，出現警告時按「完成」或「好」。
  2. 打開「系統設定」→「隱私權與安全性」，往下捲到「安全性」，按「${APP}」旁的「強制打開」。
  3. 再按一次「打開」並輸入密碼。之後就能直接開啟。
  macOS 14 以前的版本也可以按住 Control 點 App，選「打開」。

區域網路對戰
  第一次使用時 macOS 會詢問是否允許 ${APP} 尋找區域網路上的裝置，請按「允許」，
  否則看不到其他玩家的房間。

遊戲會在 Chrome 或 Edge 的視窗中開啟（沒有安裝時用預設瀏覽器）。
關閉遊戲視窗 5 分鐘後，背景的遊戲伺服器會自動結束。
需要 macOS 11 或更新版本，支援 Apple 晶片與 Intel Mac。
`);

// 4. Compressed UDIF disk image.
step('disk image');
const dmg = path.join(dist, `GravityDuel-${VERSION}-mac.dmg`);
fs.rmSync(dmg, { force: true });
if (process.platform === 'darwin') {
  // hdiutil sometimes fails with "Resource busy" on busy machines; a retry usually succeeds.
  for (let attempt = 1; ; attempt++) {
    try {
      run('hdiutil', ['create', '-volname', APP, '-srcfolder', dmgRoot, '-fs', 'HFS+', '-format', 'UDZO', '-ov', dmg]);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`hdiutil failed, retrying (${attempt})`);
      execFileSync('sleep', [String(attempt * 5)]);
    }
  }
} else {
  // ISO 9660 with Rock Ridge keeps long names, execute bits and the symlink; macOS mounts it as a disk.
  const iso = path.join(build, 'mac.iso');
  const mkiso = ['genisoimage', 'mkisofs', 'xorrisofs'].find(has);
  if (!mkiso) throw new Error('needs genisoimage, mkisofs or xorrisofs');
  run(mkiso, ['-quiet', '-D', '-l', '-r', '-dir-mode', '0755', '-no-pad', '-V', APP, '-o', iso, dmgRoot]);
  const dmgTool = process.env.DMG_TOOL || 'dmg';
  if (!process.env.DMG_TOOL && !has('dmg')) throw new Error('needs the dmg tool from libdmg-hfsplus (set DMG_TOOL)');
  run(dmgTool, [iso, dmg], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.rmSync(iso);
}
console.log(`${path.relative(root, dmg)}  ${(fs.statSync(dmg).size / 1048576).toFixed(1)} MB`);
