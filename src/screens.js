/* Gravity Duel - menu screens: title, frame select, loadout, stage, pause, KO and help.
 * DOM overlays on top of the canvas. Both players drive them from the keyboard at the same
 * time (or with the mouse); the canvas behind shows the current picks live. */
(function (GD) {
  'use strict';

  const AFF = { good: '有利', even: '穩定', bad: '不利' };
  const STAGE_INFO = {
    earth: {
      title: 'EARTH · 地球', g: 'g = 9.8 m/s² · 1.0 G',
      notes: ['實體彈藥會下墜，火箭砲要跳起來往上打', '按住上鍵噴射滯空，燃料用完會過熱', '三座平台可以掩護，按住下鍵往下穿越'],
    },
    space: {
      title: 'SPACE · 太空', g: 'g = 0 · 0 G',
      notes: ['所有彈藥直線飛行，火箭砲變成遠距利器', '方向鍵就是噴射方向，放開後保持慣性', '防禦鍵同時是逆噴射煞車'],
    },
  };
  const MENUS = {
    title: [{ id: 'start', label: '開始對戰' }, { id: 'view' }, { id: 'help', label: '操作說明' }],
    pause: [{ id: 'resume', label: '繼續' }, { id: 'restart', label: '重新開始' }, { id: 'loadout', label: '換武裝' },
      { id: 'select', label: '換機體' }, { id: 'view' }, { id: 'help', label: '操作說明' }, { id: 'title', label: '回標題' }],
    ko: [{ id: 'restart', label: '再戰一場' }, { id: 'loadout', label: '換武裝' }, { id: 'select', label: '換機體' }, { id: 'title', label: '回標題' }],
  };
  // Loadout slots: up/down picks the slot, left/right cycles the weapon in it.
  const SLOTS = () => [GD.RANGED, GD.MELEE];
  const MELEE_ROW = 1;

  const keyList = (p, a) => GD.BINDINGS[p][a].map(GD.keyLabel);
  const kbd = (p, a) => keyList(p, a).map((k) => `<kbd>${k}</kbd>`).join('');
  const mechOf = (id) => GD.MECHS.find((m) => m.id === id) || GD.MECHS[0];

  class Menus {
    constructor(root, app, actions) {
      this.root = root;
      this.app = app;
      this.act = actions;
      this.screen = 'title';
      this.cursor = { title: 0, pause: 0, ko: 0 };
      this.ready = { 1: false, 2: false };
      this.lcur = { 1: { row: 0, col: 0 }, 2: { row: 0, col: 0 } };
      this.advanceT = 0;
      this.helpFrom = 'title';
      for (const name of ['title', 'select', 'loadout', 'stage', 'pause', 'ko', 'help']) {
        const el = document.createElement('div');
        el.className = `scr scr-${name}`;
        el.dataset.screen = name;
        el.hidden = true;
        root.appendChild(el);
      }
      root.addEventListener('click', (e) => this.onClick(e));
      this.go('title');
    }

    inBattle() {
      return this.screen === 'battle' || this.screen === 'pause' || this.screen === 'ko' ||
        (this.screen === 'help' && this.helpFrom !== 'title');
    }

    go(screen) {
      if (screen === 'help' && this.screen !== 'help') this.helpFrom = this.screen;
      this.screen = screen;
      this.advanceT = 0;
      if (screen === 'select' || screen === 'loadout') this.ready = { 1: false, 2: false };
      if (screen === 'loadout') for (const p of [1, 2]) this.lcur[p] = this.posOf(this.app.picks[p].ranged);
      if (screen === 'pause' || screen === 'ko') this.cursor[screen] = 0;
      this.render();
    }

    posOf(id) {
      const slots = SLOTS();
      for (let r = 0; r < slots.length; r++) {
        const c = slots[r].findIndex((w) => w.id === id);
        if (c >= 0) return { row: r, col: c };
      }
      return { row: 0, col: 0 };
    }

    // True while player p is browsing the melee slot on the loadout screen.
    browsingMelee(p) {
      return this.screen === 'loadout' && this.lcur[p].row === MELEE_ROW;
    }

    activate(id) {
      switch (id) {
        case 'start': this.go('select'); break;
        case 'view': this.act.toggleView(); this.render(); break;
        case 'help': this.go('help'); break;
        case 'resume': this.go('battle'); break;
        case 'restart': this.act.startBattle(); break;
        case 'loadout': this.go('loadout'); break;
        case 'select': this.go('select'); break;
        case 'title': this.go('title'); break;
      }
    }

    setReady(p, v) {
      this.ready[p] = v;
      this.advanceT = this.ready[1] && this.ready[2] ? 0.45 : 0;
      this.render();
    }

    update(dt) {
      if (this.advanceT > 0) {
        this.advanceT -= dt;
        if (this.advanceT <= 0) this.go(this.screen === 'select' ? 'loadout' : 'stage');
      }
    }

    // ---- keyboard ----
    input(p, pr) {
      if (!pr) return;
      switch (this.screen) {
        case 'title': case 'pause': case 'ko': {
          const list = MENUS[this.screen];
          const prev = pr.up || (this.screen === 'ko' && pr.left);
          const next = pr.down || (this.screen === 'ko' && pr.right);
          if (prev) this.cursor[this.screen] = (this.cursor[this.screen] + list.length - 1) % list.length;
          if (next) this.cursor[this.screen] = (this.cursor[this.screen] + 1) % list.length;
          if (prev || next) this.render();
          if (pr.attack) this.activate(list[this.cursor[this.screen]].id);
          else if (pr.sub && this.screen === 'pause') this.activate('resume');
          break;
        }
        case 'help':
          if (pr.attack || pr.sub) this.go(this.helpFrom);
          break;
        case 'select': this.navSelect(p, pr); break;
        case 'loadout': this.navLoadout(p, pr); break;
        case 'stage': this.navStage(pr); break;
      }
    }

    navSelect(p, pr) {
      if (pr.sub) { if (this.ready[p]) this.setReady(p, false); else this.go('title'); return; }
      if (pr.attack) { if (!this.ready[p]) this.setReady(p, true); return; }
      if (this.ready[p]) return;
      const n = GD.MECHS.length, rows = Math.ceil(n / 2);
      const i = GD.MECHS.findIndex((m) => m.id === this.app.picks[p].mech);
      let col = i % 2, row = Math.floor(i / 2);
      if (pr.left || pr.right) col = 1 - col;
      if (pr.up) row = (row + rows - 1) % rows;
      if (pr.down) row = (row + 1) % rows;
      const j = Math.min(n - 1, row * 2 + col);
      if (j !== i) {
        this.app.picks[p].mech = GD.MECHS[j].id;
        this.act.picksChanged();
        this.render();
      }
    }

    navLoadout(p, pr) {
      if (pr.sub) { if (this.ready[p]) this.setReady(p, false); else this.go('select'); return; }
      if (pr.attack) { if (!this.ready[p]) this.setReady(p, true); return; }
      if (this.ready[p]) return;
      const slots = SLOTS();
      const pk = this.app.picks[p];
      const c = this.lcur[p];
      if (pr.up || pr.down) {
        // Switch slot and land on that slot's current pick; nothing changes on the way.
        c.row = 1 - c.row;
        c.col = Math.max(0, slots[c.row].findIndex((w) => w.id === (c.row === MELEE_ROW ? pk.melee : pk.ranged)));
        this.render();
      }
      if (pr.left || pr.right) {
        const list = slots[c.row];
        c.col = (c.col + (pr.right ? 1 : list.length - 1)) % list.length;
        pk[c.row === MELEE_ROW ? 'melee' : 'ranged'] = list[c.col].id;
        this.act.picksChanged();
        this.render();
      }
    }

    navStage(pr) {
      if (pr.left || pr.right) {
        this.app.stageId = this.app.stageId === 'earth' ? 'space' : 'earth';
        this.act.picksChanged();
        this.render();
      }
      if (pr.attack) this.act.startBattle();
      else if (pr.sub) this.go('loadout');
    }

    // Enter and Escape work for either player.
    global(code) {
      if (code === 'Enter') {
        if (MENUS[this.screen]) this.activate(MENUS[this.screen][this.cursor[this.screen]].id);
        else if (this.screen === 'help') this.go(this.helpFrom);
        else if (this.screen === 'select' || this.screen === 'loadout') { this.ready = { 1: true, 2: false }; this.setReady(2, true); }
        else if (this.screen === 'stage') this.act.startBattle();
      } else if (code === 'Escape') {
        const back = { battle: 'pause', pause: 'battle', help: this.helpFrom, select: 'title', loadout: 'select', stage: 'loadout' };
        if (back[this.screen]) this.go(back[this.screen]);
      }
    }

    // ---- mouse ----
    onClick(e) {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      el.blur();
      const p = Number(el.dataset.p);
      const id = el.dataset.id;
      switch (el.dataset.act) {
        case 'menu': {
          const list = MENUS[this.screen];
          this.cursor[this.screen] = Math.max(0, list.findIndex((it) => it.id === id));
          this.activate(id);
          break;
        }
        case 'mech':
          if (!this.ready[p]) { this.app.picks[p].mech = id; this.act.picksChanged(); this.render(); }
          break;
        case 'weapon': {
          if (this.ready[p]) break;
          const w = GD.weaponById(id);
          this.app.picks[p][w.kind === 'melee' ? 'melee' : 'ranged'] = id;
          this.lcur[p] = this.posOf(id);
          this.act.picksChanged();
          this.render();
          break;
        }
        case 'ready': this.setReady(p, !this.ready[p]); break;
        case 'stage': this.app.stageId = id; this.act.picksChanged(); this.render(); break;
        case 'start': this.act.startBattle(); break;
        case 'back': this.go(this.helpFrom); break;
      }
    }

    // ---- rendering ----
    render() {
      for (const el of this.root.children) el.hidden = el.dataset.screen !== this.screen;
      const el = this.root.querySelector(`[data-screen="${this.screen}"]`);
      if (el) el.innerHTML = this['html_' + this.screen]();
    }

    menuHtml(name) {
      const viewLabel = `視角：${this.app.view === '3d' ? '2.5D' : '2D'}`;
      return `<div class="menu menu-${name}">${MENUS[name].map((it, i) =>
        `<button data-act="menu" data-id="${it.id}" class="${i === this.cursor[name] ? 'on' : ''}">${it.id === 'view' ? viewLabel : it.label}</button>`).join('')}</div>`;
    }

    html_title() {
      return `<div class="logo">
          <div class="eyebrow">MOBILE FRAME VERSUS</div>
          <h1>GRAVITY<br>DUEL</h1>
          <p>重力決定彈道。選對武器，才能在地球或太空贏下對決。</p>
        </div>
        ${this.menuHtml('title')}
        <p class="keys-hint"><span>任一玩家 ${kbd(1, 'up')}${kbd(1, 'down')} 或 ${kbd(2, 'up')}${kbd(2, 'down')} 選擇 · ${kbd(1, 'attack')} / ${kbd(2, 'attack')} / <kbd>Enter</kbd> 確認</span></p>`;
    }

    sideHint(slotted) {
      const nav = (p) => slotted
        ? `${kbd(p, 'up')}${kbd(p, 'down')} 選欄位 · ${kbd(p, 'left')}${kbd(p, 'right')} 換武器`
        : `${kbd(p, 'up')}${kbd(p, 'left')}${kbd(p, 'down')}${kbd(p, 'right')} 選擇`;
      return `<p class="keys-hint">
          <span>P1 ${nav(1)} · ${kbd(1, 'attack')} 準備 · ${kbd(1, 'sub')} 返回</span>
          <span>P2 ${nav(2)} · ${kbd(2, 'attack')} 準備 · ${kbd(2, 'sub')} 返回</span>
        </p>`;
    }

    readyBtn(p) {
      return this.ready[p]
        ? `<button class="readybtn on" data-act="ready" data-p="${p}">READY · 按 ${kbd(p, 'sub')} 取消</button>`
        : `<button class="readybtn" data-act="ready" data-p="${p}">準備完成 ${kbd(p, 'attack')}</button>`;
    }

    html_select() {
      const side = (p) => {
        const m = mechOf(this.app.picks[p].mech);
        const st = GD.deriveStats(m);
        const stats = [['HP', m.hp, st.hpMax], ['SPEED', m.spd, st.walkSpeed], ['ARMOR', m.arm, `-${m.arm * 6}%`],
          ['ENERGY', m.en, st.energyMax], ['BOOST', m.bst, st.fuelMax]];
        return `<section class="side panel p${p} ${this.ready[p] ? 'is-ready' : ''}">
            <div class="who"><span>PLAYER ${p}</span><span class="tag ${this.ready[p] ? 'ready' : ''}">${this.ready[p] ? 'READY' : '選擇中'}</span></div>
            <div class="pick-name"><span class="code">${m.code}</span> ${m.name}<span class="role">${m.role}</span></div>
            <div class="cards c2">${GD.MECHS.map((x) => `<button class="card ${x.id === m.id ? 'sel' : ''}" data-act="mech" data-p="${p}" data-id="${x.id}">
              <span class="nm">${x.name}</span><span class="cd">${x.code} · ${x.role}</span></button>`).join('')}</div>
            <div class="stats">${stats.map(([k, v, real]) => `<div class="stat"><span>${k}</span><span class="bar"><i style="width:${v / 6 * 100}%"></i></span><span class="v">${v}</span><span class="real">${real}</span></div>`).join('')}</div>
            <p class="weak"><b>弱點</b>${m.weak}</p>
            ${this.readyBtn(p)}
          </section>`;
      };
      return `<div class="scr-head"><h2>SELECT FRAME · 選擇機體</h2><span class="step">STEP 1 / 3 · 每架機體五項能力總和都是 20</span></div>
        <div class="cols">${side(1)}<div class="vs">VS</div>${side(2)}</div>
        ${this.sideHint()}`;
    }

    weaponDetail(w) {
      const facts = w.kind === 'melee'
        ? [`傷害 ${w.dmg}`, `距離 ${w.range}`, `出刀 ${w.windup.toFixed(2)} 秒`]
        : [`傷害 ${w.dmg}`, w.blast ? `爆風 ${w.blast}` : null, `重力係數 ${w.g.toFixed(1)}`, `彈藥 ${w.ammo === Infinity ? '∞' : w.ammo}`].filter(Boolean);
      return `<div class="detail">
          <div class="d-name">${w.name}<span>${w.zh}</span></div>
          <div class="d-facts">${facts.map((t) => `<span>${t}</span>`).join('')}</div>
          <div class="d-aff"><span class="pill ${w.earth}">地球 ${AFF[w.earth]}</span>${w.earthNote}</div>
          <div class="d-aff"><span class="pill ${w.space}">太空 ${AFF[w.space]}</span>${w.spaceNote}</div>
          <div class="d-note">${w.note}</div>
        </div>`;
    }

    html_loadout() {
      const slots = SLOTS();
      const side = (p) => {
        const pk = this.app.picks[p];
        const c = this.lcur[p];
        const m = mechOf(pk.mech);
        const card = (w, r, col) => `<button class="card wcard ${w.id === pk.ranged || w.id === pk.melee ? 'sel' : ''} ${r === c.row && col === c.col && !this.ready[p] ? 'cur' : ''}"
            data-act="weapon" data-p="${p}" data-id="${w.id}"><span class="nm">${w.zh}</span><span class="cd">DMG <b>${w.dmg}</b></span></button>`;
        const slotCls = (r) => `slot ${r === c.row && !this.ready[p] ? 'active' : ''}`;
        return `<section class="side panel p${p} ${this.ready[p] ? 'is-ready' : ''}">
            <div class="who"><span>PLAYER ${p} · ${m.name}</span><span class="tag ${this.ready[p] ? 'ready' : ''}">${this.ready[p] ? 'READY' : '配置中'}</span></div>
            <div class="${slotCls(0)}"><div class="lbl">遠程武器</div>
              <div class="cards c2">${slots[0].map((w, col) => card(w, 0, col)).join('')}</div></div>
            <div class="${slotCls(1)}"><div class="lbl">近戰武器</div>
              <div class="cards c3">${slots[1].map((w, col) => card(w, 1, col)).join('')}</div></div>
            ${this.weaponDetail(slots[c.row][c.col])}
            ${this.readyBtn(p)}
          </section>`;
      };
      return `<div class="scr-head"><h2>LOADOUT · 武裝配置</h2><span class="step">STEP 2 / 3 · 遠程與近戰各選一把，戰鬥中用切換鍵互換</span></div>
        <div class="cols">${side(1)}<div class="vs">VS</div>${side(2)}</div>
        ${this.sideHint(true)}`;
    }

    html_stage() {
      const sid = this.app.stageId;
      const card = (id) => {
        const info = STAGE_INFO[id];
        return `<button class="stage-card panel ${id} ${sid === id ? 'on' : ''}" data-act="stage" data-id="${id}">
            <span class="g">${info.g}</span><h3>${info.title}</h3>
            <ul>${info.notes.map((t) => `<li>${t}</li>`).join('')}</ul></button>`;
      };
      const mu = (p) => {
        const pk = this.app.picks[p];
        const r = GD.weaponById(pk.ranged), me = GD.weaponById(pk.melee);
        const row = (w) => `<div><span class="pill ${w[sid]}">${AFF[w[sid]]}</span>${w.name} · ${w[sid + 'Note']}</div>`;
        return `<div class="mu panel p${p}"><div class="who"><span>PLAYER ${p} · ${mechOf(pk.mech).name}</span></div>${row(r)}${row(me)}</div>`;
      };
      return `<div class="scr-head"><h2>SELECT STAGE · 選擇場景</h2><span class="step">STEP 3 / 3 · 場景重力會改變所有實體彈藥的軌跡</span></div>
        <div class="stage-cards">${card('earth')}${card('space')}</div>
        <div class="matchup">${mu(1)}${mu(2)}</div>
        <p class="keys-hint"><span>任一玩家 ${kbd(1, 'left')}${kbd(1, 'right')} 或 ${kbd(2, 'left')}${kbd(2, 'right')} 切換場景 · ${kbd(1, 'sub')} / ${kbd(2, 'sub')} 返回</span>
          <button class="go" data-act="start">開始對戰 <kbd>F</kbd> <kbd>Num 1</kbd> <kbd>Enter</kbd></button></p>`;
    }

    html_pause() {
      return `<div class="modal panel"><h2>PAUSED · 暫停</h2>${this.menuHtml('pause')}
        <p class="keys-hint"><span><kbd>Esc</kbd> 繼續 · 上下選擇 · 攻擊鍵或 <kbd>Enter</kbd> 確認</span></p></div>`;
    }

    html_ko() {
      return `<div class="ko-bar panel">${this.menuHtml('ko')}</div>`;
    }

    html_help() {
      const rows = [
        ['移動', ['left', 'right']], ['跳躍・噴射（空中按住）', ['up']], ['按住往下穿越平台', ['down']],
        ['攻擊・確認', ['attack']], ['火神砲・返回', ['sub']], ['切換遠程 ⇄ 近戰', ['switch']],
        ['防禦（太空中兼煞車）', ['guard']], ['衝刺', ['dash']],
      ];
      const cell = (p, acts) => acts.map((a) => kbd(p, a)).join(' ');
      return `<div class="modal panel help">
          <h2>CONTROLS · 操作說明</h2>
          <div class="tablewrap"><table>
            <thead><tr><th>動作</th><th>P1 鍵盤左側</th><th>P2 鍵盤右側</th></tr></thead>
            <tbody>${rows.map(([label, acts]) => `<tr><td>${label}</td><td>${cell(1, acts)}</td><td>${cell(2, acts)}</td></tr>`).join('')}</tbody>
          </table></div>
          <ul>
            <li>按住上或下再攻擊，可以抬高或壓低射角。地球上抬高射角會順便跳起來。</li>
            <li>切換武器後要等 ${GD.COMBAT.switchCooldown} 秒才能再切換，剛換上的武器有 ${GD.COMBAT.switchLag} 秒出手準備。</li>
            <li>火神砲在任何模式都能用，可以擊落火箭砲與榴彈。</li>
            <li><kbd>Esc</kbd> 暫停 · <kbd>\`</kbd> 除錯資訊</li>
          </ul>
          <button class="readybtn" data-act="back">返回 <kbd>Enter</kbd></button>
        </div>`;
    }

    html_battle() { return ''; }
  }

  GD.Menus = Menus;
})(globalThis.GD = globalThis.GD || {});
