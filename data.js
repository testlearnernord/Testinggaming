/* ========= GAME DATA ========= */
const GAME_VERSION = "v0.5.2";

/* Welt in Tiles (w*h) + Tilegröße in px */
const WORLD = { W: 40, H: 24, TILE: 48 };

/* Koordinaten in TILES */
const MAPDATA = {
  farm:     { x: 26, y: 12, w: 6, h: 4 },  // eingezäuntes Feld
  clearing: { x: 20, y: 13, w: 4, h: 3 },  // Lichtung links von Farm
  pondRect: { x: 35, y: 4,  w: 4, h: 3 },  // Teich oben rechts (blockt)
  tutorial: { x: 30, y: 17 }               // Tutorial-Schild bei Fred
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

/* Pflanzen (ms) */
const PLANTS = {
  corn:    { label:"Mais",    growMs: 40000, chance: 0.60 },
  cabbage: { label:"Kohl",    growMs: 120000, wateredTotalMs: 40000 }
};

/* Gießkanne */
const CAN_MAX = 13;

/* Tag/Nacht */
const DAY_TOTAL_MS = 180000; // 3 Min
const DAYLIGHT_MS  = 120000; // 2 Min Tag
