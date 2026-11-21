// Coins-Balancing und Spielstand prüfen: node test-economy.mjs
import assert from 'node:assert/strict';
import { normProg, buy, partState, raceReward, OPP, PART_PRICE, START_COINS, DERBY_KM_PER_MIN } from './src/economy.js';
import { LEVELS } from './src/levels.js';
import { Track } from './src/world.js';

// Neuer Spielstand: Startgeld, ein Auto, eine Strecke
const p = normProg(null);
assert.equal(p.coins, START_COINS);
assert.deepEqual(p.cars, ['brutus']);
assert.deepEqual(p.levels, ['tal']);

// Müll aus dem Speicher wird bereinigt, eingebautes Tuning nur aus gekauften Teilen
const junk = normProg({ coins: -50, cars: ['vipera', 'xx'], levels: 'alle', parts: { vipera: { engine: 9, tires: ['grip', 'rakete'] } }, tunes: { vipera: { engine: 3, aero: 2, tires: 'drift' } } });
assert.equal(junk.coins, 0);
assert.deepEqual(junk.cars, ['brutus', 'vipera']);
assert.deepEqual(junk.levels, ['tal']);
assert.equal(junk.parts.vipera.engine, 3);
assert.deepEqual(junk.parts.vipera.tires, ['street', 'grip']);
assert.equal(junk.tunes.vipera.aero, 0);
assert.equal(junk.tunes.vipera.tires, 'street');

// Kaufen: Stufen der Reihe nach, nie ins Minus
const q = normProg({ coins: 1000 });
assert.equal(partState(q, 'brutus', 'engine', 2), 'lock');
assert.equal(buy(q, { kind: 'part', car: 'brutus', cat: 'engine', v: 2 }), null);
assert.equal(buy(q, { kind: 'part', car: 'brutus', cat: 'engine', v: 1 }), 500);
assert.equal(partState(q, 'brutus', 'engine', 1), 'own');
assert.equal(buy(q, { kind: 'part', car: 'brutus', cat: 'engine', v: 2 }), null); // 500 übrig, Stufe 2 kostet 1500
assert.equal(q.coins, 500);
assert.equal(buy(q, { kind: 'car', id: 'vipera' }), null);
assert.equal(buy(q, { kind: 'part', car: 'kaze', cat: 'aero', v: 1 }), null); // Auto nicht gekauft
assert.equal(buy(q, { kind: 'level', id: 'tal' }), null); // schon da

// Belohnung: Platz, Gegnerstärke und Strecke zählen; allein fahren lohnt kaum
const tal3 = 3 * new Track(LEVELS.tal).length / 1000, canyon3 = 3 * new Track(LEVELS.canyon).length / 1000;
const field = (n, place, s) => Array(n - place).fill(OPP[s]);
const win = raceReward({ km: canyon3, place: 1, behind: field(6, 1, 'normal') }).coins;
const third = raceReward({ km: canyon3, place: 3, behind: field(6, 3, 'normal') }).coins;
const last = raceReward({ km: canyon3, place: 6, behind: [] }).coins;
const solo = raceReward({ km: canyon3, place: 1, behind: [] }).coins;
const easy = raceReward({ km: canyon3, place: 1, behind: field(6, 1, 'leicht') }).coins;
const pro = raceReward({ km: canyon3, place: 1, behind: field(8, 1, 'profi') }).coins;
const short = raceReward({ km: tal3 / 3, place: 1, behind: field(6, 1, 'normal') }).coins;
const derby = raceReward({ km: 2.5 * DERBY_KM_PER_MIN, place: 1, behind: field(6, 1, 'normal') }).coins;
console.log(`Canyon 3 Runden, 6 Fahrer normal: Sieg ${win}, 3. Platz ${third}, Letzter ${last} · allein ${solo} · leichte Bots ${easy} · 8 Profis ${pro} · Tal 1 Runde ${short} · Derby-Sieg 2,5 min ${derby}`);
assert.ok(win > third && third > last && last > 0);
assert.ok(solo <= last * 1.3, 'allein fahren darf nicht mehr bringen als Letzter werden');
assert.ok(pro > win && win > easy);
assert.ok(short < win / 4, 'kurze Rennen bringen entsprechend weniger');
assert.ok(derby > third && derby < pro);

// Grind: der ganze Motor-Pfad eines Autos braucht viele Rennen (typisch: Mittelfeld/Podium gegen normale Bots)
const typical = (win + third) / 2;
const engineAll = PART_PRICE.engine.reduce((a, b) => a + b, 0);
const races = engineAll / typical;
console.log(`Motor Stufe 1–3 kosten ${engineAll} Coins ≈ ${races.toFixed(0)} typische Rennen (je ${typical.toFixed(0)} Coins), Stufe 3 allein ≈ ${(PART_PRICE.engine[3] / typical).toFixed(0)}`);
assert.ok(races >= 25 && races <= 60, 'Motor komplett soll ein ordentlicher Grind sein, aber kein Jahr dauern');
assert.ok(PART_PRICE.engine[3] / win >= 15, 'Stufe 3 nicht nach ein paar Siegen');
console.log('Wirtschaft OK');
