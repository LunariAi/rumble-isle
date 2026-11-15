// Simple bot AI. Bots play through the same applyInput()/action() API as humans, so they obey every rule.
import { BUSH_REVEAL_DIST, ITEMS, MAX_ARMOR, WEAPONS } from './config';
import { raycast } from './map';
import { BTN_DASH, BTN_SHOOT, BTN_USE, Game, InputMsg, Loot, Player, angDiff } from './sim';

export interface BotBrain {
  gx: number; gy: number; goalT: number;
  enemy: number; react: number; aimErr: number; errT: number;
  strafe: number; strafeT: number;
  stuckX: number; stuckY: number; stuckT: number; sideT: number; side: number;
  seq: number; think: number; loot: number;
}

export function newBrain(): BotBrain {
  return { gx: 0, gy: 0, goalT: 0, enemy: -1, react: 0, aimErr: 0, errT: 0, strafe: 1, strafeT: 0, stuckX: 0, stuckY: 0, stuckT: 0, sideT: 0, side: 1, seq: 0, think: Math.floor(Math.random() * 6), loot: -1 };
}

const DT = 1 / 30;

function wantsLoot(p: Player, l: Loot): boolean {
  if (l.kind === 'weapon') return p.weapons[0] === null || p.weapons[1] === null;
  if (l.kind === 'ammo') return p.weapons.some((w) => w && WEAPONS[w.id].ammo === l.ammo) && p.ammo[l.ammo!] < 90;
  return p.items[l.item!] < Math.ceil(ITEMS[l.item!].max / 2);
}

export function botThink(g: Game, p: Player, b: BotBrain): InputMsg | null {
  if (!p.alive || g.phase !== 'play') return null;
  const inp: InputMsg = { seq: ++b.seq, mx: 0, my: 0, aim: p.aim, btn: 0 };
  if (p.landT > 0) return inp;
  const rnd = () => g.rng.next();
  const z = g.zone;

  // --- perception (throttled) ---
  if (--b.think <= 0) {
    b.think = 6;
    let best = -1, bd = 470 * 470;
    for (const q of g.players) {
      if (q === p || !q.alive || q.team === p.team || q.landT > 0) continue;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d > bd) continue;
      if (q.bush >= 0 && d > BUSH_REVEAL_DIST ** 2 && g.time - q.lastShot > 1.2) continue;
      if (q.downed && d > 300 * 300) continue;
      if (raycast(g.map, p.x, p.y, q.x, q.y) <= 1) continue;
      bd = d; best = q.id;
    }
    if (best !== b.enemy) { b.enemy = best; b.react = 0.55 + rnd() * 0.6; }
    // loot target
    b.loot = -1;
    let ld = 650 * 650;
    for (const l of g.loot.values()) {
      const d = (l.x - p.x) ** 2 + (l.y - p.y) ** 2;
      if (d < ld && wantsLoot(p, l) && (l.x - z.x) ** 2 + (l.y - z.y) ** 2 < z.r * z.r) { ld = d; b.loot = l.id; }
    }
  }

  if (p.downed) {
    const mate = g.players.find((q) => q.team === p.team && q.alive && !q.downed);
    if (mate) { const a = Math.atan2(mate.y - p.y, mate.x - p.x); inp.mx = Math.cos(a); inp.my = Math.sin(a); }
    return inp;
  }

  const w = p.weapons[p.active];
  const other = p.weapons[1 - p.active];
  const usable = (x: typeof w) => !!x && (x.mag > 0 || p.ammo[WEAPONS[x.id].ammo] > 0);
  if (!usable(w) && usable(other)) g.action(p.id, { t: 'slot', i: 1 - p.active });

  const enemy = b.enemy >= 0 ? g.byId.get(b.enemy) : undefined;
  const dz = Math.hypot(p.x - z.x, p.y - z.y);
  const outside = dz > z.r - 80;
  const mustRotate = z.phase !== 'done' && Math.hypot(p.x - z.nx, p.y - z.ny) > z.nr - 60 && (z.phase === 'shrink' || z.t < 25);
  let tx = b.gx, ty = b.gy, move = true;

  if (enemy && enemy.alive) {
    const dx = enemy.x - p.x, dy = enemy.y - p.y, d = Math.hypot(dx, dy);
    b.errT -= DT;
    if (b.errT <= 0) { b.errT = 0.35; b.aimErr = (rnd() + rnd() - 1) * 0.34; }
    const want = Math.atan2(dy, dx) + b.aimErr;
    inp.aim = p.aim + Math.max(-0.25, Math.min(0.25, angDiff(want, p.aim)));
    b.react -= DT;
    b.strafeT -= DT;
    if (b.strafeT <= 0) { b.strafeT = 0.5 + rnd() * 1.2; b.strafe = rnd() < 0.5 ? -1 : 1; }
    const armed = usable(p.weapons[p.active]);
    const def = w ? WEAPONS[w.id] : null;
    const ideal = !armed ? 20 : def!.cls === 'shotgun' ? 140 : def!.cls === 'smg' ? 230 : def!.cls === 'sniper' ? 520 : 340;
    if (armed || d < 170) {
      const toward = d > ideal + 40 ? 1 : d < ideal - 60 ? -1 : 0;
      const nx = dx / (d || 1), ny = dy / (d || 1);
      inp.mx = nx * toward - ny * b.strafe * (armed ? 0.8 : 0.2);
      inp.my = ny * toward + nx * b.strafe * (armed ? 0.8 : 0.2);
      move = false;
      const range = armed ? def!.range * 0.92 : 60;
      const burst = ((g.tickN + p.id * 17) % 48) < 26; // fire in bursts with pauses
      if (b.react <= 0 && burst && d < range && Math.abs(angDiff(want, inp.aim)) < 0.2) {
        if (armed && def!.auto) inp.btn |= BTN_SHOOT;
        else if (g.tickN % 2 === 0) inp.btn |= BTN_SHOOT;
      }
      if (armed && p.items.grenade > 0 && d > 200 && d < 460 && rnd() < 0.006) g.action(p.id, { t: 'nade', x: enemy.x, y: enemy.y });
      if (p.hp < 35 && p.dashCd <= 0 && rnd() < 0.05) inp.btn |= BTN_DASH;
    }
    if (outside || (mustRotate && z.phase === 'shrink')) { move = true; tx = z.nx; ty = z.ny; }
  } else {
    // out of combat: heal up, reload, revive
    if (!p.useItem) {
      if (p.hp < 60 && p.items.medkit > 0) g.action(p.id, { t: 'use', item: 'medkit' });
      else if (p.hp < 70 && p.items.bandage > 0) g.action(p.id, { t: 'use', item: 'bandage' });
      else if (p.armor < MAX_ARMOR - 30 && p.items.cell > 0) g.action(p.id, { t: 'use', item: 'cell' });
      else if (w && w.mag < WEAPONS[w.id].mag * 0.5 && p.reloadT <= 0) g.action(p.id, { t: 'reload' });
    }
    const downedMate = g.mode === 'duos' ? g.players.find((q) => q.team === p.team && q.downed && q.alive) : undefined;
    const lootTarget = b.loot >= 0 ? g.loot.get(b.loot) : undefined;
    if (outside || mustRotate) { tx = z.nx + (b.gx % 100) - 50; ty = z.ny + (b.gy % 100) - 50; }
    else if (downedMate) {
      tx = downedMate.x; ty = downedMate.y;
      if (Math.hypot(tx - p.x, ty - p.y) < 45) { inp.btn |= BTN_USE; move = false; }
    } else if (p.useItem) move = false;
    else if (lootTarget) {
      tx = lootTarget.x; ty = lootTarget.y;
      if (Math.hypot(tx - p.x, ty - p.y) < 40) g.action(p.id, { t: 'pickup' });
    } else {
      b.goalT -= DT;
      if (b.goalT <= 0 || Math.hypot(b.gx - p.x, b.gy - p.y) < 60) {
        b.goalT = 6 + rnd() * 6;
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * Math.max(100, Math.min(z.nr, 900));
        const cx = z.phase === 'done' ? z.x : z.nx, cy = z.phase === 'done' ? z.y : z.ny;
        // roam near where we are, but biased into the next circle
        b.gx = Math.max(100, Math.min(g.map.size - 100, (p.x + cx) / 2 + Math.cos(a) * r));
        b.gy = Math.max(100, Math.min(g.map.size - 100, (p.y + cy) / 2 + Math.sin(a) * r));
      }
      tx = b.gx; ty = b.gy;
    }
    if (move) inp.aim = p.aim + Math.max(-0.2, Math.min(0.2, angDiff(Math.atan2(ty - p.y, tx - p.x), p.aim)));
  }

  if (move) {
    const a = Math.atan2(ty - p.y, tx - p.x);
    inp.mx = Math.cos(a); inp.my = Math.sin(a);
  }
  // unstick: if we barely moved for half a second, slide sideways for a moment
  if (inp.mx !== 0 || inp.my !== 0) {
    b.stuckT += DT;
    if (b.stuckT >= 0.5) {
      if (Math.hypot(p.x - b.stuckX, p.y - b.stuckY) < 30 && b.sideT <= 0) { b.sideT = 0.5 + rnd() * 0.5; b.side = rnd() < 0.5 ? -1 : 1; }
      b.stuckT = 0; b.stuckX = p.x; b.stuckY = p.y;
    }
    if (b.sideT > 0) {
      b.sideT -= DT;
      const mx = inp.mx, my = inp.my;
      inp.mx = -my * b.side + mx * 0.25; inp.my = mx * b.side + my * 0.25;
    }
  }
  return inp;
}
