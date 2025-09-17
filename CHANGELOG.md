# Changelog

## 1.2.1 — 2025-09-18
- DOM-Referenzen werden erst beim `load`-Event abgeholt, damit Chrome nicht mehr mit "Cannot read properties of null" abbricht und der Canvas schwarz bleibt.
- HUD-, Dialog- und Editor-UI prüfen auf fehlende Elemente, wodurch die Konsole sauber bleibt und der Fallback-Toast zuverlässig erscheint.

## 1.2.0 — 2025-09-18
- Spieler-Avatar mit Blickrichtungs-Gesichtern, Armschwung, Lauf-/Sprintanimationen und angestrengter Mimik beim Steine tragen.
- NPCs erhielten eigene Farbpaletten plus deutlich unterscheidbare Häuser mit Bannern und Emblemen.
- Ausdauer- und Sprintsystem inkl. prozedural erzeugten Schritt-SFX sowie einer beruhigenden Farm-Hintergrundmusik.
- Desktop startet automatisch im Vollbildmodus; mobiles UI bekommt einen Sprint-Button, HUD zeigt Ausdauer an.

## 1.1.0 — 2025-09-17
- Rewrote Poopboy als Canvas-Only Build mit mobilem UI und Touch-Steuerung.
- Feste Script-Boot-Order (data → sfx → main) und Fehler-Toast gegen schwarzen Screen.
- DPI-aware Rendering, Joystick-Input inkl. Deadzone und Context-Button.
- Neues Savegame (`pb_save_v7`) mit Sanitizing und Editor-Layout-Speicher.
- Gameplay nach CODEX: Felsen-Loop, Mais/Kohl mit Bewässerung, Upgrades (Berta/Fred), Yard-Mechanik.
- Map-Editor mit Tile-Snapping, Spawn-Safety und Persistenz.
- Audio-Unlock nach erstem Input, SFX werden prozedural in `sfx.js` generiert (keine Binärdateien).

## 1.0 — 2025-08-10
- Neue Map-Generierung: Klarere Wege, sichtbare Häuser, Dorfplatz, Farmbereich, Teich.
- Neue und überarbeitete Grafiken für Tiles und Sprites.
- Neuer, realistischer Schritt-Sound.
- Kollisionen verbessert: Kein Teleportieren mehr, sanfteres Stoppen an Wänden.
- Häuser werden als Overlay angezeigt, bis bessere Tiles vorhanden sind.
- Diverse Bugfixes (u.a. Map-Initialisierung, setTile-Fehler, Black Screen).
- Code weiter modularisiert und aufgeräumt.

## 0.9 — 2025-08-10
- Perf pass: camera culling, draw batching, fewer allocations, input debounced.
- Visuals: new 48x48 sprites for player+NPCs; procedural tiles; day/night tint; radial light.
- Gameplay: shop near NPCs (E), sprint+stamina, seeds visible, stone placement bug fixed.
- Code: modularized into small files; tiny ECS-ish organization; more comments.
