import { MAP_SIZE, PLAYER_RADIUS } from './config';
import { Rng } from './rng';

export type ObKind = 'tree' | 'rock' | 'crate' | 'container' | 'wall' | 'fence' | 'hay' | 'barrel';
// Circle when r > 0 (x,y = centre). Rect otherwise (x,y = top-left).
export interface Obstacle { kind: ObKind; x: number; y: number; r: number; w: number; h: number; bullets: boolean; v: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Circle { x: number; y: number; r: number }
export type BuildingStyle = 'house' | 'barn' | 'warehouse' | 'cabin' | 'shop' | 'bunker' | 'tent' | 'factory';
export interface Building extends Rect { style: BuildingStyle; v: number }
export interface Location { name: string; x: number; y: number }
export interface LootSpot { x: number; y: number; tier: number }
export interface Field extends Rect { kind: 'crop' | 'sand' | 'dirt' }

export interface GameMap {
  size: number;
  obstacles: Obstacle[];
  bushes: Circle[];
  water: Circle[];
  roads: Rect[];
  fields: Field[];
  buildings: Building[];
  locations: Location[];
  lootSpots: LootSpot[];
  cell: number;
  cols: number;
  grid: number[][];
}

const CELL = 160;
const WALL = 12;
const DOOR = 76;

type Door = [side: 'n' | 's' | 'e' | 'w', at: number];

export function buildMap(seed: number): GameMap {
  const rng = new Rng(seed);
  const m: GameMap = {
    size: MAP_SIZE, obstacles: [], bushes: [], water: [], roads: [], fields: [], buildings: [],
    locations: [], lootSpots: [], cell: CELL, cols: Math.ceil(MAP_SIZE / CELL), grid: [],
  };
  const reserved: Rect[] = [];

  const circle = (kind: ObKind, x: number, y: number, r: number, bullets = true, v = 0) =>
    m.obstacles.push({ kind, x, y, r, w: 0, h: 0, bullets, v });
  const rect = (kind: ObKind, x: number, y: number, w: number, h: number, bullets = true, v = 0) =>
    m.obstacles.push({ kind, x, y, r: 0, w, h, bullets, v });

  const building = (x: number, y: number, w: number, h: number, style: BuildingStyle, doors: Door[], loot: number, tier = 1) => {
    m.buildings.push({ x, y, w, h, style, v: rng.int(0, 3) });
    reserved.push({ x: x - 50, y: y - 50, w: w + 100, h: h + 100 });
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const horiz = side === 'n' || side === 's';
      const len = horiz ? w : h;
      const gaps = doors.filter((d) => d[0] === side).map((d) => d[1] * len).sort((a, b) => a - b);
      let start = 0;
      const seg = (a: number, b: number) => {
        if (b - a < 2) return;
        if (horiz) rect('wall', x + a, side === 'n' ? y : y + h - WALL, b - a, WALL);
        else rect('wall', side === 'w' ? x : x + w - WALL, y + a, WALL, b - a);
      };
      for (const g of gaps) { seg(start, g - DOOR / 2); start = g + DOOR / 2; }
      seg(start, len);
    }
    for (let i = 0; i < loot; i++) {
      m.lootSpots.push({ x: rng.range(x + 40, x + w - 40), y: rng.range(y + 40, y + h - 40), tier });
    }
  };

  const inReserved = (x: number, y: number, r: number) =>
    reserved.some((q) => x > q.x - r && x < q.x + q.w + r && y > q.y - r && y < q.y + q.h + r);
  const inWaterRaw = (x: number, y: number, r: number) => m.water.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < (c.r + r) ** 2);
  // every obstacle is treated as its bounding circle, so gaps are either closed or wide enough to walk through
  const nearObstacle = (x: number, y: number, r: number) =>
    m.obstacles.some((o) => {
      if (o.kind === 'wall' || o.kind === 'fence' || o.kind === 'container') return false; // covered by reserved rects
      const ox = o.r > 0 ? o.x : o.x + o.w / 2, oy = o.r > 0 ? o.y : o.y + o.h / 2, or = o.r > 0 ? o.r : Math.hypot(o.w, o.h) / 2;
      return (x - ox) ** 2 + (y - oy) ** 2 < (or + r) ** 2;
    });
  const free = (x: number, y: number, r: number) =>
    x > 170 && y > 170 && x < MAP_SIZE - 170 && y < MAP_SIZE - 170 && !inReserved(x, y, r) && !inWaterRaw(x, y, r) && !nearObstacle(x, y, r + 46);
  const scatter = (n: number, cx: number, cy: number, rad: number, r: number, place: (x: number, y: number) => void) => {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const a = rng.range(0, Math.PI * 2), d = Math.sqrt(rng.next()) * rad;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (!free(x, y, r)) continue;
      place(x, y); i++;
    }
  };
  const road = (x: number, y: number, w: number, h: number) => { m.roads.push({ x, y, w, h }); reserved.push({ x, y, w, h }); };

  // ---- water: Mirror Lake + a river running east to the sea ----
  m.water.push({ x: 1000, y: 3700, r: 330 }, { x: 1250, y: 3600, r: 220 }, { x: 800, y: 3860, r: 240 });
  const river = [[1400, 3580], [2000, 3350], [2400, 3300], [3000, 3380], [3500, 3150], [3900, 3050], [4400, 3000], [4900, 2950]];
  for (let i = 0; i < river.length - 1; i++) {
    const [ax, ay] = river[i], [bx, by] = river[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 45);
    for (let k = 0; k < n; k++) m.water.push({ x: ax + ((bx - ax) * k) / n, y: ay + ((by - ay) * k) / n, r: 72 });
  }

  // ---- roads (bridges where they cross water) ----
  const RW = 110;
  road(500, 2300 - RW / 2, 3800, RW);
  road(2400 - RW / 2, 900, RW, 3400);
  road(900, 900 - RW / 2, 2900, RW);
  road(900 - RW / 2, 900 - RW / 2, RW, 1400 + RW);
  road(3900 - RW / 2, 2300, RW, 1750);

  // ---- named locations ----
  m.locations.push(
    { name: 'Pinewood', x: 700, y: 620 }, { name: 'Hayfield Farm', x: 2400, y: 620 }, { name: 'Boulder Ridge', x: 3900, y: 760 },
    { name: 'Whisper Grove', x: 3150, y: 1560 }, { name: 'Sunny Mills', x: 2400, y: 2180 }, { name: 'Camp Ember', x: 700, y: 2800 },
    { name: 'Dusty Junction', x: 4050, y: 2180 }, { name: 'Mirror Lake', x: 1000, y: 3700 }, { name: 'Clank Factory', x: 2350, y: 3980 },
    { name: 'Rusty Docks', x: 4050, y: 4080 },
  );

  // Sunny Mills
  building(1990, 1950, 250, 180, 'house', [['s', 0.5], ['w', 0.5]], 2);
  building(2540, 1940, 260, 190, 'house', [['s', 0.3], ['e', 0.5]], 2);
  building(2010, 2440, 230, 200, 'house', [['n', 0.5], ['s', 0.6]], 2);
  building(2540, 2440, 290, 190, 'shop', [['n', 0.4], ['e', 0.5]], 3);
  building(1680, 1990, 200, 170, 'house', [['e', 0.5], ['s', 0.5]], 2);
  building(2900, 1990, 210, 200, 'house', [['w', 0.5], ['s', 0.5]], 2);
  building(1670, 2440, 240, 170, 'house', [['n', 0.5], ['e', 0.5]], 2);
  building(2930, 2440, 220, 190, 'house', [['n', 0.5], ['w', 0.6]], 2);
  // Hayfield Farm
  building(2090, 440, 320, 240, 'barn', [['s', 0.5], ['e', 0.5]], 4);
  building(2600, 500, 220, 180, 'house', [['s', 0.5], ['w', 0.5]], 2);
  m.fields.push({ x: 1650, y: 1040, w: 540, h: 380, kind: 'crop' }, { x: 2600, y: 1040, w: 560, h: 380, kind: 'crop' });
  for (const f of m.fields.slice(0, 2)) {
    rect('fence', f.x - 14, f.y - 14, f.w * 0.42, 8, false); rect('fence', f.x + f.w * 0.58, f.y - 14, f.w * 0.42 + 14, 8, false);
    rect('fence', f.x - 14, f.y + f.h + 6, f.w + 28, 8, false); rect('fence', f.x - 14, f.y - 14, 8, f.h * 0.4, false);
    for (let i = 0, tries = 0; i < 5 && tries < 80; tries++) {
      const hx = rng.range(f.x + 100, f.x + f.w - 100), hy = rng.range(f.y + 100, f.y + f.h - 100);
      if (nearObstacle(hx, hy, 30 + 46)) continue;
      circle('hay', hx, hy, 30); i++;
    }
    for (let i = 0; i < 2; i++) m.lootSpots.push({ x: rng.range(f.x + 40, f.x + f.w - 40), y: rng.range(f.y + 40, f.y + f.h - 40), tier: 0 });
    reserved.push({ x: f.x - 64, y: f.y - 64, w: f.w + 128, h: f.h + 128 });
  }
  // Pinewood cabins
  building(470, 500, 190, 150, 'cabin', [['s', 0.5], ['e', 0.5]], 2);
  building(840, 380, 180, 150, 'cabin', [['s', 0.5], ['w', 0.5]], 2);
  building(380, 980, 170, 150, 'cabin', [['e', 0.5], ['n', 0.5]], 2);
  // Boulder Ridge bunker
  building(3770, 600, 270, 210, 'bunker', [['s', 0.5], ['w', 0.5]], 4, 2);
  // Camp Ember
  m.fields.push({ x: 430, y: 2560, w: 560, h: 480, kind: 'dirt' });
  building(470, 2600, 120, 110, 'tent', [['s', 0.5]], 1);
  building(830, 2600, 120, 110, 'tent', [['s', 0.5]], 1);
  building(450, 2880, 120, 110, 'tent', [['e', 0.5]], 1);
  building(850, 2890, 120, 110, 'tent', [['w', 0.5]], 1);
  circle('barrel', 710, 2800, 20);
  m.lootSpots.push({ x: 660, y: 2740, tier: 1 }, { x: 760, y: 2860, tier: 1 });
  // Dusty Junction
  building(4020, 1990, 300, 190, 'shop', [['s', 0.4], ['w', 0.5]], 3);
  building(3560, 2440, 220, 180, 'house', [['n', 0.5], ['e', 0.5]], 2);
  building(4050, 2450, 240, 200, 'house', [['n', 0.5], ['w', 0.5]], 2);
  building(3600, 1980, 180, 190, 'house', [['s', 0.5], ['e', 0.5]], 2);
  // Mirror Lake cabins
  building(440, 3230, 190, 150, 'cabin', [['e', 0.5], ['s', 0.5]], 2);
  building(1400, 3990, 190, 160, 'cabin', [['n', 0.5], ['w', 0.5]], 2);
  building(560, 4260, 200, 150, 'cabin', [['n', 0.5], ['e', 0.5]], 2);
  // Clank Factory
  m.fields.push({ x: 2000, y: 3720, w: 1000, h: 560, kind: 'dirt' });
  building(2080, 3800, 250, 300, 'factory', [['n', 0.5], ['s', 0.5], ['w', 0.5]], 4, 2);
  building(2560, 3860, 260, 220, 'warehouse', [['w', 0.5], ['s', 0.5]], 3);
  // Rusty Docks
  m.fields.push({ x: 3300, y: 3620, w: 1330, h: 1010, kind: 'sand' });
  building(3380, 3760, 400, 280, 'warehouse', [['n', 0.3], ['e', 0.5], ['s', 0.7]], 5, 2);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      if (rng.chance(0.2)) continue;
      const x = 4030 + col * 215 + rng.range(-8, 8), y = 3700 + row * 200 + rng.range(-8, 8);
      if (rng.chance(0.3)) rect('container', x + 40, y - 20, 70, 150, true, rng.int(0, 3));
      else rect('container', x, y, 150, 70, true, rng.int(0, 3));
      if (rng.chance(0.6)) m.lootSpots.push({ x: x + 75, y: y + 110, tier: 1 });
    }
  }
  reserved.push({ x: 3975, y: 3620, w: 700, h: 880 });
  for (let i = 0, tries = 0; i < 6 && tries < 200; tries++) {
    const x = rng.range(3340, 3680), y = rng.range(4150, 4480);
    if (inReserved(x, y, 0) || inReserved(x + 150, y, 0) || inReserved(x, y + 70, 0) || inReserved(x + 150, y + 70, 0) || inReserved(x + 75, y + 35, 0)) continue;
    rect('container', x, y, 150, 70, true, rng.int(0, 3));
    reserved.push({ x: x - 46, y: y - 46, w: 242, h: 162 });
    m.lootSpots.push({ x: x + 75, y: y - 30, tier: 1 });
    i++;
  }

  // ---- natural scatter ----
  const tree = (x: number, y: number) => circle('tree', x, y, 15, true, rng.range(46, 72));
  scatter(120, 700, 700, 560, 15, tree);
  scatter(60, 3150, 1560, 380, 15, tree);
  scatter(55, 3900, 820, 520, 62, (x, y) => circle('rock', x, y, rng.range(26, 62), true, rng.int(0, 3)));
  scatter(40, 1000, 3700, 700, 15, tree);
  scatter(230, MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.68, 15, tree);
  scatter(80, MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.68, 46, (x, y) => circle('rock', x, y, rng.range(22, 46), true, rng.int(0, 3)));
  scatter(60, MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.66, 34, (x, y) => {
    rect('crate', x - 24, y - 24, 48, 48, true, rng.int(0, 2));
    m.lootSpots.push({ x: x + rng.pick([-58, 58]), y: y + rng.range(-20, 20), tier: 1 });
  });
  for (const [cx, cy, n] of [[2400, 2300, 10], [4000, 2300, 6], [2350, 4000, 10], [3600, 4200, 8], [700, 2800, 6]]) {
    scatter(n, cx, cy, 420, 19, (x, y) => circle('barrel', x, y, 19, true));
  }
  // bushes do not collide; they hide players
  for (let i = 0, tries = 0; i < 190 && tries < 6000; tries++) {
    const x = rng.range(200, MAP_SIZE - 200), y = rng.range(200, MAP_SIZE - 200), r = rng.range(44, 66);
    if (inReserved(x, y, r * 0.6) || inWaterRaw(x, y, r) || nearObstacle(x, y, r * 0.3)) continue;
    if (m.bushes.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + r) ** 2 * 0.5)) continue;
    m.bushes.push({ x, y, r }); i++;
  }
  // outdoor loot
  scatter(95, MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE * 0.66, 0, (x, y) => m.lootSpots.push({ x, y, tier: 0 }));

  // ---- spatial grid ----
  m.grid = Array.from({ length: m.cols * m.cols }, () => []);
  m.obstacles.forEach((o, i) => {
    const x0 = o.r > 0 ? o.x - o.r : o.x, y0 = o.r > 0 ? o.y - o.r : o.y;
    const x1 = o.r > 0 ? o.x + o.r : o.x + o.w, y1 = o.r > 0 ? o.y + o.r : o.y + o.h;
    for (let cy = cellOf(m, y0); cy <= cellOf(m, y1); cy++)
      for (let cx = cellOf(m, x0); cx <= cellOf(m, x1); cx++) m.grid[cy * m.cols + cx].push(i);
  });
  return m;
}

function cellOf(m: GameMap, v: number): number {
  return Math.max(0, Math.min(m.cols - 1, Math.floor(v / m.cell)));
}

/** Push a circle out of every obstacle it overlaps and keep it on the island. Mutates p. */
export function resolveCollisions(m: GameMap, p: { x: number; y: number }, radius = PLAYER_RADIUS): void {
  for (let pass = 0; pass < 2; pass++) {
    const cx0 = cellOf(m, p.x - radius), cx1 = cellOf(m, p.x + radius), cy0 = cellOf(m, p.y - radius), cy1 = cellOf(m, p.y + radius);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = m.grid[cy * m.cols + cx];
        for (let k = 0; k < list.length; k++) {
          const o = m.obstacles[list[k]];
          if (o.r > 0) {
            const dx = p.x - o.x, dy = p.y - o.y, min = o.r + radius, d2 = dx * dx + dy * dy;
            if (d2 < min * min) {
              const d = Math.sqrt(d2) || 0.001;
              p.x = o.x + (dx / d) * min; p.y = o.y + (dy / d) * min;
            }
          } else {
            const nx = Math.max(o.x, Math.min(p.x, o.x + o.w)), ny = Math.max(o.y, Math.min(p.y, o.y + o.h));
            const dx = p.x - nx, dy = p.y - ny, d2 = dx * dx + dy * dy;
            if (d2 < radius * radius) {
              if (d2 > 1e-6) {
                const d = Math.sqrt(d2);
                p.x = nx + (dx / d) * radius; p.y = ny + (dy / d) * radius;
              } else {
                // centre is inside the rect: exit through the nearest face
                const l = p.x - o.x, r = o.x + o.w - p.x, t = p.y - o.y, b = o.y + o.h - p.y, mn = Math.min(l, r, t, b);
                if (mn === l) p.x = o.x - radius; else if (mn === r) p.x = o.x + o.w + radius;
                else if (mn === t) p.y = o.y - radius; else p.y = o.y + o.h + radius;
              }
            }
          }
        }
      }
    }
  }
  p.x = Math.max(radius, Math.min(m.size - radius, p.x));
  p.y = Math.max(radius, Math.min(m.size - radius, p.y));
}

export function collides(m: GameMap, x: number, y: number, radius: number): boolean {
  const q = { x, y };
  resolveCollisions(m, q, radius);
  return Math.abs(q.x - x) > 0.01 || Math.abs(q.y - y) > 0.01;
}

/** Fraction (0..1) along the segment where it first hits an obstacle, or 2 if it hits nothing. */
export function raycast(m: GameMap, x1: number, y1: number, x2: number, y2: number, bulletsOnly = true): number {
  const dx = x2 - x1, dy = y2 - y1;
  let best = 2;
  const cx0 = cellOf(m, Math.min(x1, x2)), cx1 = cellOf(m, Math.max(x1, x2)), cy0 = cellOf(m, Math.min(y1, y2)), cy1 = cellOf(m, Math.max(y1, y2));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const list = m.grid[cy * m.cols + cx];
      for (let k = 0; k < list.length; k++) {
        const o = m.obstacles[list[k]];
        if (bulletsOnly && !o.bullets) continue;
        const t = o.r > 0 ? segCircle(x1, y1, dx, dy, o.x, o.y, o.r) : segRect(x1, y1, dx, dy, o);
        if (t < best) best = t;
      }
    }
  }
  return best;
}

export function segCircle(x1: number, y1: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return 2;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 2;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : 2;
}

function segRect(x1: number, y1: number, dx: number, dy: number, o: Rect): number {
  let t0 = 0, t1 = 1;
  for (let axis = 0; axis < 2; axis++) {
    const p = axis ? y1 : x1, d = axis ? dy : dx, lo = axis ? o.y : o.x, hi = lo + (axis ? o.h : o.w);
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return 2; continue; }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return 2;
  }
  return t0;
}

export function inRect(q: Rect, x: number, y: number): boolean {
  return x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
}

export function inWater(m: GameMap, x: number, y: number): boolean {
  let wet = false;
  for (let i = 0; i < m.water.length; i++) {
    const c = m.water[i], dx = x - c.x, dy = y - c.y;
    if (dx * dx + dy * dy < c.r * c.r) { wet = true; break; }
  }
  if (!wet) return false;
  for (const r of m.roads) if (inRect(r, x, y)) return false; // bridges
  return true;
}

export function bushAt(m: GameMap, x: number, y: number): number {
  for (let i = 0; i < m.bushes.length; i++) {
    const b = m.bushes[i], dx = x - b.x, dy = y - b.y;
    if (dx * dx + dy * dy < (b.r - 8) * (b.r - 8)) return i;
  }
  return -1;
}

export function buildingAt(m: GameMap, x: number, y: number): number {
  for (let i = 0; i < m.buildings.length; i++) if (inRect(m.buildings[i], x, y)) return i;
  return -1;
}

/** Nearest walkable point to (x,y) — used for landing spots and loot drops. */
export function findFreeSpot(m: GameMap, x: number, y: number, radius = PLAYER_RADIUS + 2): { x: number; y: number } {
  x = Math.max(60, Math.min(m.size - 60, x));
  y = Math.max(60, Math.min(m.size - 60, y));
  for (let ring = 0; ring < 40; ring++) {
    const n = ring === 0 ? 1 : 8 + ring * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = ring * 24;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (px < 40 || py < 40 || px > m.size - 40 || py > m.size - 40) continue;
      if (!collides(m, px, py, radius)) return { x: px, y: py };
    }
  }
  return { x, y };
}
