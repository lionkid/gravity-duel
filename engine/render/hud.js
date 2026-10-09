// HUD helpers. The HUD itself is DOM (crisp text, easy styling); these utilities place DOM elements
// at world positions and build small widgets.

import * as THREE from 'three';

const tmp = new THREE.Vector3();

// Projects a world point to CSS pixels. `visible` is false behind the camera or outside the viewport.
export function project(camera, x, y, z, width, height, out = {}) {
  tmp.set(x, y, z).project(camera);
  out.x = (tmp.x + 1) / 2 * width;
  out.y = (1 - tmp.y) / 2 * height;
  out.depth = tmp.z;
  out.visible = tmp.z < 1 && tmp.x >= -1.05 && tmp.x <= 1.05 && tmp.y >= -1.05 && tmp.y <= 1.05;
  return out;
}

export function el(tag, className, parent, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// A labelled bar: set(fraction, state) fills it; `state` becomes a CSS class for colour changes.
export function createBar(parent, label, className = '') {
  const root = el('div', `gauge ${className}`.trim(), parent);
  el('span', 'label', root, label);
  const bar = el('div', 'bar', root);
  const fill = el('i', '', bar);
  let last = -1, lastState = '';
  return {
    root,
    set(fraction, state = '') {
      const f = Math.max(0, Math.min(1, fraction));
      if (Math.abs(f - last) > 0.002) { fill.style.width = `${(f * 100).toFixed(1)}%`; last = f; }
      if (state !== lastState) { root.dataset.state = state; lastState = state; }
    },
  };
}
