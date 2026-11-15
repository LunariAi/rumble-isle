import type { AmmoType, ItemId, WeaponId } from './config';
import type { GameEvent, Loot } from './sim';

export interface Member { id: number; name: string; char: string; color: string; team: number; bot: boolean; host: boolean; online: boolean }
export interface RoomSettings { mode: 'solo' | 'duos'; bots: number; zone: 'fast' | 'normal' | 'slow' }
export interface RoomState { code: string; pub: boolean; state: 'lobby' | 'game'; settings: RoomSettings; members: Member[]; countdown: number | null; you: number }
export interface RosterEntry { id: number; name: string; char: string; color: string; team: number; bot: boolean }
export interface StartMsg { seed: number; mode: 'solo' | 'duos'; you: number; roster: RosterEntry[]; loot: Loot[]; resume: boolean }

// [id, x, y, aim, hp, armor, flags, weapon index (-1 = fists), downedHp]
export type PlayerSnap = [number, number, number, number, number, number, number, number, number];
export const F_DOWNED = 1, F_MOVING = 2, F_LANDING = 4, F_RELOAD = 8, F_USING = 16, F_DASH = 32, F_REVIVING = 64;

export interface MeState {
  w: ([WeaponId, number, number] | null)[]; // [id, rarity, mag]
  act: number;
  ammo: Record<AmmoType, number>;
  items: Record<ItemId, number>;
  rl: number; use: ItemId | null; ut: number;
  dashT: number; dashCd: number; dashX: number; dashY: number;
  slow: boolean; rev: number; landT: number;
}
export interface OwnStats { alive: boolean; place: number; kills: number; dmg: number }
export interface Snap {
  t: number; ack: number; ph: 'drop' | 'play' | 'over'; dt: number;
  view: number; me: MeState | null; own: OwnStats;
  p: PlayerSnap[]; z: number[]; al: number; ev: GameEvent[];
  drops?: [number, number, number][];
}
export interface ResultRow { id: number; place: number; kills: number; dmg: number; survived: number }
export interface OverMsg { winner: number; rows: ResultRow[]; time: number }
