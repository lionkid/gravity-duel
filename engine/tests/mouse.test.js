// The mouse without a browser: a fake document and canvas built on EventTarget. Covers steering with a
// free cursor (no pointer lock), the edge bands, and how lock requests and refusals are handled.
import test from 'node:test';
import assert from 'node:assert/strict';

function fakeDom({ rejectRaw = false, refuse = false } = {}) {
  const doc = new EventTarget();
  doc.body = { requestPointerLock() {} };
  doc.documentElement = new EventTarget();
  doc.pointerLockElement = null;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); };
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  canvas.requests = [];
  canvas.requestPointerLock = (opts) => {
    canvas.requests.push(opts || null);
    const fail = refuse || (rejectRaw && opts && opts.unadjustedMovement);
    return new Promise((resolve, reject) => setTimeout(() => {
      if (fail) { doc.dispatchEvent(new Event('pointerlockerror')); reject(new Error('refused')); return; }
      doc.pointerLockElement = canvas;
      doc.dispatchEvent(new Event('pointerlockchange'));
      resolve();
    }, 0));
  };
  globalThis.document = doc;
  globalThis.window = new EventTarget();
  return { doc, canvas };
}
const move = (target, movementX, movementY, clientX = 500, clientY = 300) => target.dispatchEvent(Object.assign(new Event('mousemove'), { movementX, movementY, clientX, clientY }));
const tick = () => new Promise((r) => setTimeout(r, 5));
const load = async () => (await import(`../input/mouse.js?${Math.random()}`)).createMouse;

test('a free cursor steers while in play, not in the menus, and edges show as bands', async () => {
  const { doc, canvas } = fakeDom();
  const mouse = (await load())(canvas);
  move(doc, 30, 0);
  assert.deepEqual(mouse.consumeLook(), { dx: 0, dy: 0 }, 'menus: the cursor is just a cursor');
  mouse.setActive(true);
  assert.ok(mouse.state.free, 'in play and not captured');
  move(doc, 40, 0);                                      // the first move after starting can jump: skipped
  move(doc, 12, -5, 500, 300);
  assert.deepEqual(mouse.consumeLook(), { dx: 12, dy: -5 });
  assert.deepEqual(mouse.state.edge, { x: 0, y: 0 });
  move(doc, 3, 0, 980, 300);                              // 2 % from the right edge, inside the 8 % band
  assert.ok(mouse.state.edge.x > 0.7 && mouse.state.edge.y === 0, `edge ${mouse.state.edge.x}`);
  move(doc, -3, 0, 10, 590);
  assert.ok(mouse.state.edge.x < -0.8 && mouse.state.edge.y > 0.8, 'bottom left');
  mouse.consumeLook();
  doc.documentElement.dispatchEvent(new Event('mouseleave'));
  assert.deepEqual(mouse.state.edge, { x: 0, y: 0 }, 'leaving the page stops the turn');
  move(doc, 200, 0, 500, 300);
  assert.equal(mouse.consumeLook().dx, 0, 'the jump on coming back is skipped');
  mouse.setActive(false);
  assert.ok(!mouse.state.free);
});

test('a captured pointer gives raw movement and no edges; losing it is reported, refusals are not', async () => {
  const { doc, canvas } = fakeDom();
  const mouse = (await load())(canvas);
  const changes = [];
  mouse.onLockChange((on) => changes.push(on));
  mouse.setActive(true);
  mouse.requestLock();
  await tick();
  assert.ok(mouse.state.locked && !mouse.state.free);
  move(doc, 7, 2, 990, 590);
  assert.deepEqual(mouse.consumeLook(), { dx: 7, dy: 2 });
  assert.deepEqual(mouse.state.edge, { x: 0, y: 0 });
  mouse.exitLock();
  assert.deepEqual(changes, [true, false]);
  assert.ok(mouse.state.free, 'back to the free cursor');
});

test('a platform without raw movement still gets a plain lock, and stays able to lock again', async () => {
  const { canvas } = fakeDom({ rejectRaw: true });
  const mouse = (await load())(canvas);
  mouse.setActive(true);
  mouse.requestLock();
  await tick(); await tick();
  assert.equal(canvas.requests.length, 2, 'raw first, then plain');
  assert.ok(canvas.requests[0].unadjustedMovement && canvas.requests[1] === null);
  assert.ok(mouse.state.locked, 'locked with the plain request');
  assert.ok(mouse.state.supported && !mouse.state.refused, 'nothing marked as refused');
  mouse.exitLock();
  mouse.requestLock();
  await tick(); await tick();
  assert.ok(mouse.state.locked, 'and it locks again after Esc');
});

test('a page that refuses the lock is told so, and stops being asked after two tries', async () => {
  const { canvas } = fakeDom({ refuse: true });
  const mouse = (await load())(canvas);
  const changes = [];
  mouse.onLockChange((on) => changes.push(on));
  mouse.setActive(true);
  mouse.requestLock();
  await tick(); await tick();
  assert.ok(mouse.state.refused && !mouse.state.locked && mouse.state.free, 'refused: steer with the free cursor');
  assert.deepEqual(changes, [], 'a refusal is not a lost lock');
  mouse.requestLock();
  await tick(); await tick();
  assert.equal(mouse.state.supported, false, 'given up after the second refusal');
  const n = canvas.requests.length;
  mouse.requestLock();
  assert.equal(canvas.requests.length, n, 'no more requests');
});
