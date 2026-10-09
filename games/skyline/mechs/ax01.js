// AX-01 VANGUARD — the balanced frame, as a part tree for engine/render/mech-builder.
// 18 m tall, feet at y = 0, facing -Z. Layered plates, shoulder fins, a three-pronged crest, cape-like
// thruster wings and glowing seams. Node names follow the animator's conventions.

export const AX01 = {
  id: 'ax01',
  palette: { armor: 0x4a5c80, armor2: 0x1f2638, trim: 0xd9b24c, glow: 0x58e0ff, dark: 0x15171c },
  parts: [
    // Hips and legs.
    { name: 'hips', shape: 'box', size: [6.2, 2.2, 4.2], pos: [0, 9.4, 0], mat: 'armor2', children: [
      { shape: 'box', size: [6.6, 1.0, 4.6], pos: [0, 0.4, 0], mat: 'trim' },
      { shape: 'box', size: [2.2, 2.4, 1.0], pos: [0, -0.6, -2.3], mat: 'armor' },          // front skirt
      { shape: 'box', size: [1.6, 2.6, 0.8], pos: [2.9, -0.8, -1.4], mat: 'armor', mirror: true, rot: [0, 0.3, 0] },  // side skirts
    ] },
    { name: 'thigh', shape: 'group', pos: [2.1, 8.6, 0], mirror: true, children: [
      { shape: 'sphere', size: [1.3, 10], pos: [0, 0, 0], mat: 'dark' },
      { shape: 'box', size: [2.6, 4.2, 3.0], pos: [0, -2.4, 0], mat: 'armor' },
      { shape: 'box', size: [2.9, 1.2, 3.3], pos: [0, -1.2, -0.1], mat: 'trim' },
      { name: 'shin', shape: 'group', pos: [0, -4.4, 0], children: [
        { shape: 'sphere', size: [1.2, 10], pos: [0, 0, 0], mat: 'dark' },
        { shape: 'box', size: [2.5, 4.2, 3.3], pos: [0, -2.2, 0.1], mat: 'armor' },
        { shape: 'box', size: [1.4, 3.2, 0.6], pos: [0, -2.2, -1.8], mat: 'armor2' },         // shin guard
        { shape: 'box', size: [0.5, 2.4, 0.3], pos: [0, -2.0, -2.0], mat: 'glow' },           // shin light
        { shape: 'box', size: [3.0, 1.1, 5.0], pos: [0, -4.4, -0.7], mat: 'armor2' },         // foot
        { shape: 'box', size: [3.0, 0.8, 1.6], pos: [0, -4.5, -3.2], mat: 'trim' },           // toe
      ] },
    ] },
    // Torso.
    { name: 'torso', shape: 'group', pos: [0, 10.6, 0], children: [
      { shape: 'box', size: [3.6, 1.6, 3.0], pos: [0, 0.6, 0], mat: 'dark' },                 // waist
      { shape: 'box', size: [7.8, 5.2, 4.8], pos: [0, 3.8, 0], mat: 'armor' },
      { shape: 'box', size: [6.4, 2.0, 1.0], pos: [0, 5.0, -2.6], mat: 'trim' },              // chest plate
      { shape: 'box', size: [2.6, 1.4, 0.8], pos: [2.6, 3.4, -2.6], mat: 'armor2', mirror: true },   // vents
      { shape: 'box', size: [1.6, 1.6, 0.6], pos: [0, 3.0, -2.7], mat: 'glow' },              // core
      { shape: 'box', size: [0.4, 3.6, 0.3], pos: [1.6, 3.4, -2.7], mat: 'glow', mirror: true },  // seams
      { shape: 'box', size: [8.4, 1.2, 5.2], pos: [0, 6.4, 0], mat: 'armor2' },               // collar
      // Head.
      { name: 'head', shape: 'group', pos: [0, 7.2, -0.2], children: [
        { shape: 'cyl', size: [0.8, 0.8, 0.8, 8], pos: [0, 0.2, 0], mat: 'dark' },
        { shape: 'box', size: [2.6, 2.6, 2.8], pos: [0, 1.7, 0], mat: 'armor' },
        { shape: 'box', size: [2.2, 0.55, 0.3], pos: [0, 1.9, -1.5], mat: 'glow' },           // visor strip
        { shape: 'box', size: [1.0, 0.9, 0.5], pos: [0, 0.9, -1.5], mat: 'armor2' },          // chin guard
        { shape: 'box', size: [0.5, 2.8, 1.3], pos: [0, 3.9, -0.3], mat: 'trim', rot: [0.2, 0, 0] },   // centre crest
        { shape: 'box', size: [0.35, 2.2, 1.0], pos: [1.1, 3.5, -0.2], mat: 'trim', rot: [0.1, 0, -0.45], mirror: true },  // side crests
        { shape: 'box', size: [0.6, 1.0, 1.6], pos: [1.5, 1.6, 0.4], mat: 'armor2', mirror: true },   // ear blocks
      ] },
      // Shoulders and arms.
      { name: 'arm', shape: 'group', pos: [5.4, 5.6, 0], mirror: true, children: [
        { shape: 'box', size: [3.6, 3.0, 4.6], pos: [0.3, 0.4, 0], mat: 'armor2' },           // shoulder
        { shape: 'box', size: [3.8, 0.9, 4.8], pos: [0.3, 1.6, 0], mat: 'trim' },
        { shape: 'box', size: [0.7, 4.6, 3.2], pos: [2.2, 2.2, 0], mat: 'trim', rot: [0, 0, 0.35] },  // shoulder fin
        { shape: 'box', size: [0.3, 3.0, 2.2], pos: [2.4, 2.4, 0], mat: 'glow', rot: [0, 0, 0.35] },
        { shape: 'sphere', size: [1.2, 10], pos: [0, -1.2, 0], mat: 'dark' },
        { shape: 'box', size: [2.2, 3.8, 2.4], pos: [0, -3.0, 0], mat: 'armor' },             // upper arm
        { shape: 'sphere', size: [1.1, 10], pos: [0, -5.0, 0], mat: 'dark' },
        { shape: 'box', size: [2.6, 3.8, 2.8], pos: [0, -6.8, -0.2], mat: 'armor' },          // forearm
        { shape: 'box', size: [2.8, 1.0, 3.0], pos: [0, -5.4, -0.2], mat: 'trim' },
        { shape: 'box', size: [1.8, 1.8, 1.8], pos: [0, -9.3, -0.3], mat: 'dark' },           // hand
      ] },
      // Backpack and thruster wings.
      { shape: 'box', size: [5.0, 4.2, 2.2], pos: [0, 4.0, 3.4], mat: 'armor2' },
      { shape: 'box', size: [5.4, 0.9, 2.4], pos: [0, 5.8, 3.4], mat: 'trim' },
      { name: 'wing', shape: 'group', pos: [2.6, 5.0, 3.8], mirror: true, children: [
        { shape: 'box', size: [0.6, 7.0, 3.0], pos: [1.0, -2.6, 0.3], mat: 'armor', rot: [0.15, 0, 0.35] },
        { shape: 'box', size: [0.25, 6.2, 2.2], pos: [1.2, -2.6, 0.4], mat: 'trim', rot: [0.15, 0, 0.35] },
        { shape: 'box', size: [0.2, 5.0, 0.4], pos: [1.1, -2.6, 1.6], mat: 'glow', rot: [0.15, 0, 0.35] },
      ] },
      { shape: 'cyl', size: [0.9, 1.1, 1.6, 10], pos: [1.6, 1.6, 3.6], mat: 'dark', mirror: true },          // nozzles
      { shape: 'cyl', size: [0.7, 0.7, 0.3, 10], pos: [1.6, 0.75, 3.6], mat: 'glow', mirror: true },
      { name: 'flame', shape: 'cone', size: [0.8, 2.0, 10], pos: [1.6, -0.5, 3.6], mat: 'flame', rot: [Math.PI, 0, 0], mirror: true },
    ] },
  ],
};

// The same frame in another colour scheme (the opponent, or a player's pick).
export function withPalette(design, palette, id) {
  return Object.assign({}, design, { id: id || `${design.id}-${palette.name || 'alt'}`, palette: Object.assign({}, design.palette, palette) });
}
