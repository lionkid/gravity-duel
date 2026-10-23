// Builds a mech from a declarative part tree, so a robot is data a game ships, not geometry code:
//
//   { id, palette: { armor, armor2, trim, glow, dark },
//     parts: [ { name, shape, size, pos, rot, mat, mirror, children: [...] }, ... ] }
//
//   shape  'box' [w, h, d] | 'cyl' [rTop, rBottom, h, segments] | 'cone' [r, h, segments] | 'sphere' [r, segments] | 'group'
//   mat    palette key; 'glow' parts are emissive (bloom picks them up)
//   mirror true builds the part twice, mirrored in x; names get an 'R' (x > 0) or 'L' suffix
//   only   'R' | 'L': inside a mirrored part, build this child on that side only (a weapon in one hand)
//
// Named nodes are collected in `nodes` with their rest pose in `rest`, which the animator uses. Every
// object remembers the part it was built from in userData.part (the mech lab picks parts by clicking
// them). Models face -Z, matching the simulation's yaw convention, so group.rotation.y = fighter.yaw.
// A design is plain JSON: validateDesign() says what is wrong with one before buildMech() would throw.

import * as THREE from 'three';

const geoCache = new Map();
function geometry(shape, size) {
  const key = `${shape}:${size.join(',')}`;
  let g = geoCache.get(key);
  if (g) return g;
  switch (shape) {
    case 'box': g = new THREE.BoxGeometry(size[0], size[1], size[2]); break;
    case 'cyl': g = new THREE.CylinderGeometry(size[0], size[1], size[2], size[3] || 12); break;
    case 'cone': g = new THREE.ConeGeometry(size[0], size[1], size[2] || 8); break;
    case 'sphere': g = new THREE.SphereGeometry(size[0], size[1] || 12, (size[1] || 12) >> 1 || 6); break;
    default: throw new Error(`unknown shape ${shape}`);
  }
  geoCache.set(key, g);
  return g;
}

export function makeMaterials(palette, { glowIntensity = 2.2 } = {}) {
  const p = Object.assign({ armor: 0x3b4a66, armor2: 0x1f2638, trim: 0xd9b24c, glow: 0x58e0ff, dark: 0x15171c }, palette);
  return {
    armor: new THREE.MeshStandardMaterial({ color: p.armor, metalness: 0.55, roughness: 0.38 }),
    armor2: new THREE.MeshStandardMaterial({ color: p.armor2, metalness: 0.5, roughness: 0.5 }),
    trim: new THREE.MeshStandardMaterial({ color: p.trim, metalness: 0.9, roughness: 0.25 }),
    glow: new THREE.MeshStandardMaterial({ color: p.glow, emissive: p.glow, emissiveIntensity: glowIntensity, metalness: 0.1, roughness: 0.3 }),
    // The sword's own light, so it can flare for a swing without the whole frame lighting up.
    blade: new THREE.MeshStandardMaterial({ color: p.glow, emissive: p.glow, emissiveIntensity: glowIntensity, metalness: 0.1, roughness: 0.3 }),
    flame: new THREE.MeshBasicMaterial({ color: p.glow, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    aura: new THREE.MeshBasicMaterial({ color: p.glow, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: p.dark, metalness: 0.4, roughness: 0.7 }),
  };
}

export function buildMech(design, options = {}) {
  const materials = makeMaterials(design.palette, options);
  const group = new THREE.Group();
  group.name = design.id;
  const nodes = new Map();
  const rest = new Map();

  function addPart(part, parent, sx, suffix) {
    const name = part.name ? part.name + suffix : '';
    let obj;
    if (part.shape && part.shape !== 'group') {
      obj = new THREE.Mesh(geometry(part.shape, part.size), materials[part.mat || 'armor']);
    } else {
      obj = new THREE.Group();
    }
    obj.name = name;
    obj.userData.part = part;
    obj.userData.side = suffix.endsWith('L') ? 'L' : suffix.endsWith('R') ? 'R' : '';
    const pos = part.pos || [0, 0, 0], rot = part.rot || [0, 0, 0];
    obj.position.set(pos[0] * sx, pos[1], pos[2]);
    obj.rotation.set(rot[0], rot[1] * sx, rot[2] * sx);
    if (part.scale) obj.scale.set(part.scale[0], part.scale[1], part.scale[2]);
    parent.add(obj);
    if (name) {
      nodes.set(name, obj);
      rest.set(name, { pos: obj.position.clone(), rot: obj.rotation.clone(), scale: obj.scale.clone() });
    }
    for (const child of part.children || []) {
      if (child.only && child.only !== (sx > 0 ? 'R' : 'L')) continue;
      addChild(child, obj, sx, suffix);
    }
    return obj;
  }
  function addChild(part, parent, sx, suffix) {
    if (part.mirror) {
      const side = (part.pos && part.pos[0] < 0) ? -1 : 1;
      addPart(part, parent, sx * side, suffix + (sx * side > 0 ? 'R' : 'L'));
      addPart(part, parent, -sx * side, suffix + (-sx * side > 0 ? 'R' : 'L'));
    } else {
      addPart(part, parent, sx, suffix);
    }
  }
  for (const part of design.parts) addChild(part, group, 1, '');

  return { design, group, nodes, rest, materials, phase: 0 };
}

export function disposeMech(mech) {
  for (const m of Object.values(mech.materials)) m.dispose();
}

export const SHAPES = { box: 3, cyl: 3, cone: 2, sphere: 1, group: 0 };     // size numbers each shape needs at least
export const MATS = ['armor', 'armor2', 'trim', 'glow', 'dark', 'blade', 'aura', 'flame'];
const PALETTE_KEYS = ['armor', 'armor2', 'trim', 'glow', 'dark'];

// Problems with a design, as strings with the part's path ("parts[2].children[0]"); [] when it is fine.
export function validateDesign(design) {
  const out = [];
  if (!design || typeof design !== 'object') return ['not an object'];
  if (!design.id || typeof design.id !== 'string') out.push('id: missing');
  if (!design.palette || typeof design.palette !== 'object') out.push('palette: missing');
  else for (const k of PALETTE_KEYS) { const v = design.palette[k]; if (!(Number.isInteger(v) && v >= 0 && v <= 0xffffff)) out.push(`palette.${k}: not a colour number`); }
  if (!Array.isArray(design.parts)) return [...out, 'parts: not a list'];
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const walk = (part, path, depth) => {
    if (depth > 12) { out.push(`${path}: nested too deep`); return; }
    if (!part || typeof part !== 'object') { out.push(`${path}: not an object`); return; }
    const shape = part.shape || 'group';
    if (!(shape in SHAPES)) out.push(`${path}.shape: unknown "${shape}"`);
    else if (shape !== 'group') {
      if (!Array.isArray(part.size) || part.size.length < SHAPES[shape] || !part.size.every(num)) out.push(`${path}.size: ${shape} needs ${SHAPES[shape]} numbers`);
      else if (part.size.some((v, i) => i < SHAPES[shape] && v <= 0 && !(shape === 'cyl' && i < 2 && v === 0))) out.push(`${path}.size: must be positive`);
    }
    for (const k of ['pos', 'rot', 'scale']) if (part[k] != null && !(Array.isArray(part[k]) && part[k].length === 3 && part[k].every(num))) out.push(`${path}.${k}: needs 3 numbers`);
    if (part.mat != null && !MATS.includes(part.mat)) out.push(`${path}.mat: unknown "${part.mat}"`);
    if (part.only != null && part.only !== 'R' && part.only !== 'L') out.push(`${path}.only: must be R or L`);
    if (part.name != null && typeof part.name !== 'string') out.push(`${path}.name: not text`);
    if (part.children != null) {
      if (!Array.isArray(part.children)) out.push(`${path}.children: not a list`);
      else part.children.forEach((c, i) => walk(c, `${path}.children[${i}]`, depth + 1));
    }
  };
  design.parts.forEach((p, i) => walk(p, `parts[${i}]`, 0));
  return out;
}
