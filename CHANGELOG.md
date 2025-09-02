# Changelog
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
