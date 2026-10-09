// Ground navigation for the AI: a grid over the arena where a cell is free when nothing solid stands
// in the walking layer. Decks overhead stay free (mechs fit under them), ramps are walkable surfaces
// with blocked side walls, so a path up a ramp onto the highway comes out naturally. A* with string
// pulling turns the grid into a few waypoints.

export function buildNavGrid(stage, { cell = 6, bodyHeight = 18, margin = 4.5 } = {}) {
  const b = stage.bounds;
  const w = Math.ceil((b.maxX - b.minX) / cell), h = Math.ceil((b.maxZ - b.minZ) / cell);
  const blocked = new Uint8Array(w * h);
  for (const s of stage.statics) {
    if (s.min[1] >= bodyHeight - 1 || s.max[1] <= 0.5) continue;     // overhead or underfoot
    const x0 = Math.max(0, Math.floor((s.min[0] - margin - b.minX) / cell)), x1 = Math.min(w - 1, Math.floor((s.max[0] + margin - b.minX) / cell));
    const z0 = Math.max(0, Math.floor((s.min[2] - margin - b.minZ) / cell)), z1 = Math.min(h - 1, Math.floor((s.max[2] + margin - b.minZ) / cell));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) blocked[iz * w + ix] = 1;
  }
  const toCell = (x, z) => ({ ix: Math.min(w - 1, Math.max(0, Math.floor((x - b.minX) / cell))), iz: Math.min(h - 1, Math.max(0, Math.floor((z - b.minZ) / cell))) });
  const toWorld = (ix, iz) => ({ x: b.minX + (ix + 0.5) * cell, z: b.minZ + (iz + 0.5) * cell });
  const free = (ix, iz) => ix >= 0 && iz >= 0 && ix < w && iz < h && !blocked[iz * w + ix];

  // Nearest free cell to (ix, iz), searching outward in rings.
  function nearestFree(ix, iz) {
    if (free(ix, iz)) return { ix, iz };
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (free(ix + dx, iz + dz)) return { ix: ix + dx, iz: iz + dz };
      }
    }
    return null;
  }

  // Straight line between two world points stays on free cells (sampled every half cell).
  function lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / (cell / 2)));
    for (let i = 0; i <= n; i++) {
      const c = toCell(ax + (bx - ax) * i / n, az + (bz - az) * i / n);
      if (!free(c.ix, c.iz)) return false;
    }
    return true;
  }

  // A* over 8 neighbours (no corner cutting). Returns world waypoints, or [] when unreachable.
  function findPath(from, to, maxExpand = 20000) {
    const s = nearestFree(toCell(from.x, from.z).ix, toCell(from.x, from.z).iz);
    const g = nearestFree(toCell(to.x, to.z).ix, toCell(to.x, to.z).iz);
    if (!s || !g) return [];
    const start = s.iz * w + s.ix, goal = g.iz * w + g.ix;
    if (start === goal) return [toWorld(g.ix, g.iz)];
    const gScore = new Float32Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const heap = [];        // [f, index]
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const hx = (i) => { const dx = Math.abs((i % w) - g.ix), dz = Math.abs(Math.floor(i / w) - g.iz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    gScore[start] = 0;
    push(hx(start), start);
    let expanded = 0, found = false;
    while (heap.length && expanded < maxExpand) {
      const [, cur] = pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      if (cur === goal) { found = true; break; }
      const cx = cur % w, cz = Math.floor(cur / w);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!free(nx, nz)) continue;
        if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;
        const ni = nz * w + nx;
        if (closed[ni]) continue;
        const ng = gScore[cur] + (dx && dz ? 1.4142 : 1);
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; push(ng + hx(ni), ni); }
      }
    }
    if (!found) return [];
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => toWorld(i % w, Math.floor(i / w)));
    pts[pts.length - 1] = { x: to.x, z: to.z };
    return simplify(pts);
  }

  // String pulling: keep only the corners the straight line cannot skip.
  function simplify(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !lineFree(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  return { cell, w, h, blocked, toCell, toWorld, free, nearestFree, lineFree, findPath, simplify };
}
