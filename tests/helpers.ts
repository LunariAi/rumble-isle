import { collides, inWater, raycast } from '../shared/map';
import { Game, InputMsg, Player } from '../shared/sim';

/** A game already in the play phase with landed players and no loot lying around. */
export function makeGame(mode: 'solo' | 'duos', teams: number[], seed = 7): { g: Game; ps: Player[] } {
  const g = new Game({ seed, mode, dropTime: 0 });
  const ps = teams.map((t, i) => g.addPlayer('P' + i, 'bruno', '#fff', t, false));
  g.tick();
  for (const p of ps) p.landT = 0;
  g.loot.clear();
  g.events.length = 0;
  return { g, ps };
}

/** Finds an open, dry strip of ground of the given length (clear line of sight along +x). */
export function openStrip(g: Game, len: number): { x: number; y: number } {
  for (let y = 400; y < g.map.size - 400; y += 90) {
    for (let x = 400; x < g.map.size - 400 - len; x += 90) {
      let ok = raycast(g.map, x - 40, y, x + len + 40, y, false) > 1;
      for (let d = -40; ok && d <= len + 40; d += 20) ok = !collides(g.map, x + d, y, 45) && !inWater(g.map, x + d, y);
      if (ok) return { x, y };
    }
  }
  throw new Error('no open strip');
}

export function place(p: Player, x: number, y: number): void { p.x = x; p.y = y; }

let seq = 1;
export function inp(mx = 0, my = 0, aim = 0, btn = 0): InputMsg { return { seq: seq++, mx, my, aim, btn }; }

export function run(g: Game, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) { each?.(); g.tick(); }
}
