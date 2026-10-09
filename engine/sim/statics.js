// The static collision world of a stage: boxes in a spatial hash on the ground plane, a flat ground at
// groundY, optional ramps (sloped walkable surfaces) and the arena bounds. Built once from Stage data;
// the controller, projectile sweeps, line-of-sight checks and the camera all query it.
//
// Ramps: { min: [x, y0, z], max: [x, y1, z], axis: 'x' | 'z', up: 1 | -1 }. The walkable surface rises
// from y0 at the low end to y1 at the high end, in the +axis direction when up is 1.

import { boxOfSegment } from './aabb.js';

export function createStatics(stage, cell = 50) {
  const boxes = stage.statics || [];
  const ramps = stage.ramps || [];
  const grid = new Map();
  const stamp = new Uint32Array(boxes.length);
  let stampId = 1;

  const key = (ix, iz) => ix * 73856093 ^ iz * 19349663;
  const cellOf = (v) => Math.floor(v / cell);
  boxes.forEach((b, i) => {
    for (let ix = cellOf(b.min[0]); ix <= cellOf(b.max[0]); ix++) {
      for (let iz = cellOf(b.min[2]); iz <= cellOf(b.max[2]); iz++) {
        const k = key(ix, iz);
        let list = grid.get(k);
        if (!list) { list = []; grid.set(k, list); }
        list.push(i);
      }
    }
  });

  // Boxes whose cells overlap the query box's footprint (a superset of the true overlaps).
  function query(b) {
    stampId++;
    const out = [];
    for (let ix = cellOf(b.min[0]); ix <= cellOf(b.max[0]); ix++) {
      for (let iz = cellOf(b.min[2]); iz <= cellOf(b.max[2]); iz++) {
        const list = grid.get(key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (stamp[i] === stampId) continue;
          stamp[i] = stampId;
          out.push(boxes[i]);
        }
      }
    }
    return out;
  }

  // Surface height of the highest ramp under (x, z), or -Infinity.
  function rampHeight(x, z) {
    let best = -Infinity;
    for (const r of ramps) {
      if (x < r.min[0] || x > r.max[0] || z < r.min[2] || z > r.max[2]) continue;
      const a = r.axis === 'x' ? 0 : 2;
      const v = r.axis === 'x' ? x : z;
      let f = (v - r.min[a]) / (r.max[a] - r.min[a] || 1);
      if (r.up < 0) f = 1 - f;
      const h = r.min[1] + (r.max[1] - r.min[1]) * f;
      if (h > best) best = h;
    }
    return best;
  }

  return {
    boxes, ramps,
    groundY: stage.groundY || 0,
    bounds: stage.bounds || null,
    query,
    queryRay: (p0, p1) => query(boxOfSegment(p0, p1)),
    rampHeight,
  };
}
