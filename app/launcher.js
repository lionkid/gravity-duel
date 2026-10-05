/* Gravity Duel - desktop launcher. Packaged into GravityDuel.exe as a Node single executable app,
 * but also runs as plain `node app/launcher.js` for development.
 *
 * The macOS app bundle runs it with the official Node binary instead (see tools/build-mac.js).
 *
 * 1. If this computer already runs a Gravity Duel server, just open the game again.
 * 2. Otherwise start the LAN server on the first free port from 8080 and open the game window
 *    (an Edge or Chrome app window when one is installed, the default browser otherwise).
 * Flags: --port <n>  --no-browser
 *        --idle-exit <s>  quit once no game page has checked in for s seconds and nobody is in the
 *                         room. The macOS app uses it because it has no console window to close. */
'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { createRequire } = require('module');

// In the packaged exe the game files sit next to the executable; in development, one folder up.
let isSea = false;
try { isSea = require('node:sea').isSea(); } catch (e) { isSea = false; }
const baseDir = isSea ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const lan = createRequire(path.join(baseDir, 'server', 'launcher-require.js'))('./lan-server.js');

const args = process.argv.slice(isSea ? 1 : 2);
const flag = (name) => args.includes(name);
const portArg = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : 0; })();
const FIRST_PORT = portArg || 8080;
const idleExit = (() => { const i = args.indexOf('--idle-exit'); return i >= 0 ? Number(args[i + 1]) || 0 : 0; })();

if (process.platform === 'win32') process.title = 'Gravity Duel';

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/info', timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body).app === 'gravity-duel'); } catch (e) { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function listen(server, port) {
  return new Promise((resolve) => {
    const onError = () => { server.removeListener('listening', onOk); resolve(false); };
    const onOk = () => { server.removeListener('error', onError); resolve(true); };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, '0.0.0.0');
  });
}

function edgePath() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Chromium browsers on macOS that can open a borderless app window.
const MAC_APP_BROWSERS = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'];
function macBrowser() {
  const homeApps = path.join(process.env.HOME || '', 'Applications');
  for (const name of MAC_APP_BROWSERS) {
    if (['/Applications', homeApps].some((d) => fs.existsSync(path.join(d, `${name}.app`)))) return name;
  }
  return null;
}

function openGame(url) {
  if (flag('--no-browser')) return;
  const detached = { detached: true, stdio: 'ignore' };
  try {
    if (process.platform === 'win32') {
      const edge = edgePath();
      // An Edge app window looks like a desktop game window: no tabs, no address bar.
      if (edge) spawn(edge, [`--app=${url}`, '--window-size=1280,900'], detached).unref();
      else spawn('cmd', ['/c', 'start', '', url], Object.assign({ windowsHide: true }, detached)).unref();
    } else if (process.platform === 'darwin') {
      const browser = macBrowser();
      if (browser) spawn('open', ['-na', browser, '--args', `--app=${url}`, '--window-size=1280,900'], detached).unref();
      else spawn('open', [url], detached).unref();
    } else {
      spawn('xdg-open', [url], detached).unref();
    }
  } catch (e) {
    console.log(`請用瀏覽器打開 ${url}`);
  }
}

(async () => {
  // Already running? Reuse it instead of starting a second server.
  for (let port = FIRST_PORT; port < FIRST_PORT + 20; port++) {
    if (await probe(port)) {
      const url = `http://localhost:${port}/`;
      console.log(`Gravity Duel 已經在執行，開啟 ${url}`);
      openGame(url);
      setTimeout(() => process.exit(0), 500);
      return;
    }
  }
  let port = 0, server = null;
  for (let p = FIRST_PORT; p < FIRST_PORT + 20; p++) {
    const s = lan.createServer(p);
    if (await listen(s, p)) { server = s; port = p; break; }
  }
  if (!server) {
    console.error(`找不到可用的連接埠（${FIRST_PORT} 到 ${FIRST_PORT + 19}）。`);
    process.exitCode = 1;
    return;
  }
  const url = `http://localhost:${port}/`;
  console.log('==============================================');
  console.log('  GRAVITY DUEL  遊戲伺服器執行中');
  console.log('==============================================');
  console.log(`  這台電腦：${url}`);
  for (const u of lan.lanAddresses(port)) console.log(`  區網位址：${u}`);
  console.log('');
  console.log('  區域網路對戰：雙方都打開 Gravity Duel，選「區域網路對戰」。');
  console.log('  一台建立房間，另一台會在列表中自動看到它。');
  console.log('');
  if (idleExit) {
    console.log(`  遊戲畫面全部關閉約 ${Math.round(idleExit / 60)} 分鐘後，伺服器會自動結束。`);
    setInterval(() => {
      if (server.idleMs() < idleExit * 1000) return;
      console.log('沒有遊戲畫面在使用，伺服器結束。');
      process.exit(0);
    }, 5000).unref();
  } else {
    console.log('  關閉這個視窗就會結束遊戲伺服器。');
  }
  openGame(url);
})();
