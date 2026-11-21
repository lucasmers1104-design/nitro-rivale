// ---------------------------------------------------------------------------
// Tuning-Werkstatt: Teile, ihre Wirkung auf die Fahrphysik, Leistungsindex (PI)
// und Leistungsklassen. applyTune() liefert eine abgeleitete Kopie des Presets –
// das Original bleibt unverändert (Garage, Bots, Netz arbeiten mit den IDs).
// ---------------------------------------------------------------------------

export const TUNE_DEFAULT = { aero: 0, engine: 0, tires: 'street', armor: 0, horn: '' };

// Jede Kategorie: Stufen mit Name, Kurztext und Wirkung (für die Anzeige)
export const PARTS = {
  aero: {
    label: 'Aerodynamik', icon: 'wing', focus: 'rear',
    levels: [
      { name: 'Serie', desc: 'Werksaerodynamik ohne Zusatzteile.' },
      { name: 'Abrisskante', desc: 'Carbon-Abrisskante auf Stelzen. Etwas mehr Anpressdruck, kaum Luftwiderstand.' },
      { name: 'GT-Flügel', desc: 'Verstellbarer Flügel mit Endplatten. Deutlich mehr Grip in schnellen Kurven.' },
      { name: 'Race-Doppelflügel', desc: 'Schwanenhals-Doppeldecker mit Gurney-Kante und Splitter. Maximaler Abtrieb, kostet Topspeed.' },
    ],
  },
  engine: {
    label: 'Motor', icon: 'engine', focus: 'engine',
    levels: [
      { name: 'Serie', desc: 'Werksleistung.' },
      { name: 'Stufe 1 · Ansaugung', desc: 'Offener Luftfilter und neue Software. +8 % Drehmoment.' },
      { name: 'Stufe 2 · Sportauspuff', desc: 'Fächerkrümmer, dicke Endrohre, lauter Sound. +16 % Drehmoment, höhere Drehzahl.' },
      { name: 'Stufe 3 · Kompressor', desc: 'Kompressor mit Lufthutze. +25 % Drehmoment, brutaler Klang.' },
    ],
  },
  tires: {
    label: 'Reifen', icon: 'tire', focus: 'wheel',
    options: [
      { id: 'street', name: 'Straße', desc: 'Ausgewogene Serienreifen.' },
      { id: 'grip', name: 'Semi-Slick', desc: 'Weiche Mischung: viel Grip auf Asphalt, schwach im Gelände.' },
      { id: 'drift', name: 'Drift', desc: 'Harte Hinterreifen: Drifts leichter halten, Mini-Turbo lädt schneller.' },
      { id: 'offroad', name: 'Gelände', desc: 'Grobstollen: kaum Grip-Verlust auf Gras, Sand und Schnee.' },
    ],
  },
  armor: {
    label: 'Panzerung', icon: 'shield', focus: 'side',
    levels: [
      { name: 'Keine', desc: 'Serienkarosserie.' },
      { name: 'Stufe 1 · Stahlschweller', desc: 'Unterfahrschutz und Stahlschweller. +30 % Haltbarkeit, etwas schwerer.' },
      { name: 'Stufe 2 · Platten + Gitter', desc: 'Genietete Türplatten und Scheibengitter. +60 % Haltbarkeit.' },
      { name: 'Stufe 3 · Kampfwagen', desc: 'Überrollkäfig, Rammplatte vorn, Kotflügel-Panzer. +90 % Haltbarkeit, deutlich schwerer.' },
    ],
  },
};

export const CLASSES = [
  { id: 'D', min: 0, color: '#59c26b' },
  { id: 'C', min: 400, color: '#3fb6d9' },
  { id: 'B', min: 500, color: '#f2b632' },
  { id: 'A', min: 600, color: '#f07a2a' },
  { id: 'S', min: 700, color: '#e0334a' },
  { id: 'X', min: 800, color: '#9b5cf6' },
];
export const classOf = (pi) => { let c = CLASSES[0]; for (const k of CLASSES) if (pi >= k.min) c = k; return c; };
export const classMax = (id) => { const i = CLASSES.findIndex((c) => c.id === id); return i < 0 || i === CLASSES.length - 1 ? 999 : CLASSES[i + 1].min - 1; };

const TIRE_IDS = PARTS.tires.options.map((o) => o.id);
const lvl = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(3, Math.round(+v))) : 0);
export function normTune(t) {
  const o = t && typeof t === 'object' ? t : {};
  return {
    aero: lvl(o.aero), engine: lvl(o.engine), armor: lvl(o.armor),
    tires: TIRE_IDS.includes(o.tires) ? o.tires : 'street',
    horn: typeof o.horn === 'string' && /^[a-z]{2,16}$/.test(o.horn) ? o.horn : '',
  };
}
export const sameTune = (a, b) => JSON.stringify(normTune(a)) === JSON.stringify(normTune(b));
export const isStock = (t) => { const n = normTune(t); return !n.aero && !n.engine && !n.armor && n.tires === 'street'; };

// Wirkung je Stufe
const ENG_TQ = [1, 1.08, 1.16, 1.25], ENG_REV = [0, 0, 0.025, 0.045], ENG_VOL = [1, 1.08, 1.18, 1.3];
const AERO_DOWN = [1, 1.35, 1.8, 2.4], AERO_GRIP = [0, 0.05, 0.1, 0.16], AERO_DRAG = [1, 1.02, 1.05, 1.09], AERO_STATIC = [1, 1.01, 1.02, 1.03];
const ARM_DUR = [1, 1.3, 1.6, 1.9], ARM_MASS = [1, 1.04, 1.08, 1.13];
const TIRE = {
  street: { on: 1, off: 1, drift: 1, charge: 1, roll: 1 },
  grip: { on: 1.08, off: 0.9, drift: 0.92, charge: 0.9, roll: 1.05 },
  drift: { on: 0.98, off: 0.95, drift: 1.25, charge: 1.35, roll: 1 },
  offroad: { on: 0.95, off: 1.32, drift: 1, charge: 1, roll: 0.62 },
};

// Werte für die Anzeige (Balken 0..1+) und den Leistungsindex
export function tunedStats(preset, tune) {
  const t = normTune(tune), s = preset.stats, tr = TIRE[t.tires];
  const speed = s.speed + [0, 0.02, 0.045, 0.07][t.engine] - [0, 0.004, 0.012, 0.022][t.aero] - [0, 0.008, 0.016, 0.026][t.armor];
  const accel = s.accel + [0, 0.04, 0.08, 0.125][t.engine] - [0, 0.02, 0.04, 0.065][t.armor];
  const handling = s.handling + [0, 0.03, 0.065, 0.1][t.aero] + (tr.on - 1) * 0.8 - [0, 0.005, 0.012, 0.025][t.armor];
  const armor = s.armor * ARM_DUR[t.armor];
  const offroad = clamp01(0.45 + (preset.drive === 'AWD' ? 0.2 : 0) + (preset.style?.bed || preset.style?.van ? 0.08 : 0) + (tr.off - 1) * 1.2 - (t.tires === 'grip' ? 0.05 : 0));
  return { speed, accel, handling, armor, offroad };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function perfIndex(preset, tune) {
  const st = tunedStats(preset, tune);
  const raw = 0.38 * st.speed + 0.34 * st.accel + 0.28 * st.handling + 0.02 * Math.min(st.armor, 1.5);
  const pi = Math.max(100, Math.min(999, Math.round(100 + (raw - 0.36) * 1300)));
  return { pi, cls: classOf(pi), stats: st };
}

// Abgeleitetes Preset für die Physik. restrict: Drehmoment-Faktor (Klassen-Drossel)
export function applyTune(preset, tune, restrict = 1) {
  const t = normTune(tune), tr = TIRE[t.tires];
  const E = preset.engine;
  const p = {
    ...preset,
    tune: t,
    engine: { ...E, torque: E.torque * ENG_TQ[t.engine] * restrict, redline: Math.round(E.redline * (1 + ENG_REV[t.engine])), gainMul: ENG_VOL[t.engine] },
    mass: Math.round(preset.mass * ARM_MASS[t.armor]),
    durability: preset.durability * ARM_DUR[t.armor],
    grip: preset.grip * AERO_STATIC[t.aero],
    downforce: 1.8 * AERO_DOWN[t.aero],
    aeroGrip: AERO_GRIP[t.aero],
    drag: 0.5 * AERO_DRAG[t.aero],
    tireOn: tr.on, tireOff: tr.off, driftEase: tr.drift, chargeMul: tr.charge, offRoll: tr.roll,
    restrict,
  };
  p.stats = tunedStats(preset, t);
  p.horn = t.horn || preset.horn;
  return p;
}

// Drossel, damit ein Auto in eine Klasse passt (Lobby-Limit). Liefert den Faktor.
export function restrictFor(preset, tune, clsId) {
  if (!clsId || clsId === 'open') return 1;
  const max = classMax(clsId);
  const { pi } = perfIndex(preset, tune);
  if (pi <= max) return 1;
  // PI sinkt um ~4,4 Punkte je Prozent weniger Drehmoment (über die Beschleunigung) – grob, dann nachregeln
  let f = 1;
  for (let i = 0; i < 40; i++) {
    f -= 0.02;
    const st = tunedStats(preset, tune);
    const raw = 0.38 * (st.speed - (1 - f) * 0.35) + 0.34 * (st.accel - (1 - f) * 0.9) + 0.28 * st.handling + 0.02 * Math.min(st.armor, 1.5);
    if (Math.round(100 + (raw - 0.36) * 1300) <= max || f < 0.45) break;
  }
  return Math.max(0.45, f);
}
export function restrictedPI(preset, tune, f) {
  if (f >= 1) return perfIndex(preset, tune).pi;
  const st = tunedStats(preset, tune);
  const raw = 0.38 * (st.speed - (1 - f) * 0.35) + 0.34 * (st.accel - (1 - f) * 0.9) + 0.28 * st.handling + 0.02 * Math.min(st.armor, 1.5);
  return Math.max(100, Math.min(999, Math.round(100 + (raw - 0.36) * 1300)));
}

// Zufälliges Tuning für Bots (passend zur Klasse)
export function randomTune(preset, rnd = Math.random, clsId = 'open') {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const t = { aero: pick([0, 0, 1, 2, 3]), engine: pick([0, 1, 1, 2, 3]), armor: pick([0, 0, 0, 1, 2, 3]), tires: pick(['street', 'street', 'grip', 'drift', 'offroad']), horn: '' };
  if (clsId && clsId !== 'open') {
    const max = classMax(clsId);
    for (const k of ['engine', 'aero', 'armor']) while (t[k] > 0 && perfIndex(preset, t).pi > max) t[k]--;
  }
  return normTune(t);
}
