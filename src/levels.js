// ---------------------------------------------------------------------------
// Strecken und Themen
// ctrl: Kontrollpunkte [x, z, y] einer geschlossenen Kurve (Index 0 = Start/Ziel)
// ---------------------------------------------------------------------------

const TAL = [
  [0, -110], [110, -115], [175, -80], [182, -10], [140, 30], [92, 14], [55, 48], [88, 95],
  [40, 128], [-60, 122], [-122, 92], [-176, 40], [-182, -40], [-142, -96], [-72, -114],
].map(([x, z]) => [x, z, 0]);

const CANYON = [
  [-60, -255, 0], [60, -255, 0], [160, -245, 0], [225, -200, 1], [250, -130, 4], [255, -78, 7.5], [255, -35, 2.5], [252, 15, 0.5],
  [245, 90, 0], [215, 140, -1], [160, 150, -2], [120, 120, -2], [95, 70, -1], [70, 55, -1], [50, 80, -1], [55, 150, -2],
  [40, 220, -3], [-10, 255, -3], [-90, 250, -2], [-150, 215, -1], [-185, 170, 0], [-180, 110, 1], [-150, 70, 2], [-180, 30, 2],
  [-215, -30, 1], [-230, -110, 0], [-215, -190, 0], [-160, -245, 0],
];

const PASS = [
  [-80, -240, 0], [40, -240, 0], [140, -235, 1], [200, -205, 2], [215, -150, 4], [190, -110, 6], [130, -100, 8], [95, -80, 9],
  [85, -50, 10], [110, -35, 11], [190, -30, 13], [225, -5, 14], [210, 30, 15], [140, 40, 16], [60, 45, 18], [0, 70, 17],
  [-60, 110, 14], [-80, 170, 11], [-130, 215, 8], [-200, 200, 6], [-235, 150, 4], [-225, 90, 3], [-190, 40, 2], [-215, -20, 1],
  [-245, -80, 1], [-230, -160, 0], [-180, -225, 0],
];

const KUESTE = [
  [-40, 250, 0], [80, 252, 0], [170, 240, 0], [235, 195, 1], [250, 120, 2], [235, 60, 4], [255, 0, 6], [240, -60, 8],
  [200, -110, 9], [190, -170, 10], [210, -235, 10], [150, -250, 9], [60, -245, 7], [0, -215, 6], [-20, -160, 5], [-70, -140, 4],
  [-130, -170, 3], [-190, -210, 2], [-250, -170, 1], [-255, -90, 1], [-225, -20, 1], [-240, 50, 0], [-245, 130, 0], [-210, 200, 0],
  [-140, 240, 0],
];

// Themen: Farben, Licht, Bewuchs, Untergrund neben der Strecke
export const THEMES = {
  meadow: {
    sky: [0x3f7fcf, 0x8fbbe6, 0xf6cfa2, 0xffe3b8], sunDir: [-0.62, 0.42, -0.66], sun: [0xffd9a8, 1.95], hemi: [0xcfe3ff, 0x6a7c45, 0.85],
    fog: [0xe2c9a6, 260, 1500], exposure: 0.9, fill: 0x9fc4ff,
    ground: [0x6d9b3f, 0x86ad4b, 0x5a8a38], high: 0xa7a35a, dirt: 0x8b7552, sand: 0xd8c690,
    offroad: 'grass', gravel: 0xcdb98e, hills: 1, outer: 1,
    trees: { pine: 0.3, fir: 0.15, birch: 0.2, oak: 0.2, bush: 0.15 }, treeCount: 520, highTrees: ['fir', 'pine'],
    tufts: [0x5f9a3a, 7000], flowers: [0xffffff, 0xf7d23e, 0xb04ad6, 0xe8452f, 0x4a7fe0], rocks: [0x8d8a84, 70],
    mountains: { colors: [0x77849e, 0x8389a3], caps: true, n: 34, h: [180, 300], d: 1000 }, clouds: [0xffffff, 0x6b6158, 22],
  },
  desert: {
    sky: [0x3d73c4, 0x9cc2e8, 0xf7c48c, 0xffd49a], sunDir: [0.55, 0.36, -0.75], sun: [0xffc98a, 2.15], hemi: [0xd8e4ff, 0x9a6b3e, 0.8],
    fog: [0xe8c095, 230, 1400], exposure: 0.88, fill: 0xa8c4ff,
    ground: [0xd6a46a, 0xe0b27a, 0xc8925a], high: 0xb8734a, dirt: 0xa8744a, sand: 0xe6c690,
    offroad: 'sand', gravel: 0xe2c08c, hills: 1.15, outer: 1.2,
    trees: { cactus: 0.45, drybush: 0.4, deadtree: 0.15 }, treeCount: 300, highTrees: ['cactus'],
    tufts: [0xc9b26a, 2600], flowers: null, rocks: [0xa85a3c, 120], buttes: 16,
    mountains: { colors: [0xb5653f, 0xc7774c], caps: false, mesa: true, n: 30, h: [120, 240], d: 950 }, clouds: [0xfff6ea, 0x7a6450, 9],
  },
  snow: {
    sky: [0x2f63b0, 0x8db4e0, 0xe3edf7, 0xfff2dc], sunDir: [-0.5, 0.38, 0.78], sun: [0xfff0dc, 1.75], hemi: [0xdbe8ff, 0x8a9bb0, 1.0],
    fog: [0xdbe6f2, 170, 1150], exposure: 0.82, fill: 0xb5d0ff,
    ground: [0xeef3f8, 0xe2eaf3, 0xd5e0ec], high: 0xf8fbff, dirt: 0xa9b3bf, sand: 0xd5e0ec,
    offroad: 'snow', gravel: 0xf2f6fb, hills: 1.6, outer: 2.2,
    trees: { snowfir: 0.6, snowpine: 0.3, snowbush: 0.1 }, treeCount: 640, highTrees: ['snowfir'],
    tufts: null, flowers: null, rocks: [0x7d838c, 60], snowfall: true,
    mountains: { colors: [0x8d97a8, 0x7f8a9c], caps: true, bigCaps: true, n: 38, h: [260, 480], d: 900 }, clouds: [0xf2f5fa, 0x8c96a6, 18],
  },
  coast: {
    sky: [0x4a5fa8, 0xd98fa0, 0xffb070, 0xffd08a], sunDir: [0.74, 0.16, 0.66], sun: [0xffa860, 2.0], hemi: [0xffd6c2, 0x6a7c55, 0.78],
    fog: [0xf0b38f, 240, 1500], exposure: 0.92, fill: 0xb59cff,
    ground: [0x6aa046, 0x7fb350, 0x5c9340], high: 0x8fae55, dirt: 0x8b7552, sand: 0xe8d3a0,
    offroad: 'grass', gravel: 0xe8d3a0, hills: 0.8, outer: 0, sea: true,
    trees: { palm: 0.55, bush: 0.25, oak: 0.2 }, treeCount: 380, highTrees: ['palm'],
    tufts: [0x6aa046, 5000], flowers: [0xff4f7a, 0xffd23e, 0xffffff, 0xff8a2a], rocks: [0x9a8f80, 50], lighthouse: true,
    mountains: { colors: [0x5d6f8c, 0x6a7a96], caps: false, islands: true, n: 14, h: [40, 110], d: 1100 }, clouds: [0xffe2d0, 0x8a5a5a, 16],
  },
};

export const LEVELS = {
  tal: {
    id: 'tal', name: 'Grünes Tal', sub: 'Klassischer Rundkurs am See', theme: 'meadow', ctrl: TAL, width: 14, diff: 1,
    card: ['#7fd35a', '#3f9a3a'], extras: { arena: { x: 0, z: 242, r: 64 }, lab: { x: 0, z: -248, w: 96, d: 66 }, lake: { x: 222, z: 178, r: 44, level: -0.65 }, ramp: { x: -142, z: 185 } },
  },
  canyon: {
    id: 'canyon', name: 'Wüsten-Canyon', sub: 'Vollgas, Sprunghügel, Haarnadel', theme: 'desert', ctrl: CANYON, width: 15, diff: 2,
    card: ['#ffb54a', '#e0682e'], extras: {},
  },
  pass: {
    id: 'pass', name: 'Alpenpass', sub: 'Bergauf, bergab, eng und rutschig', theme: 'snow', ctrl: PASS, width: 14, diff: 3,
    card: ['#8fd3ff', '#3f7fe0'], extras: {},
  },
  kueste: {
    id: 'kueste', name: 'Küstenring', sub: 'Sonnenuntergang am Meer', theme: 'coast', ctrl: KUESTE, width: 15, diff: 2,
    card: ['#ff8ab0', '#d9467a'], extras: {},
  },
};
export const LEVEL_ORDER = ['tal', 'canyon', 'pass', 'kueste'];
