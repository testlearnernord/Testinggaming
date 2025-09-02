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
    grass: "assets/tiles/grass.png",
    dirt: "assets/tiles/dirt.png",
    path: "assets/tiles/path.png",
    rock: "assets/tiles/rock.png",
    water: "assets/tiles/water.png",
    wood: "assets/tiles/wood.png",
    wall: "assets/tiles/wall.png",
  },
  fx: {
    radial: "assets/fx/radial_light.png",
    ambient: "assets/fx/ambient.png",
  },
  sfx: {
    step: "assets/audio/step.wav",
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

// Carve a village: paths, houses (rects), pond
function setTile(x,y,t){ if(x<0||y<0||x>=MAP_W||y>=MAP_H) return; map[y*MAP_W+x]=t; }
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
  const v = Math.sin(x * 0.1) + Math.cos(y * 0.08);
  setTile(x, y, v > 0 ? 0 : 1);
}
// central path
for(let x=0;x<MAP_W;x++){ setTile(x,50,2); setTile(x,51,2); }
// pond
for(let y=20;y<28;y++) for(let x=70;x<82;x++) setTile(x,y,4);
// farm wood area
for(let y=60;y<72;y++) for(let x=20;x<36;x++) setTile(x,y,5);

// Houses (wall tiles); layout fixed positions
const HOUSES = [
  { name: "Fred", rect: [22, 40, 6, 5], npc: "fred" },
  { name: "Berta", rect: [30, 40, 6, 5], npc: "berta" },
  { name: "Stefan", rect: [38, 40, 6, 5], npc: "stefan" }
];
for (const h of HOUSES) {
  const [sx, sy, w, hh] = h.rect;
  for (let y = sy; y < sy + hh; y++) for (let x = sx; x < sx + w; x++) setTile(x, y, 6);
}

// static colliders for walls/houses/water/rocks
const SOLID = new Set([3, 4, 6]);

// NPC spawn points: "in front of house"
const NPCS = [
  { id: "fred", x: (22 + 3) * TILE, y: (40 + 5) * TILE + 8 },
  { id: "berta", x: (30 + 3) * TILE, y: (40 + 5) * TILE + 8 },
  { id: "stefan", x: (38 + 3) * TILE, y: (40 + 5) * TILE + 8 },
];

export { ASSETS, MAP_W, MAP_H, TILE, TILES, map, SOLID, HOUSES, NPCS };
