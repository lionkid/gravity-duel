// Axis-aligned boxes: { min: [x, y, z], max: [x, y, z] }. The whole collision world is made of these
// (buildings, decks, rails, fighters), which keeps collision simple, deterministic and cheap to send.

export function box(min, max) { return { min, max }; }

// A box standing on y0, centred on (cx, cz), of width w (x), height h (y) and depth d (z).
export function boxAt(cx, y0, cz, w, h, d) {
  return { min: [cx - w / 2, y0, cz - d / 2], max: [cx + w / 2, y0 + h, cz + d / 2] };
}

export function overlaps(a, b) {
  return a.min[0] < b.max[0] && a.max[0] > b.min[0] &&
    a.min[1] < b.max[1] && a.max[1] > b.min[1] &&
    a.min[2] < b.max[2] && a.max[2] > b.min[2];
}

export function containsPoint(b, p) {
  return p.x >= b.min[0] && p.x <= b.max[0] && p.y >= b.min[1] && p.y <= b.max[1] && p.z >= b.min[2] && p.z <= b.max[2];
}

export function expand(b, r) {
  return { min: [b.min[0] - r, b.min[1] - r, b.min[2] - r], max: [b.max[0] + r, b.max[1] + r, b.max[2] + r] };
}

export function boxOfSegment(p0, p1) {
  return {
    min: [Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.min(p0.z, p1.z)],
    max: [Math.max(p0.x, p1.x), Math.max(p0.y, p1.y), Math.max(p0.z, p1.z)],
  };
}

const AXES = ['x', 'y', 'z'];

// Segment p0→p1 against a box (slab test). Returns { t, axis, sign } for the entry point, t in [0, 1],
// or null. A segment starting inside the box hits at t = 0.
export function segmentBox(p0, p1, b) {
  let tmin = 0, tmax = 1, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    const a = AXES[i];
    const o = p0[a], d = p1[a] - o;
    if (Math.abs(d) < 1e-9) {
      if (o < b.min[i] || o > b.max[i]) return null;
      continue;
    }
    let t1 = (b.min[i] - o) / d, t2 = (b.max[i] - o) / d;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, axis, sign };
}
