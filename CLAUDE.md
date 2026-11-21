# Nitro Rivale – Hinweise für Claude Code

Low-Poly-Mehrspieler-Rennspiel für Michael und seine Freunde. Three.js r187 + Rapier 0.21 (WASM), gebündelt mit esbuild zu **einer** `dist/index.html`. Dazu ein kleiner Node-Server ohne Fremdpakete für Online-Räume (bis 8 Fahrer).

## Zusammenarbeit
- Immer **auf Deutsch** antworten. Bei Deploy-/Server-Themen Schritt für Schritt und einfach erklären.
- Bei großen, unklaren Aufträgen vorher kurz nachfragen.
- Qualität vor Tempo: Neue Modelle (Autos, Tuning-Teile) **selbst prozedural bauen**, in derselben Bauweise wie die vorhandenen (siehe `src/carmodel.js`). Danach mit `tools/carshot.py` prüfen.
- UI im bestehenden Stil: Creme-Panels, Navy-Kontur, dicke Knöpfe, Schriften Lilita One/Fredoka (siehe `template.html`).
- Am Ende einer Version: Screenshots der neuen Sachen zeigen.

## Live-Betrieb
- **Spielseite:** Cloudflare Pages → https://nitro-rivale.pages.dev. Baut automatisch aus `main` (Build `node build.mjs`, Ausgabe `dist`). Andere Branches bekommen eine Vorschau unter `<branch>.nitro-rivale.pages.dev`.
- **Spielserver:** Coolify (Dockerfile, Port 8080) unter `nitro-server.traumcode.cloud` über einen Cloudflare-Tunnel. Im Client steht die Adresse als `GAME_SERVER` in `src/net.js`.
- **Coolify deployt nicht automatisch.** Nach jeder Änderung an `server/*.mjs` (auch an der Auto-Liste `CARS` in `server/rooms.mjs`) muss Michael in Coolify auf „Redeploy“ klicken. Darauf immer hinweisen.
- **Arbeitsweise:**
  - Neue Version auf eigenem Branch (z. B. `v9`).
  - Pull Request gegen `main` (`gh api repos/lucasmers1104-design/nitro-rivale/pulls …`). Michael merged selbst.
  - Nach dem Push den Cloudflare-Check des Commits prüfen.
  - Version im Menü steht in `template.html` (`Nitro Rivale · vX · Stand __BUILD__`).

## Befehle
```
npm install
node build.mjs                 # baut dist/index.html
node server/server.mjs         # Spiel + Server auf http://localhost:8080
node test-server.mjs           # Server-Ablauf inkl. Derby/Ausscheiden/Tuning
node test4.mjs [ids]           # Fahrphysik je Auto (Grip, Spurwechsel, Drift)
node test-drift.mjs            # Drift nur mit Handbremse, Mini-Turbo
node test-powerups.mjs         # alle neuen Power-ups
node test-speed.mjs [ids]      # 0-100, 0-200, Höchstgeschwindigkeit
node test-race.mjs tal 1 profi 8   # Bot-Rennen ohne Grafik
python3 tools/carshot.py <auto> [farbe] [tune-json]   # 6 Ansichten eines Autos als PNG
python3 browser-mp.py / browser-mp-derby.py           # 2 Browser online (Playwright + Chrome/SwiftShader)
```
Die Browser-Tests erwarten Chrome unter `/usr/bin/google-chrome`; Pfad bei Bedarf anpassen.

## Aufbau
- `src/presets.js`: Datenblätter der Autos (`CARS`, `CAR_ORDER`, Motor, Getriebe, Grip, Haltbarkeit, Hupe, Farben).
- `src/carmodel.js`: alle Modelle.
  - Bausteine: `buildShell` (Loft-Schale mit Blöcken für Haube/Türen/Kofferraum), `buildGreenhouse`, `framedFace`, `addBumper`, `addMirror`, `addExhaust`, `addWheels`, `engineBlock`.
  - Jedes Design in `DESIGNS.<id>` setzt `K.anchors` (Flügel-/Hutzen-Anker) und `K.gh` (Kanzel). Darauf bauen die Tuning-Teile auf (Abschnitt „Tuning-Teile“).
- `src/tune.js`: Tuning-Stufen und ihre Wirkung auf die Physik (`applyTune`), Leistungsindex/Klassen (`perfIndex`), Drossel fürs Klassenlimit.
- `src/car.js`: Raycast-Fahrwerk, Reifen, Drift-Regler (nur mit Handbremse), Schaden, Derby-Lebenspunkte, Power-up-Zustände.
- `src/race.js`: Rennen inkl. Varianten `race` / `elim` (Ausscheiden) / `derby`.
- `src/bot.js`: `BotDriver` (Strecke) und `DerbyDriver` (Arena).
- `src/items.js`, `src/itemfx.js`: Power-ups und ihre Effekte.
- `src/audio.js`: Motor aus Sample-Loops (`dist/sounds`), Hupen (`HORNS`), Effekte.
- `src/main.js`: Spielablauf, Menüs, Garage, Werkstatt (`openTuning`), Kamera, Mehrspieler-Client.
- `server/rooms.mjs`: Räume, Lobby, Start und Wertung.
  - Der Client rechnet seine eigenen Autos selbst. Andere sehen sie über Snapshots mit 20 Hz.
  - Ereignisse laufen über `ev`; der Server leitet nur Ereignisse zu eigenen Autos weiter.
  - Ausscheiden/Derby: Nachricht `out`. Im Derby meldet der Besitzer, beim Ausscheiden der Gastgeber.
- Debug im Browser: `window.__game` (z. B. `startRace({...})`, `autopilot()`, `openTuning()`). Für Screenshots: `state.camOverride = { pos, look, fov }`.

## Neues Auto hinzufügen (Checkliste)
1. Datenblatt in `src/presets.js` anlegen und in `CAR_ORDER` eintragen.
2. `DESIGNS.<id>` in `src/carmodel.js` bauen.
   - Vorlage: ein vorhandenes Design.
   - `K.anchors` und `K.gh` setzen, `engineBlock` aufrufen.
   - Den Serien-Spoiler nur bauen, wenn `!(K.tune.aero > 0)`.
3. Die id in `CARS` in `server/rooms.mjs` ergänzen (danach Coolify-Redeploy nötig).
4. Prüfen:
   - `node test4.mjs <id>` und `node test-speed.mjs <id>`
   - `python3 tools/carshot.py <id>`, auch mit Tuning-JSON

## Ideen für später (aus Michaels Liste)
- **Später:** Optik-Tuning (Lack, Felgen, Aufkleber), Zeitfahren, neue Strecken, Wetter.
- **Vielleicht:** eingebautes Nitro, Getriebe, Fahrwerk, Werkstatt-Währung, Rallye-Kombi.
- **Nein:** Drift-Wettbewerb, Handy-Steuerung, Rasenmäher.
