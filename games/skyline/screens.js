// Skyline's menu screens: title, difficulty, loadout, LAN room browser and room, pause, KO, help and
// settings. Templates plus action handlers; the game passes its state and callbacks in through `ctx`:
//   { loadout, cpuLoadout, cpuLevel, settings, sfx, note, version, lan (lobby state), lanDraft,
//     startBattle(), resume(), quit(), rerollCpu(), saveSettings(), applySettings(),
//     lanBrowse(), lanConnect(base), lanLeave(), lanReady(on), lanAgain(), lanLobby(), lanPickChanged(), isLan(), isHost() }

import { esc } from '../../engine/ui/screens.js';
import * as CFG from './config.js';
import { AI_LEVELS, AI_ORDER } from './ai/brain.js';

const LEVEL_DESC = { easy: '反應慢、瞄不準，適合先熟悉操作', normal: '會閃躲、會防禦、會上樓頂', hard: '反應快、瞄得準、連段不手軟' };
const loadoutText = (l) => (l ? `${CFG.WEAPON_CLASSES[l.weapon].zh}武裝 · ${CFG.ARMORS[l.armor].zh}` : '…');
const logo = () => `<h1 class="logo">GRAVITY DUEL<span>SKYLINE</span></h1>`;
const panel = (cls, html) => `<div class="panel ${cls}">${html}</div>`;
const btn = (act, label, { cls = '', attrs = '' } = {}) => `<button type="button" class="mbtn ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
const note = (text) => (text ? `<p class="note">${esc(text)}</p>` : '');

export function defineScreens(ui, ctx) {
  const back = () => { ctx.sfx.play('menuBack'); ui.back(); };
  const open = (name) => () => { ctx.sfx.play('menuOk'); ui.show(name); };

  ui.define('title', () => ({
    html: panel('', `${logo()}
      <p class="sub">重力決定彈道的機甲一對一。城市街道、高架道路、大樓屋頂，從傍晚打到天黑。</p>
      <div class="menu">
        ${btn('solo', '單人對戰', { cls: 'primary' })}
        ${btn('lan', `區域網路對戰 <small>${ctx.lan.server ? '同一個網路的兩台電腦' : '需要 Gravity Duel 伺服器（npm run dev 或桌面版）'}</small>`, { attrs: ctx.lan.server ? '' : 'disabled' })}
        ${btn('help', '操作說明')}
        ${btn('settings', '設定')}
      </div>
      ${note(ctx.note)}
      <p class="foot">v${esc(ctx.version)} · 滑鼠靈敏度與音量在「設定」</p>`),
    actions: { solo: open('cpu'), lan: () => { ctx.sfx.play('menuOk'); ctx.lanBrowse(); ui.show('lan'); }, help: open('help'), settings: open('settings') },
  }));

  ui.define('cpu', () => ({
    html: panel('', `${logo()}
      <h2>對手強度</h2>
      <div class="menu">
        ${AI_ORDER.map((id) => btn('pick', `${AI_LEVELS[id].zh}<small>${esc(LEVEL_DESC[id])}</small>`, { cls: ctx.cpuLevel === id ? 'on' : '', attrs: `data-level="${id}"` })).join('')}
      </div>
      <div class="row-end">${btn('back', '返回')}</div>`),
    actions: {
      pick: (d) => { ctx.cpuLevel = d.level; ctx.saveSettings(); ctx.sfx.play('menuOk'); ui.show('loadout'); },
      back, escape: back,
    },
  }));

  ui.define('loadout', () => ({
    html: panel('', `${logo()}
      <h2>武裝配置</h2>
      <div class="picker">
        ${pickerRow('weapon', CFG.WEAPON_CLASSES, '武裝', ctx.loadout.weapon)}
        ${pickerRow('armor', CFG.ARMORS, '裝甲', ctx.loadout.armor)}
      </div>
      <p class="pickdesc">${esc(CFG.WEAPON_CLASSES[ctx.loadout.weapon].desc)}。${esc(CFG.ARMORS[ctx.loadout.armor].desc)}。</p>
      <p class="cpu">對手：${esc(loadoutText(ctx.cpuLoadout))} · ${esc(AI_LEVELS[ctx.cpuLevel].zh)} ${btn('reroll', '換一組', { cls: 'small' })}</p>
      ${note(ctx.note)}
      <div class="row-end">${btn('back', '返回')}${btn('start', '開始對戰', { cls: 'primary' })}</div>`),
    actions: {
      opt: (d) => { ctx.loadout[d.kind] = d.id; ctx.saveSettings(); ctx.sfx.play('menuMove'); ui.refresh(); },
      reroll: () => { ctx.rerollCpu(); ctx.sfx.play('menuMove'); ui.refresh(); },
      start: () => { ctx.sfx.play('start'); ctx.startBattle(); },
      // Reached from the KO screen there is nothing underneath: go back to the title.
      back: () => { if (ui.depth <= 1) { ctx.sfx.play('menuBack'); ctx.quit(); } else back(); },
      escape: () => { if (ui.depth <= 1) { ctx.sfx.play('menuBack'); ctx.quit(); } else back(); },
    },
  }));

  // ---- LAN: the room browser. This server's room first, then rooms heard on the network.
  ui.define('lan', () => {
    const lan = ctx.lan;
    const self = lan.self;
    const rows = [];
    if (self && self.players >= 2) rows.push(`<button type="button" class="room full" disabled><b>${esc(self.name)}（這台伺服器）</b><span>已滿</span></button>`);
    else if (self && self.players === 1) rows.push(`<button type="button" class="room" data-act="join" data-url=""><b>${esc(self.name)}（這台伺服器）</b><span>有一位玩家在等對手，按下加入</span></button>`);
    else rows.push(`<button type="button" class="room primary" data-act="join" data-url=""><b>＋ 建立房間</b><span>在這台電腦開房，等對方加入（你是主機）</span></button>`);
    for (const r of lan.rooms) {
      const full = r.players >= 2;
      rows.push(`<button type="button" class="room ${full ? 'full' : ''}" data-act="join" data-url="${esc(r.url)}" ${full ? 'disabled' : ''}><b>${esc(r.name)}</b><span>${esc(r.url.replace('http://', ''))} · ${full ? '已滿' : '等待對手中，按下加入'}</span></button>`);
    }
    return {
      html: panel('', `${logo()}
        <h2>區域網路對戰</h2>
        <p class="sub">同一個網路裡的另一台電腦也打開 Gravity Duel，其中一台建立房間，另一台就會在這裡看到它。</p>
        <div class="rooms">${rows.join('')}</div>
        <p class="scan">${lan.scanned ? (lan.rooms.length ? '' : '持續搜尋其他房間…') : '搜尋中…'}</p>
        <div class="manual">
          <label for="lanAddr">找不到房間時，輸入對方畫面上的位址：</label>
          <span><input id="lanAddr" type="text" inputmode="url" placeholder="192.168.1.20:8080" autocomplete="off" value="${esc(ctx.lanDraft || '')}"><button type="button" class="mbtn small" data-act="manual">加入</button></span>
        </div>
        ${note(lan.note)}
        <div class="row-end">${btn('back', '返回')}</div>`),
      actions: {
        join: (d) => { ctx.sfx.play('menuOk'); ctx.lanConnect(d.url || ''); ui.show('room'); },
        manual: () => {
          const v = (ctx.lanDraft || '').trim();
          if (!v) return;
          ctx.sfx.play('menuOk');
          ctx.lanConnect(/^https?:\/\//.test(v) ? v : `http://${v.includes(':') ? v : `${v}:8080`}`);
          ui.show('room');
        },
        back: () => { ctx.sfx.play('menuBack'); ctx.lanLeave(); ui.back(); },
        escape: () => { ctx.sfx.play('menuBack'); ctx.lanLeave(); ui.back(); },
      },
      mount(root) {
        const box = root.querySelector('#lanAddr');
        box.addEventListener('input', () => { ctx.lanDraft = box.value; });
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-act="manual"]').click(); } });
      },
    };
  });

  // ---- LAN: inside a room. Waiting for the other player, then loadouts and ready.
  ui.define('room', () => {
    const lan = ctx.lan;
    let body;
    if (lan.phase === 'connecting') {
      body = `<p class="sub">連線中…</p>`;
    } else if (lan.phase === 'waiting' || !lan.peerLoadout) {
      const links = ctx.lanLinks();
      body = `<p class="sub">等待對手加入…　對方的畫面會自動列出這個房間；沒有的話請對方在「輸入位址」填：</p>
        <ul class="links">${links.map((u) => `<li><code>${esc(u)}</code></li>`).join('')}</ul>
        <p class="sub">你是${lan.seat === 1 ? '主機（座位 1）' : '座位 2'}。</p>`;
    } else {
      const me = lan.myReady, peer = lan.peerReady, both = me && peer;
      body = `<div class="seats">
          <div class="seat ${me ? 'ready' : ''}">
            <h3>你 · ${lan.seat === 1 ? '主機' : '座位 2'}</h3>
            <div class="picker">
              ${pickerRow('weapon', CFG.WEAPON_CLASSES, '武裝', ctx.loadout.weapon, me)}
              ${pickerRow('armor', CFG.ARMORS, '裝甲', ctx.loadout.armor, me)}
            </div>
            <p class="pickdesc">${esc(CFG.WEAPON_CLASSES[ctx.loadout.weapon].desc)}。${esc(CFG.ARMORS[ctx.loadout.armor].desc)}。</p>
            ${btn('ready', me ? '取消準備' : '準備好了', { cls: me ? '' : 'primary' })}
          </div>
          <div class="seat ${peer ? 'ready' : ''}">
            <h3>對手 · ${lan.seat === 1 ? '座位 2' : '主機'}</h3>
            <p class="peerload">${esc(loadoutText(lan.peerLoadout))}</p>
            <p class="state">${peer ? '已準備' : '還在選…'}</p>
          </div>
        </div>
        <p class="sub center">${both ? '雙方都準備好了，開始！' : '兩邊都按下準備就開始。主機是座位 1，比賽在它的電腦上計算。'}</p>`;
    }
    return {
      html: panel('wide', `${logo()}
        <h2>區域網路對戰</h2>
        ${body}
        ${note(lan.note)}
        <div class="row-end">${btn('leave', '離開房間')}</div>`),
      actions: {
        opt: (d) => { if (lan.myReady) return; ctx.loadout[d.kind] = d.id; ctx.saveSettings(); ctx.lanPickChanged(); ctx.sfx.play('menuMove'); ui.refresh(); },
        ready: () => { ctx.sfx.play(lan.myReady ? 'menuBack' : 'menuOk'); ctx.lanReady(!lan.myReady); },
        leave: () => { ctx.sfx.play('menuBack'); ctx.lanLeave(); ui.replace('lan'); ctx.lanBrowse(); },
        escape: () => { ctx.sfx.play('menuBack'); ctx.lanLeave(); ui.replace('lan'); ctx.lanBrowse(); },
      },
    };
  });

  ui.define('lanlost', () => ({
    html: panel('narrow', `<h2 class="big">對手離線</h2>
      <p class="sub">${esc(ctx.lan.note || '與對手的連線中斷了。')}</p>
      <div class="menu">
        ${btn('room', '留在房間等人', { cls: 'primary' })}
        ${btn('quit', '回到標題')}
      </div>`),
    actions: {
      room: () => { ctx.sfx.play('menuOk'); ctx.quit(true); ui.show('room'); },
      quit: () => { ctx.sfx.play('menuBack'); ctx.lanLeave(); ctx.quit(); },
    },
  }));

  ui.define('pause', () => {
    const lan = ctx.isLan();
    return {
      html: panel('narrow', `<h2 class="big">${lan ? '選單' : '暫停'}</h2>
        ${lan ? '<p class="sub">區網對戰不會暫停，對手還在打。</p>' : ''}
        <div class="menu">
          ${btn('resume', '繼續 <small>Esc</small>', { cls: 'primary' })}
          ${lan ? '' : btn('restart', '重新開始')}
          ${btn('settings', '設定')}
          ${btn('help', '操作說明')}
          ${lan ? btn('quit', '離開房間') : btn('quit', '回到標題')}
        </div>
        ${note(ctx.note)}`),
      actions: {
        resume: () => { ctx.sfx.play('menuOk'); ctx.resume(); },
        escape: () => { ctx.sfx.play('menuOk'); ctx.resume(); },
        restart: () => { ctx.sfx.play('start'); ctx.startBattle(); },
        settings: open('settings'),
        help: open('help'),
        quit: () => { ctx.sfx.play('menuBack'); if (lan) ctx.lanLeave(); ctx.quit(); },
      },
    };
  });

  ui.define('ko', (d) => {
    const lan = ctx.isLan();
    const again = lan ? (ctx.lan.againMe ? '等待對方… <small>已送出</small>' : `再戰 <small>R${ctx.lan.againPeer ? ' · 對方已按' : ''}</small>`) : '再戰 <small>R</small>';
    return {
      html: panel('narrow', `<h2 class="big ${d.win ? 'win' : 'lose'}">${d.win ? 'WIN' : 'LOSE'}</h2>
        <p class="sub">${esc(d.text || '')}</p>
        <div class="menu">
          ${btn('again', again, { cls: 'primary', attrs: lan && ctx.lan.againMe ? 'disabled' : '' })}
          ${btn('loadout', '換配置')}
          ${lan ? btn('quit', '離開房間') : btn('quit', '回到標題')}
        </div>
        ${note(lan ? ctx.lan.note : '')}`),
      actions: {
        again: () => { ctx.sfx.play('start'); if (lan) ctx.lanAgain(); else ctx.startBattle(); },
        loadout: () => { ctx.sfx.play('menuOk'); if (lan) ctx.lanLobby(); else ui.replace('loadout'); },
        quit: () => { ctx.sfx.play('menuBack'); if (lan) ctx.lanLeave(); ctx.quit(); },
      },
      keys: { KeyR: 'again' },
    };
  });

  ui.define('help', () => ({
    html: panel('', `<h2>操作說明</h2>
      <dl class="keys">${CFG.KEY_HINTS.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <ul class="rules">
        <li>火神砲沿身體正前方水平直射，不能瞄準：對手站上樓頂就打不到。連續射擊 3 秒會過熱。</li>
        <li>遠程武器要按住瞄準鍵進第一人稱才能開火；火箭砲與手砲會受重力下墜，步槍不會。</li>
        <li>鎖定且距離夠近時按攻擊，近戰會先衝刺再揮砍，連按可以接連段；防禦把傷害減半，巨劍能破防。</li>
        <li>對手的血條只在看得到它時顯示；躲進建築之間，對手就得來找你，而你也看不到它。</li>
        <li>防遠程裝甲怕近戰、防近戰裝甲怕火神砲；標準裝甲沒有弱點，而且最快。</li>
        <li>區域網路對戰：兩台電腦都打開 Gravity Duel（桌面版，或 npm run dev），一台建立房間、另一台加入。</li>
      </ul>
      <div class="row-end">${btn('back', '返回')}</div>`),
    actions: { back, escape: back },
  }));

  ui.define('settings', () => ({
    html: panel('', `<h2>設定</h2>
      <div class="settings">
        <label for="sens">滑鼠靈敏度</label><input id="sens" type="range" min="0.3" max="2" step="0.1" value="${ctx.settings.sens}"><span class="val" data-for="sens">${ctx.settings.sens.toFixed(1)}×</span>
        <label for="vol">音量</label><input id="vol" type="range" min="0" max="1" step="0.05" value="${ctx.settings.volume}"><span class="val" data-for="vol">${Math.round(ctx.settings.volume * 100)}%</span>
        <label for="bloom">光暈後製</label><input id="bloom" type="checkbox" ${ctx.settings.bloom ? 'checked' : ''}><span class="val" data-for="bloom">${ctx.settings.bloom ? '開' : '關'}</span>
      </div>
      <p class="foot">設定會保存在這個瀏覽器。</p>
      <div class="row-end">${btn('back', '返回')}</div>`),
    actions: { back, escape: back },
    mount(root) {
      const sens = root.querySelector('#sens'), vol = root.querySelector('#vol'), bloom = root.querySelector('#bloom');
      const show = (id, text) => { root.querySelector(`[data-for="${id}"]`).textContent = text; };
      const changed = () => { ctx.applySettings(); ctx.saveSettings(); };
      sens.addEventListener('input', () => { ctx.settings.sens = Number(sens.value); show('sens', `${ctx.settings.sens.toFixed(1)}×`); changed(); });
      vol.addEventListener('input', () => { ctx.settings.volume = Number(vol.value); show('vol', `${Math.round(ctx.settings.volume * 100)}%`); changed(); });
      vol.addEventListener('change', () => ctx.sfx.play('menuMove'));
      bloom.addEventListener('change', () => { ctx.settings.bloom = bloom.checked; show('bloom', bloom.checked ? '開' : '關'); changed(); });
    },
  }));
}

function pickerRow(kind, table, label, value, locked = false) {
  return `<div class="row"><span class="rowlabel">${label}</span>${Object.entries(table).map(([id, def]) =>
    `<button type="button" class="opt ${value === id ? 'on' : ''}" data-act="opt" data-kind="${kind}" data-id="${id}" title="${esc(def.desc)}" ${locked ? 'disabled' : ''}>${esc(def.zh)}</button>`).join('')}</div>`;
}
