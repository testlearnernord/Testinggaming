/* ========= GAME DATA ========= */
const GAME_VERSION = "v0.5.2";

/* Welt in Tiles (w*h) + Tilegröße in px */
const WORLD = { W: 40, H: 24, TILE: 48 };

/* Koordinaten in TILES (werden in main.js in Pixel umgerechnet) */
const MAPDATA = {
  // Farm (eingezäunt) nahe Fecalfred
  farm:  { x: 26, y: 12, w: 6, h: 4 },
  // Lichtung links der Farm (Bauplatz)
  clearing: { x: 20, y: 13, w: 4, h: 3 },
  // Teich oben rechts (blockt betreten)
  pondRect: { x: 35, y: 4, w: 4, h: 3 },
  // Tutorial-Schild (bei Fred)
  tutorial: { x: 30, y: 17 }
};

/* NPCs – Positionen in TILES */
const NPCS = [
  { id:"fred",   name:"Fecalfred",             kind:"merchant", x:32, y:16, icon:"🧑‍🌾" },
  { id:"berta",  name:"Berta Brown",           kind:"upgrade",  x:10, y:10, icon:"👩‍🎨" },
  { id:"stefan", name:"Stefan Spielverderber", kind:"cheat",    x:38, y:12, icon:"🧙‍♂️" },
];

/* Economy */
const ECON = {
  stoneToPoop: 10,
  cornSell: 1,
  cabbageSell: 7
};

/* Pflanzen-Definitionen (Millisekunden) */
const PLANTS = {
  corn:   { label:"Mais",    growMs: 40000, chance: 0.60 },           // 40s + 60% Ernte
  cabbage:{ label:"Kohl",    growMs: 120000, wateredTotalMs: 40000 }  // 120s → Gießen macht Gesamtzeit 40s
};

/* Sonstiges */
const CAN_MAX = 13;          // Gießkanne Füllung
const DAY_TOTAL_MS = 180000; // 3 Minuten
const DAYLIGHT_MS  = 120000; // 2 Minuten Tag
