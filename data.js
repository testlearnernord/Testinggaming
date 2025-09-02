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
    step: "assets/audio/step_cool.wav", // neuer cooler Schritt-Sound
    pickup: "assets/audio/pickup.wav",
    ui: "assets/audio/ui.wav",
    splash: "assets/audio/splash.wav",
    plant: "assets/audio/plant.wav",
    harvest: "assets/audio/harvest.wav"
  }
};

// Simple tile map (100x100). Houses are static with no-go colliders.
// 0=grass,1=dirt,2=path,3=rock,4=water,5=wood,6=wall
const MAP_W = 100, MAP_H = 100, TILE = 48;
const TILES = ["grass", "dirt", "path", "rock", "water", "wood", "wall"];
const map = new Uint8Array(MAP_W * MAP_H).fill(0);

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
  { id: "fred", x: (30 + 4) * TILE, y: (35 + 7) * TILE + 8 },
  { id: "berta", x: (60 + 4) * TILE, y: (35 + 7) * TILE + 8 },
  { id: "stefan", x: (45 + 4) * TILE, y: (60 + 7) * TILE + 8 },
];

export { ASSETS, MAP_W, MAP_H, TILE, TILES, map, SOLID, HOUSES, NPCS };
