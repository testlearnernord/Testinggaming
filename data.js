// Asset registry & map definition (static houses; 48x48 tiles)
const ASSETS = {
  sprites: {
    player: "assets/sprites/player.png",
    fred: "assets/sprites/fred.png",
    berta: "assets/sprites/berta.png",
    stefan: "assets/sprites/stefan.png",
    cabbage: "assets/sprites/cabbage.png",
    corn: "assets/sprites/corn.png",
    flower: "assets/sprites/flower.png",
  },
  tiles: {
    grass: "assets/tiles/grass.png",     // neue/ersetzte Grafik
    dirt: "assets/tiles/dirt.png",       // neue/ersetzte Grafik
    path: "assets/tiles/path.png",       // neue/ersetzte Grafik
    rock: "assets/tiles/rock.png",       // neue/ersetzte Grafik
    water: "assets/tiles/water.png",     // neue/ersetzte Grafik
    wood: "assets/tiles/wood.png",       // neue/ersetzte Grafik
    wall: "assets/tiles/wall.png",       // neue/ersetzte Grafik
  },
  fx: {
    radial: "assets/fx/radial_light.png",
    ambient: "assets/fx/ambient.png",
  },
  sfx: {
    step_grass: "assets/audio/step_grass.wav",
    step_dirt: "assets/audio/step_dirt.wav",
    step_stone: "assets/audio/step.wav",
    pickup: "assets/audio/pickup.wav",
    ui: "assets/audio/ui.wav",
    splash: "assets/audio/splash.wav",
    // plant: "assets/audio/plant.wav" // nur eintragen, wenn Datei wirklich existiert!
  }
};

const CONTROL_HINTS = [
  { key: "WASD/←↑→↓", desc: "Bewegen" },
  { key: "Shift", desc: "Sprint" },
  { key: "E/Leertaste", desc: "Aktion" },
  { key: "Q/E oder Mausrad", desc: "Saat wechseln" },
  { key: "1-3", desc: "Direktwahl Saat" },
  { key: "4", desc: "Stein setzen" },
  { key: "Esc", desc: "Pause" },
];

const SEEDS = [
  {
    id: "cabbage",
    name: "Kohl",
    sprite: ASSETS.sprites.cabbage,
    icon: ASSETS.sprites.cabbage,
    growTime: 30,
    yield: 1,
    hotkey: "1",
    harvest: { inventory: "seeds", id: "cabbage" },
    shop: {
      goodId: "cabbage_seed",
      name: "Kohlsamen",
      description: "Robuste Knolle, die schnell und verlässlich wächst.",
      cost: 3,
      amount: 1,
    },
  },
  {
    id: "corn",
    name: "Mais",
    sprite: ASSETS.sprites.corn,
    icon: ASSETS.sprites.corn,
    growTime: 40,
    yield: 1,
    hotkey: "2",
    harvest: { inventory: "seeds", id: "corn" },
    shop: {
      goodId: "corn_seed",
      name: "Maissamen",
      description: "Braucht etwas länger, liefert dafür eine satte Ernte.",
      cost: 4,
      amount: 1,
    },
  },
  {
    id: "flower",
    name: "Blume",
    sprite: ASSETS.sprites.flower,
    icon: ASSETS.sprites.flower,
    growTime: 20,
    yield: 1,
    hotkey: "3",
    harvest: { inventory: "flowers" },
    shop: {
      goodId: "flower_seed",
      name: "Blumensamen",
      description: "Bringt Duft und Farbe auf jedes Beet.",
      cost: 5,
      amount: 1,
    },
  },
];

const SEED_MAP = Object.fromEntries(SEEDS.map(seed => [seed.id, seed]));
const SEED_ORDER = SEEDS.map(seed => seed.id);
const SEED_HOTKEYS = SEEDS
  .filter(seed => seed.hotkey)
  .map(seed => [seed.hotkey, seed.id]);

const SHOP_GOODS = [
  ...SEEDS.map(seed => ({
    id: seed.shop?.goodId ?? `${seed.id}_seed`,
    name: seed.shop?.name ?? `${seed.name}-Samen`,
    icon: seed.icon,
    type: "seed",
    seed: seed.id,
    amount: seed.shop?.amount ?? 1,
    cost: seed.shop?.cost ?? 0,
    description: seed.shop?.description ?? "",
  })),
  {
    id: "veggie_pack",
    name: "Gemüsekiste",
    icon: ASSETS.tiles.wood,
    type: "bundle",
    contents: { cabbage: 2, corn: 1 },
    cost: 7,
    description: "Fred packt dir 2x Kohl und 1x Mais in eine rustikale Kiste.",
  },
  {
    id: "bouquet_kit",
    name: "Strauß-Kit",
    icon: ASSETS.sprites.flower,
    type: "bundle",
    contents: { flower: 3 },
    cost: 10,
    description: "Drei Blumensamen für einen duftenden Lieblingsstrauß.",
  },
  {
    id: "stone_block",
    name: "Steinblock",
    icon: ASSETS.tiles.rock,
    type: "stone",
    amount: 1,
    cost: 5,
    description: "Schwerer Block für Mauern, Wege oder Dekoration.",
  },
  {
    id: "path_bundle",
    name: "Pflaster-Set",
    icon: ASSETS.tiles.path,
    type: "stone",
    amount: 3,
    cost: 9,
    description: "Drei bearbeitete Steine für ein ordentliches Wegenetz.",
  },
];

const SHOP_GOOD_MAP = Object.fromEntries(SHOP_GOODS.map(good => [good.id, good]));

// Simple tile map (100x100). Houses are static with no-go colliders.
// 0=grass,1=dirt,2=path,3=rock,4=water,5=wood,6=wall
const MAP_W = 100, MAP_H = 100, TILE = 48;
const TILES = ["grass", "dirt", "path", "rock", "water", "wood", "wall"];
const map = new Uint8Array(MAP_W * MAP_H);

// setTile Funktion ergänzen (vor rect und Map-Generierung)
function setTile(x, y, t) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  map[y * MAP_W + x] = t;
}

// Hilfsfunktion für Rechtecke
function rect(x, y, w, h, t) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      setTile(xx, yy, t);
}

// Map-Reset: alles Gras
for (let i = 0; i < map.length; ++i) map[i] = 0;

// Hauptweg horizontal
rect(0, 50, MAP_W, 2, 2);
// Hauptweg vertikal
rect(48, 0, 2, MAP_H, 2);

// Dorfplatz (dirt)
rect(40, 40, 20, 20, 1);

// Häuser (sichtbar, weiter auseinander)
const HOUSES = [
  { name: "Fred", rect: [30, 35, 8, 7], npc: "fred" },
  { name: "Berta", rect: [60, 35, 8, 7], npc: "berta" },
  { name: "Stefan", rect: [45, 60, 8, 7], npc: "stefan" }
];
for (const h of HOUSES) {
  const [sx, sy, w, hh] = h.rect;
  // Außenwand
  rect(sx, sy, w, hh, 6);
  // Tür (unten Mitte)
  setTile(sx + Math.floor(w / 2), sy + hh - 1, 2);
  // Innenraum (dirt)
  rect(sx + 1, sy + 1, w - 2, hh - 2, 1);
}

// Teich
rect(70, 20, 12, 8, 4);
// Farmbereich
rect(20, 70, 16, 12, 5);

// static colliders for walls/houses/water/rocks
const SOLID = new Set([3, 4, 6]);

// NPC spawn points: "in front of house"
const NPCS = [
  {
    id: "fred",
    name: "Fred",
    title: "Gemüsebauer",
    accent: "#6edb8f",
    bio: "Fred kümmert sich um alles, was knackig ist. Seine Saat ist günstig und wächst zuverlässig.",
    greeting: "Frisches Gemüse gefällig? Ich hab' dir die besten Saaten beiseite gelegt.",
    shop: [
      { good: "cabbage_seed", price: 2 },
      { good: "corn_seed", price: 3 },
      { good: "veggie_pack", price: 7 },
    ],
    x: (30 + 4) * TILE,
    y: (35 + 7) * TILE + 8,
  },
  {
    id: "berta",
    name: "Berta",
    title: "Floristin",
    accent: "#f28dd3",
    bio: "Berta liebt Duft und Farbe. Bei ihr findest du alles, was deine Felder hübsch macht.",
    greeting: "Oh hallo! Ein bisschen Farbe für deinen Hof? Schau dir meine Blüten an.",
    shop: [
      { good: "flower_seed", price: 5 },
      { good: "bouquet_kit", price: 10 },
      { good: "cabbage_seed", price: 3 },
    ],
    x: (60 + 4) * TILE,
    y: (35 + 7) * TILE + 8,
  },
  {
    id: "stefan",
    name: "Stefan",
    title: "Baumeister",
    accent: "#6ab0ff",
    bio: "Stefan baut Wege und Mauern. Er tauscht gern robuste Steine gegen ein paar Rubel.",
    greeting: "Servus! Mit dem richtigen Material wird dein Hof richtig fein.",
    shop: [
      { good: "stone_block", price: 5 },
      { good: "path_bundle", price: 9 },
      { good: "corn_seed", price: 4 },
    ],
    x: (45 + 4) * TILE,
    y: (60 + 7) * TILE + 8,
  },
];

