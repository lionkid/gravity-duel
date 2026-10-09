// The city stage generator. Pure: the same options and seed always produce the same city, so LAN play
// only has to agree on a seed. Output is Stage data for the simulation (statics, ramps, spawns,
// bounds) plus `visual` hints for the renderer (roads, palette).
//
// Layout: blocks × blocks lots on a `pitch` grid, each lot `pitch - street` wide, so streets run
// between them; the arena fence sits half a street outside the outer lots. Buildings are taller near
// the centre. Every block keeps at least one low "step" building so roofs can be climbed in stages.
// An elevated highway loops around the inner blocks: the fastest way around, with no cover, reached
// by four ramps from the central streets. Mechs fit under its deck.

import { makeRng } from '../../../engine/core/rng.js';

export function generateCity(opts = {}) {
  const o = Object.assign({ seed: 1, blocks: 8, pitch: 100, street: 30, minHeight: 25, maxHeight: 130, stepHeight: 45, gravity: 32, highway: true }, opts);
  const rnd = makeRng(o.seed);
  const half = o.blocks * o.pitch / 2;
  const lot = o.pitch - o.street;
  const statics = [], roads = [], ramps = [];

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

  let highway = null;
  const lamps = [], lanes = [];
  if (o.highway && o.blocks >= 4) highway = buildHighway(o, statics, ramps, lamps, lanes);

  // Spawns face each other down the central north–south street, inside the highway loop.
  const sz = highway ? Math.min(80, highway.R - o.street / 2 - HW.rampLen - 25) : half - o.pitch / 2;
  const spawns = [{ pos: { x: 0, y: 0, z: sz }, yaw: 0 }, { pos: { x: 0, y: 0, z: -sz }, yaw: Math.PI }];

  return {
    id: 'city',
    seed: o.seed,
    gravity: o.gravity,
    groundY: 0,
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half, ceiling: 300 },
    statics,
    ramps,
    spawns,
    highway,
    visual: { roads, lamps, lanes, pitch: o.pitch, street: o.street },
  };
}

// Highway dimensions (metres).
export const HW = { deckY: 22, thick: 1.5, railH: 1.5, railW: 1, pillar: 4, pillarEvery: 50, rampLen: 80, rampSegments: 8 };

function buildHighway(o, statics, ramps, lamps, lanes) {
  const hs = o.street / 2;
  const R = Math.max(1, Math.floor(o.blocks / 4)) * o.pitch;      // loop centreline, on street grid lines
  const top = HW.deckY, bottom = HW.deckY - HW.thick;
  const deck = (x0, z0, x1, z1) => statics.push({ min: [x0, bottom, z0], max: [x1, top, z1], tag: 'deck' });
  const rail = (x0, z0, x1, z1) => statics.push({ min: [x0, top, z0], max: [x1, top + HW.railH, z1], tag: 'rail' });
  // Four deck sides (overlapping at the corners is fine).
  deck(-R - hs, R - hs, R + hs, R + hs);
  deck(-R - hs, -R - hs, R + hs, -R + hs);
  deck(R - hs, -R - hs, R + hs, R + hs);
  deck(-R - hs, -R - hs, -R + hs, R + hs);
  // Outer rails run the full side; inner rails leave a gap where the ramps join at the central streets.
  for (const sgn of [1, -1]) {
    const o1 = sgn * (R + hs), o2 = sgn * (R + hs - HW.railW);     // outer edge
    const i1 = sgn * (R - hs), i2 = sgn * (R - hs + HW.railW);     // inner edge
    rail(-R - hs, Math.min(o1, o2), R + hs, Math.max(o1, o2));        // north / south outer
    rail(Math.min(o1, o2), -R - hs, Math.max(o1, o2), R + hs);        // east / west outer
    rail(-R + hs, Math.min(i1, i2), -hs, Math.max(i1, i2));           // inner, split around the ramp gap
    rail(hs, Math.min(i1, i2), R - hs, Math.max(i1, i2));
    rail(Math.min(i1, i2), -R + hs, Math.max(i1, i2), -hs);
    rail(Math.min(i1, i2), hs, Math.max(i1, i2), R - hs);
  }
  // Pillars under the deck centreline, none on the central streets so traffic passes underneath.
  const seen = new Set();
  for (let v = -R; v <= R; v += HW.pillarEvery) {
    for (const [x, z] of [[v, R], [v, -R], [R, v], [-R, v]]) {
      const key = `${x},${z}`;
      if (seen.has(key) || Math.abs(x) < 20 && Math.abs(z) <= R || Math.abs(z) < 20 && Math.abs(x) <= R) continue;
      seen.add(key);
      statics.push({ min: [x - HW.pillar / 2, 0, z - HW.pillar / 2], max: [x + HW.pillar / 2, bottom, z + HW.pillar / 2], tag: 'pillar' });
    }
  }
  // Ramps from the inner side along the central streets, with stepped side walls that also form the
  // ramp's solid body for anything running into it from the side.
  const L = HW.rampLen, segs = HW.rampSegments;
  const rampDefs = [
    { axis: 'z', up: 1, lo: R - hs - L, hi: R - hs },
    { axis: 'z', up: -1, lo: -(R - hs), hi: -(R - hs - L) },
    { axis: 'x', up: 1, lo: R - hs - L, hi: R - hs },
    { axis: 'x', up: -1, lo: -(R - hs), hi: -(R - hs - L) },
  ];
  for (const d of rampDefs) {
    const along = (a, b) => d.axis === 'z' ? [-hs, 0, a, hs, top, b] : [a, 0, -hs, b, top, hs];
    const [x0, y0, z0, x1, y1, z1] = along(d.lo, d.hi);
    ramps.push({ min: [x0, y0, z0], max: [x1, y1, z1], axis: d.axis, up: d.up });
    for (let i = 0; i < segs; i++) {
      const a = d.lo + (L / segs) * i, b = a + L / segs;
      const far = d.up > 0 ? b : a;                                   // the segment's high end
      const h = Math.max(1, (far - d.lo) / L * top);
      const hh = d.up > 0 ? h : Math.max(1, (d.hi - far) / L * top);
      for (const side of [-1, 1]) {
        const w0 = side * hs, w1 = side * (hs - HW.railW);
        if (d.axis === 'z') statics.push({ min: [Math.min(w0, w1), 0, a], max: [Math.max(w0, w1), hh, b], tag: 'deck' });
        else statics.push({ min: [a, 0, Math.min(w0, w1)], max: [b, hh, Math.max(w0, w1)], tag: 'deck' });
      }
    }
  }
  // Lamps on the outer rail every 50 m, heads leaning over the deck; dashed centre lines on each side.
  for (let v = -R - hs + 10; v <= R + hs - 10; v += 50) {
    for (const [x, z, ix, iz] of [[v, R + hs - 0.5, 0, -1], [v, -(R + hs - 0.5), 0, 1], [R + hs - 0.5, v, -1, 0], [-(R + hs - 0.5), v, 1, 0]]) {
      lamps.push({ post: [x, top, z], head: [x + ix * 2.2, top + 8, z + iz * 2.2] });
    }
  }
  for (const d of rampDefs) {
    for (let i = 1; i < segs; i += 2) {
      const a = d.lo + (L / segs) * i;
      const h = d.up > 0 ? (a - d.lo) / L * top : (d.hi - a) / L * top;
      for (const side of [-1, 1]) {
        const w = side * (hs - 0.5);
        if (d.axis === 'z') lamps.push({ post: [w, h, a], head: [w - side * 2.2, h + 8, a] });
        else lamps.push({ post: [a, h, w], head: [a, h + 8, w - side * 2.2] });
      }
    }
  }
  lanes.push({ x0: -R - hs, z0: R, x1: R + hs, z1: R, y: top }, { x0: -R - hs, z0: -R, x1: R + hs, z1: -R, y: top },
    { x0: R, z0: -R - hs, x1: R, z1: R + hs, y: top }, { x0: -R, z0: -R - hs, x1: -R, z1: R + hs, y: top });
  return { R, deckY: top, hs };
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
