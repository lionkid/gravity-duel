// Rebindable keys: slots, one key per action, the saved difference and the names shown to the player.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneBindings, keySlots, setKey, diffBindings, applyBindingDiff, codeFromEvent, keyName, keyNames, SLOTS } from '../input/keymap.js';

const DEFAULTS = {
  move: { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  look: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
  actions: { boost: ['Space', 'Pad:A'], attack: ['KeyJ', 'Mouse0', 'Pad:RT'], aim: ['KeyK', 'Mouse2', 'Pad:LT'], dash: ['KeyL', 'ShiftLeft', 'ShiftRight', 'Pad:B'], pause: ['Escape', 'Pad:Start'] },
  pad: { lookRate: { yaw: 3.2, pitch: 2.2 }, deadzone: 0.18 },
};
const GROUPS = { move: DEFAULTS.move, look: DEFAULTS.look, actions: DEFAULTS.actions };

test('a clone is independent of the defaults and keeps the gamepad entries', () => {
  const b = cloneBindings(DEFAULTS);
  b.actions.attack.push('KeyX');
  assert.deepEqual(DEFAULTS.actions.attack, ['KeyJ', 'Mouse0', 'Pad:RT']);
  assert.deepEqual(b.pad, DEFAULTS.pad);
  assert.deepEqual(keySlots(b.actions.attack), ['KeyJ', 'Mouse0']);
  assert.deepEqual(keySlots(b.actions.boost), ['Space', '']);
  assert.deepEqual(keySlots(['Pad:A']), ['', '']);
  assert.equal(SLOTS, 2);
});

test('setting a key fills its slot, takes the key from any other action and leaves the gamepad alone', () => {
  const b = cloneBindings(DEFAULTS);
  setKey(b, GROUPS, 'actions', 'boost', 1, 'KeyJ');                 // J was attack's
  assert.deepEqual(b.actions.boost, ['Space', 'KeyJ', 'Pad:A']);
  assert.deepEqual(b.actions.attack, ['Mouse0', 'Pad:RT'], 'attack lost J, kept the mouse and the pad');
  setKey(b, GROUPS, 'move', 'forward', 0, 'ArrowUp');               // the arrow was the camera's
  assert.deepEqual(b.move.forward, ['ArrowUp']);
  assert.deepEqual(b.look.up, []);
  setKey(b, GROUPS, 'actions', 'dash', 0, '');                      // clearing a slot closes it up
  assert.deepEqual(b.actions.dash, ['ShiftLeft', 'Pad:B']);
  setKey(b, GROUPS, 'actions', 'dash', 1, 'ShiftLeft');             // the same key twice is once
  assert.deepEqual(b.actions.dash, ['ShiftLeft', 'Pad:B']);
});

test('only the changes are saved, and they come back onto fresh defaults', () => {
  const b = cloneBindings(DEFAULTS);
  setKey(b, GROUPS, 'actions', 'attack', 0, 'KeyF');
  setKey(b, GROUPS, 'actions', 'boost', 1, 'Mouse2');
  const diff = diffBindings(b, DEFAULTS, GROUPS);
  assert.deepEqual(diff, { 'actions.attack': ['KeyF', 'Mouse0'], 'actions.boost': ['Space', 'Mouse2'], 'actions.aim': ['KeyK'] });
  const back = applyBindingDiff(cloneBindings(DEFAULTS), JSON.parse(JSON.stringify(diff)), GROUPS);
  assert.deepEqual(back.actions.attack, ['KeyF', 'Mouse0', 'Pad:RT']);
  assert.deepEqual(back.actions.boost, ['Space', 'Mouse2', 'Pad:A']);
  assert.deepEqual(back.actions.aim, ['KeyK', 'Pad:LT']);
  assert.deepEqual(back.move, DEFAULTS.move);
  // Rubbish in the saved data is ignored; a key two saved entries claim goes to one of them.
  const odd = applyBindingDiff(cloneBindings(DEFAULTS), { 'actions.nothing': ['KeyQ'], 'actions.attack': 'KeyQ', 'move.left': ['KeyQ', 5, 'Pad:X'], 'move.right': ['KeyQ'] }, GROUPS);
  assert.deepEqual(odd.actions.attack, DEFAULTS.actions.attack);
  assert.deepEqual(odd.move.left, []);
  assert.deepEqual(odd.move.right, ['KeyQ']);
  assert.deepEqual(applyBindingDiff(cloneBindings(DEFAULTS), null, GROUPS), cloneBindings(DEFAULTS));
});

test('events become codes, and codes have readable names', () => {
  assert.equal(codeFromEvent({ type: 'keydown', code: 'KeyW' }), 'KeyW');
  assert.equal(codeFromEvent({ type: 'keydown', code: 'Unidentified' }), null);
  assert.equal(codeFromEvent({ type: 'mousedown', button: 2 }), 'Mouse2');
  assert.equal(codeFromEvent({ type: 'wheel', deltaY: -3 }), 'WheelUp');
  assert.equal(codeFromEvent({ type: 'wheel', deltaY: 0 }), null);
  assert.equal(keyName('KeyW'), 'W');
  assert.equal(keyName('Digit3'), '3');
  assert.equal(keyName('ShiftLeft'), '左 Shift');
  assert.equal(keyName('Mouse0'), '滑鼠左鍵');
  assert.equal(keyName('Pad:RT'), '手把 RT');
  assert.equal(keyName(''), '—');
  assert.equal(keyNames(['KeyL', 'ShiftLeft', 'Pad:B']), 'L / 左 Shift');
  assert.equal(keyNames(['Pad:B']), '—');
});
