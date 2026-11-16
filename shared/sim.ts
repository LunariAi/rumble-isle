// Authoritative game simulation. Pure logic: no sockets, no timers, no DOM.
// The server owns one Game per match; the client only reuses applyMove() for prediction.
import {
  AMMO_PACK, AmmoType, BULLET_HIT_PAD, DASH_COOLDOWN, DASH_SPEED, DASH_TIME, DOWNED_BLEED, DOWNED_HP, DOWNED_SPEED, DROP_TIME, DT, GRENADE,
  ITEMS, ITEM_IDS, ItemId, LAND_TIME, MAP_SIZE, MAX_ARMOR, MAX_HP, MELEE, PICKUP_RANGE, PLAYER_RADIUS, PLAYER_SPEED, RARITIES,
  REVIVE_HP, REVIVE_RANGE, REVIVE_TIME, USE_SLOW, WATER_SLOW, WEAPONS, WEAPON_IDS, WeaponId, ZONE_STAGES, weaponDamage,
} from './config';
import { GameMap, buildMap, bushAt, findFreeSpot, inWater, raycast, resolveCollisions, segCircle } from './map';
import { Rng } from './rng';

export const BTN_SHOOT = 1, BTN_DASH = 2, BTN_USE = 4;

export interface InputMsg { seq: number; mx: number; my: number; aim: number; btn: number }
export interface MoveState { x: number; y: number; dashT: number; dashCd: number; dashX: number; dashY: number }

/** One fixed movement step. Deterministic, shared by server (authority) and client (prediction). */
export function applyMove(map: GameMap, s: MoveState, inp: InputMsg, slow: boolean, downed: boolean): void {
  let mx = inp.mx, my = inp.my;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  s.dashCd = Math.max(0, s.dashCd - DT);
  if (inp.btn & BTN_DASH && s.dashCd <= 0 && !downed && !slow) {
    s.dashT = DASH_TIME; s.dashCd = DASH_COOLDOWN;
    if (len > 0.1) { const l = Math.hypot(mx, my); s.dashX = mx / l; s.dashY = my / l; }
    else { s.dashX = Math.cos(inp.aim); s.dashY = Math.sin(inp.aim); }
  }
  if (s.dashT > 0) {
    s.dashT = Math.max(0, s.dashT - DT);
    for (let i = 0; i < 2; i++) {
      s.x += s.dashX * DASH_SPEED * DT * 0.5; s.y += s.dashY * DASH_SPEED * DT * 0.5;
      resolveCollisions(map, s);
    }
    return;
  }
  let speed = downed ? DOWNED_SPEED : PLAYER_SPEED * (slow ? USE_SLOW : 1);
  if (inWater(map, s.x, s.y)) speed *= WATER_SLOW;
  s.x += mx * speed * DT; s.y += my * speed * DT;
  resolveCollisions(map, s);
}

export interface WeaponInst { id: WeaponId; rarity: number; mag: number }
export interface Loot {
  id: number; x: number; y: number; kind: 'weapon' | 'ammo' | 'item'; n: number;
  weapon?: WeaponId; rarity?: number; ammo?: AmmoType; item?: ItemId;
}
export interface Player extends MoveState {
  id: number; name: string; char: string; color: string; team: number; bot: boolean;
  aim: number; hp: number; armor: number; alive: boolean; downed: boolean; downedHp: number; downedBy: number;
  weapons: (WeaponInst | null)[]; active: number; ammo: Record<AmmoType, number>; items: Record<ItemId, number>;
  reloadT: number; fireCd: number; semiLock: boolean; useItem: ItemId | null; useT: number;
  reviveT: number; reviving: number;
  kills: number; damage: number; place: number; lastShot: number; btn: number; moving: boolean;
  landT: number; dropX: number; dropY: number; lastSeq: number; credits: number; bush: number; survived: number;
}
export interface Bullet { id: number; o: number; team: number; x: number; y: number; vx: number; vy: number; dist: number; range: number; dmg: number; w: WeaponId }
export interface Nade { id: number; o: number; team: number; x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; fly: number }
export interface Zone { x: number; y: number; r: number; fx: number; fy: number; fr: number; nx: number; ny: number; nr: number; stage: number; phase: 'wait' | 'shrink' | 'done'; t: number; total: number }

export type GameEvent =
  | { e: 'shot'; o: number; w: WeaponId; x: number; y: number; b: [number, number][] }
  | { e: 'hit'; b: number; x: number; y: number; t: number; d: number }
  | { e: 'melee'; o: number; x: number; y: number }
  | { e: 'kill'; v: number; k: number; w: string; down: boolean }
  | { e: 'loot+'; l: Loot }
  | { e: 'loot-'; id: number; by: number }
  | { e: 'nade'; id: number; o: number; x: number; y: number; tx: number; ty: number; fly: number }
  | { e: 'boom'; id: number; x: number; y: number }
  | { e: 'revive'; p: number; x: number; y: number }
  | { e: 'zone'; stage: number; phase: string };

export type Action =
  | { t: 'pickup' } | { t: 'reload' } | { t: 'slot'; i: number } | { t: 'use'; item: ItemId }
  | { t: 'drop' } | { t: 'nade'; x: number; y: number } | { t: 'cancel' };

export interface GameOpts { seed: number; mode: 'solo' | 'duos'; zoneScale?: number; dropTime?: number }

export class Game {
  map: GameMap;
  rng: Rng;
  mode: 'solo' | 'duos';
  players: Player[] = [];
  byId = new Map<number, Player>();
  loot = new Map<number, Loot>();
  bullets: Bullet[] = [];
  nades: Nade[] = [];
  events: GameEvent[] = [];
  zone: Zone;
  phase: 'drop' | 'play' | 'over' = 'drop';
  dropT: number;
  time = 0;
  tickN = 0;
  winnerTeam = -1;
  initialTeams = 0;
  zoneScale: number;
  private nextId = 1;
  private nextEntity = 1;
  private zoneAcc = 0;

  constructor(opts: GameOpts) {
    this.map = buildMap(opts.seed);
    this.rng = new Rng(opts.seed * 7919 + 13);
    this.mode = opts.mode;
    this.zoneScale = opts.zoneScale ?? 1;
    this.dropT = opts.dropTime ?? DROP_TIME;
    const c = MAP_SIZE / 2;
    this.zone = { x: c, y: c, r: 3500, fx: c, fy: c, fr: 3500, nx: c, ny: c, nr: 3500, stage: 0, phase: 'wait', t: 0, total: 0 };
    this.spawnLoot();
  }

  // ---------------------------------------------------------------- players
  addPlayer(name: string, char: string, color: string, team: number, bot: boolean): Player {
    const spot = this.rng.pick(this.map.lootSpots);
    const p: Player = {
      id: this.nextId++, name, char, color, team, bot,
      x: MAP_SIZE / 2, y: MAP_SIZE / 2, dashT: 0, dashCd: 0, dashX: 1, dashY: 0,
      aim: 0, hp: MAX_HP, armor: 0, alive: true, downed: false, downedHp: 0, downedBy: -1,
      weapons: [null, null], active: 0, ammo: { light: 0, shells: 0, medium: 0, heavy: 0 }, items: { bandage: 0, medkit: 0, cell: 0, grenade: 0 },
      reloadT: 0, fireCd: 0, semiLock: false, useItem: null, useT: 0, reviveT: 0, reviving: -1,
      kills: 0, damage: 0, place: 0, lastShot: -99, btn: 0, moving: false,
      landT: 0, dropX: spot.x + this.rng.range(-150, 150), dropY: spot.y + this.rng.range(-150, 150),
      lastSeq: 0, credits: 0, bush: -1, survived: 0,
    };
    if (team < 0) p.team = 1000 + p.id;
    this.players.push(p);
    this.byId.set(p.id, p);
    return p;
  }

  setDrop(id: number, x: number, y: number): void {
    const p = this.byId.get(id);
    if (!p || this.phase !== 'drop') return;
    p.dropX = Math.max(80, Math.min(MAP_SIZE - 80, x));
    p.dropY = Math.max(80, Math.min(MAP_SIZE - 80, y));
  }

  /** Apply one client movement input. Server limits how many of these run per tick (see Room). */
  applyInput(id: number, inp: InputMsg): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.lastSeq = inp.seq;
    if (!p.alive || this.phase !== 'play') return;
    p.aim = inp.aim;
    p.btn = inp.btn;
    if (p.landT > 0) return;
    const ox = p.x, oy = p.y;
    applyMove(this.map, p, inp, p.useItem !== null || p.reviving >= 0, p.downed);
    p.moving = Math.abs(p.x - ox) + Math.abs(p.y - oy) > 0.5;
  }

  action(id: number, a: Action): void {
    const p = this.byId.get(id);
    if (!p || !p.alive || p.downed || this.phase !== 'play' || p.landT > 0) return;
    switch (a.t) {
      case 'pickup': this.tryPickup(p); break;
      case 'reload': this.startReload(p); break;
      case 'slot':
        if ((a.i === 0 || a.i === 1) && a.i !== p.active) { p.active = a.i; p.reloadT = 0; p.useItem = null; p.fireCd = Math.max(p.fireCd, 0.25); p.semiLock = true; }
        break;
      case 'use': this.startUse(p, a.item); break;
      case 'cancel': p.useItem = null; break;
      case 'drop': {
        const w = p.weapons[p.active];
        if (!w) break;
        p.weapons[p.active] = null; p.reloadT = 0;
        this.addLoot({ kind: 'weapon', weapon: w.id, rarity: w.rarity, n: w.mag }, p.x + Math.cos(p.aim) * 60, p.y + Math.sin(p.aim) * 60);
        break;
      }
      case 'nade': this.throwNade(p, a.x, a.y); break;
    }
  }

  // ---------------------------------------------------------------- loot
  private spawnLoot(): void {
    const r = this.rng;
    for (const s of this.map.lootSpots) {
      if (s.tier === 0 && !r.chance(0.8)) continue;
      const roll = r.next();
      const wChance = [0.42, 0.5, 0.62][s.tier];
      if (roll < wChance) {
        const id = r.weighted(WEAPON_IDS, (w) => WEAPONS[w].weight);
        const def = WEAPONS[id];
        const rarity = r.weighted(def.rarities, (q) => (s.tier === 2 ? Math.sqrt(RARITIES[q].weight) : RARITIES[q].weight));
        this.addLoot({ kind: 'weapon', weapon: id, rarity, n: def.mag }, s.x, s.y, false);
        this.addLoot({ kind: 'ammo', ammo: def.ammo, n: AMMO_PACK[def.ammo] }, s.x + 34, s.y + 14, false);
      } else if (roll < wChance + 0.2) {
        const t = r.pick(['light', 'shells', 'medium', 'heavy'] as AmmoType[]);
        this.addLoot({ kind: 'ammo', ammo: t, n: AMMO_PACK[t] }, s.x, s.y, false);
      } else {
        const item = r.weighted(ITEM_IDS, (i) => ({ bandage: 40, cell: 28, medkit: 12, grenade: 20 })[i]);
        const n = item === 'bandage' ? r.int(2, 3) : item === 'medkit' ? 1 : r.int(1, 2);
        this.addLoot({ kind: 'item', item, n }, s.x, s.y, false);
      }
    }
  }

  addLoot(l: Omit<Loot, 'id' | 'x' | 'y'>, x: number, y: number, announce = true): Loot {
    const pos = { x, y };
    resolveCollisions(this.map, pos, 14);
    const loot: Loot = { ...l, id: this.nextEntity++, x: Math.round(pos.x), y: Math.round(pos.y) };
    this.loot.set(loot.id, loot);
    if (announce) this.events.push({ e: 'loot+', l: loot });
    return loot;
  }

  private removeLoot(l: Loot, by: number): void {
    this.loot.delete(l.id);
    this.events.push({ e: 'loot-', id: l.id, by });
  }

  /** Takes as much of a stackable loot as the player can carry. Returns true if anything was taken. */
  private takeStack(p: Player, l: Loot): boolean {
    if (l.kind === 'ammo') {
      p.ammo[l.ammo!] += l.n;
      this.removeLoot(l, p.id);
      return true;
    }
    if (l.kind === 'item') {
      const room = ITEMS[l.item!].max - p.items[l.item!];
      if (room <= 0) return false;
      const take = Math.min(room, l.n);
      p.items[l.item!] += take;
      if (take >= l.n) this.removeLoot(l, p.id);
      else { this.removeLoot(l, p.id); this.addLoot({ kind: 'item', item: l.item, n: l.n - take }, l.x, l.y); }
      return true;
    }
    return false;
  }

  private takeWeapon(p: Player, l: Loot, swap: boolean): boolean {
    let slot = p.weapons[p.active] === null ? p.active : p.weapons[0] === null ? 0 : p.weapons[1] === null ? 1 : -1;
    if (slot < 0) {
      if (!swap) return false;
      slot = p.active;
      const old = p.weapons[slot]!;
      this.addLoot({ kind: 'weapon', weapon: old.id, rarity: old.rarity, n: old.mag }, l.x, l.y);
      p.reloadT = 0;
    }
    p.weapons[slot] = { id: l.weapon!, rarity: l.rarity!, mag: l.n };
    if (p.weapons[p.active] === null) p.active = slot;
    this.removeLoot(l, p.id);
    return true;
  }

  private tryPickup(p: Player): void {
    let best: Loot | null = null, bd = PICKUP_RANGE * PICKUP_RANGE;
    for (const l of this.loot.values()) {
      const d = (l.x - p.x) ** 2 + (l.y - p.y) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    if (!best) return;
    if (best.kind === 'weapon') this.takeWeapon(p, best, true);
    else this.takeStack(p, best);
  }

  private autoPickup(p: Player): void {
    for (const l of this.loot.values()) {
      const dx = l.x - p.x, dy = l.y - p.y;
      if (dx * dx + dy * dy > 38 * 38) continue;
      if (l.kind === 'weapon') { if (p.weapons[0] === null || p.weapons[1] === null) this.takeWeapon(p, l, false); }
      else this.takeStack(p, l);
    }
  }

  // ---------------------------------------------------------------- items / weapons
  private startReload(p: Player): void {
    const w = p.weapons[p.active];
    if (!w || p.reloadT > 0) return;
    const def = WEAPONS[w.id];
    if (w.mag >= def.mag || p.ammo[def.ammo] <= 0) return;
    p.useItem = null;
    p.reloadT = def.reload;
  }

  private startUse(p: Player, item: ItemId): void {
    if (!(item in ITEMS) || item === 'grenade' || p.items[item] <= 0 || p.useItem) return;
    const def = ITEMS[item];
    if (def.heal && p.hp >= def.healCap!) return;
    if (def.armor && p.armor >= MAX_ARMOR) return;
    p.useItem = item; p.useT = def.useTime; p.reloadT = 0;
  }

  private throwNade(p: Player, tx: number, ty: number): void {
    if (p.items.grenade <= 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
    let dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const dist = Math.min(d, GRENADE.range);
    dx = (dx / d) * dist; dy = (dy / d) * dist;
    const hit = raycast(this.map, p.x, p.y, p.x + dx, p.y + dy);
    const f = hit <= 1 ? Math.max(0, hit - 14 / dist) : 1;
    p.items.grenade--;
    p.useItem = null;
    const n: Nade = { id: this.nextEntity++, o: p.id, team: p.team, x: p.x, y: p.y, sx: p.x, sy: p.y, tx: p.x + dx * f, ty: p.y + dy * f, t: 0, fly: Math.max(0.2, GRENADE.flight * (dist * f) / GRENADE.range) };
    this.nades.push(n);
    this.events.push({ e: 'nade', id: n.id, o: p.id, x: n.x, y: n.y, tx: n.tx, ty: n.ty, fly: n.fly });
  }

  private fire(p: Player): void {
    if (p.useItem) p.useItem = null;
    const w = p.weapons[p.active];
    if (!w) {
      if (p.fireCd > 0) return;
      p.fireCd = MELEE.cooldown; p.lastShot = this.time;
      this.events.push({ e: 'melee', o: p.id, x: p.x, y: p.y });
      for (const q of this.players) {
        if (q === p || !q.alive || q.team === p.team || q.landT > 0) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
        if (d > MELEE.range + PLAYER_RADIUS) continue;
        if (Math.abs(angDiff(Math.atan2(dy, dx), p.aim)) > MELEE.arc) continue;
        this.events.push({ e: 'hit', b: 0, x: q.x, y: q.y, t: q.id, d: MELEE.damage });
        this.damage(q, MELEE.damage, p.id, 'fists');
      }
      return;
    }
    const def = WEAPONS[w.id];
    if (p.reloadT > 0) return;
    if (w.mag <= 0) { this.startReload(p); return; }
    if (p.fireCd > 0 || (!def.auto && p.semiLock)) return;
    w.mag--; p.fireCd = def.fireRate; p.semiLock = true; p.lastShot = this.time;
    const dmg = weaponDamage(w.id, w.rarity);
    const shots: [number, number][] = [];
    for (let i = 0; i < def.pellets; i++) {
      const a = p.aim + (this.rng.next() * 2 - 1) * def.spread;
      const b: Bullet = { id: this.nextEntity++, o: p.id, team: p.team, x: p.x, y: p.y, vx: Math.cos(a) * def.speed, vy: Math.sin(a) * def.speed, dist: 0, range: def.range, dmg, w: w.id };
      this.bullets.push(b);
      shots.push([b.id, Math.round(a * 1000) / 1000]);
    }
    this.events.push({ e: 'shot', o: p.id, w: w.id, x: Math.round(p.x), y: Math.round(p.y), b: shots });
    if (w.mag <= 0) this.startReload(p);
  }

  // ---------------------------------------------------------------- damage
  damage(v: Player, amount: number, attackerId: number, cause: string, ignoreArmor = false): void {
    if (!v.alive || v.landT > 0 || this.phase !== 'play' || amount <= 0) return;
    const att = this.byId.get(attackerId);
    if (att && att !== v && att.team === v.team) return; // no friendly fire
    if (v.downed) {
      v.downedHp -= amount;
      if (att && att !== v) att.damage += amount;
      if (v.downedHp <= 0) this.eliminate(v, attackerId >= 0 ? attackerId : v.downedBy, cause);
      return;
    }
    let left = amount;
    if (!ignoreArmor && v.armor > 0) { const a = Math.min(v.armor, left); v.armor -= a; left -= a; }
    const dealt = Math.min(v.hp, left) + (amount - left);
    v.hp -= left;
    if (att && att !== v) att.damage += dealt;
    if (v.hp > 0) return;
    v.hp = 0;
    const mateUp = this.players.some((q) => q !== v && q.team === v.team && q.alive && !q.downed);
    if (this.mode === 'duos' && mateUp) {
      v.downed = true; v.downedHp = DOWNED_HP; v.downedBy = attackerId; v.useItem = null; v.reloadT = 0; v.dashT = 0;
      this.events.push({ e: 'kill', v: v.id, k: attackerId, w: cause, down: true });
    } else {
      this.eliminate(v, attackerId, cause);
      // a team with nobody standing is wiped
      for (const q of this.players) if (q.team === v.team && q.alive && q.downed) this.eliminate(q, q.downedBy, 'bleed');
    }
  }

  private eliminate(v: Player, killerId: number, cause: string): void {
    if (!v.alive) return;
    const teamsBefore = this.aliveTeams();
    v.alive = false; v.downed = false; v.hp = 0; v.survived = this.time; v.useItem = null; v.reviving = -1;
    const killer = this.byId.get(killerId);
    if (killer && killer.team !== v.team) killer.kills++;
    this.events.push({ e: 'kill', v: v.id, k: killer && killer.team !== v.team ? killer.id : -1, w: cause, down: false });
    for (const w of v.weapons) if (w) this.addLoot({ kind: 'weapon', weapon: w.id, rarity: w.rarity, n: w.mag }, v.x + this.rng.range(-45, 45), v.y + this.rng.range(-45, 45));
    for (const t of Object.keys(v.ammo) as AmmoType[]) if (v.ammo[t] > 0) this.addLoot({ kind: 'ammo', ammo: t, n: v.ammo[t] }, v.x + this.rng.range(-55, 55), v.y + this.rng.range(-55, 55));
    for (const i of ITEM_IDS) if (v.items[i] > 0) this.addLoot({ kind: 'item', item: i, n: v.items[i] }, v.x + this.rng.range(-55, 55), v.y + this.rng.range(-55, 55));
    v.weapons = [null, null];
    if (!this.players.some((q) => q.team === v.team && q.alive)) {
      for (const q of this.players) if (q.team === v.team) q.place = teamsBefore;
    }
    this.checkWin();
  }

  /** A player who quits mid-match is eliminated on the spot. */
  forfeit(id: number): void {
    const p = this.byId.get(id);
    if (!p || !p.alive) return;
    if (this.phase === 'drop') { p.alive = false; p.place = this.players.length; return; }
    if (this.phase !== 'play') return;
    this.eliminate(p, p.downed ? p.downedBy : -1, 'left');
    for (const q of this.players) if (q.team === p.team && q.alive && q.downed && !this.players.some((m) => m.team === q.team && m.alive && !m.downed)) this.eliminate(q, q.downedBy, 'bleed');
  }

  aliveTeams(): number {
    const s = new Set<number>();
    for (const p of this.players) if (p.alive) s.add(p.team);
    return s.size;
  }
  aliveCount(): number {
    let n = 0;
    for (const p of this.players) if (p.alive) n++;
    return n;
  }

  private checkWin(): void {
    if (this.phase !== 'play') return;
    const teams = this.aliveTeams();
    if ((this.initialTeams > 1 && teams <= 1) || teams === 0) {
      this.phase = 'over';
      const w = this.players.find((p) => p.alive);
      this.winnerTeam = w ? w.team : -1;
      for (const p of this.players) {
        if (w && p.team === w.team) p.place = 1;
        if (p.alive) p.survived = this.time;
      }
    }
  }

  // ---------------------------------------------------------------- tick
  tick(): void {
    this.tickN++;
    if (this.phase === 'over') return;
    if (this.phase === 'drop') {
      this.dropT -= DT;
      if (this.dropT <= 0) this.beginPlay();
      return;
    }
    this.time += DT;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.landT > 0) { p.landT -= DT; continue; }
      p.fireCd = Math.max(0, p.fireCd - DT);
      p.bush = bushAt(this.map, p.x, p.y);
      if (!(p.btn & BTN_SHOOT)) p.semiLock = false;
      if (p.downed) {
        const helper = this.players.some((q) => q.reviving === p.id);
        if (!helper) this.damage(p, DOWNED_BLEED * DT, -1, 'bleed');
        continue;
      }
      if (p.reloadT > 0) {
        p.reloadT -= DT;
        if (p.reloadT <= 0) {
          const w = p.weapons[p.active];
          if (w) { const def = WEAPONS[w.id]; const n = Math.min(def.mag - w.mag, p.ammo[def.ammo]); w.mag += n; p.ammo[def.ammo] -= n; }
          p.reloadT = 0;
        }
      }
      if (p.useItem) {
        p.useT -= DT;
        if (p.useT <= 0) {
          const def = ITEMS[p.useItem];
          p.items[p.useItem]--;
          if (def.heal) p.hp = Math.max(p.hp, Math.min(def.healCap!, p.hp + def.heal));
          if (def.armor) p.armor = Math.min(MAX_ARMOR, p.armor + def.armor);
          p.useItem = null;
        }
      }
      // revive (hold interact next to a downed teammate)
      let target = -1;
      if (p.btn & BTN_USE && !(p.btn & BTN_SHOOT) && this.mode === 'duos') {
        for (const q of this.players) {
          if (q.team === p.team && q.downed && q.alive && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < REVIVE_RANGE ** 2) { target = q.id; break; }
        }
      }
      if (target >= 0 && target === p.reviving) {
        p.reviveT += DT;
        if (p.reviveT >= REVIVE_TIME) {
          const q = this.byId.get(target)!;
          q.downed = false; q.hp = REVIVE_HP; q.downedBy = -1;
          this.events.push({ e: 'revive', p: q.id, x: q.x, y: q.y });
          p.reviving = -1; p.reviveT = 0;
        }
      } else { p.reviving = target; p.reviveT = 0; }
      if (p.btn & BTN_SHOOT) this.fire(p);
      this.autoPickup(p);
    }
    this.tickBullets();
    this.tickNades();
    this.tickZone();
  }

  private beginPlay(): void {
    this.phase = 'play';
    for (const p of this.players) {
      const s = findFreeSpot(this.map, p.dropX, p.dropY);
      p.x = s.x; p.y = s.y; p.landT = LAND_TIME;
    }
    this.initialTeams = this.aliveTeams();
    this.startStage(0);
  }

  private tickBullets(): void {
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      const speed = Math.hypot(b.vx, b.vy);
      const step = Math.min(speed * DT, b.range - b.dist);
      const dx = (b.vx / speed) * step, dy = (b.vy / speed) * step;
      let best = raycast(this.map, b.x, b.y, b.x + dx, b.y + dy);
      let victim: Player | null = null;
      for (const p of this.players) {
        if (!p.alive || p.id === b.o || p.team === b.team || p.landT > 0) continue;
        if (Math.abs(p.x - b.x) > step + 40 || Math.abs(p.y - b.y) > step + 40) continue;
        const t = segCircle(b.x, b.y, dx, dy, p.x, p.y, PLAYER_RADIUS + BULLET_HIT_PAD);
        if (t <= 1 && t <= best) { best = t; victim = p; }
      }
      if (best <= 1) {
        const hx = b.x + dx * best, hy = b.y + dy * best;
        this.events.push({ e: 'hit', b: b.id, x: Math.round(hx), y: Math.round(hy), t: victim ? victim.id : -1, d: victim ? b.dmg : 0 });
        if (victim) this.damage(victim, b.dmg, b.o, b.w);
        bs[i] = bs[bs.length - 1]; bs.pop();
        continue;
      }
      b.x += dx; b.y += dy; b.dist += step;
      if (b.dist >= b.range - 0.01) { bs[i] = bs[bs.length - 1]; bs.pop(); }
    }
  }

  private tickNades(): void {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += DT;
      const f = Math.min(1, n.t / n.fly);
      n.x = n.sx + (n.tx - n.sx) * f; n.y = n.sy + (n.ty - n.sy) * f;
      if (n.t < n.fly + GRENADE.fuse) continue;
      this.nades.splice(i, 1);
      this.events.push({ e: 'boom', id: n.id, x: Math.round(n.x), y: Math.round(n.y) });
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - n.x, p.y - n.y);
        if (d > GRENADE.radius) continue;
        if (d > 30 && raycast(this.map, n.x, n.y, p.x, p.y) <= 1) continue; // cover works
        const dmg = Math.round(GRENADE.damage * (1 - 0.65 * (d / GRENADE.radius)));
        if (p.id === n.o || p.team !== n.team) {
          this.events.push({ e: 'hit', b: 0, x: p.x, y: p.y, t: p.id, d: dmg });
          this.damage(p, dmg, p.id === n.o ? -1 : n.o, 'grenade');
        }
      }
    }
  }

  private startStage(i: number): void {
    const z = this.zone;
    if (i >= ZONE_STAGES.length) { z.phase = 'done'; z.t = 0; return; }
    const st = ZONE_STAGES[i];
    z.stage = i; z.phase = 'wait'; z.t = z.total = st.wait * this.zoneScale;
    z.fx = z.x; z.fy = z.y; z.fr = z.r;
    z.nr = st.radius * (MAP_SIZE / 2);
    if (i === 0) {
      z.nx = this.rng.range(MAP_SIZE * 0.3, MAP_SIZE * 0.7); z.ny = this.rng.range(MAP_SIZE * 0.3, MAP_SIZE * 0.7);
    } else {
      const a = this.rng.range(0, Math.PI * 2), d = Math.sqrt(this.rng.next()) * Math.max(0, z.r - z.nr);
      z.nx = z.x + Math.cos(a) * d; z.ny = z.y + Math.sin(a) * d;
    }
    this.events.push({ e: 'zone', stage: i, phase: 'wait' });
  }

  private tickZone(): void {
    const z = this.zone;
    if (z.phase !== 'done') {
      z.t -= DT;
      if (z.phase === 'wait' && z.t <= 0) {
        z.phase = 'shrink'; z.t = z.total = ZONE_STAGES[z.stage].shrink * this.zoneScale;
        this.events.push({ e: 'zone', stage: z.stage, phase: 'shrink' });
      } else if (z.phase === 'shrink') {
        const f = 1 - Math.max(0, z.t) / z.total;
        z.x = z.fx + (z.nx - z.fx) * f; z.y = z.fy + (z.ny - z.fy) * f; z.r = z.fr + (z.nr - z.fr) * f;
        if (z.t <= 0) this.startStage(z.stage + 1);
      }
    }
    // storm damage is applied twice a second so it shows up as readable chunks
    this.zoneAcc += DT;
    if (this.zoneAcc < 0.5) return;
    this.zoneAcc -= 0.5;
    const dps = ZONE_STAGES[Math.min(z.stage, ZONE_STAGES.length - 1)].dps;
    for (const p of this.players) {
      if (!p.alive || p.landT > 0) continue;
      if ((p.x - z.x) ** 2 + (p.y - z.y) ** 2 > z.r * z.r) this.damage(p, dps * 0.5, -1, 'zone', true);
    }
  }
}

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
