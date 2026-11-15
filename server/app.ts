import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Server, Socket } from 'socket.io';
import { CHAR_IDS, COLORS, ITEM_IDS, MAP_SIZE } from '../shared/config';
import { Action } from '../shared/sim';
import { Room, Session } from './room';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, 14) : '';
  return s || 'Player' + Math.floor(100 + Math.random() * 900);
}
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function startServer(port: number, staticDir?: string) {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: true }, maxHttpBufferSize: 4096, pingInterval: 5000, pingTimeout: 8000 });
  const sessions = new Map<string, Session>();
  const rooms = new Map<string, Room>();

  app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.size, sessions: sessions.size }); });
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.use((_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const newCode = () => {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  };
  const makeRoom = (pub: boolean, mode: 'solo' | 'duos') => {
    const r = new Room(newCode(), pub, mode, (room) => rooms.delete(room.code));
    rooms.set(r.code, r);
    return r;
  };

  io.on('connection', (socket: Socket) => {
    let session: Session | null = null;
    // token-bucket style rate limiting, per socket
    let budget = 120, inBudget = 90, strikes = 0;
    const refill = setInterval(() => { budget = 120; inBudget = 90; }, 1000);
    const allow = (isInput: boolean) => {
      if (isInput ? inBudget-- > 0 : budget-- > 0) return true;
      if (++strikes > 400) socket.disconnect(true);
      return false;
    };
    const on = (ev: string, fn: (...a: any[]) => void, isInput = false) =>
      socket.on(ev, (...a: any[]) => {
        if (!allow(isInput)) return;
        if (!session && ev !== 'hello') return;
        try { fn(...a); } catch (e) { console.error('handler error', ev, e); }
      });
    const err = (msg: string) => socket.emit('err', msg);

    on('hello', (m: any, ack: unknown) => {
      if (!m || typeof m !== 'object') return;
      let s = typeof m.token === 'string' ? sessions.get(m.token) : undefined;
      if (!s) {
        s = { token: randomBytes(18).toString('base64url'), name: '', char: CHAR_IDS[0], color: COLORS[0], socket: null, room: null };
        sessions.set(s.token, s);
      }
      if (s.socket && s.socket !== socket) s.socket.disconnect(true); // same player opened a second tab
      s.socket = socket;
      session = s;
      setProfile(s, m);
      if (typeof ack === 'function') ack({ token: s.token });
      if (s.room) s.room.setOnline(s, true);
      else socket.emit('room', null);
    });

    const setProfile = (s: Session, m: any) => {
      s.name = cleanName(m.name);
      if (CHAR_IDS.includes(m.char)) s.char = m.char;
      if (COLORS.includes(m.color)) s.color = m.color;
    };
    on('profile', (m: any) => { if (m && typeof m === 'object') { setProfile(session!, m); session!.room?.broadcastRoom(); } });

    on('quick', (m: any) => {
      const s = session!;
      if (s.room) return;
      const mode = m?.mode === 'duos' ? 'duos' : 'solo';
      let room = [...rooms.values()].find((r) => r.pub && r.state === 'lobby' && r.settings.mode === mode && r.humans < 16);
      if (!room) room = makeRoom(true, mode);
      if (!room.join(s)) err('Could not join a match, try again');
    });
    on('create', (m: any) => {
      const s = session!;
      if (s.room) return;
      if (rooms.size > 500) return err('Server is full');
      makeRoom(false, m?.mode === 'duos' ? 'duos' : 'solo').join(s);
    });
    on('join', (m: any) => {
      const s = session!;
      if (s.room) return;
      const code = typeof m?.code === 'string' ? m.code.toUpperCase().trim().slice(0, 8) : '';
      const room = rooms.get(code);
      if (!room) return err('No lobby with that code');
      if (room.state !== 'lobby') return err('That match already started');
      if (!room.join(s)) err('Lobby is full');
    });
    on('leave', () => session!.room?.leave(session!));
    on('settings', (m: any) => session!.room?.setSettings(session!, m));
    on('team', (m: any) => session!.room?.setTeam(session!, m?.team));
    on('start', () => session!.room?.start(session!));

    on('in', (m: any) => {
      if (!Array.isArray(m) || m.length !== 5 || !m.every(num)) return;
      const [seq, mx, my, aim, btn] = m as number[];
      if (!Number.isInteger(seq) || seq < 0 || Math.abs(aim) > 10) return;
      session!.room?.input(session!, { seq, mx: Math.max(-1, Math.min(1, mx)), my: Math.max(-1, Math.min(1, my)), aim, btn: btn & 7 });
    }, true);
    on('act', (m: any) => {
      if (!m || typeof m !== 'object') return;
      let a: Action | null = null;
      switch (m.t) {
        case 'pickup': case 'reload': case 'drop': case 'cancel': a = { t: m.t }; break;
        case 'slot': if (m.i === 0 || m.i === 1) a = { t: 'slot', i: m.i }; break;
        case 'use': if (ITEM_IDS.includes(m.item)) a = { t: 'use', item: m.item }; break;
        case 'nade': if (num(m.x) && num(m.y) && Math.abs(m.x) < MAP_SIZE * 2 && Math.abs(m.y) < MAP_SIZE * 2) a = { t: 'nade', x: m.x, y: m.y }; break;
      }
      if (a) session!.room?.act(session!, a);
    });
    on('dropAt', (m: any) => { if (m && num(m.x) && num(m.y)) session!.room?.dropAt(session!, m.x, m.y); });
    on('spec', (m: any) => session!.room?.spectate(session!, m?.dir === -1 ? -1 : 1));

    socket.on('disconnect', () => {
      clearInterval(refill);
      const s = session;
      if (!s || s.socket !== socket) return;
      s.socket = null;
      if (s.room) s.room.setOnline(s, false);
      // forget idle sessions after 10 minutes
      setTimeout(() => { if (!s.socket && !s.room) sessions.delete(s.token); }, 600000).unref();
    });
  });

  return new Promise<{ port: number; close: () => Promise<void>; rooms: Map<string, Room> }>((resolve) => {
    http.listen(port, () => {
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : port, rooms,
        close: () => new Promise<void>((r) => { for (const room of [...rooms.values()]) room.destroy(); io.close(() => r()); }),
      });
    });
  });
}
