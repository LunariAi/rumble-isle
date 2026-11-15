import type { Socket } from 'socket.io';
import { BotBrain, botThink, newBrain } from '../shared/bots';
import { BUSH_REVEAL_DIST, CHAR_IDS, COLORS, DEFAULT_FILL, MAX_PLAYERS, SHOT_REVEAL_TIME, SNAP_EVERY, TICK_RATE, VIEW_RADIUS, WEAPON_IDS } from '../shared/config';
import { F_DASH, F_DOWNED, F_LANDING, F_MOVING, F_RELOAD, F_REVIVING, F_USING, MeState, Member, OverMsg, PlayerSnap, RoomSettings, RoomState, Snap, StartMsg } from '../shared/protocol';
import { Action, Game, GameEvent, InputMsg, Player } from '../shared/sim';

export interface Session {
  token: string; name: string; char: string; color: string;
  socket: Socket | null; room: Room | null;
}
interface Seat {
  id: number; session: Session; team: number; pid: number; view: number;
  inputs: InputMsg[]; credits: number; lastSeq: number; offlineSince: number; idle: number;
}

const BOT_NAMES = ['Waffles', 'Pickle', 'Noodle', 'Biscuit', 'Turbo', 'Gizmo', 'Peanut', 'Mochi', 'Sprocket', 'Dumpling', 'Zigzag', 'Pepper', 'Tater', 'Bubbles', 'Nacho', 'Wobble', 'Fizz', 'Crumpet', 'Bandit', 'Pogo', 'Marble', 'Squid', 'Truffle', 'Banjo'];
const ZONE_SCALE = { fast: 0.6, normal: 1, slow: 1.4 };
const PUBLIC_COUNTDOWN = 12;

export class Room {
  static dropTime: number | undefined; // test hook: shorten the landing phase
  seats = new Map<string, Seat>();
  state: 'lobby' | 'game' = 'lobby';
  settings: RoomSettings;
  host = '';
  game: Game | null = null;
  countdownEnd = 0;
  private brains = new Map<number, BotBrain>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lobbyTimer: ReturnType<typeof setInterval> | null = null;
  private pending: GameEvent[] = [];
  private nextSeat = 1;
  private startedAt = 0;
  private ticksDone = 0;
  private emptySince = 0;

  constructor(public code: string, public pub: boolean, mode: 'solo' | 'duos', private onEmpty: (r: Room) => void) {
    this.settings = { mode, bots: pub ? DEFAULT_FILL : 8, zone: 'normal' };
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000);
  }

  // ------------------------------------------------------------ lobby
  get humans(): number { return this.seats.size; }

  join(s: Session): boolean {
    if (this.state !== 'lobby' || this.seats.size >= MAX_PLAYERS) return false;
    const seat: Seat = { id: this.nextSeat++, session: s, team: this.freeTeam(), pid: -1, view: -1, inputs: [], credits: 0, lastSeq: 0, offlineSince: 0, idle: 0 };
    this.seats.set(s.token, seat);
    s.room = this;
    if (!this.host) this.host = s.token;
    if (this.pub && !this.countdownEnd) this.countdownEnd = Date.now() + PUBLIC_COUNTDOWN * 1000;
    this.broadcastRoom();
    return true;
  }

  private freeTeam(): number {
    for (let t = 1; t <= MAX_PLAYERS; t++) {
      let n = 0;
      for (const s of this.seats.values()) if (s.team === t) n++;
      if (n < 2) return t;
    }
    return 1;
  }

  setTeam(s: Session, team: number): void {
    const seat = this.seats.get(s.token);
    if (!seat || this.state !== 'lobby' || !Number.isInteger(team) || team < 1 || team > MAX_PLAYERS / 2) return;
    let n = 0;
    for (const o of this.seats.values()) if (o.team === team && o !== seat) n++;
    if (n >= 2) return;
    seat.team = team;
    this.broadcastRoom();
  }

  setSettings(s: Session, raw: any): void {
    if (s.token !== this.host || this.state !== 'lobby' || this.pub || !raw || typeof raw !== 'object') return;
    if (raw.mode === 'solo' || raw.mode === 'duos') this.settings.mode = raw.mode;
    if (Number.isInteger(raw.bots) && raw.bots >= 0 && raw.bots < MAX_PLAYERS) this.settings.bots = raw.bots;
    if (raw.zone === 'fast' || raw.zone === 'normal' || raw.zone === 'slow') this.settings.zone = raw.zone;
    this.broadcastRoom();
  }

  leave(s: Session): void {
    const seat = this.seats.get(s.token);
    if (!seat) return;
    if (this.game && seat.pid >= 0) this.game.forfeit(seat.pid);
    this.seats.delete(s.token);
    s.room = null;
    s.socket?.emit('room', null);
    if (this.host === s.token) this.host = this.seats.keys().next().value ?? '';
    if (this.seats.size === 0) { this.destroy(); return; }
    this.broadcastRoom();
  }

  setOnline(s: Session, online: boolean): void {
    const seat = this.seats.get(s.token);
    if (!seat) return;
    seat.offlineSince = online ? 0 : Date.now();
    if (!online) { seat.inputs.length = 0; const p = this.game?.byId.get(seat.pid); if (p) p.btn = 0; }
    this.broadcastRoom();
    if (online && this.state === 'game' && this.game) s.socket?.emit('start', this.startMsg(seat, true));
  }

  private lobbyTick(): void {
    const now = Date.now();
    // drop players who have been disconnected for a while
    for (const seat of [...this.seats.values()]) {
      const limit = this.state === 'lobby' ? 15000 : 120000;
      if (seat.offlineSince && now - seat.offlineSince > limit) this.leave(seat.session);
    }
    if (this.seats.size === 0) return;
    const online = [...this.seats.values()].some((s) => !s.offlineSince);
    if (online) this.emptySince = 0;
    else if (!this.emptySince) this.emptySince = now;
    else if (now - this.emptySince > 45000) { for (const seat of [...this.seats.values()]) this.leave(seat.session); return; }
    if (this.state === 'lobby' && this.pub && this.countdownEnd) {
      if (now >= this.countdownEnd) this.start();
      else this.broadcastRoom();
    }
  }

  roomState(seat: Seat): RoomState {
    const members: Member[] = [...this.seats.values()].map((s) => ({
      id: s.id, name: s.session.name, char: s.session.char, color: s.session.color, team: s.team, bot: false,
      host: s.session.token === this.host, online: !s.offlineSince,
    }));
    return {
      code: this.code, pub: this.pub, state: this.state, settings: this.settings, members, you: seat.id,
      countdown: this.pub && this.countdownEnd && this.state === 'lobby' ? Math.max(0, Math.ceil((this.countdownEnd - Date.now()) / 1000)) : null,
    };
  }

  broadcastRoom(): void {
    for (const seat of this.seats.values()) seat.session.socket?.emit('room', this.roomState(seat));
  }

  // ------------------------------------------------------------ match
  start(by?: Session): void {
    if (this.state !== 'lobby' || (by && by.token !== this.host)) return;
    const mode = this.settings.mode;
    this.seed = Math.floor(Math.random() * 1e9);
    const g = (this.game = new Game({ seed: this.seed, mode, zoneScale: ZONE_SCALE[this.settings.zone], dropTime: Room.dropTime }));
    this.brains.clear();
    this.pending = [];
    const teamCount = new Map<number, number>();
    for (const seat of this.seats.values()) {
      const team = mode === 'duos' ? seat.team : -1;
      const p = g.addPlayer(seat.session.name, seat.session.char, seat.session.color, team, false);
      seat.pid = p.id; seat.view = p.id; seat.inputs = []; seat.credits = 0; seat.lastSeq = 0;
      teamCount.set(p.team, (teamCount.get(p.team) ?? 0) + 1);
    }
    const target = this.pub ? Math.max(DEFAULT_FILL, this.seats.size) : Math.min(MAX_PLAYERS, this.seats.size + this.settings.bots);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let botTeam = 500;
    while (g.players.length < target) {
      let team = -1;
      if (mode === 'duos') {
        // fill half-empty human teams first, then pair bots up
        const half = [...teamCount.entries()].find(([, n]) => n === 1);
        team = half ? half[0] : ++botTeam;
        teamCount.set(team, (teamCount.get(team) ?? 0) + 1);
      }
      const p = g.addPlayer(names[g.players.length % names.length], CHAR_IDS[Math.floor(Math.random() * CHAR_IDS.length)], COLORS[Math.floor(Math.random() * COLORS.length)], team, true);
      this.brains.set(p.id, newBrain());
    }
    this.state = 'game';
    this.countdownEnd = 0;
    this.broadcastRoom();
    for (const seat of this.seats.values()) seat.session.socket?.emit('start', this.startMsg(seat, false));
    this.startedAt = Date.now();
    this.ticksDone = 0;
    this.timer = setInterval(() => this.loop(), 1000 / TICK_RATE / 2);
  }

  private startMsg(seat: Seat, resume: boolean): StartMsg {
    const g = this.game!;
    return {
      seed: this.seed, mode: g.mode, you: seat.pid, resume,
      roster: g.players.map((p) => ({ id: p.id, name: p.name, char: p.char, color: p.color, team: p.team, bot: p.bot })),
      loot: [...g.loot.values()],
    };
  }
  private seed = 0;

  private loop(): void {
    // fixed timestep with catch-up, so a busy event loop never slows the match down
    const due = Math.floor(((Date.now() - this.startedAt) * TICK_RATE) / 1000);
    let n = 0;
    while (this.ticksDone < due && n++ < 5) { this.ticksDone++; this.tick(); }
    if (this.ticksDone < due - 10) this.ticksDone = due;
  }

  private tick(): void {
    const g = this.game;
    if (!g) return;
    for (const seat of this.seats.values()) {
      seat.credits = Math.min(seat.credits + 1, 5);
      // a silent client (hidden tab, lag spike) must not keep its last buttons held down
      if (seat.inputs.length) seat.idle = 0;
      else if (++seat.idle === 12) { const p = g.byId.get(seat.pid); if (p) { p.btn = 0; p.moving = false; } }
      while (seat.inputs.length && seat.credits > 0) { g.applyInput(seat.pid, seat.inputs.shift()!); seat.credits--; }
    }
    for (const [pid, brain] of this.brains) {
      const p = g.byId.get(pid)!;
      const inp = botThink(g, p, brain);
      if (inp) g.applyInput(pid, inp);
    }
    g.tick();
    if (g.events.length) { for (const e of g.events) this.pending.push(e); g.events.length = 0; }
    if (g.tickN % SNAP_EVERY === 0) {
      for (const seat of this.seats.values()) {
        if (seat.offlineSince || !seat.session.socket) continue;
        seat.session.socket.emit('snap', this.snapshot(seat));
      }
      this.pending.length = 0;
    }
    if (g.phase === 'over') this.finish();
  }

  private pickView(seat: Seat, dir: number): void {
    const g = this.game!;
    const self = g.byId.get(seat.pid);
    if (self?.alive) { seat.view = seat.pid; return; }
    let pool = g.players.filter((p) => p.alive && self && p.team === self.team);
    if (!pool.length) pool = g.players.filter((p) => p.alive);
    if (!pool.length) return;
    const i = pool.findIndex((p) => p.id === seat.view);
    seat.view = pool[(i + dir + pool.length) % pool.length].id;
  }

  spectate(s: Session, dir: number): void {
    const seat = this.seats.get(s.token);
    if (seat && this.game) this.pickView(seat, dir >= 0 ? 1 : -1);
  }

  private snapshot(seat: Seat): Snap {
    const g = this.game!;
    const self = g.byId.get(seat.pid)!;
    let v = g.byId.get(seat.view);
    if (!v || !v.alive) { this.pickView(seat, 1); v = g.byId.get(seat.view) ?? self; }
    const ps: PlayerSnap[] = [];
    const vr2 = VIEW_RADIUS * VIEW_RADIUS;
    for (const p of g.players) {
      if (!p.alive) continue;
      const mate = p.team === v.team;
      if (!mate) {
        const d2 = (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
        if (d2 > vr2) continue;
        if (p.bush >= 0 && d2 > BUSH_REVEAL_DIST ** 2 && g.time - p.lastShot > SHOT_REVEAL_TIME && p.bush !== v.bush) continue;
      }
      const w = p.weapons[p.active];
      const flags = (p.downed ? F_DOWNED : 0) | (p.moving ? F_MOVING : 0) | (p.landT > 0 ? F_LANDING : 0) | (p.reloadT > 0 ? F_RELOAD : 0) |
        (p.useItem ? F_USING : 0) | (p.dashT > 0 ? F_DASH : 0) | (p.reviving >= 0 ? F_REVIVING : 0);
      ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.aim * 100) / 100, Math.ceil(p.hp), Math.ceil(p.armor), flags, w ? WEAPON_IDS.indexOf(w.id) : -1, Math.ceil(p.downedHp)]);
    }
    const me: MeState = {
      w: v.weapons.map((w) => (w ? [w.id, w.rarity, w.mag] : null)), act: v.active, ammo: v.ammo, items: v.items,
      rl: v.reloadT, use: v.useItem, ut: v.useT, dashT: v.dashT, dashCd: v.dashCd, dashX: v.dashX, dashY: v.dashY,
      slow: v.useItem !== null || v.reviving >= 0, rev: v.reviving >= 0 ? v.reviveT : 0, landT: v.landT,
    };
    const er2 = (VIEW_RADIUS + 400) ** 2;
    const ev = this.pending.filter((e) => {
      if (e.e === 'hit' && (e.t === v!.id || e.t === seat.pid)) return true;
      if ('x' in e && 'y' in e) return (e.x - v!.x) ** 2 + (e.y - v!.y) ** 2 < er2;
      return true;
    });
    const z = g.zone;
    const snap: Snap = {
      t: g.tickN, ack: self.lastSeq, ph: g.phase, dt: g.dropT, view: v.id, me,
      own: { alive: self.alive, place: self.place, kills: self.kills, dmg: Math.round(self.damage) },
      p: ps, al: g.aliveCount(), ev,
      z: [Math.round(z.x), Math.round(z.y), Math.round(z.r), Math.round(z.nx), Math.round(z.ny), Math.round(z.nr), z.stage, z.phase === 'wait' ? 0 : z.phase === 'shrink' ? 1 : 2, Math.max(0, z.t)],
    };
    if (g.phase === 'drop') snap.drops = g.players.filter((p) => p.team === self.team).map((p) => [p.id, Math.round(p.dropX), Math.round(p.dropY)]);
    return snap;
  }

  private finish(): void {
    const g = this.game!;
    const msg: OverMsg = {
      winner: g.winnerTeam, time: g.time,
      rows: g.players.map((p) => ({ id: p.id, place: p.place || 1, kills: p.kills, dmg: Math.round(p.damage), survived: Math.round(p.survived) })),
    };
    for (const seat of this.seats.values()) seat.session.socket?.emit('over', msg);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.game = null;
    this.state = 'lobby';
    for (const seat of [...this.seats.values()]) { seat.pid = -1; if (seat.offlineSince) this.leave(seat.session); }
    if (this.pub) { for (const seat of [...this.seats.values()]) this.leave(seat.session); return; }
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ in-game messages (already validated by the caller)
  input(s: Session, inp: InputMsg): void {
    const seat = this.seats.get(s.token);
    if (!seat || !this.game || inp.seq <= seat.lastSeq) return;
    seat.lastSeq = inp.seq;
    if (seat.inputs.length >= 10) seat.inputs.shift();
    seat.inputs.push(inp);
  }
  act(s: Session, a: Action): void {
    const seat = this.seats.get(s.token);
    if (seat && this.game) this.game.action(seat.pid, a);
  }
  dropAt(s: Session, x: number, y: number): void {
    const seat = this.seats.get(s.token);
    if (seat && this.game) this.game.setDrop(seat.pid, x, y);
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.lobbyTimer) clearInterval(this.lobbyTimer);
    this.timer = this.lobbyTimer = null;
    this.game = null;
    this.onEmpty(this);
  }
}
