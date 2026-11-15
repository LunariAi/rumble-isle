// All artwork is drawn procedurally on canvas — no image assets.
import { AMMO_COLORS, AmmoType, ItemId, RARITIES, WEAPONS, WeaponClass, WeaponId } from '../../../shared/config';
import type { Building, GameMap, Obstacle } from '../../../shared/map';
import type { Loot } from '../../../shared/sim';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
function circle(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
}

// ------------------------------------------------------------------ characters
export interface CharOpts { walk: number; weapon: WeaponClass | null; recoil: number; hurt: number; downed: boolean; punch: number }

const OUTLINE = '#2b2540';

export function drawWeapon(c: Ctx, cls: WeaponClass, x: number, y: number, s = 1): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.lineWidth = 2.5; c.strokeStyle = OUTLINE; c.lineJoin = 'round';
  const body = (px: number, py: number, w: number, h: number, col: string, r = 2) => { rr(c, px, py, w, h, r); c.fillStyle = col; c.fill(); c.stroke(); };
  switch (cls) {
    case 'pistol': body(0, -3.5, 17, 7, '#8b93a7'); body(-1, -3.5, 7, 7, '#5a6072'); break;
    case 'shotgun': body(4, -3, 28, 6, '#6e7487'); body(-4, -4.5, 16, 9, '#b0703c', 3); body(14, -4.5, 9, 9, '#8c5529', 2); break;
    case 'rifle': body(8, -2.5, 26, 5, '#5a6072'); body(-4, -4.5, 22, 9, '#3f7d5c', 3); body(4, 3, 6, 7, '#2f3140', 1); break;
    case 'smg': body(6, -2.5, 15, 5, '#5a6072'); body(-3, -4.5, 16, 9, '#d18a2c', 3); body(3, 3, 5, 9, '#2f3140', 1); break;
    case 'sniper': body(6, -2, 40, 4, '#4b5062'); body(-6, -4, 24, 8, '#7a4fb5', 3); body(4, -8.5, 13, 5, '#2f3140', 2); break;
  }
  c.restore();
}

/** Draws a character centred on the origin facing +x. Caller translates/rotates. */
export function drawCharacter(c: Ctx, char: string, color: string, o: CharOpts): void {
  const dark = shade(color, -0.3), light = shade(color, 0.45);
  c.lineJoin = 'round'; c.lineCap = 'round';
  // feet
  const sw = Math.sin(o.walk) * 7;
  c.fillStyle = OUTLINE;
  c.beginPath(); c.ellipse(-2 + sw, -10, 7, 5, 0, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(-2 - sw, 10, 7, 5, 0, 0, TAU); c.fill();
  // back features
  c.lineWidth = 3; c.strokeStyle = OUTLINE; c.fillStyle = dark;
  if (char === 'bruno') { for (const s of [-1, 1]) { circle(c, -7, 14 * s, 6.5); c.fill(); c.stroke(); } }
  if (char === 'kiki') {
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(-10, 9 * s); c.lineTo(-4, 22 * s); c.lineTo(5, 13 * s); c.closePath(); c.fill(); c.stroke(); }
    c.beginPath(); c.moveTo(-17, 0); c.quadraticCurveTo(-30, Math.sin(o.walk * 0.5) * 8, -27, 10); c.lineWidth = 5; c.strokeStyle = dark; c.stroke();
    c.lineWidth = 3; c.strokeStyle = OUTLINE;
  }
  if (char === 'hopper') { for (const s of [-1, 1]) { c.beginPath(); c.ellipse(-17, 7 * s, 12, 5, s * 0.25, 0, TAU); c.fill(); c.stroke(); c.beginPath(); c.ellipse(-17, 7 * s, 7, 2, s * 0.25, 0, TAU); c.fillStyle = '#ffc9d6'; c.fill(); c.fillStyle = dark; } }
  if (char === 'bolt') { c.beginPath(); c.moveTo(-12, 0); c.lineTo(-25, 0); c.stroke(); circle(c, -26, 0, 4); c.fillStyle = '#ff5d6c'; c.fill(); c.stroke(); }
  // weapon + hands
  const rc = -o.recoil * 6;
  if (!o.downed) {
    if (o.weapon) {
      drawWeapon(c, o.weapon, 14 + rc, 8);
      c.fillStyle = light; c.strokeStyle = OUTLINE; c.lineWidth = 2.5;
      circle(c, 15 + rc, 9, 5.5); c.fill(); c.stroke();
      if (o.weapon !== 'pistol') { circle(c, 27 + rc, 3, 5.5); c.fill(); c.stroke(); }
      else { circle(c, 11, -13, 5.5); c.fill(); c.stroke(); }
    } else {
      c.fillStyle = light; c.strokeStyle = OUTLINE; c.lineWidth = 2.5;
      const p = Math.sin(Math.min(1, o.punch) * Math.PI) * 16;
      circle(c, 14 + p, 13, 6); c.fill(); c.stroke();
      circle(c, 14, -13, 6); c.fill(); c.stroke();
    }
  }
  // body
  c.lineWidth = 3; c.strokeStyle = OUTLINE; c.fillStyle = color;
  if (char === 'bolt') rr(c, -17, -17, 34, 34, 9); else circle(c, 0, 0, 18);
  c.fill(); c.stroke();
  // highlight
  c.fillStyle = 'rgba(255,255,255,0.22)';
  c.beginPath(); c.ellipse(-5, -7, 9, 5, -0.6, 0, TAU); c.fill();
  // face
  if (char === 'bolt') {
    rr(c, 3, -12, 10, 24, 4); c.fillStyle = '#23263a'; c.fill();
    c.fillStyle = '#7df9ff'; circle(c, 8, -5, 2.6); c.fill(); circle(c, 8, 5, 2.6); c.fill();
  } else {
    if (char === 'bruno') { circle(c, 11, 0, 6.5); c.fillStyle = light; c.fill(); circle(c, 15, 0, 2.4); c.fillStyle = OUTLINE; c.fill(); }
    if (char === 'hopper') { circle(c, 14, 0, 2.2); c.fillStyle = '#ff8fab'; c.fill(); }
    if (char === 'kiki') { c.strokeStyle = OUTLINE; c.lineWidth = 1.2; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(13, 3 * s); c.lineTo(21, 7 * s); c.moveTo(13, 5 * s); c.lineTo(19, 11 * s); c.stroke(); } }
    c.fillStyle = '#fff';
    circle(c, 8, -6.5, 4.4); c.fill(); circle(c, 8, 6.5, 4.4); c.fill();
    c.fillStyle = OUTLINE;
    circle(c, 9.8, -6.5, 2.2); c.fill(); circle(c, 9.8, 6.5, 2.2); c.fill();
  }
  // top features
  if (char === 'sprout') {
    c.fillStyle = '#58c45a'; c.strokeStyle = '#2f7d3a'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(-8, -6, 9, 4.5, 0.7, 0, TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(-8, 6, 9, 4.5, -0.7, 0, TAU); c.fill(); c.stroke();
  }
  if (char === 'cap') {
    c.lineWidth = 2.5; c.strokeStyle = OUTLINE;
    c.beginPath(); c.arc(-7, 0, 10.5, 0, TAU); c.fillStyle = '#2f3a5c'; c.fill(); c.stroke();
    c.beginPath(); c.arc(-7, 0, 10.5, -1.0, 1.0); c.lineWidth = 4; c.strokeStyle = '#f2c94c'; c.stroke();
    circle(c, -8, 0, 2.6); c.fillStyle = '#f2c94c'; c.fill();
  }
  if (o.hurt > 0) { c.globalAlpha = Math.min(0.7, o.hurt); circle(c, 0, 0, 19); c.fillStyle = '#fff'; c.fill(); c.globalAlpha = 1; }
}

// ------------------------------------------------------------------ icons / loot
export function drawItemIcon(c: Ctx, item: ItemId, s = 1): void {
  c.save(); c.scale(s, s); c.lineWidth = 2.2; c.strokeStyle = OUTLINE; c.lineJoin = 'round';
  if (item === 'bandage') {
    rr(c, -9, -6, 18, 12, 4); c.fillStyle = '#fff7ea'; c.fill(); c.stroke();
    c.fillStyle = '#ff5d6c'; c.fillRect(-1.5, -4, 3, 8); c.fillRect(-4, -1.5, 8, 3);
  } else if (item === 'medkit') {
    rr(c, -10, -8, 20, 16, 3); c.fillStyle = '#ff5d6c'; c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.fillRect(-2, -5.5, 4, 11); c.fillRect(-5.5, -2, 11, 4);
  } else if (item === 'cell') {
    rr(c, -6, -10, 12, 20, 3); c.fillStyle = '#4ad2ff'; c.fill(); c.stroke();
    c.fillStyle = '#eaffff'; c.beginPath(); c.moveTo(1.5, -6); c.lineTo(-3, 1); c.lineTo(0, 1); c.lineTo(-1.5, 6); c.lineTo(3, -1); c.lineTo(0, -1); c.closePath(); c.fill();
  } else {
    circle(c, 0, 1.5, 8); c.fillStyle = '#ff9a2e'; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(3, -8, 5, 2.6, -0.5, 0, TAU); c.fillStyle = '#58c45a'; c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.5)'; circle(c, -3, -1, 2.2); c.fill();
  }
  c.restore();
}

export function drawAmmoIcon(c: Ctx, t: AmmoType, s = 1): void {
  c.save(); c.scale(s, s); c.lineWidth = 2.2; c.strokeStyle = OUTLINE;
  rr(c, -9, -6, 18, 12, 2.5); c.fillStyle = AMMO_COLORS[t]; c.fill(); c.stroke();
  c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(-9, -1, 18, 2.4);
  c.restore();
}

const WEAPON_LEN: Record<WeaponClass, number> = { pistol: 17, shotgun: 32, rifle: 34, smg: 22, sniper: 46 };
export function drawWeaponIcon(c: Ctx, id: WeaponId, s = 1): void {
  const cls = WEAPONS[id].cls;
  drawWeapon(c, cls, (-WEAPON_LEN[cls] / 2 + 2) * s, 0, s);
}

export function drawLoot(c: Ctx, l: Loot, t: number): void {
  const bob = Math.sin(t * 3 + l.id) * 2;
  const col = l.kind === 'weapon' ? RARITIES[l.rarity!].color : l.kind === 'ammo' ? AMMO_COLORS[l.ammo!] : '#ffffff';
  c.save();
  c.translate(l.x, l.y);
  c.globalAlpha = 0.28; circle(c, 0, 0, l.kind === 'weapon' ? 27 : 17); c.fillStyle = col; c.fill();
  c.globalAlpha = 0.8; c.lineWidth = 2.5; c.strokeStyle = col; c.stroke();
  c.globalAlpha = 1;
  c.translate(0, bob);
  if (l.kind === 'weapon') { c.rotate(-0.5); drawWeaponIcon(c, l.weapon!, 1.15); }
  else if (l.kind === 'ammo') drawAmmoIcon(c, l.ammo!, 0.95);
  else drawItemIcon(c, l.item!, 1);
  c.restore();
}

// ------------------------------------------------------------------ world
export const GROUND = { sea: '#2f9fd6', sand: '#f3e2a9', grass: '#7fcf5f' };
const ROOFS: Record<string, string[]> = {
  house: ['#e86a5a', '#4a90d9', '#f0a640', '#8e6bd1'], barn: ['#b5432f'], warehouse: ['#7d8aa0'], cabin: ['#9a6a3a'],
  shop: ['#2bb5a0', '#e55d8c'], bunker: ['#5d6b5a'], tent: ['#f0a640', '#4a90d9', '#e86a5a', '#58c45a'], factory: ['#8a5a44'],
};
const FLOORS: Record<string, string> = { house: '#d9b98a', barn: '#c9a15e', warehouse: '#a9afb9', cabin: '#b98a55', shop: '#e3d7c1', bunker: '#8b9189', tent: '#cdb98f', factory: '#9c9590' };
const CONTAINER = ['#d9534f', '#3f8fd6', '#e0a030', '#3fae7a'];

export function roofColor(b: Building): string { const list = ROOFS[b.style]; return list[b.v % list.length]; }

export function drawGround(c: Ctx, m: GameMap, x0: number, y0: number, x1: number, y1: number, t: number): void {
  const S = m.size;
  rr(c, -40, -40, S + 80, S + 80, 300); c.fillStyle = '#8fd6f2'; c.fill(); // shallows
  rr(c, 0, 0, S, S, 260); c.fillStyle = GROUND.sand; c.fill();
  rr(c, 85, 85, S - 170, S - 170, 210); c.fillStyle = GROUND.grass; c.fill();
  const vis = (x: number, y: number, w: number, h: number) => x < x1 && x + w > x0 && y < y1 && y + h > y0;
  // grass tufts on a hashed lattice
  c.fillStyle = 'rgba(60,150,60,0.22)';
  const G = 150;
  for (let gy = Math.floor(y0 / G); gy <= y1 / G; gy++) {
    for (let gx = Math.floor(x0 / G); gx <= x1 / G; gx++) {
      const h = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
      const px = gx * G + (h % 97) / 97 * G, py = gy * G + ((h >> 8) % 89) / 89 * G;
      if (px < 140 || py < 140 || px > S - 140 || py > S - 140) continue;
      c.beginPath(); c.ellipse(px, py, 16 + (h % 23), 7 + (h % 7), (h % 6), 0, TAU); c.fill();
    }
  }
  for (const f of m.fields) {
    if (!vis(f.x, f.y, f.w, f.h)) continue;
    rr(c, f.x, f.y, f.w, f.h, f.kind === 'crop' ? 10 : 60);
    c.fillStyle = f.kind === 'crop' ? '#e3c552' : f.kind === 'sand' ? '#ecd79a' : '#c2a577'; c.fill();
    if (f.kind === 'crop') { c.strokeStyle = 'rgba(160,120,20,.35)'; c.lineWidth = 6; c.beginPath(); for (let y = f.y + 18; y < f.y + f.h; y += 26) { c.moveTo(f.x + 10, y); c.lineTo(f.x + f.w - 10, y); } c.stroke(); }
  }
  // water: shore pass then water pass so overlapping circles merge
  for (const pass of [0, 1, 2]) {
    c.fillStyle = pass === 0 ? '#e9dca3' : pass === 1 ? '#3fb1e6' : '#5cc3f0';
    c.beginPath();
    for (const w of m.water) {
      const r = pass === 0 ? w.r + 9 : pass === 1 ? w.r : w.r - 16;
      if (r <= 0 || !vis(w.x - r, w.y - r, r * 2, r * 2)) continue;
      c.moveTo(w.x + r, w.y); c.arc(w.x, w.y, r, 0, TAU);
    }
    c.fill();
  }
  // roads
  for (const r of m.roads) {
    if (!vis(r.x, r.y, r.w, r.h)) continue;
    rr(c, r.x, r.y, r.w, r.h, 16); c.fillStyle = '#8f93a0'; c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 5; c.setLineDash([34, 30]);
  c.beginPath();
  for (const r of m.roads) {
    if (!vis(r.x, r.y, r.w, r.h)) continue;
    if (r.w > r.h) { c.moveTo(r.x + 20, r.y + r.h / 2); c.lineTo(r.x + r.w - 20, r.y + r.h / 2); }
    else { c.moveTo(r.x + r.w / 2, r.y + 20); c.lineTo(r.x + r.w / 2, r.y + r.h - 20); }
  }
  c.stroke(); c.setLineDash([]);
  for (const b of m.buildings) {
    if (!vis(b.x, b.y, b.w, b.h)) continue;
    c.fillStyle = FLOORS[b.style]; c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeStyle = 'rgba(0,0,0,.07)'; c.lineWidth = 2; c.beginPath();
    for (let x = b.x + 30; x < b.x + b.w; x += 30) { c.moveTo(x, b.y); c.lineTo(x, b.y + b.h); }
    c.stroke();
  }
  void t;
}

export function drawObstacle(c: Ctx, o: Obstacle): void {
  c.lineWidth = 3; c.strokeStyle = OUTLINE; c.lineJoin = 'round';
  switch (o.kind) {
    case 'rock': {
      c.fillStyle = 'rgba(0,0,0,.16)'; c.beginPath(); c.ellipse(o.x + 5, o.y + 7, o.r, o.r * 0.92, 0, 0, TAU); c.fill();
      c.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rad = o.r * (0.9 + (((o.v + i * 5) * 37) % 10) / 70); c.lineTo(o.x + Math.cos(a) * rad, o.y + Math.sin(a) * rad); }
      c.closePath(); c.fillStyle = '#9aa3b2'; c.fill(); c.stroke();
      c.fillStyle = '#b9c1ce'; c.beginPath(); c.ellipse(o.x - o.r * 0.25, o.y - o.r * 0.28, o.r * 0.42, o.r * 0.3, -0.5, 0, TAU); c.fill();
      break;
    }
    case 'tree': circle(c, o.x, o.y, o.r); c.fillStyle = '#8a5a34'; c.fill(); c.stroke(); break;
    case 'hay': {
      circle(c, o.x, o.y, o.r); c.fillStyle = '#eccb5a'; c.fill(); c.stroke();
      c.lineWidth = 2; c.strokeStyle = 'rgba(150,110,20,.6)'; circle(c, o.x, o.y, o.r * 0.62); c.stroke(); circle(c, o.x, o.y, o.r * 0.28); c.stroke();
      break;
    }
    case 'barrel': {
      circle(c, o.x, o.y, o.r); c.fillStyle = '#d9534f'; c.fill(); c.stroke();
      c.lineWidth = 2; circle(c, o.x, o.y, o.r * 0.6); c.strokeStyle = 'rgba(0,0,0,.3)'; c.stroke();
      c.fillStyle = '#f4d35e'; circle(c, o.x, o.y, 4); c.fill();
      break;
    }
    case 'crate': {
      rr(c, o.x, o.y, o.w, o.h, 5); c.fillStyle = ['#c98d4a', '#b97d3e', '#d39a58'][o.v % 3]; c.fill(); c.stroke();
      c.lineWidth = 2.5; c.strokeStyle = 'rgba(70,40,10,.55)';
      c.beginPath(); c.moveTo(o.x + 7, o.y + 7); c.lineTo(o.x + o.w - 7, o.y + o.h - 7); c.moveTo(o.x + o.w - 7, o.y + 7); c.lineTo(o.x + 7, o.y + o.h - 7); c.stroke();
      break;
    }
    case 'container': {
      c.fillStyle = 'rgba(0,0,0,.16)'; c.fillRect(o.x + 6, o.y + 8, o.w, o.h);
      rr(c, o.x, o.y, o.w, o.h, 5); c.fillStyle = CONTAINER[o.v % 4]; c.fill(); c.stroke();
      c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.2)'; c.beginPath();
      if (o.w > o.h) for (let x = o.x + 14; x < o.x + o.w - 4; x += 14) { c.moveTo(x, o.y + 6); c.lineTo(x, o.y + o.h - 6); }
      else for (let y = o.y + 14; y < o.y + o.h - 4; y += 14) { c.moveTo(o.x + 6, y); c.lineTo(o.x + o.w - 6, y); }
      c.stroke();
      break;
    }
    case 'wall': c.fillStyle = '#4a3f52'; c.fillRect(o.x, o.y, o.w, o.h); break;
    case 'fence': c.fillStyle = '#9a6a3a'; c.fillRect(o.x, o.y, o.w, o.h); c.lineWidth = 1.5; c.strokeRect(o.x, o.y, o.w, o.h); break;
  }
}

export function drawCanopy(c: Ctx, o: Obstacle, alpha: number): void {
  const r = o.v;
  c.globalAlpha = alpha;
  c.fillStyle = 'rgba(0,0,0,.15)'; circle(c, o.x + 8, o.y + 10, r); c.fill();
  const g = ((o.x * 7 + o.y * 13) | 0) % 3;
  c.fillStyle = ['#3f9f4a', '#4aae52', '#379246'][g];
  c.strokeStyle = '#256b33'; c.lineWidth = 3;
  c.beginPath();
  for (let i = 0; i <= 9; i++) { const a = (i / 9) * TAU; const rad = r * (i % 2 ? 0.9 : 1.02); c.lineTo(o.x + Math.cos(a) * rad, o.y + Math.sin(a) * rad); }
  c.closePath(); c.fill(); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.13)'; circle(c, o.x - r * 0.25, o.y - r * 0.28, r * 0.5); c.fill();
  c.globalAlpha = 1;
}

export function drawBush(c: Ctx, x: number, y: number, r: number, alpha: number): void {
  c.globalAlpha = alpha;
  c.fillStyle = '#58b84f'; c.strokeStyle = '#2f7d3a'; c.lineWidth = 3;
  c.beginPath();
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + x; c.moveTo(x + Math.cos(a) * r * 0.45 + r * 0.55, y + Math.sin(a) * r * 0.45); c.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.55, 0, TAU); }
  c.stroke(); c.fill();
  circle(c, x, y, r * 0.6); c.fill();
  c.fillStyle = '#6fcc62';
  for (let i = 0; i < 4; i++) { const a = i * 1.7 + y; circle(c, x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, r * 0.2); c.fill(); }
  c.globalAlpha = 1;
}

export function drawRoof(c: Ctx, b: Building, alpha: number): void {
  if (alpha <= 0.01) return;
  const col = roofColor(b);
  c.globalAlpha = alpha;
  c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(b.x + 6, b.y + 10, b.w + 6, b.h + 4);
  rr(c, b.x - 8, b.y - 8, b.w + 16, b.h + 16, b.style === 'tent' ? 22 : 8);
  c.fillStyle = col; c.fill(); c.lineWidth = 4; c.strokeStyle = OUTLINE; c.stroke();
  c.strokeStyle = shade(col.startsWith('#') ? col : '#888888', -0.25); c.lineWidth = 4;
  c.beginPath();
  if (b.style === 'tent') { c.moveTo(b.x, b.y); c.lineTo(b.x + b.w, b.y + b.h); c.moveTo(b.x + b.w, b.y); c.lineTo(b.x, b.y + b.h); }
  else if (b.w >= b.h) { c.moveTo(b.x + 10, b.y + b.h / 2); c.lineTo(b.x + b.w - 10, b.y + b.h / 2); }
  else { c.moveTo(b.x + b.w / 2, b.y + 10); c.lineTo(b.x + b.w / 2, b.y + b.h - 10); }
  c.stroke();
  if (b.style === 'bunker' || b.style === 'factory' || b.style === 'warehouse') {
    c.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = 0; i < 3; i++) c.fillRect(b.x + 24 + i * (b.w - 80) / 2, b.y + 18, 32, 20);
  }
  c.globalAlpha = 1;
}

/** Pre-renders the whole island to a small canvas for the minimap and landing map. */
export function renderMapImage(m: GameMap, px: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d')!;
  const pad = 60, s = px / (m.size + pad * 2);
  c.fillStyle = GROUND.sea; c.fillRect(0, 0, px, px);
  c.scale(s, s); c.translate(pad, pad);
  drawGround(c, m, -pad, -pad, m.size + pad, m.size + pad, 0);
  for (const o of m.obstacles) {
    if (o.kind === 'tree') { circle(c, o.x, o.y, o.v * 0.9); c.fillStyle = '#3f9f4a'; c.fill(); }
    else if (o.kind === 'rock') { circle(c, o.x, o.y, o.r); c.fillStyle = '#9aa3b2'; c.fill(); }
    else if (o.kind === 'container') { c.fillStyle = CONTAINER[o.v % 4]; c.fillRect(o.x, o.y, o.w, o.h); }
  }
  for (const b of m.buildings) { c.fillStyle = roofColor(b); c.fillRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16); c.strokeStyle = OUTLINE; c.lineWidth = 6; c.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16); }
  return cv;
}
export const MAP_PAD = 60;
