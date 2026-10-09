// The city stage generator. Pure: the same options and seed always produce the same city, so LAN play
// only has to agree on a seed. Output is Stage data for the simulation (statics, ramps, spawns,
// bounds) plus `visual` hints for the renderer (roads, palette).
//
// Layout: blocks × blocks lots on a `pitch` grid, each lot `pitch - street` wide, so streets run
// between them; the arena fence sits half a street outside the outer lots. Buildings are taller near
// the centre. Every block keeps at least one low "step" building so roofs can be climbed in stages.

import { makeRng } from '../../../engine/core/rng.js';

export function generateCity(opts = {}) {
  const o = Object.assign({ seed: 1, blocks: 8, pitch: 100, street: 30, minHeight: 25, maxHeight: 130, stepHeight: 45, gravity: 32 }, opts);
  const rnd = makeRng(o.seed);
  const half = o.blocks * o.pitch / 2;
  const lot = o.pitch - o.street;
  const statics = [], roads = [];

  for (let bi = 0; bi < o.blocks; bi++) {
    for (let bj = 0; bj < o.blocks; bj++) {
      const cx = -half + o.pitch / 2 + bi * o.pitch;
      const cz = -half + o.pitch / 2 + bj * o.pitch;
      const dist = Math.max(Math.abs(cx), Math.abs(cz)) / half;         // 0 centre … ~1 edge
      const base = o.maxHeight + (o.minHeight - o.maxHeight) * Math.pow(dist, 0.9);
      const boxes = layoutLot(rnd, cx, cz, lot);
      // Heights: every box its own, the smallest footprint forced low so each block has a step.
      let smallest = 0;
      boxes.forEach((b, i) => { if (b.w * b.d < boxes[smallest].w * boxes[smallest].d) smallest = i; });
      boxes.forEach((b, i) => {
        let h = base * rnd.range(0.6, 1.25);
        if (i === smallest) h = rnd.range(o.minHeight, o.stepHeight);
        h = Math.round(Math.min(o.maxHeight, Math.max(o.minHeight, h)));
        statics.push({ min: [b.x - b.w / 2, 0, b.z - b.d / 2], max: [b.x + b.w / 2, h, b.z + b.d / 2], tag: 'building', tint: rnd.int(5), seed: rnd.int(1000) });
      });
    }
  }

  // Streets between the lots (interior grid lines), as visual strips.
  for (let k = 1; k < o.blocks; k++) {
    const c = -half + k * o.pitch;
    roads.push({ x0: c - o.street / 2, z0: -half, x1: c + o.street / 2, z1: half });
    roads.push({ x0: -half, z0: c - o.street / 2, x1: half, z1: c + o.street / 2 });
  }

  // Spawns face each other down the central north–south street.
  const sz = o.blocks >= 4 ? 2 * o.pitch : half - o.pitch / 2;
  const spawns = [{ pos: { x: 0, y: 0, z: sz }, yaw: 0 }, { pos: { x: 0, y: 0, z: -sz }, yaw: Math.PI }];

  return {
    id: 'city',
    seed: o.seed,
    gravity: o.gravity,
    groundY: 0,
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half, ceiling: 300 },
    statics,
    ramps: [],
    spawns,
    visual: { roads, pitch: o.pitch, street: o.street },
  };
}

// Splits a lot into 2–3 building footprints with small gaps. Returns { x, z, w, d } centres and sizes.
function layoutLot(rnd, cx, cz, lot) {
  const gap = rnd.range(2, 4);
  const inset = rnd.range(2, 6);                 // pavement around the lot
  const L = lot - inset * 2;
  const kind = rnd.int(3);
  if (kind === 0) {
    // Main tower in one corner plus a low annex along one side.
    const annex = rnd.range(16, 24);
    const sx = rnd.chance(0.5) ? 1 : -1, sz = rnd.chance(0.5) ? 1 : -1;
    const mainW = L - annex - gap;
    return [
      { x: cx + sx * (L / 2 - mainW / 2), z: cz, w: mainW, d: L },
      { x: cx - sx * (L / 2 - annex / 2), z: cz + sz * (L / 2 - (L * 0.6) / 2), w: annex, d: L * 0.6 },
    ];
  }
  if (kind === 1) {
    // Two slabs side by side, split along a random axis.
    const alongX = rnd.chance(0.5);
    const a = rnd.range(0.4, 0.6), w1 = (L - gap) * a, w2 = L - gap - w1;
    const o1 = -L / 2 + w1 / 2, o2 = L / 2 - w2 / 2;
    return alongX
      ? [{ x: cx + o1, z: cz, w: w1, d: L }, { x: cx + o2, z: cz, w: w2, d: L }]
      : [{ x: cx, z: cz + o1, w: L, d: w1 }, { x: cx, z: cz + o2, w: L, d: w2 }];
  }
  // One large block and two smaller ones on the other half.
  const bigW = (L - gap) * rnd.range(0.5, 0.6);
  const smallW = L - gap - bigW;
  const d1 = (L - gap) * rnd.range(0.4, 0.6), d2 = L - gap - d1;
  const sx = rnd.chance(0.5) ? 1 : -1;
  return [
    { x: cx - sx * (L / 2 - bigW / 2), z: cz, w: bigW, d: L },
    { x: cx + sx * (L / 2 - smallW / 2), z: cz - L / 2 + d1 / 2, w: smallW, d: d1 },
    { x: cx + sx * (L / 2 - smallW / 2), z: cz + L / 2 - d2 / 2, w: smallW, d: d2 },
  ];
}
