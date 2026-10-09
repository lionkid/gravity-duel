// Skyline's menu screens: title, difficulty, loadout, pause, KO, help and settings. Templates plus
// action handlers; the game passes its state and callbacks in through `ctx`:
//   { loadout, cpuLoadout, cpuLevel, settings, sfx, note, version,
//     startBattle(), resume(), quit(), rerollCpu(), saveSettings(), applySettings() }

import { esc } from '../../engine/ui/screens.js';
import * as CFG from './config.js';
import { AI_LEVELS, AI_ORDER } from './ai/brain.js';

const LEVEL_DESC = { easy: '反應慢、瞄不準，適合先熟悉操作', normal: '會閃躲、會防禦、會上樓頂', hard: '反應快、瞄得準、連段不手軟' };
const loadoutText = (l) => `${CFG.WEAPON_CLASSES[l.weapon].zh}武裝 · ${CFG.ARMORS[l.armor].zh}`;
const logo = () => `<h1 class="logo">GRAVITY DUEL<span>SKYLINE</span></h1>`;
const panel = (cls, html) => `<div class="panel ${cls}">${html}</div>`;
const btn = (act, label, { cls = '', attrs = '' } = {}) => `<button type="button" class="mbtn ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
const note = (ctx) => (ctx.note ? `<p class="note">${esc(ctx.note)}</p>` : '');

export function defineScreens(ui, ctx) {
  const back = () => { ctx.sfx.play('menuBack'); ui.back(); };
  const open = (name) => () => { ctx.sfx.play('menuOk'); ui.show(name); };

  ui.define('title', () => ({
    html: panel('', `${logo()}
      <p class="sub">重力決定彈道的機甲一對一。城市街道、高架道路、大樓屋頂，從傍晚打到天黑。</p>
      <div class="menu">
        ${btn('solo', '單人對戰', { cls: 'primary' })}
        ${btn('lan', '區域網路對戰 <small>M4 推出</small>', { attrs: 'disabled' })}
        ${btn('help', '操作說明')}
        ${btn('settings', '設定')}
      </div>
      ${note(ctx)}
      <p class="foot">v${esc(ctx.version)} · 滑鼠靈敏度與音量在「設定」</p>`),
    actions: { solo: open('cpu'), help: open('help'), settings: open('settings') },
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
      ${note(ctx)}
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

  ui.define('pause', () => ({
    html: panel('narrow', `<h2 class="big">暫停</h2>
      <div class="menu">
        ${btn('resume', '繼續 <small>Esc</small>', { cls: 'primary' })}
        ${btn('restart', '重新開始')}
        ${btn('settings', '設定')}
        ${btn('help', '操作說明')}
        ${btn('quit', '回到標題')}
      </div>
      ${note(ctx)}`),
    actions: {
      resume: () => { ctx.sfx.play('menuOk'); ctx.resume(); },
      escape: () => { ctx.sfx.play('menuOk'); ctx.resume(); },
      restart: () => { ctx.sfx.play('start'); ctx.startBattle(); },
      settings: open('settings'),
      help: open('help'),
      quit: () => { ctx.sfx.play('menuBack'); ctx.quit(); },
    },
  }));

  ui.define('ko', (d) => ({
    html: panel('narrow', `<h2 class="big ${d.win ? 'win' : 'lose'}">${d.win ? 'WIN' : 'LOSE'}</h2>
      <p class="sub">${esc(d.text || '')}</p>
      <div class="menu">
        ${btn('again', '再戰 <small>R</small>', { cls: 'primary' })}
        ${btn('loadout', '換配置')}
        ${btn('quit', '回到標題')}
      </div>`),
    actions: {
      again: () => { ctx.sfx.play('start'); ctx.startBattle(); },
      loadout: () => { ctx.sfx.play('menuOk'); ui.replace('loadout'); },
      quit: () => { ctx.sfx.play('menuBack'); ctx.quit(); },
    },
    keys: { KeyR: 'again' },
  }));

  ui.define('help', () => ({
    html: panel('', `<h2>操作說明</h2>
      <dl class="keys">${CFG.KEY_HINTS.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <ul class="rules">
        <li>火神砲沿身體正前方水平直射，不能瞄準：對手站上樓頂就打不到。連續射擊 3 秒會過熱。</li>
        <li>遠程武器要按住瞄準鍵進第一人稱才能開火；火箭砲與手砲會受重力下墜，步槍不會。</li>
        <li>鎖定且距離夠近時按攻擊，近戰會先衝刺再揮砍，連按可以接連段；防禦把傷害減半，巨劍能破防。</li>
        <li>對手的血條只在看得到它時顯示；躲進建築之間，對手就得來找你，而你也看不到它。</li>
        <li>防遠程裝甲怕近戰、防近戰裝甲怕火神砲；標準裝甲沒有弱點，而且最快。</li>
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

function pickerRow(kind, table, label, value) {
  return `<div class="row"><span class="rowlabel">${label}</span>${Object.entries(table).map(([id, def]) =>
    `<button type="button" class="opt ${value === id ? 'on' : ''}" data-act="opt" data-kind="${kind}" data-id="${id}" title="${esc(def.desc)}">${esc(def.zh)}</button>`).join('')}</div>`;
}
