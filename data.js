/* ========= GAME DATA ========= */
const GAME_VERSION = "v0.6.1"; // Build mit Fixes

/* Welt in Tiles (w*h) + Tilegröße in px */
const WORLD = { W: 40, H: 24, TILE: 48 };

/* Map – angepasst:
   - BERTA links/oben
   - Feld mittig links
   - Lichtung (Shack/Toolbox) rechts vom Feld
   - Teich oben rechts
   - Fred links unten
   - Stefan rechts unten */
const MAPDATA = {
  farm:     { x: 18, y: 14, w: 6, h: 4 },   // Feld (mit Tor unten)
  clearing: { x: 25, y: 13, w: 5, h: 4 },   // Lichtung (Shack/Toolbox)
  pondRect: { x: 34, y: 5,  w: 5, h: 4 },   // Teich oben rechts
  tutorial: { x: 26, y: 18 }                // Info-Schild neben Fred
};

/* NPCs – Positionen in TILES */
const NPCS = [
  { id:"fred",   name:"Fecalfred",             kind:"merchant", x:10, y:19, icon:"🧑‍🌾" }, // links unten
  { id:"berta",  name:"Berta Brown",           kind:"upgrade",  x:12, y:9,  icon:"👩‍🎨" }, // links/oben
  { id:"stefan", name:"Stefan Spielverderber", kind:"cheat",    x:36, y:16, icon:"🧙‍♂️" }, // rechts unten
];

/* Economy */
const ECON = { stoneToPoop: 10, cornSell: 1, cabbageSell: 7 };

/* Pflanzen (ms) */
const PLANTS = {
  corn:    { label:"Mais",    growMs: 40000, chance: 0.60 },
  cabbage: { label:"Kohl",    growMs: 120000, wateredTotalMs: 40000 }
};

/* Gießkanne */
const CAN_MAX = 13;

/* Tag/Nacht */
const DAY_TOTAL_MS = 180000; // 3 Min total
const DAYLIGHT_MS  = 120000; // 2 Min Tag
