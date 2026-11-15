import { io } from 'socket.io-client';
import type { OverMsg, RoomSettings, RoomState, Snap, StartMsg } from '../../shared/protocol';
import { GameClient } from './game/client';
import { audio } from './game/audio';
import { emptyHud, useStore } from './store';

const socket = io({ transports: ['websocket', 'polling'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 2500 });
export let game: GameClient | null = null;
let recorded = false;
let pendingJoin = new URLSearchParams(location.search).get('join');

const send = (ev: string, data?: unknown) => { if (socket.connected) socket.emit(ev, data); };

export function connect(): void {
  socket.on('connect', () => {
    const { profile } = useStore.getState();
    let token = '';
    try { token = sessionStorage.getItem('ri_token') || ''; } catch { /* ignore */ }
    socket.emit('hello', { token, name: profile.name, char: profile.char, color: profile.color }, (r: { token: string }) => {
      try { sessionStorage.setItem('ri_token', r.token); } catch { /* ignore */ }
      useStore.setState({ connected: true });
    });
  });
  socket.on('disconnect', () => useStore.setState({ connected: false }));

  socket.on('room', (room: RoomState | null) => {
    const st = useStore.getState();
    useStore.setState({ room });
    if (!room) {
      if (st.screen === 'lobby') useStore.setState({ screen: 'menu' });
      if (pendingJoin) { send('join', { code: pendingJoin }); pendingJoin = null; history.replaceState(null, '', location.pathname); }
      return;
    }
    pendingJoin = null;
    if (st.screen === 'menu') useStore.setState({ screen: 'lobby' });
  });

  socket.on('start', (msg: StartMsg) => {
    game?.destroy();
    game = new GameClient(msg, send);
    recorded = false;
    useStore.setState({ start: msg, result: null, screen: 'game', hud: emptyHud, feed: [], banner: null });
  });
  socket.on('snap', (s: Snap) => game?.onSnap(s));
  socket.on('over', (msg: OverMsg) => {
    const you = useStore.getState().start?.you;
    const row = msg.rows.find((r) => r.id === you);
    if (row) { record(row.place, row.kills); if (row.place === 1) audio.victory(); else audio.defeat(); }
    useStore.setState({ result: msg });
  });
  socket.on('err', (m: string) => useStore.getState().showToast(String(m)));
  socket.connect();
}

function record(place: number, kills: number): void {
  if (recorded) return;
  recorded = true;
  const p = useStore.getState().profile;
  useStore.getState().setProfile({ matches: p.matches + 1, wins: p.wins + (place === 1 ? 1 : 0), kills: p.kills + kills, best: p.best ? Math.min(p.best, place) : place });
}

export const net = {
  syncProfile() { const p = useStore.getState().profile; send('profile', { name: p.name, char: p.char, color: p.color }); },
  quick(mode: 'solo' | 'duos') { audio.unlock(); send('quick', { mode }); },
  create(mode: 'solo' | 'duos') { audio.unlock(); send('create', { mode }); },
  join(code: string) { audio.unlock(); send('join', { code }); },
  settings(s: Partial<RoomSettings>) { send('settings', s); },
  team(team: number) { send('team', { team }); },
  start() { send('start'); },
  /** Leave the room (forfeits if a match is running) and go back to the main menu. */
  leave() {
    const st = useStore.getState();
    if (st.screen === 'game' && !st.result && st.hud.dead) record(st.hud.place || 99, st.hud.kills);
    send('leave');
    game?.destroy(); game = null;
    useStore.setState({ screen: 'menu', start: null, result: null, room: null });
  },
  /** After a match: private lobbies persist, so go back to it; otherwise back to the menu. */
  afterMatch(again: boolean) {
    const st = useStore.getState();
    const mode = st.start?.mode ?? 'solo';
    game?.destroy(); game = null;
    if (st.room) { useStore.setState({ screen: 'lobby', start: null, result: null }); return; }
    useStore.setState({ screen: 'menu', start: null, result: null });
    if (again) send('quick', { mode });
  },
};

// handy for debugging from the browser console; the server never trusts anything the client holds
(window as any).__ri = { get game() { return game; }, store: useStore };
