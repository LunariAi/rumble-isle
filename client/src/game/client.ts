// Client-side game: input, prediction, interpolation, effects and canvas rendering.
// The server is authoritative; nothing here can change health, ammo, inventory or hits.
import { COLORS, DT, GRENADE, ItemId, MAP_SIZE, PICKUP_RANGE, PLAYER_RADIUS, REVIVE_RANGE, WEAPONS, WEAPON_IDS, WeaponId } from '../../../shared/config';
import { GameMap, buildMap, buildingAt, bushAt, raycast, segCircle } from '../../../shared/map';
import { F_DOWNED, F_LANDING, F_MOVING, MeState, OwnStats, PlayerSnap, RosterEntry, Snap, StartMsg } from '../../../shared/protocol';
import { BTN_DASH, BTN_SHOOT, BTN_USE, GameEvent, InputMsg, Loot, MoveState, applyMove } from '../../../shared/sim';
import { Hud, Prompt, useStore } from '../store';
import { audio } from './audio';
import { MAP_PAD, drawBush, drawCanopy, drawCharacter, drawGround, drawLoot, drawObstacle, drawRoof, renderMapImage, shade } from './draw';

const STEP = 1000 / 30;
const INTERP_DELAY = 3.2; // ticks (~107 ms) behind the newest snapshot
const TAU = Math.PI * 2;

interface VBullet { id: number; o: number; team: number; x: number; y: number; dx: number; dy: number; speed: number; dist: number; range: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; kind: 0 | 1 | 2 } // 0 dot, 1 ring, 2 smoke
interface DmgNum { x: number; y: number; n: number; life: number; mine: boolean }
interface VNade { x: number; y: number; sx: number; sy: number; tx: number; ty: number; t: number; fly: number }
interface Anim { walk: number; recoil: number; hurt: number; punch: number; stepT: number; x: number; y: number; hp: number }
interface RP { id: number; x: number; y: number; aim: number; hp: number; armor: number; flags: number; w: number; dhp: number }

const CAUSE: Record<string, string> = { fists: 'Fists', zone: 'the Storm', grenade: 'Boom Berry', bleed: 'bleeding out', left: 'quitting' };

export class GameClient {
  map: GameMap;
  roster = new Map<number, RosterEntry>();
  you: number;
  myTeam: number;
  mode: 'solo' | 'duos';
  loot = new Map<number, Loot>();
  mapImage: HTMLCanvasElement;
  zone: number[] = [MAP_SIZE / 2, MAP_SIZE / 2, 3500, MAP_SIZE / 2, MAP_SIZE / 2, 3500, 0, 0, 0];
  drops: [number, number, number][] = [];
  phase: 'drop' | 'play' | 'over' = 'drop';
  view: number;
  showMap = false;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private mini: HTMLCanvasElement | null = null;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private frame = 0;
  private time = 0;

  private snaps: { t: number; p: Map<number, PlayerSnap> }[] = [];
  private tickOffset = NaN;
  private me: MeState | null = null;
  private own: OwnStats = { alive: true, place: 0, kills: 0, dmg: 0 };
  private alive = 0;
  private dropT = 0;

  private pred: MoveState = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, dashT: 0, dashCd: 0, dashX: 1, dashY: 0 };
  private prevX = 0; private prevY = 0; private errX = 0; private errY = 0;
  private predReady = false;
  private pending: InputMsg[] = [];
  private seq = 0;
  private aim = 0;
  private myFlags = 0;

  private bullets: VBullet[] = [];
  private parts: Particle[] = [];
  private nums: DmgNum[] = [];
  private nades = new Map<number, VNade>();
  private anims = new Map<number, Anim>();
  private rps: RP[] = [];
  private cam = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 1 };
  private shake = 0;
  private hurtFlash = 0;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, down: false };
  private dashQueued = false;
  private roofAlpha: Float32Array;
  private stamp: Uint32Array;
  private hudT = 0;
  private lastReload = 0;
  private lastUse: ItemId | null = null;
  private lastHp = 100;
  private wasAlive = true;
  private zoneBeepT = 0;
  private cleanup: (() => void)[] = [];

  constructor(start: StartMsg, private send: (ev: string, data?: unknown) => void) {
    this.map = buildMap(start.seed);
    this.you = this.view = start.you;
    this.mode = start.mode;
    for (const r of start.roster) this.roster.set(r.id, r);
    this.myTeam = this.roster.get(start.you)?.team ?? -1;
    for (const l of start.loot) this.loot.set(l.id, l);
    this.mapImage = renderMapImage(this.map, 900);
    this.roofAlpha = new Float32Array(this.map.buildings.length).fill(1);
    this.stamp = new Uint32Array(this.map.obstacles.length);
  }

  // ------------------------------------------------------------------ lifecycle
  attach(canvas: HTMLCanvasElement, mini: HTMLCanvasElement): void {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.mini = mini;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, ev: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn, opts);
      this.cleanup.push(() => t.removeEventListener(ev, fn, opts));
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr); canvas.height = Math.floor(window.innerHeight * dpr);
    };
    resize();
    on(window, 'resize', resize);
    on(window, 'keydown', (e: KeyboardEvent) => this.keyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, 'blur', () => { this.keys.clear(); this.mouse.down = false; });
    on(window, 'mousemove', (e: MouseEvent) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      audio.unlock();
      if (e.button !== 0) return;
      if (!this.own.alive) { this.send('spec', { dir: 1 }); return; }
      this.mouse.down = true;
    });
    on(window, 'mouseup', (e: MouseEvent) => { if (e.button === 0) this.mouse.down = false; });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(canvas, 'wheel', (e: WheelEvent) => { e.preventDefault(); this.swap(); }, { passive: false });
    this.last = performance.now();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.update(now); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.canvas = this.ctx = null;
  }

  private get controlling(): boolean { return this.own.alive && this.phase === 'play' && this.view === this.you && this.me !== null; }

  // ------------------------------------------------------------------ input
  private keyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    audio.unlock();
    this.keys.add(e.code);
    if (e.code === 'KeyM' || e.code === 'Tab') { this.showMap = !this.showMap; this.pushHud(true); return; }
    if (!this.own.alive) {
      if (e.code === 'ArrowLeft') this.send('spec', { dir: -1 });
      if (e.code === 'ArrowRight' || e.code === 'Space') this.send('spec', { dir: 1 });
      return;
    }
    if (!this.controlling) return;
    const use = (item: ItemId) => { if (this.me!.use) this.send('act', { t: 'cancel' }); else this.send('act', { t: 'use', item }); };
    switch (e.code) {
      case 'KeyR': this.send('act', { t: 'reload' }); break;
      case 'KeyE': case 'KeyF': this.send('act', { t: 'pickup' }); break;
      case 'Digit1': this.send('act', { t: 'slot', i: 0 }); break;
      case 'Digit2': this.send('act', { t: 'slot', i: 1 }); break;
      case 'KeyQ': this.swap(); break;
      case 'Digit3': use('bandage'); break;
      case 'Digit4': use('medkit'); break;
      case 'Digit5': use('cell'); break;
      case 'KeyG': { const w = this.mouseWorld(); this.send('act', { t: 'nade', x: w.x, y: w.y }); break; }
      case 'KeyX': this.send('act', { t: 'drop' }); break;
      case 'Space': this.dashQueued = true; break;
    }
  }
  private swap(): void { if (this.controlling) this.send('act', { t: 'slot', i: 1 - this.me!.act }); }

  private mouseWorld(): { x: number; y: number } {
    return { x: this.cam.x + (this.mouse.x - window.innerWidth / 2) / this.cam.zoom, y: this.cam.y + (this.mouse.y - window.innerHeight / 2) / this.cam.zoom };
  }

  setDrop(x: number, y: number): void {
    if (this.phase !== 'drop') return;
    this.send('dropAt', { x, y });
    const mine = this.drops.find((d) => d[0] === this.you);
    if (mine) { mine[1] = x; mine[2] = y; } else this.drops.push([this.you, x, y]);
    audio.click();
  }

  private step(): void {
    if (!this.controlling) return;
    const k = this.keys;
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const my = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const w = this.mouseWorld();
    this.aim = Math.round(Math.atan2(w.y - this.pred.y, w.x - this.pred.x) * 10000) / 10000;
    const btn = (this.mouse.down && !this.showMap ? BTN_SHOOT : 0) | (this.dashQueued ? BTN_DASH : 0) | (k.has('KeyE') || k.has('KeyF') ? BTN_USE : 0);
    const inp: InputMsg = { seq: ++this.seq, mx, my, aim: this.aim, btn };
    this.send('in', [inp.seq, mx, my, inp.aim, btn]);
    if (this.dashQueued && this.pred.dashCd <= 0 && !this.me!.slow && !(this.myFlags & F_DOWNED)) audio.dash();
    this.dashQueued = false;
    this.prevX = this.pred.x; this.prevY = this.pred.y;
    if (this.myFlags & F_LANDING || !this.predReady) return;
    applyMove(this.map, this.pred, inp, this.me!.slow, (this.myFlags & F_DOWNED) !== 0);
    this.pending.push(inp);
    if (this.pending.length > 90) this.pending.shift();
  }

  // ------------------------------------------------------------------ network
  onSnap(s: Snap): void {
    const now = performance.now();
    const sample = s.t - (now * 30) / 1000;
    if (Number.isNaN(this.tickOffset) || Math.abs(sample - this.tickOffset) > 8) this.tickOffset = sample;
    else this.tickOffset += (sample - this.tickOffset) * 0.05;
    const p = new Map<number, PlayerSnap>();
    for (const row of s.p) p.set(row[0], row);
    this.snaps.push({ t: s.t, p });
    if (this.snaps.length > 16) this.snaps.shift();

    const phaseBefore = this.phase;
    this.phase = s.ph; this.me = s.me; this.own = s.own; this.zone = s.z; this.alive = s.al; this.dropT = s.dt;
    if (s.drops) this.drops = s.drops;
    if (this.view !== s.view) { this.view = s.view; this.predReady = false; }
    if (phaseBefore === 'drop' && s.ph === 'play') { audio.land(); useStore.getState().showBanner('Go go go!', 'Find a weapon'); }

    // reconcile local prediction with the authoritative position
    const mine = p.get(this.you);
    if (mine && s.own.alive && s.me && s.view === this.you) {
      this.myFlags = mine[6];
      const ox = this.pred.x, oy = this.pred.y;
      this.pred.x = mine[1]; this.pred.y = mine[2];
      this.pred.dashT = s.me.dashT; this.pred.dashCd = s.me.dashCd; this.pred.dashX = s.me.dashX; this.pred.dashY = s.me.dashY;
      let keep = 0;
      for (const inp of this.pending) if (inp.seq > s.ack) this.pending[keep++] = inp;
      this.pending.length = keep;
      const downed = (mine[6] & F_DOWNED) !== 0;
      for (const inp of this.pending) applyMove(this.map, this.pred, inp, s.me.slow, downed);
      const dx = ox - this.pred.x, dy = oy - this.pred.y;
      if (this.predReady && dx * dx + dy * dy < 120 * 120) { this.errX += dx; this.errY += dy; this.prevX -= dx; this.prevY -= dy; }
      else { this.errX = this.errY = 0; this.prevX = this.pred.x; this.prevY = this.pred.y; }
      this.predReady = true;
    }
    for (const e of s.ev) this.onEvent(e);

    // sounds driven by state changes of the player we are watching
    if (s.me) {
      if (s.me.rl > 0 && this.lastReload <= 0) audio.reload();
      this.lastReload = s.me.rl;
      if (!s.me.use && this.lastUse && mine && (mine[4] > this.lastHp || this.lastUse === 'cell')) audio.heal();
      this.lastUse = s.me.use;
    }
    if (mine) this.lastHp = mine[4];
    if (this.wasAlive && !s.own.alive) { this.wasAlive = false; audio.death(); this.mouse.down = false; }
  }

  private name(id: number): string { return this.roster.get(id)?.name ?? '???'; }

  private sound(x: number, y: number): [number, number] {
    const dx = x - this.cam.x, d = Math.hypot(dx, y - this.cam.y);
    return [Math.max(0, 1 - d / 1400) ** 1.6, Math.max(-1, Math.min(1, dx / 700))];
  }

  private onEvent(e: GameEvent): void {
    const st = useStore.getState();
    switch (e.e) {
      case 'shot': {
        const def = WEAPONS[e.w];
        const a = this.anims.get(e.o);
        const team = this.roster.get(e.o)?.team ?? -1;
        // draw from where the shooter is on *this* screen, so tracers leave the gun barrel
        const sx = a ? a.x : e.x, sy = a ? a.y : e.y;
        for (const [id, ang] of e.b) {
          const dx = Math.cos(ang), dy = Math.sin(ang);
          this.bullets.push({ id, o: e.o, team, x: sx + dx * 30, y: sy + dy * 30, dx, dy, speed: def.speed, dist: 30, range: def.range });
        }
        if (a) a.recoil = 1;
        const ang = e.b[0][1];
        for (let i = 0; i < 4; i++) this.spawn(sx + Math.cos(ang) * 36, sy + Math.sin(ang) * 36, Math.cos(ang) * 120 + rnd(90), Math.sin(ang) * 120 + rnd(90), 0.12, 5, '#ffe9a3', 0);
        const [vol, pan] = this.sound(e.x, e.y);
        audio.shot(def.cls, e.o === this.view ? 1 : vol * 0.8, pan);
        if (e.o === this.view) this.shake = Math.max(this.shake, def.cls === 'sniper' ? 9 : def.cls === 'shotgun' ? 7 : 2.5);
        break;
      }
      case 'hit': {
        const i = this.bullets.findIndex((b) => b.id === e.b);
        if (i >= 0) this.bullets.splice(i, 1);
        if (e.t >= 0) {
          const a = this.anims.get(e.t);
          if (a) a.hurt = 1;
          const col = this.roster.get(e.t)?.color ?? '#fff';
          for (let k = 0; k < 6; k++) this.spawn(e.x, e.y, rnd(260), rnd(260), 0.3, 5, col, 0);
          const shooter = this.bullets.length >= 0 && e.d > 0;
          if (shooter) this.nums.push({ x: e.x + rnd(14), y: e.y - 24, n: Math.round(e.d), life: 0.8, mine: e.t === this.view });
          if (e.t === this.view) { audio.hurt(); this.shake = Math.max(this.shake, 6); this.hurtFlash = 1; }
          else audio.hit();
        } else {
          for (let k = 0; k < 4; k++) this.spawn(e.x, e.y, rnd(200), rnd(200), 0.22, 4, '#e8e2d0', 0);
          const [vol, pan] = this.sound(e.x, e.y);
          audio.wall(vol, pan);
        }
        break;
      }
      case 'melee': {
        const a = this.anims.get(e.o);
        if (a) a.punch = 0.001;
        const [vol, pan] = this.sound(e.x, e.y);
        audio.punch(vol, pan);
        break;
      }
      case 'kill': {
        const weapon = e.w in WEAPONS ? WEAPONS[e.w as WeaponId].name : CAUSE[e.w] ?? e.w;
        st.pushFeed({ killer: e.k >= 0 ? this.name(e.k) : '', victim: this.name(e.v), weapon, down: e.down, mine: e.k === this.you || e.v === this.you });
        const a = this.anims.get(e.v);
        if (a && !e.down) {
          const col = this.roster.get(e.v)?.color ?? '#fff';
          for (let k = 0; k < 22; k++) this.spawn(a.x, a.y, rnd(420), rnd(420), 0.6, 8, k % 3 ? col : '#ffffff', 0);
          this.spawn(a.x, a.y, 0, 0, 0.45, 70, col, 1);
          for (let k = 0; k < 5; k++) this.spawn(a.x + rnd(20), a.y + rnd(20), rnd(40), -40 + rnd(30), 0.9, 18, '#ffffff', 2);
        }
        if (e.k === this.you && e.v !== this.you) { audio.kill(); st.showBanner(e.down ? 'Knocked!' : 'Eliminated!', this.name(e.v)); }
        else if (e.v === this.you && e.down) st.showBanner('You are down!', 'Crawl to your teammate');
        break;
      }
      case 'loot+': this.loot.set(e.l.id, e.l); break;
      case 'loot-': this.loot.delete(e.id); if (e.by === this.view) audio.pickup(); break;
      case 'nade': this.nades.set(e.id, { x: e.x, y: e.y, sx: e.x, sy: e.y, tx: e.tx, ty: e.ty, t: 0, fly: e.fly }); break;
      case 'boom': {
        this.nades.delete(e.id);
        this.spawn(e.x, e.y, 0, 0, 0.4, GRENADE.radius, '#ffb347', 1);
        for (let k = 0; k < 26; k++) this.spawn(e.x, e.y, rnd(520), rnd(520), 0.5, 9, k % 2 ? '#ff9a2e' : '#ffe08a', 0);
        for (let k = 0; k < 8; k++) this.spawn(e.x + rnd(60), e.y + rnd(60), rnd(60), rnd(60), 1.1, 34, '#6b6470', 2);
        const [vol, pan] = this.sound(e.x, e.y);
        audio.boom(vol, pan);
        this.shake = Math.max(this.shake, 16 * vol);
        break;
      }
      case 'revive': {
        for (let k = 0; k < 14; k++) this.spawn(e.x, e.y, rnd(200), rnd(200) - 60, 0.7, 6, '#7dffb0', 0);
        if (this.roster.get(e.p)?.team === this.myTeam) audio.revive();
        break;
      }
      case 'zone':
        if (e.phase === 'shrink') { audio.zoneWarn(); st.showBanner('The storm is closing in!', 'Get inside the white circle'); }
        else if (e.stage > 0) st.showBanner('Storm paused', 'Next circle is marked on your map');
        break;
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: string, kind: 0 | 1 | 2): void {
    if (this.parts.length > 500) this.parts.shift();
    this.parts.push({ x, y, vx, vy, life, max: life, size, color, kind });
  }

  // ------------------------------------------------------------------ frame
  private update(now: number): void {
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    this.time += dt;
    this.frame++;
    this.acc += dtMs;
    let n = 0;
    while (this.acc >= STEP) { this.acc -= STEP; if (n++ < 4) this.step(); }
    this.interpolate(now, dt);
    this.simulateEffects(dt);
    this.render(dt);
    this.hudT -= dtMs;
    if (this.hudT <= 0) { this.hudT = 100; this.pushHud(false); }
  }

  /** Builds this frame's list of players: remote ones interpolated between snapshots, the local one predicted. */
  private interpolate(now: number, dt: number): void {
    const rps = this.rps;
    rps.length = 0;
    const sn = this.snaps;
    if (!sn.length) return;
    const rt = (now * 30) / 1000 + this.tickOffset - INTERP_DELAY;
    let bi = sn.length - 1;
    while (bi > 0 && sn[bi - 1].t >= rt) bi--;
    const b = sn[bi], a = sn[Math.max(0, bi - 1)];
    const f = b.t === a.t ? 1 : Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
    const newest = sn[sn.length - 1].p;
    for (const [id, pb] of b.p) {
      if (!newest.has(id)) continue; // gone (dead or out of sight) in the latest state
      const pa = a.p.get(id) ?? pb;
      let da = pb[3] - pa[3];
      if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
      const cur = newest.get(id)!;
      rps.push({ id, x: pa[1] + (pb[1] - pa[1]) * f, y: pa[2] + (pb[2] - pa[2]) * f, aim: pa[3] + da * f, hp: cur[4], armor: cur[5], flags: pb[6], w: cur[7], dhp: cur[8] });
    }
    if (this.controlling && this.predReady) {
      const me = rps.find((r) => r.id === this.you);
      const k = Math.exp(-dt * 14);
      this.errX *= k; this.errY *= k;
      const al = this.acc / STEP;
      if (me) {
        const moved = Math.abs(this.pred.x - this.prevX) + Math.abs(this.pred.y - this.prevY) > 0.3;
        me.x = this.prevX + (this.pred.x - this.prevX) * al + this.errX;
        me.y = this.prevY + (this.pred.y - this.prevY) * al + this.errY;
        const w = this.mouseWorld();
        me.aim = Math.atan2(w.y - me.y, w.x - me.x);
        me.flags = (me.flags & ~F_MOVING) | (moved ? F_MOVING : 0);
      }
    }
    // per-player animation state
    for (const r of rps) {
      let an = this.anims.get(r.id);
      if (!an) { an = { walk: 0, recoil: 0, hurt: 0, punch: 0, stepT: 0, x: r.x, y: r.y, hp: r.hp }; this.anims.set(r.id, an); }
      an.x = r.x; an.y = r.y;
      an.recoil = Math.max(0, an.recoil - dt * 9);
      an.hurt = Math.max(0, an.hurt - dt * 5);
      if (an.punch > 0) { an.punch += dt * 5; if (an.punch >= 1) an.punch = 0; }
      if (r.flags & F_MOVING && !(r.flags & F_LANDING)) {
        an.walk += dt * (r.flags & F_DOWNED ? 5 : 15);
        an.stepT += dt;
        if (an.stepT > 0.3) {
          an.stepT = 0;
          const [vol, pan] = this.sound(r.x, r.y);
          if (r.id === this.view) audio.step(0.7, 0); else if (vol > 0.45) audio.step(vol * 0.8, pan);
        }
      } else an.walk *= 0.8;
    }
    const v = rps.find((r) => r.id === this.view);
    if (v) {
      const lookX = (this.mouse.x - window.innerWidth / 2) / this.cam.zoom * 0.14, lookY = (this.mouse.y - window.innerHeight / 2) / this.cam.zoom * 0.14;
      const tx = v.x + (this.controlling ? lookX : 0), ty = v.y + (this.controlling ? lookY : 0);
      const k = this.controlling ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 8);
      if (Math.hypot(tx - this.cam.x, ty - this.cam.y) > 900) { this.cam.x = tx; this.cam.y = ty; }
      else { this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k; }
    } else if (this.phase === 'drop') {
      const d = this.drops.find((q) => q[0] === this.you);
      if (d) { this.cam.x += (d[1] - this.cam.x) * 0.05; this.cam.y += (d[2] - this.cam.y) * 0.05; }
    }
  }

  private simulateEffects(dt: number): void {
    // tracers: stop them locally at walls and players so they never appear to pass through cover
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = Math.min(b.speed * dt, b.range - b.dist);
      const ex = b.x + b.dx * step, ey = b.y + b.dy * step;
      let t = raycast(this.map, b.x, b.y, ex, ey);
      for (const r of this.rps) {
        if (r.id === b.o || (this.roster.get(r.id)?.team ?? -2) === b.team || r.flags & F_LANDING) continue;
        const tp = segCircle(b.x, b.y, ex - b.x, ey - b.y, r.x, r.y, PLAYER_RADIUS);
        if (tp < t) t = tp;
      }
      if (t <= 1) { this.bullets.splice(i, 1); continue; }
      b.x = ex; b.y = ey; b.dist += step;
      if (b.dist >= b.range - 0.01) this.bullets.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
    }
    for (let i = this.nums.length - 1; i >= 0; i--) { const d = this.nums[i]; d.life -= dt; d.y -= 40 * dt; if (d.life <= 0) this.nums.splice(i, 1); }
    for (const n of this.nades.values()) {
      n.t += dt;
      const f = Math.min(1, n.t / n.fly);
      n.x = n.sx + (n.tx - n.sx) * f; n.y = n.sy + (n.ty - n.sy) * f;
    }
    this.shake = Math.max(0, this.shake - dt * 40);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    // storm warning beeps while outside the circle
    const z = this.zone;
    if (this.controlling && Math.hypot(this.cam.x - z[0], this.cam.y - z[1]) > z[2]) {
      this.zoneBeepT -= dt;
      if (this.zoneBeepT <= 0) { this.zoneBeepT = 1.2; audio.countdown(); }
    }
  }

  // ------------------------------------------------------------------ render
  private render(dt: number): void {
    const c = this.ctx, cv = this.canvas;
    if (!c || !cv) return;
    const W = cv.width, H = cv.height, dpr = W / window.innerWidth;
    const viewed = this.rps.find((r) => r.id === this.view);
    const scoped = viewed && viewed.w >= 0 && WEAPONS[WEAPON_IDS[viewed.w]].cls === 'sniper';
    const baseZoom = Math.max(window.innerWidth / 1340, window.innerHeight / 760) * (scoped ? 0.8 : 1);
    this.cam.zoom += (baseZoom - this.cam.zoom) * Math.min(1, dt * 6);
    if (this.cam.zoom < 0.05) this.cam.zoom = baseZoom;
    const zoom = this.cam.zoom * dpr;
    const shakeOn = useStore.getState().settings.shake;
    const sx = shakeOn ? rnd(this.shake) : 0, sy = shakeOn ? rnd(this.shake) : 0;
    const camX = this.cam.x + sx, camY = this.cam.y + sy;
    const x0 = camX - W / 2 / zoom - 90, x1 = camX + W / 2 / zoom + 90, y0 = camY - H / 2 / zoom - 90, y1 = camY + H / 2 / zoom + 90;

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#2f9fd6'; c.fillRect(0, 0, W, H);
    c.setTransform(zoom, 0, 0, zoom, W / 2 - camX * zoom, H / 2 - camY * zoom);
    const m = this.map;
    drawGround(c, m, x0, y0, x1, y1, this.time);

    for (const l of this.loot.values()) if (l.x > x0 && l.x < x1 && l.y > y0 && l.y < y1) drawLoot(c, l, this.time);

    // obstacles via the spatial grid
    const trees: number[] = [];
    const cx0 = Math.max(0, Math.floor(x0 / m.cell)), cx1 = Math.min(m.cols - 1, Math.floor(x1 / m.cell));
    const cy0 = Math.max(0, Math.floor(y0 / m.cell)), cy1 = Math.min(m.cols - 1, Math.floor(y1 / m.cell));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const i of m.grid[cy * m.cols + cx]) {
          if (this.stamp[i] === this.frame) continue;
          this.stamp[i] = this.frame;
          const o = m.obstacles[i];
          drawObstacle(c, o);
          if (o.kind === 'tree') trees.push(i);
        }
      }
    }

    for (const n of this.nades.values()) {
      const f = Math.min(1, n.t / n.fly), h = Math.sin(f * Math.PI) * 40;
      c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(n.x, n.y, 9, 6, 0, 0, TAU); c.fill();
      c.fillStyle = n.t > n.fly && Math.sin(this.time * 30) > 0 ? '#fff' : '#ff9a2e';
      c.strokeStyle = '#2b2540'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(n.x, n.y - h, 9, 0, TAU); c.fill(); c.stroke();
      if (n.t > n.fly) { c.strokeStyle = 'rgba(255,90,60,.5)'; c.lineWidth = 2; c.beginPath(); c.arc(n.x, n.y, GRENADE.radius, 0, TAU); c.stroke(); }
    }

    // players: downed first so standing players draw on top
    const me = this.me;
    for (const pass of [0, 1]) {
      for (const r of this.rps) {
        const downed = (r.flags & F_DOWNED) !== 0;
        if ((pass === 0) !== downed) continue;
        if (r.x < x0 || r.x > x1 || r.y < y0 || r.y > y1) continue;
        const info = this.roster.get(r.id);
        if (!info) continue;
        const an = this.anims.get(r.id)!;
        const landing = (r.flags & F_LANDING) !== 0;
        const lt = landing ? (r.id === this.view && me ? Math.min(1, me.landT / 2.2) : 0.5) : 0;
        c.fillStyle = 'rgba(0,0,0,.2)';
        c.beginPath(); c.ellipse(r.x + 3, r.y + 6 + lt * 30, 19 * (1 - lt * 0.4), 14 * (1 - lt * 0.4), 0, 0, TAU); c.fill();
        c.save();
        c.translate(r.x, r.y - lt * 90);
        c.rotate(r.aim);
        const s = (downed ? 0.85 : 1) * (1 + lt * 0.5);
        c.scale(s, s);
        if (downed) c.globalAlpha = 0.75;
        drawCharacter(c, info.char, info.color, { walk: an.walk, weapon: r.w >= 0 ? WEAPONS[WEAPON_IDS[r.w]].cls : null, recoil: an.recoil, hurt: an.hurt, downed, punch: an.punch });
        c.restore();
        if (landing) {
          c.save(); c.translate(r.x, r.y - lt * 90 - 6); c.globalAlpha = 0.92;
          for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 46, (i / 6) * TAU, ((i + 1) / 6) * TAU); c.closePath(); c.fillStyle = i % 2 ? '#ffffff' : info.color; c.fill(); }
          c.lineWidth = 3; c.strokeStyle = '#2b2540'; c.beginPath(); c.arc(0, 0, 46, 0, TAU); c.stroke();
          c.restore();
        }
      }
    }

    // tracers
    c.lineCap = 'round';
    for (const pass of [0, 1]) {
      c.strokeStyle = pass ? '#fff7d6' : 'rgba(255,196,84,.45)'; c.lineWidth = pass ? 2.5 : 7;
      c.beginPath();
      for (const b of this.bullets) { const len = Math.min(46, b.dist - 26); c.moveTo(b.x - b.dx * len, b.y - b.dy * len); c.lineTo(b.x, b.y); }
      c.stroke();
    }

    // cover layers: bushes, tree canopies, roofs
    const px = viewed ? viewed.x : camX, py = viewed ? viewed.y : camY;
    const myBush = viewed ? bushAt(m, px, py) : -1;
    for (let i = 0; i < m.bushes.length; i++) {
      const b = m.bushes[i];
      if (b.x + b.r < x0 || b.x - b.r > x1 || b.y + b.r < y0 || b.y - b.r > y1) continue;
      drawBush(c, b.x, b.y, b.r, i === myBush ? 0.38 : 0.97);
    }
    for (const i of trees) {
      const o = m.obstacles[i];
      const near = (o.x - px) ** 2 + (o.y - py) ** 2 < (o.v + 10) ** 2;
      drawCanopy(c, o, near ? 0.28 : 0.93);
    }
    const inside = viewed ? buildingAt(m, px, py) : -1;
    for (let i = 0; i < m.buildings.length; i++) {
      const b = m.buildings[i];
      const target = i === inside ? 0 : 1;
      this.roofAlpha[i] += (target - this.roofAlpha[i]) * Math.min(1, dt * 10);
      if (b.x + b.w < x0 || b.x > x1 || b.y + b.h < y0 || b.y > y1) continue;
      drawRoof(c, b, this.roofAlpha[i]);
    }

    // storm
    const z = this.zone;
    c.beginPath();
    c.rect(x0 - 50, y0 - 50, x1 - x0 + 100, y1 - y0 + 100);
    c.arc(z[0], z[1], Math.max(0, z[2]), 0, TAU, true);
    c.fillStyle = 'rgba(150,60,220,0.3)'; c.fill('evenodd');
    c.lineWidth = 6; c.strokeStyle = `rgba(210,130,255,${0.75 + Math.sin(this.time * 5) * 0.2})`;
    c.beginPath(); c.arc(z[0], z[1], Math.max(0, z[2]), 0, TAU); c.stroke();
    if (z[7] !== 2 && z[5] < z[2]) {
      c.setLineDash([22, 18]); c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.85)';
      c.beginPath(); c.arc(z[3], z[4], z[5], 0, TAU); c.stroke(); c.setLineDash([]);
    }

    // particles
    for (const p of this.parts) {
      const f = p.life / p.max;
      if (p.kind === 1) { c.globalAlpha = f; c.lineWidth = 6 * f + 1; c.strokeStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (1 - f * 0.8), 0, TAU); c.stroke(); }
      else if (p.kind === 2) { c.globalAlpha = f * 0.5; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (1.4 - f * 0.6), 0, TAU); c.fill(); }
      else { c.globalAlpha = Math.min(1, f * 2); c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + f * 0.6), 0, TAU); c.fill(); }
    }
    c.globalAlpha = 1;

    // labels
    c.textAlign = 'center'; c.lineJoin = 'round';
    for (const r of this.rps) {
      const info = this.roster.get(r.id);
      if (!info || r.x < x0 || r.x > x1 || r.y < y0 || r.y > y1) continue;
      const mate = info.team === this.myTeam && r.id !== this.view;
      const downed = (r.flags & F_DOWNED) !== 0;
      if (mate || (r.id === this.view && !this.controlling)) {
        c.font = '800 15px Nunito, system-ui, sans-serif';
        c.lineWidth = 4; c.strokeStyle = '#1d1a2b'; c.strokeText(info.name, r.x, r.y - 34);
        c.fillStyle = mate ? '#8df7ff' : '#ffffff'; c.fillText(info.name, r.x, r.y - 34);
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(r.x - 24, r.y - 29, 48, 5);
        c.fillStyle = downed ? '#ff5d6c' : '#69db7c'; c.fillRect(r.x - 24, r.y - 29, 48 * (downed ? r.dhp : r.hp) / 100, 5);
      }
      if (downed) {
        c.font = '900 13px Nunito, system-ui, sans-serif';
        c.lineWidth = 4; c.strokeStyle = '#1d1a2b'; c.strokeText(mate ? 'HELP!' : 'DOWN', r.x, r.y + 38);
        c.fillStyle = '#ff5d6c'; c.fillText(mate ? 'HELP!' : 'DOWN', r.x, r.y + 38);
      }
    }
    for (const d of this.nums) {
      c.globalAlpha = Math.min(1, d.life * 2.5);
      c.font = '900 20px Nunito, system-ui, sans-serif';
      c.lineWidth = 4; c.strokeStyle = '#1d1a2b'; c.strokeText(String(d.n), d.x, d.y);
      c.fillStyle = d.mine ? '#ff5d6c' : '#ffe066'; c.fillText(String(d.n), d.x, d.y);
    }
    c.globalAlpha = 1;

    // screen-space overlays
    c.setTransform(1, 0, 0, 1, 0, 0);
    const outside = Math.hypot(px - z[0], py - z[1]) > z[2];
    if (outside && this.phase === 'play') {
      const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8);
      g.addColorStop(0, 'rgba(150,60,220,0)'); g.addColorStop(1, `rgba(150,60,220,${0.35 + Math.sin(this.time * 6) * 0.1})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    if (this.hurtFlash > 0) {
      const g = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(1, `rgba(255,40,60,${this.hurtFlash * 0.45})`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    if (this.frame % 3 === 0 && this.mini) this.drawMap(this.mini, false);
  }

  /** Draws the island overview (minimap, big map and landing map share this). */
  drawMap(cv: HTMLCanvasElement, big: boolean): void {
    const c = cv.getContext('2d')!;
    const S = cv.width, k = S / (MAP_SIZE + MAP_PAD * 2);
    const tx = (v: number) => (v + MAP_PAD) * k;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.mapImage, 0, 0, S, S);
    const z = this.zone;
    if (this.phase !== 'drop') {
      c.beginPath(); c.rect(0, 0, S, S); c.arc(tx(z[0]), tx(z[1]), Math.max(0, z[2] * k), 0, TAU, true);
      c.fillStyle = 'rgba(150,60,220,0.42)'; c.fill('evenodd');
      c.lineWidth = big ? 3 : 2; c.strokeStyle = '#d68aff'; c.beginPath(); c.arc(tx(z[0]), tx(z[1]), Math.max(0, z[2] * k), 0, TAU); c.stroke();
      if (z[7] !== 2) { c.strokeStyle = '#ffffff'; c.setLineDash([5, 4]); c.beginPath(); c.arc(tx(z[3]), tx(z[4]), z[5] * k, 0, TAU); c.stroke(); c.setLineDash([]); }
    }
    if (big) {
      c.textAlign = 'center'; c.font = `800 ${Math.round(S / 46)}px Nunito, system-ui, sans-serif`; c.lineJoin = 'round';
      for (const l of this.map.locations) {
        c.lineWidth = 4; c.strokeStyle = 'rgba(29,26,43,.85)'; c.strokeText(l.name, tx(l.x), tx(l.y));
        c.fillStyle = '#fff'; c.fillText(l.name, tx(l.x), tx(l.y));
      }
    }
    const dot = (x: number, y: number, col: string, r: number, aim?: number) => {
      c.fillStyle = col; c.strokeStyle = '#1d1a2b'; c.lineWidth = 2;
      c.beginPath();
      if (aim === undefined) c.arc(tx(x), tx(y), r, 0, TAU);
      else { const a = aim; c.moveTo(tx(x) + Math.cos(a) * r * 1.7, tx(y) + Math.sin(a) * r * 1.7); c.lineTo(tx(x) + Math.cos(a + 2.5) * r * 1.2, tx(y) + Math.sin(a + 2.5) * r * 1.2); c.lineTo(tx(x) + Math.cos(a - 2.5) * r * 1.2, tx(y) + Math.sin(a - 2.5) * r * 1.2); c.closePath(); }
      c.fill(); c.stroke();
    };
    const r = big ? S / 90 : 4.5;
    if (this.phase === 'drop') {
      for (const d of this.drops) {
        const mine = d[0] === this.you;
        const x = tx(d[1]), y = tx(d[2]);
        c.strokeStyle = '#1d1a2b'; c.lineWidth = 5; c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); c.stroke();
        c.strokeStyle = mine ? '#ffe066' : '#8df7ff'; c.lineWidth = 3; c.stroke();
        c.beginPath(); c.arc(x, y, r * (1.8 + Math.sin(this.time * 5) * 0.3), 0, TAU); c.stroke();
      }
      return;
    }
    for (const p of this.rps) {
      const info = this.roster.get(p.id);
      if (!info || p.id === this.view || info.team !== (this.roster.get(this.view)?.team ?? -1)) continue;
      dot(p.x, p.y, '#8df7ff', r);
    }
    const v = this.rps.find((p) => p.id === this.view);
    if (v) dot(v.x, v.y, '#ffe066', r * 1.15, v.aim);
  }

  mapToWorld(fx: number, fy: number): { x: number; y: number } {
    return { x: fx * (MAP_SIZE + MAP_PAD * 2) - MAP_PAD, y: fy * (MAP_SIZE + MAP_PAD * 2) - MAP_PAD };
  }

  // ------------------------------------------------------------------ HUD bridge (10 Hz, keeps React out of the frame loop)
  private pushHud(force: boolean): void {
    const me = this.me;
    const v = this.rps.find((r) => r.id === this.view);
    let prompt: Prompt | null = null;
    if (this.controlling && v && me && !(v.flags & F_DOWNED)) {
      if (this.mode === 'duos') {
        for (const r of this.rps) {
          if (r.id !== this.you && r.flags & F_DOWNED && this.roster.get(r.id)?.team === this.myTeam && Math.hypot(r.x - v.x, r.y - v.y) < REVIVE_RANGE) { prompt = { kind: 'revive' }; break; }
        }
      }
      if (!prompt) {
        let best: Loot | null = null, bd = PICKUP_RANGE * PICKUP_RANGE;
        for (const l of this.loot.values()) { const d = (l.x - v.x) ** 2 + (l.y - v.y) ** 2; if (d < bd) { bd = d; best = l; } }
        if (best) {
          const full = me.w[0] !== null && me.w[1] !== null;
          prompt = { kind: 'loot', loot: best, current: best.kind === 'weapon' ? me.w[me.act] : null, swap: best.kind === 'weapon' && full };
        }
      }
    }
    const z = this.zone;
    const hud: Hud = {
      phase: this.phase, dropT: this.dropT,
      hp: v ? v.hp : 0, armor: v ? v.armor : 0, downed: !!v && (v.flags & F_DOWNED) !== 0, downedHp: v ? v.dhp : 0,
      w: me ? me.w : [null, null], act: me ? me.act : 0, ammo: me ? me.ammo : { light: 0, shells: 0, medium: 0, heavy: 0 },
      items: me ? me.items : { bandage: 0, medkit: 0, cell: 0, grenade: 0 },
      reload: me ? me.rl : 0, use: me ? me.use : null, useT: me ? me.ut : 0, dashCd: me ? me.dashCd : 0, rev: me ? me.rev : 0,
      alive: this.alive, kills: this.own.kills, zoneT: z[8], zonePhase: z[7], zoneStage: z[6],
      outside: !!v && Math.hypot(v.x - z[0], v.y - z[1]) > z[2],
      spectating: !this.own.alive && this.view !== this.you ? this.name(this.view) : null,
      dead: !this.own.alive, place: this.own.place, ping: 0, prompt, showMap: this.showMap,
    };
    void force;
    useStore.setState({ hud });
  }
}

function rnd(n: number): number { return (Math.random() * 2 - 1) * n; }
export { COLORS, DT, shade };
