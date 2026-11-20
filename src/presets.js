// Fahrzeug-Presets: alles, was ein Auto ausmacht, steckt hier drin.
// Später wird das pro Auto ein JSON-Datenblatt neben der GLB-Datei aus Blender.

export const CARS = {
  brutus: {
    id: 'brutus',
    name: 'Brutus V8',
    tag: 'Muscle-Car · Heckantrieb · V8-Sauger',
    stats: { speed: 0.78, accel: 0.72, handling: 0.6, armor: 0.75 },
    mass: 1450,
    drive: 'RWD',
    dims: { w: 1.96, l: 4.75, h: 0.62, cabinH: 0.52, cabinL: 2.05, cabinZ: 0.3 },
    wheel: { r: 0.37, w: 0.34, base: 2.86, track: 1.64, rest: 0.34 },
    sound: 'v8_sport',
    engine: { type: 'V8', cyl: 8, idle: 750, redline: 6600, torque: 690, turbo: 0, lump: 0.32, bass: 1.0 },
    gears: [3.0, 2.05, 1.5, 1.16, 0.93, 0.8],
    finalDrive: 4.2,
    grip: 1.0,
    rearGrip: 1.0,
    durability: 1.2,
    style: { scoop: true, spoiler: 'duck', stripes: true, exhaust: 2 },
    colors: ['#d23a2a', '#1f4fbf', '#f2b632', '#16161a', '#e8e4da', '#2f8f5a'],
  },
  kaze: {
    id: 'kaze',
    name: 'Kaze RS Turbo',
    tag: 'JDM-Coupé · Heckantrieb · R4 Turbo',
    stats: { speed: 0.72, accel: 0.66, handling: 0.88, armor: 0.45 },
    mass: 1180,
    drive: 'RWD',
    dims: { w: 1.78, l: 4.35, h: 0.56, cabinH: 0.5, cabinL: 1.95, cabinZ: 0.2 },
    wheel: { r: 0.33, w: 0.3, base: 2.55, track: 1.5, rest: 0.3 },
    sound: 'v8_turbo',
    engine: { type: 'R4', cyl: 4, idle: 900, redline: 8200, torque: 430, turbo: 1.0, flutter: true, lump: 0.06, bass: 0.55 },
    gears: [3.3, 2.25, 1.65, 1.3, 1.05, 0.87],
    finalDrive: 4.4,
    grip: 1.06,
    rearGrip: 0.98,
    durability: 0.85,
    style: { spoiler: 'wing', exhaust: 1, popups: false },
    colors: ['#f4f1ea', '#e85d1c', '#2a6fd6', '#7a1fa2', '#22252b', '#f7d23e'],
  },
  rhino: {
    id: 'rhino',
    name: 'Rhino 4x4',
    tag: 'Pickup · Allrad · V6 Biturbo',
    stats: { speed: 0.64, accel: 0.7, handling: 0.5, armor: 1.0 },
    mass: 2050,
    drive: 'AWD',
    dims: { w: 2.06, l: 5.2, h: 0.82, cabinH: 0.62, cabinL: 1.95, cabinZ: -0.35 },
    wheel: { r: 0.44, w: 0.38, base: 3.2, track: 1.76, rest: 0.42 },
    sound: 'v8_umluft',
    engine: { type: 'V6', cyl: 6, idle: 700, redline: 6000, torque: 840, turbo: 0.7, flutter: false, lump: 0.14, bass: 0.85 },
    gears: [3.2, 2.15, 1.55, 1.2, 0.97, 0.82],
    finalDrive: 4.8,
    grip: 0.93,
    rearGrip: 0.99,
    durability: 1.75,
    style: { bed: true, bullbar: true, exhaust: 1 },
    colors: ['#3b4a2f', '#c9c3b4', '#8a2b1d', '#1c2a40', '#d98a1c', '#2b2b2e'],
  },
};

export const CAR_ORDER = ['brutus', 'kaze', 'rhino'];

export const SOUNDS = [
  ['v8_leise', 'V8 Sauger · Leise'], ['v8_normal', 'V8 Sauger · Normal'], ['v8_sport', 'V8 Sauger · Sport'], ['v8_track', 'V8 Sauger · Track (Bang-Limiter)'],
  ['v8_turbo', 'V8 Turbo · Blow-Off'], ['v8_biturbo', 'V8 Biturbo · Blow-Off'], ['v8_flattern', 'V8 Biturbo · Flattern'], ['v8_umluft', 'V8 Biturbo · Umluft'],
];
