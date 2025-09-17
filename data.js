export const APP_VERSION = "v1.1.0";
export const APP_BASE_PATH = "/";
export const SAVE_KEY = "pb_save_v7";
export const GAME_VERSION = 7;

export const DEBUG = false;

export const WORLD = {
  tileSize: 32,
  width: 40,
  height: 40,
  walkSpeed: 2.8,
  sprintBonus: 0.35,
  staminaDrain: 0.22,
  staminaRecovery: 0.35,
  inventoryLimit: 99,
  yardBatch: 5,
  yardUpgradeStones: 20,
  maxHearts: 3,
  baseWater: 7,
  editorLayoutKey: "pb_editor_layout_v1",
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
  },
  {
    id: "berta",
    name: "Berta",
    dialog: "Werkzeuge frisch geölt – brauchst du was?",
    pos: { x: 22.5, y: 18.5 },
    kind: "upgrades",
  },
  {
    id: "stefan",
    name: "Stefan",
    dialog: "Der Wald hat noch Platz – lass uns planen.",
    pos: { x: 30.5, y: 18.5 },
    kind: "planner",
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
};

export const ECON = {
  cornSell: 1,
  cabbageSell: 7,
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
  dayNightEnabled: false,
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
