/* =========================================================================
   GAME DATA – Map, Items, NPCs, Buildings, Constants
   ========================================================================= */

const GAME_VERSION = "v0.5.2";

// ==== MAP SETTINGS ====
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;

// ==== COLLISION AREAS (static) ====
const COLLISION_RECTS = [
  // Teich-Kollision (oberer Teich blockt betreten)
  { x: 1550, y: 300, w: 180, h: 140 }, // Anpassung: Größe des Teichs
];

// ==== TUTORIAL SIGNS ====
const TUTORIAL_SIGNS = [
  {
    x: 600, y: 480,
    text: [
      "Willkommen bei Poopboy!",
      "Du kannst Steine aufnehmen, platzieren, als Munition nutzen oder mit ihnen handeln.",
      "Platzierte Steine blockieren Monster – und dich selbst!",
      "Denke strategisch!"
    ]
  }
];

// ==== NPCs ====
const NPCS = [
  {
    name: "Fecalfred",
    x: 550, y: 450,
    type: "merchant",
    img: "fred.png",
    scale: 1,
    dialog: [
      "Willkommen, Freund!",
      "Ich kaufe Mais und Kohl.",
      "Ich verkaufe Saat und Poop."
    ]
  },
  {
    name: "Berta Brown",
    x: 1400, y: 500,
    type: "upgrade",
    img: "berta.png",
    scale: 1,
    dialog: [
      "Ich habe nützliche Upgrades!",
      "Schuhe, Gießkannen und mehr."
    ]
  },
  {
    name: "Stefan Spielverderber",
    x: 1900, y: 800,
    type: "cheat",
    img: "stefan.png",
    scale: 1,
    dialog: [
      "Ich bin Stefan Spielverderber!",
      "Ich kann alles spawnen, Zeit ändern, Godmode geben."
    ]
  }
];

// ==== ITEM DEFINITIONS ====
const ITEMS = {
  stone: {
    name: "Stein",
    icon: "stone.png",
    stack: 99
  },
  dirt: {
    name: "Erdbrocken",
    icon: "dirt.png",
    stack: 99
  },
  poop: {
    name: "Poop",
    icon: "poop.png",
    stack: 99
  },
  corn_seed: {
    name: "Maissaat",
    icon: "corn_seed.png",
    stack: 50
  },
  cabbage_seed: {
    name: "Kohlsaat",
    icon: "cabbage_seed.png",
    stack: 50
  },
  corn: {
    name: "Mais",
    icon: "corn.png",
    stack: 50
  },
  cabbage: {
    name: "Kohl",
    icon: "cabbage.png",
    stack: 50
  }
};

// ==== START INVENTORY ====
const START_INVENTORY = [
  { id: "stone", qty: 0 },
  { id: "poop", qty: 0 },
  { id: "corn_seed", qty: 0 },
  { id: "cabbage_seed", qty: 0 }
];

// ==== BUILDINGS ====
const BUILDINGS = {
  shack_broken: {
    name: "Kaputter Schuppen",
    cost: 50,
    icon: "shack_broken.png",
    safeZone: true
  },
  clearing_expand: {
    name: "Lichtung erweitern",
    cost: 75,
    icon: "clearing_expand.png",
    safeZone: false
  }
};

// ==== MONSTER SETTINGS ====
const MONSTER_TYPES = [
  {
    name: "Slime",
    hp: 2,
    speed: 0.5,
    dmg: 1,
    loot: [
      { id: "poop", chance: 0.2, qty: 1 },
      { id: "cabbage_seed", chance: 0.1, qty: 1 },
      { id: "stone", chance: 0.3, qty: 1 },
      { id: "coin", chance: 0.25, qty: [1, 3] }
    ]
  }
];

// ==== GAME ECONOMY ====
const ECONOMY = {
  stoneToPoop: 10, // Steine für 1 Poop
  cornSell: 1,     // Verkaufspreis Mais
  cabbageSell: 7,  // Verkaufspreis Kohl
  cornGrowChance: 0.6,
  cabbageGrowChance: 1.0
};
