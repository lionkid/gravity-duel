// The mech builder in Node: a design builds to named nodes with their parts recorded, validation
// catches what would break a build, and the stock AX-01 carries a model for every weapon.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMech, validateDesign, disposeMech } from '../render/mech-builder.js';
import { animateMech } from '../render/mech-anim.js';
import { AX01, withPalette } from '../../games/skyline/mechs/ax01.js';
import { WEAPONS } from '../../games/skyline/config.js';

const idle = (over = {}) => Object.assign({ speed: 0, runSpeed: 28, onGround: true, boosting: false, dashing: false, vy: 0, landLag: 0, aiming: false, aimPitch: 0,
  active: 'vulcan', melee: null, guard: false, stun: 0, dead: false, rangedId: 'rocket', meleeId: 'saber', hitT: Infinity, hitSide: 0, hitHeavy: false, firedT: Infinity, firedKind: '' }, over);

test('the stock design is valid, JSON-clean and builds with every joint and weapon the animator looks for', () => {
  assert.deepEqual(validateDesign(AX01), []);
  const copy = JSON.parse(JSON.stringify(AX01));
  assert.deepEqual(copy, AX01, 'plain data, nothing lost through JSON');
  const m = buildMech(AX01);
  for (const name of ['torso', 'head', 'armL', 'armR', 'thighL', 'thighR', 'shinL', 'shinR', 'wingL', 'wingR', 'flameL', 'flameR', 'weaponR']) assert.ok(m.nodes.has(name), `node ${name}`);
  assert.ok(!m.nodes.has('weaponL'), 'weapons only in the right hand');
  for (const kind of ['ranged', 'melee']) for (const w of Object.values(WEAPONS[kind])) {
    const node = m.nodes.get(`${w.id}R`);
    assert.ok(node, `a model for ${w.id}`);
    if (kind === 'melee') for (const part of ['edgeR', 'auraR', 'bladeBaseR', 'bladeTipR']) assert.ok(node.getObjectByName(part), `${w.id} has ${part}`);
  }
  let withPart = 0, total = 0;
  m.group.traverse((o) => { if (o !== m.group) { total++; if (o.userData.part) withPart++; } });
  assert.equal(withPart, total, 'every object remembers its part');
  disposeMech(m);
});

test('the animator shows the weapon of the loadout in the slot in use and hides the others', () => {
  const m = buildMech(AX01);
  const vis = () => Object.fromEntries([...m.nodes.get('weaponR').children].map((w) => [w.name, w.visible]));
  animateMech(m, idle({ active: 'melee', rangedId: 'longrifle', meleeId: 'greatblade' }), 1 / 60);
  assert.deepEqual(vis(), { rocketR: false, longrifleR: false, handcannonR: false, saberR: false, greatbladeR: true, knifeR: false });
  assert.equal(m.activeMelee, m.nodes.get('greatbladeR'));
  animateMech(m, idle({ active: 'ranged', rangedId: 'longrifle', meleeId: 'greatblade' }), 1 / 60);
  assert.deepEqual(vis(), { rocketR: false, longrifleR: true, handcannonR: false, saberR: false, greatbladeR: false, knifeR: false });
  animateMech(m, idle({ active: 'vulcan', rangedId: 'handcannon', meleeId: 'knife' }), 1 / 60);
  assert.ok(Object.values(vis()).every((v) => !v), 'nothing in hand with the vulcan');
  // A swing flares the blade.
  animateMech(m, idle({ active: 'melee', meleeId: 'saber', melee: { stage: 'active', progress: 0.5, style: 'slashR' } }), 1 / 60);
  assert.ok(m.materials.blade.emissiveIntensity > 2.2 && m.materials.aura.opacity > 0.3);
  disposeMech(m);
});

test('a palette swap keeps the parts and recolours the materials', () => {
  const red = withPalette(AX01, { armor: 0x7a2330, glow: 0xff7a3d }, 'red');
  assert.equal(red.parts, AX01.parts);
  assert.equal(red.palette.armor, 0x7a2330); assert.equal(red.palette.trim, AX01.palette.trim);
  const m = buildMech(red);
  assert.equal(m.materials.glow.color.getHex(), 0xff7a3d);
  disposeMech(m);
});

test('validation names what is wrong, with the part path', () => {
  const bad = JSON.parse(JSON.stringify(AX01));
  bad.parts[0].children[0].shape = 'blob';
  bad.parts[1].children[1].size = [2, 'x', 3];
  bad.parts[2].children.push({ shape: 'cyl', size: [1, 1], mat: 'gold', pos: [0, 0], only: 'X' });
  bad.palette.glow = 'cyan';
  const problems = validateDesign(bad);
  assert.ok(problems.some((p) => p.startsWith('parts[0].children[0].shape')), problems.join('; '));
  assert.ok(problems.some((p) => p.startsWith('parts[1].children[1].size')));
  assert.ok(problems.some((p) => p.includes('.size: cyl needs 3')));
  assert.ok(problems.some((p) => p.includes('.mat: unknown "gold"')));
  assert.ok(problems.some((p) => p.includes('.pos: needs 3 numbers')));
  assert.ok(problems.some((p) => p.includes('.only: must be R or L')));
  assert.ok(problems.some((p) => p.startsWith('palette.glow')));
  assert.deepEqual(validateDesign(null), ['not an object']);
  assert.deepEqual(validateDesign({ id: 'x', palette: AX01.palette, parts: 'no' }), ['parts: not a list']);
  assert.deepEqual(validateDesign({ id: 'x', palette: AX01.palette, parts: [{ shape: 'group', children: [{ shape: 'box', size: [1, 2, 3] }] }] }), []);
});
