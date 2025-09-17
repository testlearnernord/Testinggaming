# Poopboy v1.4.1

Top-down Farm-Arcade für GitHub Pages. Sammle Felsen, wandle sie in 💩 um und baue Mais, Kohl oder Mondbohnen an. Die Version ist für mobile und Desktop ausgelegt, nutzt Canvas 2D und speichert automatisch unter `pb_save_v8` im `localStorage`.

## Quickstart

1. Repository auf den GitHub Pages Branch (`work`) klonen.
2. Assets liegen flach im Repo (`index.html`, `data.js`, `main.js`, `sfx.js`, `/assets`). Kein Build-Schritt nötig; Audio wird beim Unlock prozedural in `sfx.js` erzeugt (keine Binärdateien).
3. Lokalen HTTP-Server starten (`python -m http.server` o. ä.).
4. App im Browser öffnen. Beim ersten Tap/Klick wird Audio freigeschaltet.

## Neu in v1.4.1

- Kein Blackscreen mehr auf GitHub Pages: Modernes Optional-Chaining wurde entfernt, sodass auch ältere Browser das Spiel wieder starten.
- Touch- und Desktop-Steuerung besitzen Fallbacks für Pointer-Capture & Layoutdaten, damit Sprint-Button und NPC-Editor überall funktionieren.
- Pflanzenwachstum und Nacht-Boni arbeiten mit defensiven Default-Werten – Mondbohnen und Bewässerung bleiben stabil.

## Neu in v1.4.0

- Dynamischer Tag-Nacht-Zyklus mit Ambient-Licht, HUD-Uhrzeit und Tagesabschnitt.
- Glühwürmchen und Mondschein-Bonus nachts rund um den Teich (höhere 💩-Dropchance).
- Neue Feldfrucht **Mondbohne**: leuchtet nachts, wächst schneller im Dunkeln und verkauft sich für 11 €.
- Touch- und Desktop-Steuerung erhalten einen Saat-Button bzw. Taste **3**, um die Saatarten schnell zu wechseln.

## Neu in v1.3.0

- Robuster Start: Die Boot-Sequenz lauscht auf `DOMContentLoaded`, `load` und bereits geladene Dokumente, bevor sie initiiert. So startet die App zuverlässig auf GitHub Pages, auch wenn das Skript nachträglich geladen wird.
- Stabile Darstellung: Der Renderer setzt die Canvas-Transform nun pro Frame zurück. Zufällige schwarze Frames oder schleichende Offsets verschwinden.
- Performance: Tiles, NPCs, Steine und Dirt werden nur noch gezeichnet, wenn sie im sichtbaren Bereich der Kamera liegen. Das reduziert die Fillrate spürbar – gerade auf Mobilgeräten.
- Gemeinsame Helfer: Feld-, Hof- und Teich-Schutzflächen werden zentral geprüft. Spawn-, Platzierungs- und Interaktionslogik teilen sich denselben Code und bleiben wartbar.

## Neu in v1.2.1

- Start-Fix: DOM-Referenzen werden erst beim `load`-Event aufgebaut, damit Chrome auf GitHub Pages nicht mehr mit Null-Elementen abstürzt und einen schwarzen Bildschirm zeigt.

## Highlights v1.2.0

- Animierte Charaktere mit Blickrichtungs-Gesichtern, Armschwung und sichtbar angestrengtem Gesicht beim Steine schleppen.
- NPCs mit individuellen Farbpaletten und Häusern, inkl. Bannern und Emblemen zur besseren Orientierung.
- Sprint- und Ausdauersystem mit prozedural generierten Schrittgeräuschen sowie entspannter Farm-Hintergrundmusik.
- Desktop-Keyboardspiel startet automatisch im Vollbild, Mobile erhält einen eigenen Sprint-Button.

## Steuerung

### Desktop
- **WASD / Pfeile** – Bewegung
- **Shift** – Sprint (verbraucht Ausdauer)
- **Leertaste** – Kontextaktion (Shop, Pflanzen, Abliefern, Editor)
- **1 / 2** – Saatart wählen (Mais / Kohl)
- **3** – Mondbohne auswählen

### Mobile
- Virtueller Joystick links
- Sprint-Button rechts oder Joystick bis zum Rand halten
- Kontextbutton rechts
- Saat-Button rechts zum Durchschalten der Saatarten
- Restart-Button setzt den Speicherstand zurück

## Gameplay-Loop

1. Felsen und Erdbrocken einsammeln (Felsen spawnen nach, Dirt dropt 10–15 % 💩).
2. Felsen auf dem Hof abliefern: 5 Stück = 1 💩. Nach 20 Felsen schaltet Fecalfred den Karren + 💩-Verkauf frei.
3. **Mais** kostet 1 💩, wächst in 40 s (bewässert −30 s, min. 10 s), 60 % Erfolgs-Chance.
4. **Kohl** benötigt Saat (2 € bei Fecalfred), wächst 120 s bzw. 40 s wenn gewässert, verkauft sich für 7 €.
5. **Mondbohnen** brauchen Saat (3 € nach Hof-Upgrade), profitieren vom Nachtlicht, verkaufen sich für 11 €.
6. Bei Fecalfred verkaufen, mit Cash bei Berta Upgrades holen.

## Upgrades & Shops

- **Berta**: Gießkanne (5 € → 13 Füllungen), Schuhe (+35 % Speed, 7 €), Steinzerkleinerer (6 € → 8 Munition pro Stein).
- **Fecalfred**: Mais/Kohl verkaufen, Kohlsaat (2 €). Nach 20 Felsen zusätzlich 💩-Verkauf (4 €), Mondbohnen-Saat (3 €) und Karren (6 €, +10 % Tragespeed).
- **Editor-Tisch**: Positionen von Fred, Berta, Stefan sowie Feld, Lichtung, Teich, Felsenhof verschieben (Tile-Snapping, Speicherung unter `pb_editor_layout_v1`).

## Daten & Tuning

Alle Balancing-Werte liegen zentral in [`data.js`](data.js):
- `PLANTS` mit Wachstumszeiten und Erfolgsraten
- `ECON` (Verkaufspreise)
- `STONE` (Tragespeed, Munitionsertrag)
- `SPAWN` für Stein-/Dirt-Spawns
- `WORLD` für Basisgeschwindigkeit, Wasser-/Ausdauer-Kapazität und Sprint-Tuning

## Savegame

- Automatisches Speichern nach relevanten Aktionen (`pb_save_v8`).
- Werte werden beim Laden geclamped und sanitisiert.
- Speichert Tageszeit, freigeschaltete Mondbohnen und alle Pflanzen.
- Reset über den "Neu starten" Button oder Entfernen des LocalStorage-Eintrags.

## Deployment

- Alle Pfade sind relativ (`./assets/...`) und funktionieren unter GitHub Pages (`/` oder `/<repo>/`).
- Nach Commit einfach pushen, Pages baut automatisch.
- Optional Tag setzen (`git tag v1.2.1`).

## Troubleshooting

**Schwarzer Bildschirm:**
- Die Initialisierung wartet auf `DOMContentLoaded` *und* `load`. Sollte dennoch etwas hängen bleiben, erscheint eine Toast-Fehlermeldung.
- Bei hartnäckigen Problemen hilft weiterhin ein Hard-Reload (Ctrl/Cmd + Shift + R).

**Kein Sound:**
- Der erste User-Input schaltet Audio via `primeAudioUnlock()` frei. Bei blockierenden Browsern einmal tippen/klicken.

**Performance:**
- Canvas ist DPR-aware (`devicePixelRatio`).
- Der Game-Loop nutzt `requestAnimationFrame` und vermeidet per-frame Allokationen.

## QA Checkliste

- Start ohne Konsolenfehler (Desktop & Mobile)
- HUD zeigt Version `v1.4.1` im Overlay an
- Sprint verbraucht Ausdauer und regeneriert beim Stehen
- Fußschritte klingen je nach Untergrund, Musik startet nach erstem Input
- NPC-Gesichter folgen der Spielerposition, Häuser wirken visuell eindeutig
- Steinabgabe liefert 💩 wie erwartet
- Pflanzen wachsen und lassen sich gießen/ernten
- Upgrades wirken direkt nach Kauf
- Editor speichert Layout und verhindert Felsen-Spawns auf verbotenen Tiles
- FPS > 55 auch mit vielen Felsen
