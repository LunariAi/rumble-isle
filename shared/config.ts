// All tunable gameplay numbers live here. Server and client both import this file.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAP_EVERY = 1; // server sends a snapshot every N ticks (30 Hz)

export const MAP_SIZE = 4800;
export const PLAYER_RADIUS = 18;
export const BULLET_HIT_PAD = 6; // bullets hit a slightly larger circle than the body, so near misses count
export const PLAYER_SPEED = 200;
export const WATER_SLOW = 0.6;
export const USE_SLOW = 0.55;
export const DOWNED_SPEED = 55;
export const DASH_SPEED = 600;
export const DASH_TIME = 0.2;
export const DASH_COOLDOWN = 6;

export const MAX_HP = 100;
export const MAX_ARMOR = 100;
export const PICKUP_RANGE = 62;
export const VIEW_RADIUS = 1350; // interest management radius
export const BUSH_REVEAL_DIST = 170; // hidden players in bushes become visible this close
export const SHOT_REVEAL_TIME = 1.2; // seconds a bush-hidden player stays visible after firing

export const DROP_TIME = 14; // seconds to pick a landing spot
export const LAND_TIME = 2.2; // parachute animation, invulnerable

export const REVIVE_TIME = 4;
export const REVIVE_RANGE = 60;
export const REVIVE_HP = 30;
export const DOWNED_HP = 100;
export const DOWNED_BLEED = 4; // hp per second

export const MELEE = { damage: 14, range: 52, arc: 1.0, cooldown: 0.42 };
export const GRENADE = { range: 520, flight: 0.75, fuse: 1.1, radius: 150, damage: 85 };

export type AmmoType = 'light' | 'shells' | 'medium' | 'heavy';
export type WeaponClass = 'pistol' | 'shotgun' | 'rifle' | 'smg' | 'sniper';

export interface WeaponDef {
  name: string;
  cls: WeaponClass;
  ammo: AmmoType;
  damage: number; // per pellet, before rarity multiplier
  pellets: number;
  fireRate: number; // seconds between shots
  reload: number; // seconds
  mag: number;
  range: number; // world units
  speed: number; // projectile units / second
  spread: number; // radians, half-angle of random cone
  auto: boolean;
  rarities: number[]; // rarity indices this weapon can roll
  weight: number; // loot table weight
}

export const WEAPONS = {
  popper: { name: 'Popper', cls: 'pistol', ammo: 'light', damage: 15, pellets: 1, fireRate: 0.26, reload: 1.2, mag: 12, range: 620, speed: 1500, spread: 0.022, auto: false, rarities: [0, 1, 2], weight: 20 },
  bigiron: { name: 'Big Iron', cls: 'pistol', ammo: 'heavy', damage: 38, pellets: 1, fireRate: 0.6, reload: 1.7, mag: 6, range: 760, speed: 1800, spread: 0.012, auto: false, rarities: [2, 3, 4], weight: 6 },
  scatter: { name: 'Scatterblast', cls: 'shotgun', ammo: 'shells', damage: 9, pellets: 8, fireRate: 0.85, reload: 2.3, mag: 5, range: 330, speed: 1400, spread: 0.16, auto: false, rarities: [0, 1, 2, 3], weight: 14 },
  thumper: { name: 'Thumper', cls: 'shotgun', ammo: 'shells', damage: 7, pellets: 7, fireRate: 0.38, reload: 2.6, mag: 8, range: 300, speed: 1400, spread: 0.19, auto: true, rarities: [2, 3, 4], weight: 5 },
  ranger: { name: 'Ranger AR', cls: 'rifle', ammo: 'medium', damage: 17, pellets: 1, fireRate: 0.14, reload: 2.0, mag: 28, range: 780, speed: 1800, spread: 0.028, auto: true, rarities: [0, 1, 2, 3, 4], weight: 14 },
  bruiser: { name: 'Bruiser', cls: 'rifle', ammo: 'medium', damage: 27, pellets: 1, fireRate: 0.26, reload: 2.4, mag: 20, range: 880, speed: 1900, spread: 0.018, auto: true, rarities: [2, 3, 4], weight: 6 },
  buzzer: { name: 'Buzzer SMG', cls: 'smg', ammo: 'light', damage: 10, pellets: 1, fireRate: 0.075, reload: 1.7, mag: 32, range: 520, speed: 1550, spread: 0.06, auto: true, rarities: [0, 1, 2, 3], weight: 15 },
  longshot: { name: 'Longshot', cls: 'sniper', ammo: 'heavy', damage: 78, pellets: 1, fireRate: 1.35, reload: 2.8, mag: 4, range: 1500, speed: 2900, spread: 0.003, auto: false, rarities: [1, 2, 3, 4], weight: 6 },
} satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export const RARITIES = [
  { name: 'Common', color: '#b8c0cc', mult: 1.0, weight: 46 },
  { name: 'Uncommon', color: '#5fd35f', mult: 1.08, weight: 28 },
  { name: 'Rare', color: '#4aa8ff', mult: 1.16, weight: 15 },
  { name: 'Epic', color: '#c36bff', mult: 1.25, weight: 8 },
  { name: 'Legendary', color: '#ffb52e', mult: 1.35, weight: 3 },
];

export function weaponDamage(id: WeaponId, rarity: number): number {
  return Math.round(WEAPONS[id].damage * RARITIES[rarity].mult * 10) / 10;
}

export const AMMO_PACK: Record<AmmoType, number> = { light: 30, shells: 8, medium: 30, heavy: 8 };
export const AMMO_NAMES: Record<AmmoType, string> = { light: 'Light ammo', shells: 'Shells', medium: 'Medium ammo', heavy: 'Heavy ammo' };
export const AMMO_COLORS: Record<AmmoType, string> = { light: '#ffd84a', shells: '#ff6b4a', medium: '#4ac8ff', heavy: '#b46bff' };

export type ItemId = 'bandage' | 'medkit' | 'cell' | 'grenade';
export interface ItemDef { name: string; max: number; useTime: number; heal?: number; healCap?: number; armor?: number; color: string; rarity: number }
export const ITEMS: Record<ItemId, ItemDef> = {
  bandage: { name: 'Bandage', max: 10, useTime: 2.0, heal: 20, healCap: 75, color: '#ffffff', rarity: 0 },
  medkit: { name: 'Medkit', max: 3, useTime: 5.0, heal: 100, healCap: 100, color: '#ff5d6c', rarity: 2 },
  cell: { name: 'Shield Cell', max: 6, useTime: 2.5, armor: 34, color: '#4ad2ff', rarity: 1 },
  grenade: { name: 'Boom Berry', max: 4, useTime: 0, color: '#ff9a2e', rarity: 2 },
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export interface ZoneStage { wait: number; shrink: number; radius: number; dps: number }
// radius = fraction of the map half-size. A full match lasts at most ≈ 6.5 minutes at scale 1.
export const ZONE_STAGES: ZoneStage[] = [
  { wait: 60, shrink: 38, radius: 0.62, dps: 1 },
  { wait: 48, shrink: 32, radius: 0.38, dps: 2 },
  { wait: 38, shrink: 28, radius: 0.22, dps: 4 },
  { wait: 30, shrink: 24, radius: 0.11, dps: 7 },
  { wait: 24, shrink: 20, radius: 0.045, dps: 11 },
  { wait: 18, shrink: 22, radius: 0, dps: 16 },
];

export const CHARACTERS = [
  { id: 'bruno', name: 'Bruno', blurb: 'Sleepy bear, wide awake in a fight' },
  { id: 'kiki', name: 'Kiki', blurb: 'Alley cat with nine lives to spend' },
  { id: 'bolt', name: 'Bolt', blurb: 'Scrap-built robot, zero chill' },
  { id: 'sprout', name: 'Sprout', blurb: 'Grew up in a bush, still hides there' },
  { id: 'cap', name: 'Cap\'n Mango', blurb: 'Lost the ship, kept the hat' },
  { id: 'hopper', name: 'Hopper', blurb: 'Bunny with a mean streak' },
] as const;
export const CHAR_IDS: string[] = CHARACTERS.map((c) => c.id);

export const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac', '#e9ecef', '#868e96'];

export const MAX_PLAYERS = 20;
export const DEFAULT_FILL = 14; // total players a public match is topped up to with bots
