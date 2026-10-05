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
    moon: {
      title: 'MOON · 月面基地', g: 'g = 1.6 m/s² · 0.17 G',
      notes: ['低重力：跳得又高又久，彈藥只會微微下墜', '真空：爆風變小、能量回復變慢、光束不衰減', '開火有後座力，空中連射會被推開'],
    },
    space: {
      title: 'SPACE · 太空', g: 'g = 0 · 0 G',
      notes: ['所有彈藥直線飛行，開火後座力會推動機體', '方向鍵就是噴射方向，放開後保持慣性', '真空爆風變小；防禦鍵兼逆噴射煞車'],
    },
  };
  const MENUS = {
    title: [{ id: 'solo', label: '單人模式 · 對戰電腦' }, { id: 'versus', label: '雙人模式 · 同一台電腦' }, { id: 'lan', label: '區域網路對戰' },
      { id: 'view' }, { id: 'sound' }, { id: 'help', label: '操作說明' }],
    pause: [{ id: 'resume', label: '繼續' }, { id: 'restart', label: '重新開始' }, { id: 'loadout', label: '換武裝' },
      { id: 'select', label: '換機體' }, { id: 'view' }, { id: 'sound' }, { id: 'help', label: '操作說明' }, { id: 'title', label: '回標題' }],
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
      this.cursor = { title: 0, pause: 0, ko: 0, cpu: 1 };
      this.ready = { 1: false, 2: false };
      this.lcur = { 1: { row: 0, col: 0 }, 2: { row: 0, col: 0 } };
      this.advanceT = 0;
      this.helpFrom = 'title';
      this.lanCursor = 0;
      for (const name of ['title', 'cpu', 'lan', 'select', 'loadout', 'stage', 'pause', 'ko', 'help']) {
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

    solo() {
      return this.app.mode === 'solo';
    }

    // LAN helpers: which side this browser plays, and whether it is the guest (player 2).
    lan() { return this.app.mode === 'lan'; }
    me() { return this.lan() ? this.app.net.player || 1 : 0; }
    guest() { return this.lan() && this.app.net.player === 2; }

    // Screen changes both LAN players must make together are sent to the other browser too.
    goShared(screen) {
      if (this.lan()) this.act.share({ t: 'go', screen });
      this.go(screen);
    }

    go(screen) {
      if (screen === 'help' && this.screen !== 'help') this.helpFrom = this.screen;
      if (screen === 'select' && this.screen !== 'select' && this.solo()) this.act.newCpuSeed();
      if (screen === 'cpu') this.cursor.cpu = Math.max(0, GD.AI_ORDER.indexOf(this.app.cpuLevel));
      this.screen = screen;
      this.advanceT = 0;
      // The computer side is always ready in single-player mode.
      if (screen === 'select' || screen === 'loadout') this.ready = { 1: false, 2: this.solo() };
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
        case 'solo': this.act.setMode('solo'); this.go('cpu'); break;
        case 'versus': this.act.setMode('versus'); this.go('select'); break;
        case 'lan': this.act.setMode('lan'); this.lanCursor = 0; this.go('lan'); break;
        case 'view': this.act.toggleView(); this.render(); break;
        case 'sound': this.act.toggleSound(); this.render(); break;
        case 'help': this.go('help'); break;
        case 'resume': this.goShared('battle'); break;
        case 'restart':
          // On LAN only the host starts matches; the guest asks for one.
          if (this.guest()) this.act.share({ t: 'restart' });
          else this.act.startBattle();
          break;
        case 'loadout': this.goShared('loadout'); break;
        case 'select': this.goShared('select'); break;
        case 'title':
          if (this.lan()) this.act.lanLeave();
          this.go('title');
          break;
      }
    }

    setReady(p, v, remote) {
      this.ready[p] = v;
      if (this.solo()) this.ready[2] = true;
      // On LAN the host moves both browsers forward; the guest waits for the host's go.
      this.advanceT = this.ready[1] && this.ready[2] && !this.guest() ? 0.45 : 0;
      if (!remote && this.lan()) this.act.picksChanged();
      this.render();
    }

    pickLevel(i) {
      this.cursor.cpu = i;
      this.app.cpuLevel = GD.AI_ORDER[i];
      this.act.picksChanged();
    }

    update(dt) {
      if (this.advanceT > 0) {
        this.advanceT -= dt;
        if (this.advanceT <= 0) this.goShared(this.screen === 'select' ? 'loadout' : 'stage');
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
        case 'cpu': {
          const n = GD.AI_ORDER.length;
          if (pr.up || pr.left) { this.pickLevel((this.cursor.cpu + n - 1) % n); this.render(); }
          if (pr.down || pr.right) { this.pickLevel((this.cursor.cpu + 1) % n); this.render(); }
          if (pr.attack) this.go('select');
          else if (pr.sub) this.go('title');
          break;
        }
        case 'lan': {
          if (this.app.net.ws) {                     // in a room: back leaves the room
            if (pr.sub) { this.act.lanLeave(); this.render(); }
            break;
          }
          const items = this.lanItems();
          if (pr.up) { this.lanCursor = (this.lanCursor + items.length - 1) % items.length; this.render(); }
          if (pr.down) { this.lanCursor = (this.lanCursor + 1) % items.length; this.render(); }
          if (pr.attack) this.lanPick(items[Math.min(this.lanCursor, items.length - 1)]);
          else if (pr.sub) this.activate('title');
          break;
        }
        case 'select': if (!this.lan() || p === this.me()) this.navSelect(p, pr); break;
        case 'loadout': if (!this.lan() || p === this.me()) this.navLoadout(p, pr); break;
        case 'stage': if (!this.guest()) this.navStage(pr); break;
      }
    }

    navSelect(p, pr) {
      if (pr.sub) {
        if (this.ready[p]) this.setReady(p, false);
        else if (!this.lan()) this.go(this.solo() ? 'cpu' : 'title');
        return;
      }
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
      if (pr.sub) { if (this.ready[p]) this.setReady(p, false); else this.goShared('select'); return; }
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
        const order = GD.STAGE_ORDER, n = order.length;
        const i = Math.max(0, order.indexOf(this.app.stageId));
        this.app.stageId = order[(i + (pr.right ? 1 : n - 1)) % n];
        this.act.picksChanged();
        this.render();
      }
      if (pr.attack) this.act.startBattle();
      else if (pr.sub) this.goShared('loadout');
    }

    // Enter and Escape work for either player.
    global(code) {
      if (code === 'Enter') {
        if (MENUS[this.screen]) this.activate(MENUS[this.screen][this.cursor[this.screen]].id);
        else if (this.screen === 'help') this.go(this.helpFrom);
        else if (this.screen === 'cpu') this.go('select');
        else if (this.screen === 'lan' && !this.app.net.ws) this.lanPick(this.lanItems()[Math.min(this.lanCursor, this.lanItems().length - 1)]);
        else if ((this.screen === 'select' || this.screen === 'loadout') && this.lan()) this.setReady(this.me(), true);
        else if (this.screen === 'select' || this.screen === 'loadout') { this.ready = { 1: true, 2: false }; this.setReady(2, true); }
        else if (this.screen === 'stage' && !this.guest()) this.act.startBattle();
      } else if (code === 'Escape') {
        if (this.lan()) {
          const back = { battle: 'pause', pause: 'battle', loadout: 'select', stage: 'loadout' };
          if (this.screen === 'help') this.go(this.helpFrom);
          else if (this.screen === 'lan' || this.screen === 'select') this.activate('title');
          else if (back[this.screen] && !(this.screen === 'stage' && this.guest())) this.goShared(back[this.screen]);
          return;
        }
        const back = { battle: 'pause', pause: 'battle', help: this.helpFrom, cpu: 'title', select: this.solo() ? 'cpu' : 'title', loadout: 'select', stage: 'loadout' };
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
          if (list) this.cursor[this.screen] = Math.max(0, list.findIndex((it) => it.id === id));
          this.activate(id);
          break;
        }
        case 'mech':
          if (this.lan() && p !== this.me()) break;
          if (!this.ready[p]) { this.app.picks[p].mech = id; this.act.picksChanged(); this.render(); }
          break;
        case 'weapon': {
          if (this.ready[p] || (this.lan() && p !== this.me())) break;
          const w = GD.weaponById(id);
          this.app.picks[p][w.kind === 'melee' ? 'melee' : 'ranged'] = id;
          this.lcur[p] = this.posOf(id);
          this.act.picksChanged();
          this.render();
          break;
        }
        case 'ready': if (!this.lan() || p === this.me()) this.setReady(p, !this.ready[p]); break;
        case 'stage': if (!this.guest()) { this.app.stageId = id; this.act.picksChanged(); this.render(); } break;
        case 'start': if (!this.guest()) this.act.startBattle(); break;
        case 'lanroom': this.lanPick(this.lanItems()[Number(id)]); break;
        case 'lanmanual': {
          const box = this.root.querySelector('#lanAddr');
          const v = box ? box.value.trim() : '';
          if (v) this.act.lanConnect(/^https?:\/\//.test(v) ? v : `http://${v.includes(':') ? v : v + ':8080'}`);
          break;
        }
        case 'lanleave': this.act.lanLeave(); this.render(); break;
        case 'level': this.pickLevel(Number(id)); this.go('select'); break;
        case 'back': this.go(this.helpFrom); break;
      }
    }

    // ---- rendering ----
    render(silent) {
      // Menu blips: a new screen confirms, a change on the same screen is a cursor move.
      if (!silent && this.act.sfx && this.screen !== 'battle') this.act.sfx(this.lastScreen !== this.screen ? 'menuOk' : 'menuMove');
      this.lastScreen = this.screen;
      for (const el of this.root.children) el.hidden = el.dataset.screen !== this.screen;
      const el = this.root.querySelector(`[data-screen="${this.screen}"]`);
      // Keep whatever the player is typing in the lobby's address box across re-renders.
      const box = el && el.querySelector('#lanAddr');
      const typed = box ? { v: box.value, focus: document.activeElement === box } : null;
      if (el) el.innerHTML = this['html_' + this.screen]();
      const nbox = el && el.querySelector('#lanAddr');
      if (nbox && typed) { nbox.value = typed.v; if (typed.focus) nbox.focus(); }
    }

    menuHtml(name) {
      const label = (it) => (it.id === 'view' ? `視角：${this.app.view === '3d' ? '2.5D' : '2D'}`
        : it.id === 'sound' ? `音效：${this.app.sound ? '開' : '關'}` : it.label);
      return `<div class="menu menu-${name}">${MENUS[name].map((it, i) =>
        `<button data-act="menu" data-id="${it.id}" class="${i === this.cursor[name] ? 'on' : ''}">${label(it)}</button>`).join('')}</div>`;
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

    // Right-hand panel in single-player mode: the opponent stays hidden until the stage is picked.
    cpuSide() {
      const L = GD.AI_LEVELS[this.app.cpuLevel];
      const rules = {
        easy: ['機體與武器隨機挑選', '反應慢，常常打歪'],
        normal: ['依場景重力挑選有利的武器', '看距離切換遠程與近戰'],
        hard: ['依場景挑武器，還會針對你的配置', '預判彈道、攔截火箭、近身防禦'],
      }[L.id];
      return `<section class="side panel p2 cpu is-ready">
          <div class="who"><span>CPU · ${L.label}</span><span class="tag ready">自動配置</span></div>
          <div class="pick-name">? ? ?<span class="role">選完場景後揭曉</span></div>
          <ul class="cpu-rules">${rules.map((t) => `<li>${t}</li>`).join('')}</ul>
          <p class="weak"><b>強度</b>${L.desc}</p>
          <p class="cpu-note">要換強度，按返回鍵回到上一頁。</p>
        </section>`;
    }

    whoTag(p) {
      if (!this.lan()) return '';
      return p === this.me() ? ' · 你' : ' · 對手';
    }

    sideHint(slotted) {
      const nav = (p) => slotted
        ? `${kbd(p, 'up')}${kbd(p, 'down')} 選欄位 · ${kbd(p, 'left')}${kbd(p, 'right')} 換武器`
        : `${kbd(p, 'up')}${kbd(p, 'left')}${kbd(p, 'down')}${kbd(p, 'right')} 選擇`;
      if (this.solo()) {
        return `<p class="keys-hint"><span>${nav(1)} · ${kbd(1, 'attack')} 準備 · ${kbd(1, 'sub')} 返回</span><span>單人模式中，P2 的方向鍵與按鍵也可以操作</span></p>`;
      }
      if (this.lan()) {
        return `<p class="keys-hint"><span>你是 PLAYER ${this.me()} · ${nav(1)} · ${kbd(1, 'attack')} 準備 · ${kbd(1, 'sub')} 取消</span><span>鍵盤左右兩側都能操作 · 雙方都準備好就進入下一步</span></p>`;
      }
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
            <div class="who"><span>PLAYER ${p}${this.whoTag(p)}</span><span class="tag ${this.ready[p] ? 'ready' : ''}">${this.ready[p] ? 'READY' : '選擇中'}</span></div>
            <div class="pick-name"><span class="code">${m.code}</span> ${m.name}<span class="role">${m.role}</span></div>
            <div class="cards c2">${GD.MECHS.map((x) => `<button class="card ${x.id === m.id ? 'sel' : ''}" data-act="mech" data-p="${p}" data-id="${x.id}">
              <span class="nm">${x.name}</span><span class="cd">${x.code} · ${x.role}</span></button>`).join('')}</div>
            <div class="stats">${stats.map(([k, v, real]) => `<div class="stat"><span>${k}</span><span class="bar"><i style="width:${v / 6 * 100}%"></i></span><span class="v">${v}</span><span class="real">${real}</span></div>`).join('')}</div>
            <p class="weak"><b>弱點</b>${m.weak}</p>
            ${this.readyBtn(p)}
          </section>`;
      };
      return `<div class="scr-head"><h2>SELECT FRAME · 選擇機體</h2><span class="step">STEP 1 / 3 · 每架機體五項能力總和都是 20</span></div>
        <div class="cols">${side(1)}<div class="vs">VS</div>${this.solo() ? this.cpuSide() : side(2)}</div>
        ${this.sideHint()}`;
    }

    weaponDetail(w) {
      const facts = w.kind === 'melee'
        ? [`傷害 ${w.dmg}`, `距離 ${w.range}`, `出刀 ${w.windup.toFixed(2)} 秒`]
        : [`傷害 ${w.dmg}`, w.blast ? `爆風 ${w.blast}` : null, `重力係數 ${w.g.toFixed(1)}`, `彈藥 ${w.ammo === Infinity ? '∞' : w.ammo}`].filter(Boolean);
      return `<div class="detail">
          <div class="d-name">${w.name}<span>${w.zh}</span></div>
          <div class="d-facts">${facts.map((t) => `<span>${t}</span>`).join('')}</div>
          ${GD.STAGE_ORDER.map((sid) => `<div class="d-aff"><span class="pill ${GD.aff(w, sid)}">${GD.STAGES[sid].zh} ${AFF[GD.aff(w, sid)]}</span>弱點：${w.st[sid].con}</div>`).join('')}
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
            <div class="who"><span>PLAYER ${p}${this.whoTag(p)} · ${m.name}</span><span class="tag ${this.ready[p] ? 'ready' : ''}">${this.ready[p] ? 'READY' : '配置中'}</span></div>
            <div class="${slotCls(0)}"><div class="lbl">遠程武器</div>
              <div class="cards c2">${slots[0].map((w, col) => card(w, 0, col)).join('')}</div></div>
            <div class="${slotCls(1)}"><div class="lbl">近戰武器</div>
              <div class="cards c3">${slots[1].map((w, col) => card(w, 1, col)).join('')}</div></div>
            ${this.weaponDetail(slots[c.row][c.col])}
            ${this.readyBtn(p)}
          </section>`;
      };
      return `<div class="scr-head"><h2>LOADOUT · 武裝配置</h2><span class="step">STEP 2 / 3 · 遠程與近戰各選一把，戰鬥中用切換鍵互換</span></div>
        <div class="cols">${side(1)}<div class="vs">VS</div>${this.solo() ? this.cpuSide() : side(2)}</div>
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
        const cpu = p === 2 && this.solo();
        const pk = cpu ? this.act.cpuPicks() : this.app.picks[p];
        const r = GD.weaponById(pk.ranged), me = GD.weaponById(pk.melee);
        const row = (w) => `<div><span class="pill ${GD.aff(w, sid)}">${AFF[GD.aff(w, sid)]}</span><span>${w.name} · ${w.st[sid].pro}<em>弱點：${w.st[sid].con}</em></span></div>`;
        const who = cpu ? `CPU ${GD.AI_LEVELS[this.app.cpuLevel].label} · ${mechOf(pk.mech).name}` : `PLAYER ${p} · ${mechOf(pk.mech).name}`;
        const why = cpu && pk.reasons ? `<div class="why">${pk.reasons.map((t) => `<span>${t}</span>`).join('')}</div>` : '';
        return `<div class="mu panel p${p}"><div class="who"><span>${who}</span>${cpu ? '<span class="tag ready">自動配置</span>' : ''}</div>${row(r)}${row(me)}${why}</div>`;
      };
      return `<div class="scr-head"><h2>SELECT STAGE · 選擇場景</h2><span class="step">STEP 3 / 3 · 場景重力會改變所有實體彈藥的軌跡</span></div>
        <div class="stage-cards">${GD.STAGE_ORDER.map(card).join('')}</div>
        <div class="matchup">${mu(1)}${mu(2)}</div>
        ${this.guest()
          ? '<p class="keys-hint"><span>由主機（PLAYER 1）選擇場景並開始對戰，請稍候。</span></p>'
          : `<p class="keys-hint"><span>任一玩家 ${kbd(1, 'left')}${kbd(1, 'right')} 或 ${kbd(2, 'left')}${kbd(2, 'right')} 切換場景 · ${kbd(1, 'sub')} / ${kbd(2, 'sub')} 返回</span>
          <button class="go" data-act="start">開始對戰 ${kbd(1, 'attack')} ${kbd(2, 'attack')} <kbd>Enter</kbd></button></p>`}`;
    }

    html_cpu() {
      const items = GD.AI_ORDER.map((id, i) => {
        const L = GD.AI_LEVELS[id];
        return `<button class="lvl panel ${i === this.cursor.cpu ? 'on' : ''}" data-act="level" data-id="${i}">
            <span class="lvl-name">${L.label}<small>${id.toUpperCase()}</small></span><span class="lvl-desc">${L.desc}</span></button>`;
      }).join('');
      return `<div class="scr-head"><h2>VS CPU · 電腦強度</h2><span class="step">單人模式 · 電腦會在你選好場景後自動配置機體與武器</span></div>
        <div class="lvls">${items}</div>
        <p class="keys-hint"><span>${kbd(1, 'up')}${kbd(1, 'down')} 或 ${kbd(2, 'up')}${kbd(2, 'down')} 選擇 · ${kbd(1, 'attack')} / <kbd>Enter</kbd> 確認 · ${kbd(1, 'sub')} 返回</span></p>`;
    }

    // Lobby entries: open a room on this server, or join one heard on the LAN.
    lanItems() {
      const list = [{ kind: 'create' }];
      const info = this.app.lanRooms || { rooms: [] };
      if (info.self && info.self.players > 0) list.push({ kind: 'join', room: { name: `${info.self.name}（這台伺服器）`, url: '', players: info.self.players } });
      for (const r of info.rooms || []) if (r.players > 0) list.push({ kind: 'join', room: r });
      return list;
    }

    lanPick(item) {
      if (!item) return;
      if (item.kind === 'create') this.act.lanConnect('');
      else if (item.room.players < 2) this.act.lanConnect(item.room.url);
    }

    html_lan() {
      const net = this.app.net;
      const note = this.app.lanNote ? `<p class="lan-note">${this.app.lanNote}</p>` : '';
      let body;
      if (!net.supported) {
        body = `<p>區域網路對戰需要用 Gravity Duel 程式開啟遊戲。目前這個頁面是直接開檔或在預覽中執行，無法連線。</p>
          <ol>
            <li><b>Windows</b>：執行安裝檔 <code>GravityDuel-Setup.exe</code>，從桌面的 Gravity Duel 圖示開啟。</li>
            <li><b>其他系統</b>：安裝 Node.js 後在專案資料夾執行 <code>node server/lan-server.js</code>，用瀏覽器打開它顯示的網址。</li>
            <li>兩台電腦都選「區域網路對戰」，一台建立房間，另一台會在列表看到它。</li>
          </ol>
          <p class="muted">兩台電腦要在同一個 Wi-Fi 或區域網路。</p>`;
      } else if (!net.ws) {
        // Not in a room yet: the room browser.
        const items = this.lanItems();
        this.lanCursor = Math.min(this.lanCursor, items.length - 1);
        const rows = items.map((it, i) => {
          const on = i === this.lanCursor ? 'on' : '';
          if (it.kind === 'create') {
            return `<button class="room ${on}" data-act="lanroom" data-id="${i}"><b>＋ 建立房間</b><span>在這台電腦開房，等別人加入（你是主機）</span></button>`;
          }
          const full = it.room.players >= 2;
          return `<button class="room ${on} ${full ? 'full' : ''}" data-act="lanroom" data-id="${i}"><b>${it.room.name}</b>
            <span>${it.room.url ? it.room.url.replace('http://', '') : '同一台伺服器'} · ${full ? '已滿' : '等待對手中，按下加入'}</span></button>`;
        }).join('');
        const searching = items.length === 1 ? '<p class="muted">正在搜尋同一個網路裡的房間… 對方建立房間後會自動出現在這裡。</p>' : '';
        body = `<div class="rooms">${rows}</div>${searching}
          <div class="manual"><label for="lanAddr">找不到房間時，輸入對方畫面上的位址：</label>
            <span><input id="lanAddr" type="text" inputmode="url" placeholder="192.168.1.20:8080" autocomplete="off">
            <button class="readybtn" data-act="lanmanual">加入</button></span></div>`;
      } else if (net.status === 'connecting') {
        body = '<p class="lan-big">連線到伺服器中…</p>';
      } else if (net.status === 'online' && !net.peer) {
        body = `<p class="lan-big">你是 PLAYER ${net.player}${net.isHost ? '（主機）' : ''}，等待對手加入…</p>
          <p>同一個網路裡的玩家打開 Gravity Duel 的「區域網路對戰」，就會在列表看到這個房間。也可以讓對方輸入：</p>
          ${net.links.map((u) => `<p class="lan-url">${u.replace('http://', '')}</p>`).join('')}`;
      } else if (net.status === 'online') {
        body = `<p class="lan-big">對手已連線，準備進入選擇機體。</p>`;
      } else if (net.status === 'full') {
        body = '<p class="lan-big">房間已滿，已經有兩位玩家在線上。</p>';
      } else {
        body = `<p class="lan-big">沒有連上伺服器。</p><p>請確認對方的 Gravity Duel 還開著，再按返回回到房間列表。</p>`;
      }
      return `<div class="scr-head"><h2>LAN · 區域網路對戰</h2><span class="step">兩台電腦各自用自己的鍵盤或按鈕操作</span></div>
        <div class="modal panel lan">${note}${body}
          <div class="lan-actions">${net.ws || net.status === 'full' || net.status === 'error' || net.status === 'closed'
            ? `<button class="readybtn" data-act="lanleave">${net.ws ? '離開房間' : '回到房間列表'} ${kbd(1, 'sub')}</button>`
            : `<button class="readybtn" data-act="menu" data-id="title">返回標題 ${kbd(1, 'sub')}</button>`}</div></div>`;
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
            <li>單人模式中，鍵盤左右兩側的按鍵都能操作你的機體。</li>
            <li><kbd>Esc</kbd> 暫停 · <kbd>M</kbd> 音效開關 · <kbd>\`</kbd> 除錯資訊</li>
          </ul>
          <button class="readybtn" data-act="back">返回 <kbd>Enter</kbd></button>
        </div>`;
    }

    html_battle() { return ''; }
  }

  GD.Menus = Menus;
})(globalThis.GD = globalThis.GD || {});
