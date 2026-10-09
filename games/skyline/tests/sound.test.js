import test from 'node:test';
import assert from 'node:assert/strict';
import { RECIPES, soundForEvent } from '../sound.js';

const world = { fighters: [{ id: 1, pos: { x: 0, y: 0, z: 0 } }, { id: 2, pos: { x: 30, y: 0, z: 0 } }] };
const at = { x: 5, y: 10, z: 5 };

test('every simulation event plays a defined recipe', () => {
  const played = [];
  const sfx = { play: (name) => played.push(name) };
  const events = [
    ...['vulcan', 'rocket', 'longrifle', 'handcannon'].map((kind) => ({ t: 'shot', id: 1, kind, ...at })),
    ...['rocketS', 'rocketM', 'bolt', 'shell'].map((look) => ({ t: 'impact', look, ...at })),
    { t: 'slash', id: 1, ...at }, { t: 'melee', id: 2, lunge: true },
    { t: 'hit', id: 2, amount: 50, ...at }, { t: 'hit', id: 2, amount: 200, ...at }, { t: 'hit', id: 2, amount: 10, guard: true, ...at }, { t: 'hit', id: 2, amount: 10, broke: true, ...at },
    { t: 'jump', id: 1 }, { t: 'land', id: 1, hard: false, ...at }, { t: 'land', id: 1, hard: true, ...at }, { t: 'dash', id: 1, ...at },
    { t: 'switch', id: 1 }, { t: 'lock', id: 1 }, { t: 'unlock', id: 1 }, { t: 'overheat', id: 1 }, { t: 'fence', id: 1 }, { t: 'ko', id: 2 },
  ];
  for (const e of events) soundForEvent(sfx, e, world, 1);
  assert.equal(played.length, events.length);
  for (const name of played) assert.ok(RECIPES[name], `recipe ${name} is missing`);
});

test('the opponent lock-on cues are not heard', () => {
  const played = [];
  soundForEvent({ play: (n) => played.push(n) }, { t: 'lock', id: 2 }, world, 1);
  soundForEvent({ play: (n) => played.push(n) }, { t: 'unlock', id: 2 }, world, 1);
  soundForEvent({ play: (n) => played.push(n) }, { t: 'lock', id: 1, auto: true }, world, 1);
  assert.deepEqual(played, []);
});

test('recipes only use tones and noise with sane parameters', () => {
  const calls = [];
  const synth = { throttle: () => true, tone: (...a) => calls.push(['tone', ...a]), noise: (...a) => calls.push(['noise', ...a]) };
  for (const recipe of Object.values(RECIPES)) recipe(synth, { pan: 0, gain: 1 });
  assert.ok(calls.length >= Object.keys(RECIPES).length);
  for (const [kind, , f0, f1, dur, gain] of calls) {
    assert.ok(f0 > 0 && f1 > 0, `${kind} frequency`);
    assert.ok(dur > 0 && dur < 3, `${kind} duration ${dur}`);
    assert.ok(gain > 0 && gain <= 1, `${kind} gain ${gain}`);
  }
});
