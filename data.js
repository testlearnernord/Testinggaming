export const APP_VERSION = "v1.4.1";
export const APP_BASE_PATH = "/";
export const SAVE_KEY = "pb_save_v8";
export const GAME_VERSION = 8;

export const DEBUG = false;

export const WORLD = {
  tileSize: 32,
  width: 40,
  height: 40,
  walkSpeed: 2.8,
  sprintMultiplier: 1.35,
  shoesSpeedBonus: 0.12,
  staminaMax: 1,
  staminaDrain: 0.32,
  staminaRecovery: 0.38,
  staminaIdleRecovery: 0.6,
  walkAnimRate: 7,
  runAnimRate: 11,
  walkStepInterval: 0.42,
  runStepInterval: 0.28,
  inventoryLimit: 99,
  yardBatch: 5,
  yardUpgradeStones: 20,
  maxHearts: 3,
  baseWater: 7,
  editorLayoutKey: "pb_editor_layout_v1",
  dayLength: 240,
  dawnDuration: 0.12,
  duskDuration: 0.12,
};

export const MAPDATA = {
  legend: {
    ".": "grass",
    "p": "path",
    "h": "house",
    "x": "woods",
    "w": "water",
    "f": "field",
    "y": "yard",
    "c": "clearing",
    "q": "quarry",
    "d": "fecalfred",
    "b": "berta",
    "s": "stefan",
    "t": "table",
  },
  layout: [
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "x......................................x",
    "x...hhhhhhhh...........................x",
    "x...hhhhhhhh...........................x",
    "x...hhhhhhhh...........................x",
    "x...hhhhhhhh...........................x",
    "x...hhhhhhhh...........................x",
    "x...pppppppppppppppp...................x",
    "x.................p....................x",
    "x.................p....................x",
    "x.................p.........cccccc.....x",
    "x.................p.........cccccc.....x",
    "x..........pppppppppppp.....cccccc.....x",
    "x..........pffffffffffp.....cccccc.....x",
    "x..........pffffffffffp.wwwwcccccc.....x",
    "x..........pffffffffffp.wwwwcccccc.....x",
    "x..........pffffffppppppppppppcccc.....x",
    "x..........pffffffffffp................x",
    "x.........pppfffdfffpfpppppppps........x",
    "x..........pppyyyyppppp................x",
    "x...........p.yyyy..p.t................x",
    "x...........p.......p..................x",
    "x...........p.......p..................x",
    "x...........p.......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqpq......p..................x",
    "x.....qqqqqqqq......p.......wwwwww.....x",
    "x.....qqqqqqqq......p.......wwwwww.....x",
    "x.....qqqqqqqq......p.......wwwwww.....x",
    "x.....qqqqqqqq......p.......wwwwww.....x",
    "x...........................wwwwww.....x",
    "x...........................wwwwww.....x",
    "x......................................x",
    "x......................................x",
    "x......................................x",
    "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  ],
  yardArea: { x: 14, y: 19, w: 4, h: 2 },
  pondArea: { x: 24, y: 14, w: 4, h: 3 },
  clearingArea: { x: 28, y: 10, w: 6, h: 7 },
  fieldArea: { x: 12, y: 13, w: 10, h: 6 },
  quarryArea: { x: 6, y: 24, w: 8, h: 10 },
  playerSpawn: { x: 20.5, y: 33.5 },
  editorTable: { x: 22, y: 20 },
  cameraBounds: { x: 2, y: 2, w: 36, h: 36 },
};

export const NPCS = [
  {
    id: "fred",
    name: "Fecalfred",
    dialog: "Gib mir Felsen und ich mache Dünger draus.",
    pos: { x: 16.5, y: 18.5 },
    kind: "shop",
    houseId: "fred",
    style: {
      skin: "#f2cda2",
      hair: "#5a3924",
      outfit: "#d28b45",
      accent: "#f8d57a",
      eyes: "#2a221f",
    },
  },
  {
    id: "berta",
    name: "Berta",
    dialog: "Werkzeuge frisch geölt – brauchst du was?",
    pos: { x: 22.5, y: 18.5 },
    kind: "upgrades",
    houseId: "berta",
    style: {
      skin: "#f5d2da",
      hair: "#2b1f3b",
      outfit: "#a35fb7",
      accent: "#68d4f5",
      eyes: "#221b28",
    },
  },
  {
    id: "stefan",
    name: "Stefan",
    dialog: "Der Wald hat noch Platz – lass uns planen.",
    pos: { x: 30.5, y: 18.5 },
    kind: "planner",
    houseId: "stefan",
    style: {
      skin: "#f3e0c8",
      hair: "#3c545f",
      outfit: "#4b90c7",
      accent: "#9fe3c6",
      eyes: "#1c2b33",
    },
  },
];

export const HOUSES = [
  {
    id: "fred",
    area: { x: 4, y: 2, w: 3, h: 5 },
    palette: {
      wall: "#3a2a1c",
      roof: "#7d4722",
      trim: "#f4d28a",
      door: "#2b1d16",
      banner: "#f3c55f",
    },
    emblem: "💩",
  },
  {
    id: "berta",
    area: { x: 7, y: 2, w: 2, h: 5 },
    palette: {
      wall: "#2f2a3c",
      roof: "#72569c",
      trim: "#f6b8e0",
      door: "#1c1428",
      banner: "#5de1f7",
    },
    emblem: "🔧",
  },
  {
    id: "stefan",
    area: { x: 9, y: 2, w: 3, h: 5 },
    palette: {
      wall: "#1f3642",
      roof: "#396b78",
      trim: "#a3efd9",
      door: "#14232b",
      banner: "#82f28f",
    },
    emblem: "📐",
  },
];

export const PLANTS = {
  corn: {
    id: "corn",
    label: "Mais",
    growMs: 40000,
    chance: 0.6,
    minMs: 10000,
    waterBonusMs: 30000,
    poopCost: 1,
    sellPrice: 1,
  },
  cabbage: {
    id: "cabbage",
    label: "Kohl",
    growMs: 120000,
    wateredTotalMs: 40000,
    poopCost: 0,
    seedCost: 1,
    sellPrice: 7,
  },
  moonflower: {
    id: "moonflower",
    label: "Mondbohne",
    growMs: 90000,
    minMs: 25000,
    waterBonusMs: 45000,
    nightSpeed: 2.1,
    seedCost: 3,
    sellPrice: 11,
  },
};

export const ECON = {
  cornSell: 1,
  cabbageSell: 7,
  moonflowerSell: 11,
};

export const CAN_MAX = 13;

export const SPAWN = {
  boulderInit: 24,
  dirtInit: 40,
  boulderCap: 60,
  boulderIntervalMs: [12000, 20000],
};

export const STONE = {
  carrySlow: 0.72,
  cartBonus: 1.1,
  crusherYield: 8,
};

export const FLAGS = {
  dayNightEnabled: true,
  monstersEnabled: false,
};

export const CONTROLS = {
  keyboard: {
    up: ["w", "arrowup"],
    down: ["s", "arrowdown"],
    left: ["a", "arrowleft"],
    right: ["d", "arrowright"],
    action: [" ", "space"],
    sprint: ["shift"],
    editor: ["e"],
  },
  touchDeadZone: 0.18,
};

export const STORAGE_DEFAULTS = {
  money: 0,
  poop: 0,
  ammo: 0,
  corn: 0,
  cabbage: 0,
  cabbageSeed: 0,
  moonflower: 0,
  moonflowerSeed: 0,
  yardDelivered: 0,
  yardPending: 0,
  upgrades: {
    watering: false,
    shoes: false,
    crusher: false,
    cart: false,
  },
  watering: {
    charges: WORLD.baseWater,
  },
};

export function resolveAsset(path) {
  const clean = path.replace(/^\//, "");
  if (APP_BASE_PATH === "/" || APP_BASE_PATH === "./") {
    return `./${clean}`;
  }
  const base = APP_BASE_PATH.endsWith("/") ? APP_BASE_PATH : `${APP_BASE_PATH}/`;
  return `${base}${clean}`;
}

export function isWalkableSymbol(symbol) {
  return symbol === "." || symbol === "p" || symbol === "f" || symbol === "c" || symbol === "y" || symbol === "q" || symbol === "d" || symbol === "b" || symbol === "s" || symbol === "t";
}

export function isBlockingSymbol(symbol) {
  return !isWalkableSymbol(symbol);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
