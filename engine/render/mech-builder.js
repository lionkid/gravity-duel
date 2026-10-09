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
// Named nodes are collected in `nodes` with their rest pose in `rest`, which the animator uses.
// Models face -Z, matching the simulation's yaw convention, so group.rotation.y = fighter.yaw.

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
    flame: new THREE.MeshBasicMaterial({ color: p.glow, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
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
