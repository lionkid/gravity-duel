// Rebindable keys. A binding table (see bindings.js) maps actions to lists of codes; the keyboard and
// mouse codes in each list are what the player may change (gamepad codes, 'Pad:…', stay as they are),
// in up to `SLOTS` slots. The table is edited in place, so a mapper holding it follows at once, and the
// difference from the game's defaults is what gets saved and restored.

export const SLOTS = 2;
const isPad = (c) => c.startsWith('Pad:');

export function cloneBindings(b) {
  const out = {};
  for (const group of Object.keys(b)) {
    const g = b[group];
    out[group] = Array.isArray(g) || typeof g !== 'object' || g === null ? structuredClone(g)
      : Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Array.isArray(v) ? v.slice() : structuredClone(v)]));
  }
  return out;
}

// The player-changeable codes of a binding, padded to SLOTS with ''.
export function keySlots(list) {
  const keys = (list || []).filter((c) => !isPad(c)).slice(0, SLOTS);
  while (keys.length < SLOTS) keys.push('');
  return keys;
}

// Puts `code` in slot `slot` of (group, action), taking it away from any other binding first so one
// key never does two things. An empty code clears the slot.
export function setKey(bindings, groups, group, action, slot, code) {
  if (code) {
    for (const g of Object.keys(groups)) for (const a of Object.keys(groups[g])) {
      const list = bindings[g] && bindings[g][a];
      if (list && !(g === group && a === action)) bindings[g][a] = list.filter((c) => c !== code);
    }
  }
  const list = bindings[group][action];
  const keys = keySlots(list), pads = list.filter(isPad);
  keys[slot] = code || '';
  // The same key twice in one binding is just once; empty slots close up.
  bindings[group][action] = [...keys.filter((c, i) => c && keys.indexOf(c) === i), ...pads];
  return bindings;
}

// The bindings that differ from the defaults, by "group.action", keyboard and mouse codes only.
export function diffBindings(bindings, defaults, groups) {
  const diff = {};
  for (const g of Object.keys(groups)) for (const a of Object.keys(groups[g])) {
    const mine = (bindings[g][a] || []).filter((c) => !isPad(c)), theirs = (defaults[g][a] || []).filter((c) => !isPad(c));
    if (mine.join('\n') !== theirs.join('\n')) diff[`${g}.${a}`] = mine;
  }
  return diff;
}

// Applies a saved diff onto a fresh copy of the defaults. Unknown actions and malformed entries are ignored.
export function applyBindingDiff(bindings, diff, groups) {
  if (!diff || typeof diff !== 'object') return bindings;
  for (const [key, codes] of Object.entries(diff)) {
    const [g, a] = key.split('.');
    if (!groups[g] || !groups[g][a] || !Array.isArray(codes)) continue;
    const keys = codes.filter((c) => typeof c === 'string' && c && !isPad(c)).slice(0, SLOTS);
    bindings[g][a] = [...keys, ...(bindings[g][a] || []).filter(isPad)];
  }
  // One key, one action: a later action wins a key that two saved entries claim.
  const seen = new Map();
  for (const g of Object.keys(groups)) for (const a of Object.keys(groups[g])) {
    for (const c of bindings[g][a]) { if (isPad(c)) continue; const prev = seen.get(c); if (prev) bindings[prev[0]][prev[1]] = bindings[prev[0]][prev[1]].filter((x) => x !== c); seen.set(c, [g, a]); }
  }
  return bindings;
}

// A code from a keyboard, mouse or wheel event the player pressed while rebinding, or null for keys
// that cannot be bound.
export function codeFromEvent(e) {
  if (e.type === 'keydown') return e.code && e.code !== 'Unidentified' ? e.code : null;
  if (e.type === 'mousedown' || e.type === 'pointerdown') return e.button >= 0 && e.button <= 4 ? `Mouse${e.button}` : null;
  if (e.type === 'wheel') return e.deltaY > 0 ? 'WheelDown' : e.deltaY < 0 ? 'WheelUp' : null;
  return null;
}

// How a code is shown to the player.
const NAMES = {
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', CapsLock: 'Caps Lock',
  ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt', MetaLeft: '左 ⌘', MetaRight: '右 ⌘',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  Mouse0: '滑鼠左鍵', Mouse1: '滑鼠中鍵', Mouse2: '滑鼠右鍵', Mouse3: '滑鼠側鍵 1', Mouse4: '滑鼠側鍵 2', WheelUp: '滾輪上', WheelDown: '滾輪下',
  NumpadEnter: '數字鍵 Enter', NumpadAdd: '數字鍵 +', NumpadSubtract: '數字鍵 -', NumpadMultiply: '數字鍵 *', NumpadDivide: '數字鍵 /', NumpadDecimal: '數字鍵 .',
};
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `數字鍵 ${m[1]}`;
  if ((m = /^F(\d{1,2})$/.exec(code))) return code;
  if (code.startsWith('Pad:')) return `手把 ${code.slice(4)}`;
  return code;
}

// "W / 左 Shift": the player-visible keys of a binding.
export function keyNames(list) {
  const keys = (list || []).filter((c) => !isPad(c));
  return keys.length ? keys.map(keyName).join(' / ') : '—';
}
