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
      { name: 'vulcan', shape: 'group', pos: [0, 4.6, -2.6], children: [                             // chest vulcans
        { shape: 'cyl', size: [0.3, 0.3, 1.2, 8], pos: [3.0, 0, 0], rot: [Math.PI / 2, 0, 0], mat: 'dark', mirror: true },
        { shape: 'cyl', size: [0.3, 0.3, 1.2, 8], pos: [3.0, -0.8, 0], rot: [Math.PI / 2, 0, 0], mat: 'dark', mirror: true },
      ] },
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
        // Weapons in the right hand, one model per weapon id; the animator shows the one the loadout
        // carries in the slot in use. All point along -Z (forward). A melee model carries `edge` (the lit
        // blade), `aura` (its glow sheet) and `bladeBase` / `bladeTip` (where the swing trail is drawn).
        { name: 'weapon', shape: 'group', pos: [0, -9.3, -0.3], only: 'R', children: [
          // Rocket launcher: a fat tube with a loaded warhead showing, a drum magazine underneath.
          { name: 'rocket', shape: 'group', children: [
            { shape: 'cyl', size: [1.15, 1.15, 9.2, 12], pos: [0, 0.9, -4.1], rot: [Math.PI / 2, 0, 0], mat: 'armor2' },
            { shape: 'cyl', size: [1.45, 1.45, 1.4, 12], pos: [0, 0.9, -8.7], rot: [Math.PI / 2, 0, 0], mat: 'trim' },          // muzzle ring
            { shape: 'cyl', size: [0.8, 0.8, 0.5, 12], pos: [0, 0.9, -9.4], rot: [Math.PI / 2, 0, 0], mat: 'glow' },            // loaded warhead
            { shape: 'box', size: [1.8, 2.0, 3.0], pos: [0, -0.9, -1.8], mat: 'armor' },                                         // magazine
            { shape: 'box', size: [0.8, 1.0, 2.8], pos: [0, 2.5, -1.6], mat: 'trim' },                                           // sight
            { shape: 'box', size: [2.4, 0.5, 0.5], pos: [0, 0.9, 0.9], mat: 'dark' },                                            // rear grip bar
          ] },
          // Long rifle: a slim barrel most of the mech's height, a scope with a lit lens, a shoulder stock.
          { name: 'longrifle', shape: 'group', children: [
            { shape: 'box', size: [1.4, 2.0, 4.2], pos: [0, 0.4, 0.1], mat: 'armor2' },                                          // receiver
            { shape: 'box', size: [1.3, 1.5, 6.0], pos: [0, 0.3, -4.8], mat: 'armor' },                                          // barrel shroud
            { shape: 'cyl', size: [0.42, 0.42, 14.5, 10], pos: [0, 0.3, -8.6], rot: [Math.PI / 2, 0, 0], mat: 'armor2' },        // barrel
            { shape: 'cyl', size: [0.65, 0.65, 1.2, 10], pos: [0, 0.3, -15.4], rot: [Math.PI / 2, 0, 0], mat: 'trim' },         // muzzle brake
            { shape: 'box', size: [0.26, 0.26, 7.0], pos: [0, -0.55, -6.5], mat: 'glow' },                                       // energy rail
            { shape: 'cyl', size: [0.5, 0.5, 4.6, 10], pos: [0, 2.1, -2.4], rot: [Math.PI / 2, 0, 0], mat: 'dark' },            // scope
            { shape: 'cyl', size: [0.38, 0.38, 0.2, 10], pos: [0, 2.1, -4.8], rot: [Math.PI / 2, 0, 0], mat: 'glow' },          // lens
            { shape: 'box', size: [0.4, 1.0, 0.5], pos: [0, 1.4, -1.2], mat: 'trim' }, { shape: 'box', size: [0.4, 1.0, 0.5], pos: [0, 1.4, -3.6], mat: 'trim' },   // scope mounts
            { shape: 'box', size: [1.2, 1.7, 3.8], pos: [0, 0.1, 3.6], mat: 'armor' },                                           // stock
            { shape: 'box', size: [0.9, 1.5, 1.0], pos: [0, -1.1, 1.0], mat: 'dark' },                                           // grip
          ] },
          // Hand cannon: short and wide, a revolver drum behind the barrel.
          { name: 'handcannon', shape: 'group', children: [
            { shape: 'cyl', size: [1.1, 1.1, 4.4, 12], pos: [0, 0.6, -2.6], rot: [Math.PI / 2, 0, 0], mat: 'armor2' },           // barrel
            { shape: 'cyl', size: [1.4, 1.4, 0.9, 12], pos: [0, 0.6, -5.0], rot: [Math.PI / 2, 0, 0], mat: 'trim' },            // muzzle
            { shape: 'cyl', size: [0.72, 0.72, 0.3, 12], pos: [0, 0.6, -5.55], rot: [Math.PI / 2, 0, 0], mat: 'glow' },         // bore
            { shape: 'cyl', size: [1.7, 1.7, 1.8, 8], pos: [0, 0.6, 0.2], rot: [Math.PI / 2, 0, 0], mat: 'armor' },              // drum
            { shape: 'cyl', size: [1.8, 1.8, 0.3, 8], pos: [0, 0.6, 0.2], rot: [Math.PI / 2, 0, 0], mat: 'trim' },               // drum band
            { shape: 'box', size: [1.8, 1.4, 3.0], pos: [0, -0.7, -0.4], mat: 'armor2' },                                        // frame
            { shape: 'box', size: [1.0, 1.9, 1.2], pos: [0, -1.5, 1.2], mat: 'dark' },                                           // grip
            { shape: 'box', size: [0.6, 0.6, 1.6], pos: [0, 1.9, -1.6], mat: 'trim' },                                           // iron sight
          ] },
          // Energy sabre: a straight lit blade with a glow sheet.
          { name: 'saber', shape: 'group', children: [
            { shape: 'cyl', size: [0.5, 0.55, 2.6, 8], pos: [0, 0, 1.2], rot: [Math.PI / 2, 0, 0], mat: 'trim' },               // hilt
            { shape: 'box', size: [2.8, 2.2, 0.5], pos: [0, 0.1, -0.2], mat: 'armor2' },                                         // guard
            { name: 'edge', shape: 'box', size: [0.55, 2.0, 13.5], pos: [0, 0.1, -7.6], mat: 'blade' },
            { name: 'aura', shape: 'box', size: [0.06, 3.6, 14.2], pos: [0, 0.1, -7.6], mat: 'aura' },
            { name: 'bladeBase', shape: 'group', pos: [0, 0.1, -0.9] },
            { name: 'bladeTip', shape: 'group', pos: [0, 0.1, -14.4] },
          ] },
          // Great blade: broad and heavy, a dark fuller down the middle, a two-handed hilt.
          { name: 'greatblade', shape: 'group', children: [
            { shape: 'cyl', size: [0.6, 0.65, 4.2, 8], pos: [0, 0, 2.0], rot: [Math.PI / 2, 0, 0], mat: 'trim' },               // long hilt
            { shape: 'sphere', size: [0.8, 10], pos: [0, 0, 4.3], mat: 'armor2' },                                                // pommel
            { shape: 'box', size: [4.8, 2.6, 0.9], pos: [0, 0.1, -0.4], mat: 'armor2' },                                         // guard
            { shape: 'box', size: [5.2, 0.8, 1.0], pos: [0, 0.1, -0.4], mat: 'trim' },
            { name: 'edge', shape: 'box', size: [0.9, 3.6, 17.0], pos: [0, 0.1, -9.6], mat: 'blade' },
            { shape: 'box', size: [1.1, 0.5, 12.5], pos: [0, 0.1, -8.4], mat: 'armor2' },                                        // fuller
            { name: 'aura', shape: 'box', size: [0.06, 5.8, 18.0], pos: [0, 0.1, -9.6], mat: 'aura' },
            { name: 'bladeBase', shape: 'group', pos: [0, 0.1, -1.0] },
            { name: 'bladeTip', shape: 'group', pos: [0, 0.1, -18.2] },
          ] },
          // Combat knife: short, quick.
          { name: 'knife', shape: 'group', children: [
            { shape: 'cyl', size: [0.4, 0.45, 2.2, 8], pos: [0, 0, 1.0], rot: [Math.PI / 2, 0, 0], mat: 'trim' },               // hilt
            { shape: 'box', size: [2.0, 1.2, 0.4], pos: [0, 0.1, -0.2], mat: 'armor2' },                                         // guard
            { name: 'edge', shape: 'box', size: [0.4, 1.3, 8.0], pos: [0, 0.1, -4.4], mat: 'blade' },
            { name: 'aura', shape: 'box', size: [0.05, 2.4, 8.5], pos: [0, 0.1, -4.4], mat: 'aura' },
            { name: 'bladeBase', shape: 'group', pos: [0, 0.1, -0.6] },
            { name: 'bladeTip', shape: 'group', pos: [0, 0.1, -8.6] },
          ] },
        ] },
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
