import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { PLAYER_SPEED } from '../shared/config';
import type { OverMsg, RoomState, Snap, StartMsg } from '../shared/protocol';
import { startServer } from '../server/app';
import { Room } from '../server/room';

let server: Awaited<ReturnType<typeof startServer>>;
let url = '';

beforeAll(async () => {
  Room.dropTime = 0.5;
  server = await startServer(0);
  url = `http://localhost:${server.port}`;
});
afterAll(async () => { await server.close(); });

class Client {
  sock: Socket;
  token = '';
  room: RoomState | null = null;
  start: StartMsg | null = null;
  snaps: Snap[] = [];
  over: OverMsg | null = null;
  errors: string[] = [];
  seq = 0;
  constructor(public name: string, token?: string) {
    this.sock = io(url, { transports: ['websocket'], forceNew: true });
    this.sock.on('room', (r) => (this.room = r));
    this.sock.on('start', (s) => (this.start = s));
    this.sock.on('snap', (s) => this.snaps.push(s));
    this.sock.on('over', (o) => (this.over = o));
    this.sock.on('err', (e) => this.errors.push(e));
    this.token = token ?? '';
  }
  hello(): Promise<void> {
    return new Promise((res) => this.sock.emit('hello', { token: this.token, name: this.name, char: 'kiki', color: '#ff6b6b' }, (r: any) => { this.token = r.token; res(); }));
  }
  get last(): Snap { return this.snaps[this.snaps.length - 1]; }
  me(): number[] | undefined { return this.last?.p.find((p) => p[0] === this.start!.you); }
  move(mx: number, my: number, btn = 0) { this.sock.emit('in', [++this.seq, mx, my, 0, btn]); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => unknown, ms = 5000): Promise<void> {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout waiting for ' + fn); await sleep(15); }
}

describe('multiplayer server', () => {
  it('private lobby with invite code, synchronised match, validation, reconnection', async () => {
    const a = new Client('Alice'), b = new Client('Bob');
    await a.hello(); await b.hello();
    a.sock.emit('create', { mode: 'solo' });
    await until(() => a.room);
    expect(a.room!.pub).toBe(false);
    expect(a.room!.code).toMatch(/^[A-Z0-9]{5}$/);

    b.sock.emit('join', { code: 'ZZZZZ' });
    await until(() => b.errors.length);
    b.sock.emit('join', { code: a.room!.code.toLowerCase() });
    await until(() => b.room && a.room!.members.length === 2);
    expect(a.room!.members.map((m) => m.name).sort()).toEqual(['Alice', 'Bob']);

    // only the host may change settings or start
    b.sock.emit('settings', { bots: 0 });
    b.sock.emit('start');
    a.sock.emit('settings', { bots: 3, zone: 'fast', mode: 'solo' });
    await until(() => a.room!.settings.bots === 3 && b.room!.settings.zone === 'fast');
    a.sock.emit('settings', { bots: 0 }); // no bots, so nothing random can interfere with the assertions below
    await until(() => b.room!.settings.bots === 0);
    expect(a.room!.state).toBe('lobby');
    a.sock.emit('start');
    await until(() => a.start && b.start);
    expect(a.start!.seed).toBe(b.start!.seed);
    expect(a.start!.roster.length).toBe(2);
    expect(a.start!.you).not.toBe(b.start!.you);
    expect(a.start!.loot.length).toBeGreaterThan(100);

    // both choose the same landing spot so they can see each other
    a.sock.emit('dropAt', { x: 2400, y: 1500 }); b.sock.emit('dropAt', { x: 2460, y: 1500 });
    await until(() => a.last?.ph === 'play' && b.last?.ph === 'play' && a.me() && b.last.p.some((p) => p[0] === a.start!.you));
    await sleep(2400); // landing animation
    const start = a.me()!.slice();
    const seenByB0 = b.last.p.find((p) => p[0] === a.start!.you)!.slice();
    expect(Math.abs(seenByB0[1] - start[1])).toBeLessThan(2);

    // authoritative movement: 30 inputs = one second of walking, and B sees the same position
    for (let i = 0; i < 30; i++) { a.move(-1, 0); await sleep(33); }
    await until(() => a.last.ack === a.seq);
    await sleep(150);
    const moved = Math.hypot(a.me()![1] - start[1], a.me()![2] - start[2]);
    expect(moved).toBeGreaterThan(40);
    expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * 1.01);
    const seenByB = b.last.p.find((p) => p[0] === a.start!.you)!;
    expect(seenByB[1]).toBeCloseTo(a.me()![1], 0);
    expect(seenByB[2]).toBeCloseTo(a.me()![2], 0);

    // speed hack: flooding inputs must not move the player faster than real time allows
    const before = a.me()!.slice();
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) a.move(1, 0, 2);
    await sleep(500);
    const elapsed = (Date.now() - t0) / 1000;
    const dist = Math.hypot(a.me()![1] - before[1], a.me()![2] - before[2]);
    expect(dist).toBeLessThan(PLAYER_SPEED * (elapsed + 0.4) + 160 /* one dash */);

    // garbage and forged messages are ignored
    a.sock.emit('in', 'lol'); a.sock.emit('in', [1, 2]); a.sock.emit('in', [NaN, 0, 0, 0, 0]);
    a.sock.emit('act', { t: 'use', item: 'godmode' }); a.sock.emit('act', null); a.sock.emit('act', { t: 'nade', x: 'a', y: {} });
    a.sock.emit('hp', 9999); a.sock.emit('dropAt', { x: 1e99, y: -5 });
    await sleep(100);
    expect(a.me()![4]).toBeLessThanOrEqual(100);
    expect(a.last.me!.items.grenade).toBe(0);

    // reconnection: drop the socket mid-match and come back with the same token
    const you = a.start!.you;
    a.sock.disconnect();
    await until(() => b.room!.members.find((m) => m.name === 'Alice')?.online === false);
    const a2 = new Client('Alice', a.token);
    await a2.hello();
    await until(() => a2.start && a2.snaps.length > 2);
    expect(a2.start!.resume).toBe(true);
    expect(a2.start!.you).toBe(you);
    expect(a2.room!.state).toBe('game');
    expect(a2.me()).toBeTruthy();

    // leaving mid-match eliminates you, which hands the win to the last player standing
    b.sock.emit('leave');
    await until(() => b.room === null);
    await until(() => a2.over);
    expect(a2.over!.rows.find((r) => r.id === you)!.place).toBe(1);
    expect(a2.over!.rows.find((r) => r.id === b.start!.you)!.place).toBe(2);
    // private lobbies survive the match so friends can go again
    await until(() => a2.room?.state === 'lobby');
    a2.sock.emit('leave');
    await until(() => a2.room === null && server.rooms.size === 0);
    a2.sock.disconnect(); b.sock.disconnect();
  });

  it('quick play matchmaking puts players in the same public lobby, fills with bots and plays to the end', async () => {
    const a = new Client('Ann'), b = new Client('Ben');
    await a.hello(); await b.hello();
    a.sock.emit('quick', { mode: 'duos' });
    await until(() => a.room);
    b.sock.emit('quick', { mode: 'duos' });
    await until(() => b.room);
    expect(b.room!.code).toBe(a.room!.code);
    expect(a.room!.pub).toBe(true);
    expect(a.room!.countdown).toBeGreaterThan(0);
    // same duo by default; force the countdown
    expect(new Set(b.room!.members.map((m) => m.team)).size).toBe(1);
    const room = server.rooms.get(a.room!.code)!;
    room.countdownEnd = Date.now();
    await until(() => a.start && b.start, 4000);
    const ra = a.start!.roster.find((r) => r.id === a.start!.you)!, rb = a.start!.roster.find((r) => r.id === b.start!.you)!;
    expect(ra.team).toBe(rb.team);
    expect(a.start!.roster.length).toBeGreaterThanOrEqual(14);
    // teammates always appear in each other's snapshots
    await until(() => a.last?.ph === 'play');
    expect(a.last.p.some((p) => p[0] === b.start!.you)).toBe(true);
    // fast-forward: eliminate everyone but team A on the server and check the result broadcast
    const g = room.game!;
    for (const p of g.players) if (p.team !== ra.team) { p.landT = 0; g.damage(p, 999, a.start!.you, 'popper'); if (p.alive) g.damage(p, 999, a.start!.you, 'popper'); }
    await until(() => a.over && b.over);
    expect(a.over!.winner).toBe(ra.team);
    expect(a.over!.rows.find((r) => r.id === a.start!.you)!.place).toBe(1);
    expect(a.over!.rows.find((r) => r.id === b.start!.you)!.place).toBe(1);
    await until(() => a.room === null && server.rooms.size === 0);
    a.sock.disconnect(); b.sock.disconnect();
  });
});
