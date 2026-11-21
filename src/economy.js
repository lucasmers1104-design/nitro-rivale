// ---------------------------------------------------------------------------
// Coins: Preise, Belohnung je Rennen und der Spielstand (gekaufte Autos,
// Strecken, Tuning-Teile, eingebautes Tuning). Reine Daten + Funktionen,
// damit test-economy.mjs das Balancing ohne Grafik prüfen kann.
// ---------------------------------------------------------------------------
import { CAR_ORDER } from './presets.js';
import { LEVEL_ORDER } from './levels.js';
import { normTune } from './tune.js';

export const START_COINS = 300;
export const FREE_CAR = 'brutus';
export const FREE_LEVEL = 'tal';
export const CAR_PRICE = { brutus: 0, brummi: 900, rhino: 1800, kaze: 4000, vipera: 9000 };
export const LEVEL_PRICE = { tal: 0, canyon: 750, kueste: 1000, pass: 1500 };
// Stufen müssen der Reihe nach gekauft werden; die letzte kostet so viel wie die ersten zwei zusammen und mehr
export const PART_PRICE = { engine: [0, 500, 1500, 4000], aero: [0, 400, 1200, 3200], armor: [0, 350, 1000, 2800] };
export const TIRE_PRICE = 600;
export const HORN_PRICE = 200;
const TIRES = ['street', 'grip', 'drift', 'offroad'];

export const carPrice = (id) => CAR_PRICE[id] ?? 5000;
export const levelPrice = (id) => LEVEL_PRICE[id] ?? 1500;

// ---------------------------------------------------------------- Belohnung
// Wert eines geschlagenen Gegners: Bots nach Stärke, echte Fahrer zählen am meisten
export const OPP = { leicht: 0.5, normal: 1, profi: 1.4, human: 1.5 };
const PER_KM = 3, PER_BEATEN = 4.5, WIN = 1.25;
export const DERBY_KM_PER_MIN = 2.2;

// km: gefahrene Strecke (Derby: Minuten × DERBY_KM_PER_MIN); behind: Gegner-Werte (OPP) aller Fahrer hinter dir
export function raceReward({ km, place, behind = [] }) {
  const k = Math.max(0, Math.min(Number(km) || 0, 40)); // Deckel: ein Rennen bringt nie mehr als 40 km
  const beat = behind.reduce((a, b) => a + (Number(b) || 0), 0);
  const base = k * PER_KM, beaten = k * PER_BEATEN * beat;
  const win = place === 1 && behind.length ? (base + beaten) * (WIN - 1) : 0;
  return { coins: Math.round(base + beaten + win), base: Math.round(base), beaten: Math.round(beaten), win: Math.round(win) };
}

// ---------------------------------------------------------------- Spielstand
const int = (v, a, b) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, Math.round(+v))) : a);
const hornOk = (h) => typeof h === 'string' && /^[a-z]{2,16}$/.test(h);

export function newProg() { return normProg(null); }

// Bereinigt einen Spielstand (aus localStorage oder vom Server). Eingebautes Tuning nur aus gekauften Teilen.
export function normProg(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const fresh = !raw || typeof raw !== 'object' || !Number.isFinite(+o.coins);
  const p = {
    v: 1,
    rev: int(o.rev, 0, 1e12),
    coins: fresh ? START_COINS : int(o.coins, 0, 1e9),
    earned: int(o.earned, 0, 1e12),
    cars: CAR_ORDER.filter((id) => id === FREE_CAR || (Array.isArray(o.cars) && o.cars.includes(id))),
    levels: LEVEL_ORDER.filter((id) => id === FREE_LEVEL || (Array.isArray(o.levels) && o.levels.includes(id))),
    parts: {},
    tunes: {},
  };
  for (const id of p.cars) {
    const q = (o.parts && typeof o.parts[id] === 'object' && o.parts[id]) || {};
    const parts = {
      engine: int(q.engine, 0, 3), aero: int(q.aero, 0, 3), armor: int(q.armor, 0, 3),
      tires: TIRES.filter((t) => t === 'street' || (Array.isArray(q.tires) && q.tires.includes(t))),
      horns: Array.isArray(q.horns) ? [...new Set(q.horns.filter(hornOk))].slice(0, 20) : [],
    };
    p.parts[id] = parts;
    const t = normTune(o.tunes?.[id]);
    p.tunes[id] = {
      engine: Math.min(t.engine, parts.engine), aero: Math.min(t.aero, parts.aero), armor: Math.min(t.armor, parts.armor),
      tires: parts.tires.includes(t.tires) ? t.tires : 'street',
      horn: parts.horns.includes(t.horn) ? t.horn : '',
    };
  }
  return p;
}

export const ownsCar = (p, id) => p.cars.includes(id);
export const ownsLevel = (p, id) => p.levels.includes(id);

// Zustand eines Tuning-Teils: 'own' (gekauft), 'buy' (kaufbar), 'lock' (erst die Stufe davor)
export function partState(p, car, cat, v) {
  const q = p.parts[car];
  if (!q) return 'lock';
  if (cat === 'tires') return q.tires.includes(v) ? 'own' : 'buy';
  if (cat === 'horn') return !v || q.horns.includes(v) ? 'own' : 'buy';
  if (v <= q[cat]) return 'own';
  return v === q[cat] + 1 ? 'buy' : 'lock';
}
export function partPrice(cat, v) {
  if (cat === 'tires') return v === 'street' ? 0 : TIRE_PRICE;
  if (cat === 'horn') return v ? HORN_PRICE : 0;
  return PART_PRICE[cat]?.[v] ?? 0;
}

// Kaufen: liefert den Preis (Coins schon abgezogen) oder null, wenn es nicht geht
export function buy(p, what) {
  let price, apply;
  if (what.kind === 'car') {
    if (!CAR_ORDER.includes(what.id) || ownsCar(p, what.id)) return null;
    price = carPrice(what.id);
    apply = () => { p.cars = CAR_ORDER.filter((id) => id === what.id || p.cars.includes(id)); p.parts[what.id] = { engine: 0, aero: 0, armor: 0, tires: ['street'], horns: [] }; p.tunes[what.id] = normTune(null); };
  } else if (what.kind === 'level') {
    if (!LEVEL_ORDER.includes(what.id) || ownsLevel(p, what.id)) return null;
    price = levelPrice(what.id);
    apply = () => { p.levels = LEVEL_ORDER.filter((id) => id === what.id || p.levels.includes(id)); };
  } else if (what.kind === 'part') {
    const { car, cat, v } = what;
    if (!ownsCar(p, car) || partState(p, car, cat, v) !== 'buy') return null;
    if (cat === 'tires' && !TIRES.includes(v)) return null;
    if (cat === 'horn' && !hornOk(v)) return null;
    price = partPrice(cat, v);
    const q = p.parts[car];
    apply = () => { if (cat === 'tires') q.tires.push(v); else if (cat === 'horn') q.horns.push(v); else q[cat] = v; };
  } else return null;
  if (p.coins < price) return null;
  p.coins -= price;
  apply();
  return price;
}
