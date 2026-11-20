Du überarbeitest die 3D-Automodelle in meinem Browser-Rennspiel „Blechschaden" (Three.js r187 + Rapier, alles prozedural im Code, keine externen Modelldateien). Der komplette Quellcode liegt im Anhang (blechschaden-src.zip).

## Ziel
Die drei Autos sollen insgesamt deutlich cleaner, hochwertiger und stimmiger aussehen. Es geht NICHT um mehr Detailtreue oder Realismus, sondern um einen sauberen, modernen Low-Poly-Look: klare Silhouetten, gute Proportionen, saubere Kanten, nichts schwebt oder steckt ineinander. Stilrichtung: hochwertige stilisierte Low-Poly-Rennspiele (flache Schattierung, wenige aber bewusst gesetzte Polygone, kräftige Lackfarben).

## Was zu tun ist
Schreibe die Funktion `buildCarModel(preset, color, envMap)` in `src/car.js` neu (gern mit eigenen Hilfsfunktionen). Physik, Schadenslogik, Sound, HUD und alles andere bleiben unverändert.

### Gestaltung
- Echte Fahrgastzelle statt Glasblock: lackierte A-, B- und C-Säulen und Dach, getrennte Scheiben (Frontscheibe, Seitenscheiben, Heckscheibe) mit leichtem Einzug.
- Saubere Radhäuser bzw. ausgestellte Kotflügel: Räder sitzen sichtbar in den Radläufen, kein Durchstechen durch die Karosserie.
- Abgeschrägte Kanten (Fasen) an Motorhaube, Dach, Stoßstangen und Kotflügeln statt reiner Quader.
- Integrierte Scheinwerfer, Rückleuchten und Kühlergrill, bündig in der Karosserie.
- Dezente Fugen/Linien zwischen Türen, Haube und Kofferraum. Die Teile müssen exakt bündig sitzen.
- Reifen mit Flanke und Fase, Felgen mit 5–6 Speichen (Low-Poly), passende Bremsscheibe dahinter.
- Stimmige Proportionen und Stance: Spurweite bündig mit den Radläufen, leichte Keilform wo passend.
- Jedes Auto bekommt eine eigene, sofort erkennbare Silhouette (nur fiktive Designs, keine echten Marken, Logos oder Modellnamen):
  - **Brutus V8**: amerikanisches Muscle-Car der späten 60er. Lange Haube, kurzes Heck, Hutze, Chromstoßstangen, zwei Rennstreifen, Doppelscheinwerfer, Entenbürzel-Spoiler, Doppelrohr-Auspuff.
  - **Kaze RS Turbo**: japanisches Sportcoupé der 90er. Flache Keilnase, breite flache Scheinwerfer, fließende Dachlinie, großer Heckflügel, Seitenschweller, ein dickes Endrohr.
  - **Rhino 4x4**: moderner Full-Size-Pickup. Hohe kantige Front, großer Grill, Doppelkabine, offene Ladefläche mit Bordwänden, Heckklappe, Rammschutz, grobe Offroad-Reifen, höhergelegt.

### Technische Regeln (unbedingt einhalten, sonst bricht das Spiel)
- Koordinaten: vorne = −Z, oben = +Y, rechts = +X, Einheit Meter. Ursprung = Mitte des unteren Karosseriekörpers (Maße aus `preset.dims`: w, h, l, cabinH, cabinL, cabinZ).
- Die Kollisionsboxen werden aus `preset.dims` berechnet: Unterbau `(w*0.98, h, l+0.2)`, Kabine `(w*0.74, cabinH, cabinL*0.9)` bei `(0, h/2+cabinH/2, cabinZ)`. Die Optik soll grob darin bleiben. Wenn du Proportionen deutlich änderst, passe die Werte in `src/presets.js` an.
- Räder: Für jedes Rad `pivot` (Group) an `local = (±track/2, anchorY, ∓base/2)` mit `anchorY = −h/2 + 0.16`, darin `hold` (Group), darin `spin` (Group) mit Reifen und Felge. Die Radachse liegt auf lokal X, Radius `preset.wheel.r`, Breite `preset.wheel.w`. Das Spiel setzt `hold.position.y`, `hold.rotation.z`, `pivot.rotation.y` und `spin.rotation.x`. Behalte die Felder des `wheels`-Eintrags exakt bei: id `FL`/`FR`/`RL`/`RR`, front, left, local, pivot, hold, spin und alle Zustandsfelder.
- Rückgabeobjekt mit denselben Feldern wie bisher: `root, sway, mats, deformables, parts, wheels, lights {head[], tail[]}, exhausts (Vector3, Endrohr-Spitzen lokal), flames, fire, paintColor, enginePoint, anchorY`. `sway` = Gruppe mit allem außer den Rad-Pivots. Diesen Block am Ende der Funktion beibehalten.
- Lack: Alle lackierten Karosserieteile nutzen `mats.paint` (vertexColors, Farbe Weiß). Sie MÜSSEN über `addDeform(mesh)` registriert werden: Dellen, Kratzer und Lackfarbe laufen über Vertexfarben und `paintColor`. Spiegel nutzen `mats.mirror`. Scheiben nutzen `mats.glass` (bekommt bei Schaden eine Risstextur, darum brauchen die Scheiben UVs).
- Verformbarkeit: Karosserieflächen brauchen genug Vertices für Dellen, etwa alle 0,25–0,3 m ein Segment. Keine großen Einzeldreiecke auf Haube, Türen, Kotflügeln oder Dach.
- Abnehmbare Teile über `addPart({...})` mit genau diesen IDs (HUD und Schaden hängen daran): `bumperF, bumperR, hood, trunk (beim Pickup = Heckklappe), doorL, doorR, mirrorL, mirrorR`, dazu optional `spoiler` und `bullbar`. Je Teil: `obj` mit Ursprung in der Teilmitte, `size` (Kollisionsbox beim Abfallen), `center`, `pivot` (Scharnier), `axis`, `looseAngle`, `hp`, `looseAt`, `mass`, `deform: [lackierte Meshes des Teils]`.
- Scheinwerfer und Rückleuchten bleiben einzelne Meshes mit eigenem emissivem Material in `lights.head` bzw. `lights.tail` (sie werden bei Schaden ausgeblendet).
- Auspuff: `exhausts` = Endrohr-Spitzen, an jeder Spitze `createFlame()` aus `fx.js` (Flammen zeigen nach +Z). `fire` = `createFlame()` am Motor.
- Weiterhin `flatShading: true`, geteilte Materialien, keine externen Texturen. Budget ca. 4–8k Dreiecke pro Auto, alle Meshes werfen und empfangen Schatten.
- Der Showroom (`makeShowModel` in `src/main.js`) nutzt `wheels[].hold`, `anchorY` und `preset.wheel`. Die Autos müssen dort korrekt auf dem Podium stehen.

### Abnahme
1. `npm install && node build.mjs` baut ohne Fehler.
2. `node test4.mjs`, `node test-lab.mjs` und `node test-lap.mjs` laufen ohne Exceptions, mit ähnlichen Werten wie vorher.
3. Im Spiel: Showroom-Podium, Rennstrecke und Crash-Labor ansehen. Teile fallen sauber ab, Dellen sehen gut aus, nichts flackert (Z-Fighting) und nichts schwebt.

Liefere die geänderten Dateien vollständig (`src/car.js`, ggf. `src/presets.js`) und beschreibe kurz, was du pro Auto gestaltet hast.
