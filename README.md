# Nitro Rivale – Low-Poly-Rennspiel

Three.js + Rapier (WASM) im Browser, dazu ein kleiner Node-Server für Mehrspieler-Räume (bis 8 Fahrer, ohne Fremdpakete).

## Starten
```
npm install
node build.mjs        # baut dist/index.html (eine Datei, inkl. Physik-WASM)
```
Einzelspieler: `dist/index.html` direkt im Browser öffnen.
Mit Mehrspieler: `node server/server.mjs` starten und http://localhost:8080 öffnen (siehe unten).

## Aufbau
- `src/presets.js` – Datenblätter der Autos (Motor, Getriebe, Grip, Haltbarkeit)
- `src/carmodel.js` – die fünf Auto-Modelle (prozedurale Low-Poly-Karosserien mit bündigen, abnehmbaren Teilen)
- `src/car.js` – Raycast-Fahrwerk, Reifenmodell, Drift-Hilfen, Dellen/Schaden
- `tools/viewer/` – Modell-Betrachter für Screenshots der Autos (`node tools/viewer/build.mjs`)
- `src/world.js` – Strecke (Spline), Untergrund, Arena, Schanze, Requisiten
- `src/audio.js` – Sample-Motor (RPM-Loops aus `sounds/manifest.json`), Synth als Fallback, Turbo, Pops, Crash-Sounds
- `src/fx.js` – Low-Poly-Rauch (blendet nahe Kamera aus), Funken, Splitter, Bremsspuren, Flammen-Shader
- `src/hud.js` – Analog-Tacho (Drehzahl + km/h) und Schadensanzeige (Canvas)
- `src/main.js` – Loop, Kamera, Crash-Erkennung, HUD, Garage
- `test4.mjs` – Fahrphysik-Tests mit Fahrer-Bot (Grip, Spurwechsel, Drift halten + abfangen)
- `test-lab.mjs` – Rammbock-Test im Crash-Labor

## Echte Motorsounds einbinden
`sounds/manifest.json` neben die index.html legen:
```json
{ "v8": { "loops": [ { "rpm": 1000, "on": "v8_on_1000.mp3", "off": "v8_off_1000.mp3" } ] } }
```
Schlüssel = Motortyp (`v8`, `r4`, `v6`) oder `default`.

## Teile-Namen (für Blender-Export in Phase 2)
`bumperF`, `bumperR`, `hood`, `trunk`, `doorL`, `doorR`, `mirrorL`, `mirrorR`, `spoiler`, `bullbar`
– jedes Teil als eigenes Objekt, Ursprung am Scharnier.

## Sound-Pipeline (echte V8-Aufnahmen)
`tools/` enthält die Python-Skripte: Zündfrequenz-Linie im Spektrogramm verfolgen (`ridge3.py`, `build_bank.py`),
Abschnitte schneiden + MP3 packen (`pack.py`). Ergebnis: `dist/sounds/*.mp3` + `manifest.json`.
Im Spiel spielt `GranularEngine` (src/audio.js) für jede Drehzahl genau die passende Stelle der Aufnahme ab
(unter Last aus den Vollgas-Zügen, im Schub aus dem Ausrollen, dazu Leerlauf, Begrenzer, Start und Gas-weg-Pops/Blow-off).

## Neu in v5: Rennen, Bots, Power-ups, Strecken, Menüs
- `src/levels.js` – vier Strecken (Grünes Tal, Wüsten-Canyon, Alpenpass, Küstenring) mit Höhenprofil und Themen (Farben, Licht, Bewuchs, Untergrund)
- `src/world.js` – baut eine Strecke komplett auf und wieder ab (`buildWorld(game, levelId)` → `dispose()`), inkl. Startampel, Tribüne, Boxen, Schneefall, Meer
- `src/race.js` – Startampel, Fortschritt, Runden, Platzierung, Zielwertung, Zurücksetzen auf die Strecke
- `src/bot.js` – Bot-Fahrer (Ideallinie, Bremspunkte, Ausweichen, Befreien, Power-up-Einsatz), Stärken Leicht/Normal/Profi
- `src/items.js` – ?-Kisten und 8 Power-ups: Nitro, Sprung, Rakete, Sprengfass, Ölfleck, Schockwelle, Stahlpanzer, Reparatur
- `src/icons.js` – SVG-Symbole der Oberfläche
- `src/main.js` – Spielablauf: Hauptmenü mit Bot-Rennen im Hintergrund, Einzelspieler, Mehrspieler-Räume, Garage, HUD, Pause, Ergebnis, Einstellungen
- Tests: `node test-race.mjs [strecke] [runden] [stärke] [autos]` (Bot-Rennen ohne Grafik), `node test-world.mjs` (Gelände = Physik), `node tools/trackcheck.mjs` (Radien, Abstände, Steigungen)

## Mehrspieler (v6)
- `server/server.mjs` – liefert das Spiel aus (`dist/`, gzip) und betreibt die Räume unter `/ws`; `/health` meldet Räume/Spieler
- `server/rooms.mjs` – Räume mit 5-stelligem Code, Gastgeber (wird bei Verlassen weitergereicht), Bots, Einstellungen, Startampel, Zielwertung, Rennende
- `server/ws.mjs` – schlanke WebSocket-Umsetzung (RFC 6455), keine npm-Pakete nötig
- `src/net.js` – Verbindung im Spiel, Fahrzustand kompakt packen (20 × pro Sekunde)
- So läuft es: Jeder Rechner fährt sein eigenes Auto (die Bots fährt der Gastgeber). Die anderen Autos werden mit 110 ms Puffer weich nachgezogen.
  Treffer, Dellen, Kisten und Power-ups gehen als Ereignisse an alle; Ampel, Platzierung und Rennende bestimmt der Server.
- Einladen: Knopf „EINLADEN“ kopiert einen Link `…/?raum=CODE` – wer ihn öffnet, landet direkt im Raum.
- Tests: `node test-server.mjs` (Server, 26 Prüfungen), `python3 browser-mp.py` (zwei echte Browser fahren gegeneinander),
  `python3 browser-mp-leave.py` (jemand schließt mitten im Rennen den Tab)

### Im eigenen WLAN testen
```
npm install
node build.mjs
node server/server.mjs          # PORT=9000 node server/server.mjs für einen anderen Port
```
Freunde im selben WLAN öffnen `http://<IP-deines-PCs>:8080`. Unter Windows einmal den Zugriff in der Firewall erlauben.

### Online stellen (Coolify + Cloudflare Tunnel)
1. Den Projektordner in ein Git-Repo legen (privat geht, `.gitignore` liegt bei; `dist/sounds` muss mit rein).
2. Coolify → Projekt → **+ Neu** → Repository wählen → Build Pack **Dockerfile**. Das Dockerfile baut das Spiel selbst (`npm ci` + `node build.mjs`).
3. **Ports Exposes: 8080**, Health-Check-Pfad `/health`. Domain z. B. `nitro-server.traumcode.cloud` – so eintragen wie bei deinen anderen Apps hinter dem Tunnel.
4. Cloudflare Zero Trust → Tunnel → **Public Hostname** für die Subdomain anlegen, Ziel wie bei den anderen Apps (Coolify-Proxy). WebSockets laufen durch den Tunnel ohne Extra-Einstellung.
5. **Wichtig:** Für diese Subdomain **keine Access-Anmeldung** – falls eine Wildcard-Access-App deine Domain abdeckt, eine Bypass-Regel „Everyone“ für die Subdomain anlegen. Sonst kommen deine Freunde nicht ins Spiel und `/ws` wird blockiert.
6. Prüfen: `https://nitro.deine-domain.de/health` zeigt `{"ok":true,...}` → Spiel öffnen → Mehrspieler → Raum erstellen.

Hinweise: Räume liegen im Arbeitsspeicher – ein Neustart/Redeploy beendet laufende Räume. Nur **eine** Instanz betreiben (kein Skalieren auf mehrere Container).
Läuft die Seite woanders als der Server, kann unter Einstellungen → „Spielserver“ eine Adresse eingetragen werden (z. B. `nitro.deine-domain.de`).

## Neu in v7: Fahrgefühl, Drift, Sound, Effekte
- **Grip:** maximale Querbeschleunigung +17 %, mehr Abtrieb bei Tempo. Bots nutzen den Grip mit (`aLat` in `src/bot.js`).
- **Drift-Regler** (`src/car.js`): Im Drift bestimmen Lenkung und Gas den *Driftwinkel* (nicht die Drehrate).
  - Steuerung: Handbremse antippen = Heck raus, Gas = halten, in die Kurve lenken = mehr Winkel, gegenlenken / Gas weg = greifen.
  - Schwung-Wechsel per Handbremsen-Flick, Power-Slide bei RWD am Grip-Limit.
  - Mini-Turbo nach langem Drift (Funken blau/orange/lila).
  - Test: `node test-drift.mjs`.
- **Kamera:** Tempo-Zoom auf max. 76° begrenzt (vorher bis ~89°), weniger Zurückweichen beim Beschleunigen.
- **Tacho:** nur noch die zwei Rundinstrumente, Beschriftung alle 40 km/h (keine Überlappung).
- **Sound:**
  - Motor-Loops neu gebaut mit WSOLA (`tools/loops2.py`). Statt 0,12–0,3 s harter Wiederholung laufen jetzt ~1,5 s lange, phasengenau zusammengesetzte Loops: kein Schnarren und keine Knackser mehr.
  - `tools/levels.py` gleicht Lautheit und Schärfe aller Motoren an (der Turbo war +5 dB lauter). Werte stehen im Manifest (`gain`, `shelf`, `liftGain`).
  - Gas-weg-Effekt mit Abklingzeit und über die Motor-Filter; Schaltunterbrechung beim Hochschalten.
  - Reifenquietschen aus Rauschbändern statt Pfeiftönen; weichere UI-Töne; sanfte Höhenabsenkung im Master.
- **Effekte** (`src/itemfx.js`):
  - Öl spritzt aus dem Heck, die Lache breitet sich mit Regenbogenfilm aus.
  - Schockwelle mit Bodenwelle, Druckkuppel, Staubwalze und Rissen.
  - Explosionen mit Feuerball-Blitz und Brandfleck.

## Neu in v8: Neue Autos, Werkstatt, Power-ups, Hupe, Derby + Ausscheiden
- **Neue Autos** (`src/carmodel.js`, gleiche Bauweise wie die anderen: Loft-Schale, bündige Teile, Radläufe, Kanzel):
  - **Vipera GT** – Mittelmotor-Supersportler: Keilnase mit Kotflügel-Kuppen, weit vorn sitzende Kanzel, taillierte Flanken mit Lufteinlässen und Leitblechen, Lamellen-Motorabdeckung, Diffusor, Vierrohr-Auspuff.
  - **Brummi** – Lieferwagen (~2,75 t): kurze Schnauze, hohe Kanzel, Schiebetür mit Laufschiene, Zierstreifen (passt sich dem Lack an), Dachsicken, Flügeltüren, Stahlfelgen.
  - Modelle prüfen: `python3 tools/carshot.py vipera '#c8102e'` (6 Ansichten) bzw. mit Tuning: `python3 tools/carshot.py brummi - '{"aero":3,"engine":3,"armor":3,"tires":"offroad"}'`.
- **Werkstatt / Tuning** (`src/tune.js`, Teile in `src/carmodel.js` → „Tuning-Teile“): Garage → TUNING.
  - Aerodynamik (Abrisskante, GT-Flügel, Race-Doppelflügel + Splitter), Motor (Pilzfilter, Fächerkrümmer + dicke Endrohre, Kompressor/Hutze), Reifen (Semi-Slick, Drift, Gelände), Panzerung (Stahlschweller, Türplatten + Scheibengitter, Käfig + Rammplatte + Naben-Dorne), Hupe.
  - Jedes Teil wirkt auf die Physik (`applyTune`): Drehmoment/Drehzahl, Abtrieb/Kurvengrip/Luftwiderstand, Grip je Untergrund, Haltbarkeit/Gewicht.
  - **Leistungsklassen** D–X über einen Leistungsindex (PI). Einzelspieler und Lobby können eine Klasse vorgeben – zu starke Autos werden automatisch gedrosselt.
- **Modi:** *Ausscheiden* (nach jeder Runde des Führenden fliegt der Letzte raus) und *Derby-Arena* (Last Man Standing mit Lebenspunkten, Bots mit eigener Derby-KI `DerbyDriver`). Online entscheidet beim Ausscheiden der Gastgeber, im Derby meldet jeder seine eigenen Autos (`out`-Nachricht, siehe `server/rooms.mjs`).
- **Hinweis Server:** v8 braucht den neuen Server (neue Autos, Tuning, Modi) → in Coolify einmal „Redeploy“.
- Tests: `node test-server.mjs`, `node test-powerups.mjs`, `node test-speed.mjs`, `node test4.mjs vipera,brummi`, `python3 browser-mp-derby.py`.

## Neu in v9: Coins, Spielstand, Rakete, Derby
- **Coins** (`src/economy.js`): Nach jedem Rennen, Ausscheiden oder Derby gibt es Coins – nach gefahrener Strecke (Derby: Minuten), geschlagenen Gegnern (Bots nach Stärke, echte Fahrer zählen am meisten) und Sieg-Bonus. Allein fahren bringt kaum etwas.
  - Ausgeben: Autos (Brutus gratis, Brummi 900 … Vipera 9 000), Strecken (Grünes Tal gratis, Canyon 750, Küste 1 000, Pass 1 500), Tuning-Teile je Auto (Stufen der Reihe nach, Motor 500 / 1 500 / 4 000 usw.).
  - Kaufen: erster Klick fragt nach („SICHER?“), zweiter kauft. Münzen fliegen beim Verdienen zum Zähler oben und beim Kaufen vom Zähler zum Teil.
  - Balancing prüfen: `node test-economy.mjs` (Motor komplett ≈ 44 typische Rennen, Stufe 3 allein ≈ 29).
- **Spielstand** liegt im Browser *und* auf dem Spielserver (`server/saves.mjs`, `POST /api/save`, eine JSON-Datei in `DATA_DIR`). Unter Einstellungen steht der Spielstand-Code – auf einem anderen PC eingeben und der Fortschritt ist dort.
- **Rakete**: mehr Schaden, Treffer legt das Auto ~1,7 s lahm (kein Gas, keine Lenkung). Im Derby sucht sie den nächsten Gegner.
- **Power-ups nach Platz**: stufenlos – vorne Verteidigung, als Letzter je ~25 % Rakete und Nitro.
- **Nebelwand**: wer sie legt, sieht durch den eigenen Rauch durch; nur Verfolger tappen im Nebel.
- **Derby**: Arena mit Radius 64 m statt 44 m, keine Reparatur aus den Kisten.

### Spielstände in Coolify sichern (einmalig)
1. Coolify → Projekt → die Nitro-App → **Persistent Storage** → **+ Add** → **Volume Mount**.
2. Name z. B. `nitro-saves`, **Destination Path** `/app/data` → Speichern.
3. **Redeploy** klicken.
4. Prüfen: `https://nitro-server.traumcode.cloud/health` zeigt `"store":"ok"` und `"saves": …`. Steht dort `"fehler"`, kann der Server nicht in den Ordner schreiben.

Ohne Volume gehen die Spielstände auf dem Server bei jedem Redeploy verloren (im Browser bleiben sie, und das Spiel lädt sie beim nächsten Start wieder hoch).

### v9.2: Drift, Runden, Abkürzungen, Tastatur
- **Drift** ruhiger und besser steuerbar (≈ 27–42° statt 36–56°, straffere Regelung, schnellerer Ausstieg). **Drift-Cancel:** Bremse antippen oder Leertaste ohne Lenken → sofort Grip, Mini-Turbo verfällt. Test: `node test-drift.mjs`.
- **Runden:** Nach einer Abkürzung hing der Fortschritt bisher fast eine Runde fest. Jetzt wird nach ~1 s auf der Strecke weitergezählt (ohne die abgekürzte Strecke). Test: `node test-laps.mjs`.
- **Abkürzungen:** Leitplanken an allen Stellen, wo Querfahren über die Wiese viel spart (`world.js`, Typ `rail`). `node test-world.mjs` prüft, dass jede solche Linie gesperrt ist.
- **Tastatur:** Power-up jetzt `E` oder `Q` (Shift löste unter Windows die Einrastfunktion aus). Tab/Alt/F10 im Rennen gesperrt (schoben den Fokus aus dem Spiel). Im Vollbild beendet kurzes Esc nicht mehr das Vollbild.
