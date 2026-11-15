import { create } from 'zustand';
import { CHAR_IDS, COLORS, ItemId, WeaponId } from '../../shared/config';
import type { MeState, OverMsg, RoomState, StartMsg } from '../../shared/protocol';
import type { Loot } from '../../shared/sim';
import { audio } from './game/audio';

export interface Profile { name: string; char: string; color: string; matches: number; wins: number; kills: number; best: number }
export interface Settings { master: number; sfx: number; music: number; muted: boolean; shake: boolean }
export interface FeedItem { id: number; killer: string; victim: string; weapon: string; down: boolean; mine: boolean }
export interface Prompt { kind: 'loot' | 'revive'; loot?: Loot; current?: [WeaponId, number, number] | null; swap?: boolean }

export interface Hud {
  phase: 'drop' | 'play' | 'over'; dropT: number;
  hp: number; armor: number; downed: boolean; downedHp: number;
  w: MeState['w']; act: number; ammo: MeState['ammo']; items: MeState['items'];
  reload: number; use: ItemId | null; useT: number; dashCd: number; rev: number;
  alive: number; kills: number; zoneT: number; zonePhase: number; zoneStage: number; outside: boolean;
  spectating: string | null; dead: boolean; place: number; ping: number; prompt: Prompt | null; showMap: boolean;
}

export const emptyHud: Hud = {
  phase: 'drop', dropT: 0, hp: 100, armor: 0, downed: false, downedHp: 0, w: [null, null], act: 0,
  ammo: { light: 0, shells: 0, medium: 0, heavy: 0 }, items: { bandage: 0, medkit: 0, cell: 0, grenade: 0 },
  reload: 0, use: null, useT: 0, dashCd: 0, rev: 0, alive: 0, kills: 0, zoneT: 0, zonePhase: 0, zoneStage: 0, outside: false,
  spectating: null, dead: false, place: 0, ping: 0, prompt: null, showMap: false,
};

function load<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...def, ...JSON.parse(v) } : def; } catch { return def; }
}
function save(key: string, v: unknown): void { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

const defaultProfile: Profile = {
  name: 'Player' + Math.floor(100 + Math.random() * 900), char: CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)],
  color: COLORS[Math.floor(Math.random() * 8)], matches: 0, wins: 0, kills: 0, best: 0,
};

interface State {
  screen: 'menu' | 'lobby' | 'game';
  connected: boolean;
  profile: Profile;
  settings: Settings;
  room: RoomState | null;
  start: StartMsg | null;
  result: OverMsg | null;
  hud: Hud;
  feed: FeedItem[];
  banner: { text: string; sub?: string; id: number } | null;
  toast: string | null;
  setProfile: (p: Partial<Profile>) => void;
  setSettings: (s: Partial<Settings>) => void;
  pushFeed: (f: Omit<FeedItem, 'id'>) => void;
  showBanner: (text: string, sub?: string) => void;
  showToast: (t: string) => void;
}

let feedId = 1;
export const useStore = create<State>((set, get) => ({
  screen: 'menu', connected: false,
  profile: load('ri_profile', defaultProfile),
  settings: load('ri_settings', { master: 0.8, sfx: 0.9, music: 0.7, muted: false, shake: true }),
  room: null, start: null, result: null, hud: emptyHud, feed: [], banner: null, toast: null,
  setProfile: (p) => { const profile = { ...get().profile, ...p }; save('ri_profile', profile); set({ profile }); },
  setSettings: (s) => { const settings = { ...get().settings, ...s }; save('ri_settings', settings); audio.apply(settings); set({ settings }); },
  pushFeed: (f) => {
    const item = { ...f, id: feedId++ };
    set({ feed: [...get().feed.slice(-4), item] });
    setTimeout(() => set({ feed: get().feed.filter((x) => x.id !== item.id) }), 6000);
  },
  showBanner: (text, sub) => {
    const id = feedId++;
    set({ banner: { text, sub, id } });
    setTimeout(() => { if (get().banner?.id === id) set({ banner: null }); }, 3200);
  },
  showToast: (t) => { set({ toast: t }); setTimeout(() => { if (get().toast === t) set({ toast: null }); }, 3500); },
}));

audio.apply(useStore.getState().settings);
