// The mech lab (機體工房): the player's mech on a turntable inside the game, with its design open for
// editing. The part tree on the left, the selected part's fields on the right, animation and weapon
// pickers along the bottom. Every edit rebuilds the mech at once (through onDesign, which also keeps
// the design in the browser); "reset" hands the stock design back. Parts can be picked by clicking
// them in the view, and moved, turned and resized right there: a selected part carries a gizmo (arrows,
// rings or cubes, W / E / R), and dragging the part itself slides it across the screen. During a drag
// only the live objects move; the design is rebuilt once the button comes up. Pure DOM and Three.js
// here; the game owns the scene, the mech and the camera and calls frame() and animate() each frame
// while the lab is open.
//
//   const lab = createLab({ root, canvas, stock, design (getter), onDesign(design), onClose, sfx });
//   lab.open(mech); lab.frame(dt, camera, mech); lab.animate(mech, dt); lab.close();

import * as THREE from 'three';
import { animateMech } from '../../engine/render/mech-anim.js';
import { validateDesign, partGeometry, SHAPES, MATS } from '../../engine/render/mech-builder.js';
import { createGizmo, rayAxisParam, rayPlanePoint, planeBasis, angleInPlane, angleDelta, eulerAxes } from '../../engine/render/gizmo.js';
import { WEAPONS, WEAPON_CLASSES, MOVE } from './config.js';

const JOINTS = new Set(['torso', 'head', 'arm', 'thigh', 'shin', 'wing', 'flame', 'weapon', 'vulcan', 'hips']);
const WEAPON_IDS = new Set(['rocket', 'longrifle', 'handcannon', 'saber', 'greatblade', 'knife']);
const MAT_ZH = { armor: '主裝甲', armor2: '深色裝甲', trim: '金屬飾邊', glow: '發光', dark: '關節', blade: '刀身（發光）', aura: '刀光（半透明）', flame: '噴射火焰' };
const SHAPE_ZH = { box: '方塊', cyl: '圓柱', cone: '圓錐', sphere: '球', group: '群組／關節' };
const SIZE_LABELS = { box: ['寬', '高', '深'], cyl: ['上半徑', '下半徑', '高', '邊數'], cone: ['半徑', '高', '邊數'], sphere: ['半徑', '細分'], group: [] };
const ANIMS = { idle: '站立', run: '跑步', boost: '噴射', aim: '瞄準', guard: '防禦', slash: '揮砍', hit: '受擊' };
const SLOTS_ZH = { melee: '近戰', vulcan: '火神砲', ranged: '遠程' };
const DEG = 180 / Math.PI;
const MODES = { move: ['移動', 'W'], rotate: ['旋轉', 'E'], size: ['尺寸', 'R'] };
const SNAP = { move: 0.25, rotate: Math.PI / 12, size: 0.25 };

const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function createLab({ root, canvas, stock, design: getDesign, onDesign, onClose, sfx = null }) {
  let design = null;                  // the design being edited (a copy of the stock one once anything changes)
  let selected = null;                // the selected part object
  let selectedObj = null;             // the object of it the player clicked (one of its sides), if any
  let mech = null;
  let mode = 'move';                  // what the gizmo does: 'move' | 'rotate' | 'size'
  let drag = null;                    // a drag in progress: { kind: 'cam' | 'move' | 'free' | 'rotate' | 'size', ... }
  const gizmo = createGizmo();
  const stockJson = JSON.stringify(stock);
  const undo = [], redo = [];
  const ui = {};
  const cam = { yaw: 0.6, pitch: 0.28, dist: 48, idle: 0, auto: true, drag: null };
  const show = { anim: 'idle', cls: 'normal', slot: 'melee', t: 0 };
  const picker = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let highlight = null;
  let saveTimer = 0;

  // ---------------------------------------------------------------- DOM
  root.innerHTML = '';
  const top = el('div', 'lpanel ltop', root);
  el('h2', '', top, '機體工房');
  const topBtn = (label, cls, fn) => { const b = el('button', `lbtn ${cls || ''}`, top, label); b.type = 'button'; b.addEventListener('click', () => { click(); fn(); }); return b; };
  ui.undo = topBtn('復原', '', () => history(undo, redo));
  ui.redo = topBtn('重做', '', () => history(redo, undo));
  topBtn('匯出 JSON', '', exportJson);
  topBtn('匯入 JSON', '', () => ui.file.click());
  ui.file = document.createElement('input'); ui.file.type = 'file'; ui.file.accept = 'application/json,.json'; ui.file.hidden = true; top.appendChild(ui.file);
  ui.file.addEventListener('change', () => { const f = ui.file.files && ui.file.files[0]; if (f) importJson(f); ui.file.value = ''; });
  topBtn('恢復預設機體', 'danger', () => { if (confirm('放棄所有修改，回到原本的 AX-01？')) setDesign(stock, { stock: true }); });
  const modes = el('span', 'lmodes', top);
  ui.modes = {};
  for (const [k, [zh, key]] of Object.entries(MODES)) {
    const b = el('button', `lbtn ${k === mode ? 'on' : ''}`, modes); b.type = 'button'; b.innerHTML = `${zh}<small>${key}</small>`; b.title = `拖曳零件的方式（${key}）`;
    b.addEventListener('click', () => { click(); setMode(k); });
    ui.modes[k] = b;
  }
  el('span', 'lhint', top, '點零件選取 · 拖零件／箭頭移動、環旋轉、方塊改尺寸（Shift 吸附）· 右鍵拖曳轉鏡頭 · 滾輪縮放 · Esc 關閉');
  topBtn('關閉', 'primary', () => onClose && onClose());

  const treePanel = el('div', 'lpanel ltree', root);
  const treeHead = el('div', 'lhead', treePanel, '零件');
  ui.count = el('span', '', treeHead, '');
  ui.tree = el('div', 'tree', treePanel);
  ui.palette = el('div', 'lpal', treePanel);

  const fieldPanel = el('div', 'lpanel lfields', root);
  const fieldHead = el('div', 'lhead', fieldPanel, '選取的零件');
  const headBtns = el('span', 'lrow', fieldHead);
  const fieldBtn = (label, cls, fn) => { const b = el('button', `lbtn ${cls || ''}`, headBtns, label); b.type = 'button'; b.addEventListener('click', () => { click(); fn(); }); return b; };
  ui.add = fieldBtn('＋子零件', '', addChild);
  ui.dup = fieldBtn('複製', '', duplicate);
  ui.del = fieldBtn('刪除', 'danger', remove);
  ui.fields = el('div', 'fields', fieldPanel);
  ui.note = el('div', 'lnote', fieldPanel, '');

  const bottom = el('div', 'lpanel lbottom', root);
  const pick = (label, options, value, fn) => {
    const lab = el('label', '', bottom, label);
    const sel = el('select', '', lab);
    for (const [k, zh] of options) { const o = el('option', '', sel, zh); o.value = k; }
    sel.value = value;
    sel.addEventListener('change', () => { click(); fn(sel.value); });
    return sel;
  };
  pick('動作', Object.entries(ANIMS), show.anim, (v) => { show.anim = v; show.t = 0; });
  pick('武裝', Object.entries(WEAPON_CLASSES).map(([k, w]) => [k, w.zh]), show.cls, (v) => { show.cls = v; });
  pick('手持', Object.entries(SLOTS_ZH), show.slot, (v) => { show.slot = v; });
  const spin = el('label', '', bottom);
  const spinBox = el('input', '', spin); spinBox.type = 'checkbox'; spinBox.checked = true;
  spin.appendChild(document.createTextNode('自動轉動'));
  spinBox.addEventListener('change', () => { cam.auto = spinBox.checked; });
  ui.status = el('span', 'lhint', bottom, '');

  // ---------------------------------------------------------------- the design
  function setDesign(d, { stock: isStock = false, keepSelection = false, record = true } = {}) {
    if (record && design) { undo.push(JSON.stringify(design)); if (undo.length > 60) undo.shift(); redo.length = 0; }
    design = isStock ? stock : d;
    if (!keepSelection) selected = null;
    onDesign(design);
    renderAll();
  }
  // The stock design is never edited: the first change works on a copy.
  function editable() {
    if (design === stock) { const copy = structuredClone(stock); copy.id = 'custom'; return copy; }
    return design;
  }
  // Starts an edit: records the design for undo and makes it editable (the first edit of the stock
  // design moves to a copy, with the selection moved to the copy's part at the same path). Returns
  // the selected part of the design being edited.
  function beginEdit() {
    const d = editable();
    if (d !== design) {
      const path = selected ? pathOf(design, selected) : null;
      undo.push(JSON.stringify(design)); redo.length = 0;
      design = d;
      selected = path ? partAt(design, path) : null;
    } else { undo.push(JSON.stringify(design)); if (undo.length > 60) undo.shift(); redo.length = 0; }
    return selected;
  }
  // An edit of the current design in one go: `fn(design, part)` edits in place (part: the selected
  // part of the design being edited, not the fields' closure's), then rebuild and redraw.
  function edit(fn, { redraw = true } = {}) {
    const part = beginEdit();
    fn(design, part);
    onDesign(design);
    if (redraw) renderAll(); else { renderTree(); refreshHighlight(); buttons(); }
  }
  function buttons() { ui.undo.disabled = !undo.length; ui.redo.disabled = !redo.length; ui.dup.disabled = ui.del.disabled = !selected; }
  function history(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(design));
    const s = from.pop();
    const d = s === stockJson ? stock : JSON.parse(s);          // back at the stock: the stock itself
    const path = selected ? pathOf(design, selected) : null;
    design = d;
    selected = path ? partAt(design, path) : null;
    selectedObj = null;
    onDesign(design);
    renderAll();
  }
  // Where a part sits in the tree ([index, index, ...] through parts/children), or null.
  function pathOf(d, part) {
    const walk = (list, path) => {
      for (let i = 0; i < list.length; i++) {
        if (list[i] === part) return [...path, i];
        const found = list[i].children ? walk(list[i].children, [...path, i]) : null;
        if (found) return found;
      }
      return null;
    };
    return walk(d.parts, []);
  }
  function partAt(d, path) {
    let list = d.parts, part = null;
    for (const i of path) { part = list && list[i]; if (!part) return null; list = part.children; }
    return part;
  }
  function parentOf(d, part) {
    const path = pathOf(d, part);
    if (!path) return null;
    return path.length === 1 ? { list: d.parts, index: path[0] } : { list: partAt(d, path.slice(0, -1)).children, index: path[path.length - 1] };
  }
  function countParts(d) { let n = 0; const walk = (list) => { for (const p of list) { n++; if (p.children) walk(p.children); } }; walk(d.parts); return n; }

  function addChild() {
    edit((d) => {
      const part = { shape: 'box', size: [2, 2, 2], pos: [0, 0, 0], mat: 'armor' };
      const where = selected ? pathOf(d, selected) : null;
      if (where) { const parent = partAt(d, where); (parent.children = parent.children || []).push(part); } else d.parts.push(part);
      selected = part;
    });
  }
  function duplicate() {
    if (!selected) return;
    edit((d) => {
      const at = parentOf(d, selected);
      if (!at) return;
      const copy = structuredClone(at.list[at.index]);
      if (copy.name) copy.name = `${copy.name}2`;
      at.list.splice(at.index + 1, 0, copy);
      selected = copy;
    });
  }
  function remove() {
    if (!selected) return;
    edit((d) => {
      const at = parentOf(d, selected);
      if (at) at.list.splice(at.index, 1);
      selected = null;
    });
  }
  function exportJson() {
    const text = JSON.stringify(design, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `${design.id || 'mech'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importJson(file) {
    file.text().then((text) => {
      let d;
      try { d = JSON.parse(text); } catch (e) { note(`讀不懂這個檔案：${e.message}`, true); return; }
      const problems = validateDesign(d);
      if (problems.length) { note(`這個設計有問題：\n${problems.slice(0, 8).join('\n')}`, true); return; }
      setDesign(d);
      note(`已匯入 ${file.name}：${countParts(d)} 個零件。`);
    });
  }
  function note(text, bad = false) { ui.note.textContent = text; ui.note.className = `lnote ${bad ? 'bad' : ''}`; }
  function click() { if (sfx) sfx.play('menuMove'); }

  // ---------------------------------------------------------------- the tree
  function renderAll() { renderTree(); renderFields(); renderPalette(); refreshHighlight(); buttons(); }
  function renderTree() {
    ui.tree.innerHTML = '';
    ui.count.textContent = `${countParts(design)} 個`;
    const pal = design.palette;
    const walk = (list, depth) => {
      for (const part of list) {
        const row = el('div', `tnode ${part === selected ? 'sel' : ''}`, ui.tree);
        row.style.setProperty('--d', depth);
        const shape = part.shape || 'group';
        if (shape !== 'group') { const sw = el('i', 'tmat', row); sw.style.background = part.mat === 'aura' || part.mat === 'flame' ? 'transparent' : hex(pal[part.mat === 'blade' ? 'glow' : part.mat] ?? pal.armor); }
        const isJoint = part.name && (JOINTS.has(part.name) || WEAPON_IDS.has(part.name));
        el('span', `tname ${isJoint ? 'joint' : ''}`, row, part.name || SHAPE_ZH[shape] || shape);
        el('span', 'tinfo', row, part.name ? SHAPE_ZH[shape] + (part.mirror ? ' ×2' : '') : (part.size ? part.size.slice(0, 3).map((v) => round(v, 1)).join('×') : '') + (part.mirror ? ' ×2' : ''));
        row.addEventListener('click', () => { selected = part; selectedObj = null; renderAll(); });
        if (part.children) walk(part.children, depth + 1);
      }
    };
    walk(design.parts, 0);
    const sel = ui.tree.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  // ---------------------------------------------------------------- the fields
  function renderFields() {
    ui.fields.innerHTML = '';
    ui.dup.disabled = ui.del.disabled = !selected;
    if (!selected) {
      el('div', 'lempty', ui.fields, '點左邊的零件，或直接點畫面上的機體，就能改它的形狀、大小、位置、角度與材質。「＋子零件」會在選取的零件底下加一個方塊（沒選取時加在最上層）。\n\n黃色名字是動畫會轉動的關節，改名會讓那個部位不動。單位是公尺，機體高 18 m；+X 是機體的右手邊，面向 -Z。');
      return;
    }
    const part = selected;
    const shape = part.shape || 'group';
    const row = (label) => { const r = el('div', 'frow', ui.fields); el('span', '', r, label); return r; };
    // Name.
    const name = el('input', '', row('名稱')); name.type = 'text'; name.value = part.name || ''; name.placeholder = '（無）';
    name.addEventListener('change', () => edit((d, p) => { if (name.value.trim()) p.name = name.value.trim(); else delete p.name; }));
    // Shape.
    const sh = el('select', '', row('形狀'));
    for (const k of Object.keys(SHAPES)) { const o = el('option', '', sh, SHAPE_ZH[k]); o.value = k; }
    sh.value = shape;
    sh.addEventListener('change', () => edit((d, p) => {
      const to = sh.value;
      if (to === 'group') { p.shape = 'group'; delete p.size; delete p.mat; }
      else {
        p.shape = to;
        const defaults = { box: [2, 2, 2], cyl: [1, 1, 2, 12], cone: [1, 2, 8], sphere: [1, 10] };
        const old = p.size || [];
        p.size = defaults[to].map((v, i) => (old[i] != null && (to !== 'cyl' || i < 3) && (to !== 'cone' || i < 2) && (to !== 'sphere' || i < 1) ? old[i] : v));
        if (!p.mat) p.mat = 'armor';
      }
    }));
    // Size.
    if (shape !== 'group') {
      const labels = SIZE_LABELS[shape];
      const r = row('尺寸');
      const nums = el('div', `fnums ${labels.length === 4 ? 'four' : ''}`, r);
      labels.forEach((lab, i) => numInput(nums, lab, part.size[i] ?? 0, i >= SHAPES[shape] ? 1 : 0.1, (v) => edit((d, p) => { p.size[i] = i >= SHAPES[shape] ? Math.max(3, Math.round(v)) : Math.max(0.05, v); }, { redraw: false }), `size-${i}`));
    }
    // Position and rotation.
    vecRow('位置', part.pos || [0, 0, 0], 0.1, (i, v) => edit((d, p) => { (p.pos = p.pos || [0, 0, 0])[i] = v; }, { redraw: false }), 'pos');
    vecRow('旋轉°', (part.rot || [0, 0, 0]).map((v) => round(v * DEG, 1)), 5, (i, v) => edit((d, p) => { (p.rot = p.rot || [0, 0, 0])[i] = v / DEG; }, { redraw: false }), 'rot');
    if (part.scale) vecRow('縮放', part.scale, 0.1, (i, v) => edit((d, p) => { p.scale[i] = v; }, { redraw: false }));
    // Material.
    if (shape !== 'group') {
      const mat = el('select', '', row('材質'));
      for (const k of MATS) { const o = el('option', '', mat, MAT_ZH[k]); o.value = k; }
      mat.value = part.mat || 'armor';
      mat.addEventListener('change', () => edit((d, p) => { p.mat = mat.value; }));
    }
    // Mirror and side.
    const mr = row('左右');
    const wrap = el('div', 'lrow', mr);
    const mirror = el('label', '', wrap); const mbox = el('input', '', mirror); mbox.type = 'checkbox'; mbox.checked = !!part.mirror; mirror.appendChild(document.createTextNode(' 左右各一（鏡像）'));
    mbox.addEventListener('change', () => edit((d, p) => { if (mbox.checked) p.mirror = true; else delete p.mirror; }));
    const only = el('select', '', wrap);
    for (const [k, zh] of [['', '兩側都有'], ['R', '只在右側'], ['L', '只在左側']]) { const o = el('option', '', only, zh); o.value = k; }
    only.value = part.only || '';
    only.title = '在鏡像零件底下：只建在這一側（例如右手的武器）';
    only.addEventListener('change', () => edit((d, p) => { if (only.value) p.only = only.value; else delete p.only; }));
    const info = el('div', 'lnote', ui.fields);
    info.textContent = `${part.children ? `${part.children.length} 個子零件；` : ''}${part.name && JOINTS.has(part.name) ? '這是動畫關節，位置是轉軸。' : part.name && WEAPON_IDS.has(part.name) ? '這是武器模型：對應到武裝「' + weaponZh(part.name) + '」。' : ''}`;
  }
  function numInput(parent, label, value, step, fn, field = '') {
    const wrap = el('label', '', parent);
    wrap.title = label;
    const inp = el('input', '', wrap); inp.type = 'number'; inp.step = step; inp.value = round(value, 2);
    if (field) inp.dataset.field = field;
    inp.addEventListener('input', () => { const v = Number(inp.value); if (Number.isFinite(v)) fn(v); });
    return inp;
  }
  function vecRow(label, vec, step, fn, field = '') {
    const r = el('div', 'frow', ui.fields); el('span', '', r, label);
    const nums = el('div', 'fnums', r);
    ['x', 'y', 'z'].forEach((ax, i) => numInput(nums, ax, vec[i], step, (v) => fn(i, v), field ? `${field}-${i}` : ''));
  }
  // The fields' numbers follow a drag without rebuilding the panel.
  function refreshFieldValues(part) {
    for (const inp of ui.fields.querySelectorAll('input[data-field]')) {
      const [k, i] = inp.dataset.field.split('-');
      const v = k === 'pos' ? (part.pos || [0, 0, 0])[i] : k === 'rot' ? (part.rot || [0, 0, 0])[i] * DEG : part.size ? part.size[i] : 0;
      if (document.activeElement !== inp) inp.value = round(v, k === 'rot' ? 1 : 2);
    }
  }
  function weaponZh(id) { for (const kind of ['ranged', 'melee']) for (const w of Object.values(WEAPONS[kind])) if (w.id === id) return w.zh; return id; }

  function renderPalette() {
    ui.palette.innerHTML = '';
    for (const k of ['armor', 'armor2', 'trim', 'glow', 'dark']) {
      const lab = el('label', '', ui.palette, MAT_ZH[k]);
      const inp = el('input', '', lab); inp.type = 'color'; inp.value = hex(design.palette[k]);
      inp.addEventListener('input', () => edit((d) => { d.palette[k] = parseInt(inp.value.slice(1), 16); }, { redraw: false }));
    }
  }

  // ---------------------------------------------------------------- the view
  // The objects built from a part (both sides of a mirrored one), with the side sign the builder used
  // for x and for the y / z rotations.
  function objectsOf(part) {
    const out = [];
    if (mech) mech.group.traverse((o) => { if (o.userData.part === part) out.push({ obj: o, sx: o.userData.side === 'L' ? -1 : 1 }); });
    return out;
  }
  function refreshHighlight() {
    if (highlight) { highlight.parent && highlight.parent.remove(highlight); highlight = null; }
    gizmo.hide();
    if (!selected || !mech) return;
    const objs = objectsOf(selected);
    if (!objs.length) return;
    // The object the player picked, or (after a rebuild) the one on the same side, else the right one.
    const side = selectedObj ? selectedObj.userData.side : 'R';
    const ref = objs.find((o) => o.obj === selectedObj) || objs.find((o) => o.obj.userData.side === side) || objs.find((o) => o.sx > 0) || objs[0];
    selectedObj = ref.obj;
    highlight = new THREE.BoxHelper(ref.obj, 0xffd040);
    highlight.material.depthTest = false;
    highlight.renderOrder = 10;
    mech.group.parent.add(highlight);
    if (!gizmo.group.parent) mech.group.parent.add(gizmo.group);
    placeGizmo();
  }
  // The gizmo sits at the selected object's origin: arrows along its parent's axes (the position is in
  // parent space), rings about the axes its Euler angles turn about, cubes along its own axes.
  const qTmp = new THREE.Quaternion(), qParent = new THREE.Quaternion(), pTmp = new THREE.Vector3();
  function gizmoAxes(obj, which) {
    obj.parent.getWorldQuaternion(qParent);
    if (which === 'rotate') return eulerAxes(qParent, obj.rotation);
    const q = which === 'size' ? obj.getWorldQuaternion(qTmp) : qParent;
    return [new THREE.Vector3(1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(0, 0, 1).applyQuaternion(q)];
  }
  function placeGizmo() {
    if (!selected || !selectedObj || !mech) { gizmo.hide(); return; }
    const shape = selected.shape || 'group';
    if (mode === 'size' && shape === 'group') { gizmo.hide(); return; }
    mech.group.updateMatrixWorld(true);
    selectedObj.getWorldPosition(pTmp);
    gizmo.show(mode, pTmp, gizmoAxes(selectedObj, mode));
  }
  function setMode(m) {
    mode = m;
    for (const [k, b] of Object.entries(ui.modes)) b.classList.toggle('on', k === m);
    placeGizmo();
  }
  // Is this object drawn (none of its ancestors hidden)?
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function rayAt(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    picker.setFromCamera(ndc, cam.camera);
    return picker;
  }
  // The part under the pointer: { part, obj } or null.
  function partAtPointer(e) {
    if (!mech) return null;
    const hits = rayAt(e).intersectObject(mech.group, true).filter((h) => h.object.userData.part && shown(h.object) && h.object.material !== mech.materials.aura);
    return hits.length ? { part: hits[0].object.userData.part, obj: hits[0].object } : null;
  }
  function select(part, obj) {
    selected = part; selectedObj = obj || null;
    click();
    renderAll();
  }

  // ---- dragging the selected part
  // Snapping with Shift: positions and sizes to a quarter metre, angles to 15°.
  const snap = (v, step, on) => (on ? Math.round(v / step) * step : v);
  function beginDrag(kind, axis, e) {
    // The live objects are found before the edit, which may move the design to a copy.
    const objs = objectsOf(selected);
    const ref = objs.find((o) => o.obj === selectedObj) || objs[0];
    if (!ref) return false;
    const before = { design, selected };            // to come back to when the drag goes nowhere
    const part = beginEdit();
    if (!part) { giveUp(before); return false; }
    const ray = rayAt(e).ray;
    mech.group.updateMatrixWorld(true);
    const origin = ref.obj.getWorldPosition(new THREE.Vector3());
    const d = { kind, axis, part, objs, sx: ref.sx, origin, before, live: null, start: { pos: (part.pos || [0, 0, 0]).slice(), rot: (part.rot || [0, 0, 0]).slice(), size: (part.size || []).slice() }, moved: false };
    let ok = true;
    if (kind === 'move' || kind === 'size') {
      d.dir = gizmoAxes(ref.obj, kind)[axis];
      d.t0 = rayAxisParam(ray, origin, d.dir);
      ok = !Number.isNaN(d.t0);
    } else if (kind === 'free') {
      d.normal = cam.camera.getWorldDirection(new THREE.Vector3()).negate();
      d.p0 = rayPlanePoint(ray, origin, d.normal);
      ref.obj.parent.getWorldQuaternion(d.parentQ = new THREE.Quaternion());
      ok = !!d.p0;
    } else if (kind === 'rotate') {
      d.dir = gizmoAxes(ref.obj, 'rotate')[axis];
      Object.assign(d, planeBasis(d.dir));
      const p = rayPlanePoint(ray, origin, d.dir);
      ok = !!p;
      if (p) { d.a0 = angleInPlane(p, origin, d.u, d.v); d.turn = 0; }
    }
    if (!ok) { giveUp(before); return false; }
    drag = d;
    canvas.setPointerCapture(e.pointerId);
    return true;
  }
  function moveDrag(e) {
    const d = drag, part = d.part, ray = rayAt(e).ray, shift = e.shiftKey;
    if (d.kind === 'move') {
      const t = rayAxisParam(ray, d.origin, d.dir);
      if (Number.isNaN(t)) return;
      const delta = snap(t - d.t0, SNAP.move, shift);
      part.pos = d.start.pos.slice();
      part.pos[d.axis] = round(d.start.pos[d.axis] + delta * (d.axis === 0 ? d.sx : 1), 3);
    } else if (d.kind === 'free') {
      const p = rayPlanePoint(ray, d.origin, d.normal);
      if (!p) return;
      // The step across the screen plane, in the parent's frame.
      const local = p.sub(d.p0).applyQuaternion(qTmp.copy(d.parentQ).invert());
      part.pos = [round(d.start.pos[0] + snap(local.x, SNAP.move, shift) * d.sx, 3), round(d.start.pos[1] + snap(local.y, SNAP.move, shift), 3), round(d.start.pos[2] + snap(local.z, SNAP.move, shift), 3)];
    } else if (d.kind === 'rotate') {
      const p = rayPlanePoint(ray, d.origin, d.dir);
      if (!p) return;
      const a = angleInPlane(p, d.origin, d.u, d.v);
      d.turn += angleDelta(d.a0, a);
      d.a0 = a;
      const turn = snap(d.turn, SNAP.rotate, shift);
      part.rot = d.start.rot.slice();
      part.rot[d.axis] = round(d.start.rot[d.axis] + turn * (d.axis === 0 ? 1 : d.sx), 4);
    } else if (d.kind === 'size') {
      const t = rayAxisParam(ray, d.origin, d.dir);
      if (Number.isNaN(t)) return;
      const delta = snap(t - d.t0, SNAP.size, shift);
      part.size = d.start.size.slice();
      const grow = (i, k) => { part.size[i] = round(Math.max(0.05, d.start.size[i] + delta * k), 3); };
      const shape = part.shape || 'group';
      if (shape === 'box') grow(d.axis, 2);
      else if (shape === 'cyl') { if (d.axis === 1) grow(2, 2); else { grow(0, 1); grow(1, 1); } }
      else if (shape === 'cone') { if (d.axis === 1) grow(1, 2); else grow(0, 1); }
      else if (shape === 'sphere') grow(0, 1);
    }
    d.moved = true;
    applyLive(d);
  }
  // The live objects (and the animator's rest pose, for a joint) take the part's new values at once.
  function applyLive(d) {
    const part = d.part, pos = part.pos || [0, 0, 0], rot = part.rot || [0, 0, 0];
    if (d.kind === 'size') {
      // One fresh geometry (not the builder's shared cache) for the live objects; the last one goes.
      if (part.shape && part.shape !== 'group') {
        const g = partGeometry(part.shape, part.size, { cached: false });
        for (const { obj } of d.objs) if (obj.isMesh) obj.geometry = g;
        dropLive(d); d.live = g;
      }
    } else for (const { obj, sx } of d.objs) {
      obj.position.set(pos[0] * sx, pos[1], pos[2]);
      obj.rotation.set(rot[0], rot[1] * sx, rot[2] * sx);
      const rest = obj.name && mech.rest.get(obj.name);
      if (rest) { rest.pos.copy(obj.position); rest.rot.copy(obj.rotation); }
    }
    if (highlight) highlight.update();
    placeGizmo();
    refreshFieldValues(part);
  }
  const dropLive = (d) => { if (d.live) { d.live.dispose(); d.live = null; } };
  // A drag that changed nothing: forget its undo entry (and the copy of the stock design, if any).
  function giveUp(before) { undo.pop(); design = before.design; selected = before.selected; buttons(); }
  function endDrag() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) { onDesign(design); renderAll(); } else giveUp(d.before);
    dropLive(d);                                 // the rebuilt mech has its own geometry
  }

  const onDown = (e) => {
    if (!open || e.target !== canvas) return;
    if (e.button === 0 && selected && selectedObj) {
      const hit = gizmo.pick(rayAt(e));
      if (hit && beginDrag(hit.mode, hit.axis, e)) return;
      const under = partAtPointer(e);
      if (under && under.part === selected && mode === 'move' && beginDrag('free', 0, e)) return;
    }
    drag = { kind: 'cam', x: e.clientX, y: e.clientY, moved: false, button: e.button };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!open) return;
    if (!drag) {
      if (selected && e.target === canvas) gizmo.hover(gizmo.pick(rayAt(e)));
      return;
    }
    cam.idle = 0;
    if (drag.kind !== 'cam') { moveDrag(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    cam.yaw -= dx * 0.008; cam.pitch = Math.max(-0.4, Math.min(1.3, cam.pitch + dy * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
  };
  const onUp = (e) => {
    if (!open || !drag) return;
    if (drag.kind !== 'cam') { endDrag(); return; }
    const d = drag; drag = null;
    if (!d.moved && d.button === 0) { const under = partAtPointer(e); if (under) select(under.part, under.obj); }
  };
  const onWheel = (e) => { if (!open) return; cam.dist = Math.max(14, Math.min(140, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); cam.idle = 0; };
  const typing = () => { const t = document.activeElement; return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'); };
  const onKey = (e) => {
    if (!open) return;
    if (e.code === 'Escape') {
      if (typing()) { document.activeElement.blur(); return; }
      if (drag && drag.kind !== 'cam') { const d = drag; drag = null; history(undo, redo); dropLive(d); return; }    // drop the drag: back to before it
      e.preventDefault(); onClose && onClose();
      return;
    }
    if (typing()) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) history(redo, undo); else history(undo, redo); return; }
    if (e.code === 'KeyW') setMode('move'); else if (e.code === 'KeyE') setMode('rotate'); else if (e.code === 'KeyR') setMode('size');
    else if ((e.code === 'Delete' || e.code === 'Backspace') && selected) { e.preventDefault(); remove(); }
  };
  let open = false;
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKey);

  // The preview's animation state for the chosen animation, weapon class and slot.
  function previewState(dt) {
    show.t += dt;
    const w = WEAPON_CLASSES[show.cls] ? show.cls : 'normal';
    const ranged = WEAPONS.ranged[w], melee = WEAPONS.melee[w];
    const st = { speed: 0, runSpeed: MOVE.run, onGround: true, boosting: false, dashing: false, vy: 0, landLag: 0, aiming: false, aimPitch: 0,
      active: show.slot, melee: null, guard: false, stun: 0, dead: false, rangedId: ranged.id, meleeId: melee.id,
      hitT: Infinity, hitSide: 0, hitHeavy: false, firedT: Infinity, firedKind: '' };
    switch (show.anim) {
      case 'run': st.speed = MOVE.run; break;
      case 'boost': st.onGround = false; st.boosting = true; st.vy = 12; break;
      case 'aim': st.aiming = true; st.aimPitch = 0.15 * Math.sin(show.t * 0.8); st.active = 'ranged'; break;
      case 'guard': st.guard = true; break;
      case 'hit': { const t = show.t % 1.4; st.hitT = t; st.hitSide = 1; st.hitHeavy = true; break; }
      case 'slash': {
        // The weapon's combo, swing after swing, with a pause between rounds.
        st.active = 'melee';
        const combo = melee.combo;
        const total = combo.reduce((a, s) => a + s.windup + s.active + s.recovery, 0) + 0.8;
        let t = show.t % total;
        for (let i = 0; i < combo.length; i++) {
          const sw = combo[i], len = sw.windup + sw.active + sw.recovery;
          if (t < len) {
            const stage = t < sw.windup ? 'windup' : t < sw.windup + sw.active ? 'active' : 'recovery';
            const t0 = stage === 'windup' ? 0 : stage === 'active' ? sw.windup : sw.windup + sw.active;
            st.melee = { stage, progress: (t - t0) / sw[stage], style: sw.style || 'slashR' };
            break;
          }
          t -= len;
        }
        break;
      }
      default: break;
    }
    return st;
  }

  return {
    get open() { return open; },
    open(m) {
      open = true;
      mech = m;
      design = getDesign();
      undo.length = 0; redo.length = 0; selected = null; selectedObj = null; drag = null;
      root.hidden = false;
      cam.idle = 0; show.t = 0;
      renderAll();
      note(design === stock ? '這是原本的 AX-01。改了就會存在這個瀏覽器，進遊戲直接用。' : '這是你修改過的機體（存在這個瀏覽器）。');
    },
    close() {
      open = false;
      root.hidden = true;
      if (highlight) { highlight.parent && highlight.parent.remove(highlight); highlight = null; }
      gizmo.hide();
      drag = null;
      if (mech) { mech.group.rotation.set(0, mech.group.rotation.y, 0); mech.group.visible = true; }
    },
    // The turntable camera around the mech.
    frame(dt, camera, m) {
      mech = m;
      cam.camera = camera;
      cam.idle += dt;
      if (cam.auto && cam.idle > 2.5 && !cam.drag) cam.yaw += dt * 0.25;
      const p = m.group.position;
      const cy = p.y + 9;
      camera.position.set(p.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, cy + Math.sin(cam.pitch) * cam.dist, p.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
      camera.lookAt(p.x, cy, p.z);
      if (highlight) highlight.update();
      gizmo.update(camera);
      ui.status.textContent = `${countParts(design)} 個零件 · ${design === stock ? '原廠設計' : '自訂設計'}${selected ? ` · ${MODES[mode][0]}模式` : ''}`;
    },
    // The mech plays the chosen animation, in place, facing the camera's starting side.
    animate(m, dt) {
      mech = m;
      const st = previewState(dt);
      animateMech(m, st, dt);
      m.group.rotation.y = (m.rootYaw || 0);
      m.group.position.y = (st.onGround ? 0 : 6 + Math.sin(show.t * 2) * 1.5) + (m.rootLift || 0);
      // The mech's hand nodes may have been rebuilt: keep the highlight on the selected part; the gizmo
      // follows the part as the animation moves it (not while it is being dragged).
      if (selected && (!highlight || !highlight.parent)) refreshHighlight();
      else if (selected && !drag) placeGizmo();
    },
    // After a rebuild (onDesign), the game hands over the new mech object.
    setMech(m) { mech = m; if (!drag) { selectedObj = null; refreshHighlight(); } },
    setMode,
    get mode() { return mode; },
    get selected() { return selected; },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey);
      gizmo.dispose();
      clearTimeout(saveTimer);
    },
  };
}
