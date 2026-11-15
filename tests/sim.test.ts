import { describe, expect, it } from 'vitest';
import { botThink, newBrain } from '../shared/bots';
import { DT, ITEMS, MAP_SIZE, PLAYER_RADIUS, PLAYER_SPEED, REVIVE_HP, REVIVE_TIME, WATER_SLOW, WEAPONS, ZONE_STAGES, weaponDamage } from '../shared/config';
import { buildMap, collides, inWater } from '../shared/map';
import { BTN_DASH, BTN_SHOOT, BTN_USE, Game } from '../shared/sim';
import { inp, makeGame, openStrip, place, run } from './helpers';

describe('map', () => {
  it('is deterministic for a seed and has all the content', () => {
    const a = buildMap(42), b = buildMap(42), c = buildMap(43);
    expect(JSON.stringify(a.obstacles)).toBe(JSON.stringify(b.obstacles));
    expect(JSON.stringify(a.obstacles)).not.toBe(JSON.stringify(c.obstacles));
    expect(a.locations.length).toBeGreaterThanOrEqual(8);
    expect(a.buildings.length).toBeGreaterThan(20);
    expect(a.lootSpots.length).toBeGreaterThan(150);
    expect(a.bushes.length).toBeGreaterThan(100);
  });
});

describe('movement and collision', () => {
  it('moves at walking speed and normalises oversized input (no speed hacks)', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    const s = openStrip(g, 400);
    place(p, s.x, s.y);
    for (let i = 0; i < 30; i++) g.applyInput(p.id, inp(1, 0));
    expect(p.x - s.x).toBeCloseTo(PLAYER_SPEED, 0);
    const x0 = p.x, y0 = p.y;
    g.applyInput(p.id, inp(1000, 1000));
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeCloseTo(PLAYER_SPEED * DT, 3);
  });

  it('cannot walk through walls, rocks or off the island', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    const b = g.map.buildings[0];
    // walk into the middle of the north wall segment from outside
    place(p, b.x + 30, b.y - 60);
    for (let i = 0; i < 60; i++) g.applyInput(p.id, inp(0, 1));
    expect(p.y).toBeLessThanOrEqual(b.y - PLAYER_RADIUS + 0.01);
    const rock = g.map.obstacles.find((o) => o.kind === 'rock')!;
    place(p, rock.x - rock.r - 60, rock.y);
    for (let i = 0; i < 90; i++) g.applyInput(p.id, inp(1, 0));
    expect(Math.hypot(p.x - rock.x, p.y - rock.y)).toBeGreaterThanOrEqual(rock.r + PLAYER_RADIUS - 0.01);
    place(p, 60, 60);
    for (let i = 0; i < 90; i++) g.applyInput(p.id, inp(-1, -1));
    expect(p.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
    expect(p.y).toBeGreaterThanOrEqual(PLAYER_RADIUS);
    expect(collides(g.map, p.x, p.y, PLAYER_RADIUS - 0.1)).toBe(false);
  });

  it('dash cannot tunnel through a wall', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    const b = g.map.buildings[0];
    place(p, b.x + 30, b.y - PLAYER_RADIUS - 1);
    g.applyInput(p.id, inp(0, 1, 0, BTN_DASH));
    for (let i = 0; i < 10; i++) g.applyInput(p.id, inp(0, 1));
    expect(p.y).toBeLessThan(b.y);
    expect(p.dashCd).toBeGreaterThan(0);
  });

  it('water slows movement', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    place(p, 1000, 3700);
    expect(inWater(g.map, p.x, p.y)).toBe(true);
    g.applyInput(p.id, inp(1, 0));
    expect(p.x - 1000).toBeCloseTo(PLAYER_SPEED * WATER_SLOW * DT, 3);
  });
});

describe('weapons', () => {
  const duel = (weapon: keyof typeof WEAPONS = 'bruiser', dist = 200) => {
    const r = makeGame('solo', [-1, -1]);
    const s = openStrip(r.g, dist + 100);
    place(r.ps[0], s.x, s.y); place(r.ps[1], s.x + dist, s.y);
    r.ps[0].weapons[0] = { id: weapon, rarity: 0, mag: WEAPONS[weapon].mag };
    return r;
  };

  it('bullets deal the configured damage and armor absorbs first', () => {
    const { g, ps: [a, b] } = duel();
    b.armor = 10;
    g.applyInput(a.id, inp(0, 0, 0, BTN_SHOOT));
    g.tick(); a.btn = 0;
    run(g, 12);
    const dmg = weaponDamage('bruiser', 0);
    expect(b.armor).toBe(0);
    expect(b.hp).toBeCloseTo(100 - (dmg - 10), 5);
    expect(a.damage).toBeCloseTo(dmg, 5);
    expect(g.bullets.length).toBe(0);
  });

  it('rarity scales damage', () => {
    expect(weaponDamage('ranger', 4)).toBeGreaterThan(weaponDamage('ranger', 0));
  });

  it('walls stop bullets', () => {
    const { g, ps: [a, b] } = makeGame('solo', [-1, -1]);
    const bd = g.map.buildings[0];
    place(a, bd.x + 30, bd.y - 60); place(b, bd.x + 30, bd.y + 60);
    a.weapons[0] = { id: 'bruiser', rarity: 0, mag: 5 };
    g.applyInput(a.id, inp(0, 0, Math.PI / 2, BTN_SHOOT));
    run(g, 15);
    expect(b.hp).toBe(100);
  });

  it('bullets expire at max range', () => {
    const { g, ps: [a, b] } = duel('scatter', WEAPONS.scatter.range + 200);
    g.applyInput(a.id, inp(0, 0, 0, BTN_SHOOT));
    g.tick(); a.btn = 0;
    run(g, 40);
    expect(b.hp).toBe(100);
    expect(g.bullets.length).toBe(0);
  });

  it('uses ammo, respects fire rate, reloads from reserve and cannot fire empty', () => {
    const { g, ps: [a] } = duel('popper', 5000 > MAP_SIZE ? 300 : 300);
    const w = a.weapons[0]!;
    w.mag = 2; a.ammo.light = 5;
    let shots = 0;
    const fireOnce = () => {
      g.applyInput(a.id, inp(0, 0, Math.PI, BTN_SHOOT)); g.tick();
      g.applyInput(a.id, inp(0, 0, Math.PI, 0)); g.tick();
      shots = g.events.filter((e) => e.e === 'shot').length;
    };
    fireOnce();
    expect(w.mag).toBe(1);
    fireOnce(); // still on cooldown: fire rate limits it
    expect(w.mag).toBe(1);
    run(g, 10);
    fireOnce();
    expect(w.mag).toBe(0);
    expect(shots).toBe(2);
    expect(a.reloadT).toBeGreaterThan(0); // auto reload on empty
    fireOnce();
    expect(shots).toBe(2); // cannot shoot while reloading
    run(g, Math.ceil(WEAPONS.popper.reload / DT) + 2);
    expect(w.mag).toBe(5);
    expect(a.ammo.light).toBe(0);
    w.mag = 0;
    run(g, 5);
    g.action(a.id, { t: 'reload' });
    expect(a.reloadT).toBe(0); // nothing left to reload with
    fireOnce();
    expect(shots).toBe(2);
  });

  it('semi-auto weapons need a fresh trigger pull, automatic ones do not', () => {
    const semi = duel('popper', 300), auto = duel('buzzer', 300);
    for (const [r, expected] of [[semi, 1], [auto, 5]] as const) {
      const a = r.ps[0];
      for (let i = 0; i < 30; i++) { r.g.applyInput(a.id, inp(0, 0, Math.PI, BTN_SHOOT)); r.g.tick(); }
      const n = r.g.events.filter((e) => e.e === 'shot').length;
      if (expected === 1) expect(n).toBe(1); else expect(n).toBeGreaterThan(expected);
    }
  });

  it('grenades damage enemies in the blast radius', () => {
    const { g, ps: [a, b] } = duel('popper', 300);
    a.items.grenade = 1;
    g.action(a.id, { t: 'nade', x: b.x, y: b.y });
    expect(a.items.grenade).toBe(0);
    run(g, 80);
    expect(b.hp).toBeLessThan(40);
    g.action(a.id, { t: 'nade', x: b.x, y: b.y });
    expect(g.nades.length).toBe(0);
  });
});

describe('loot and inventory', () => {
  it('picks up, swaps, drops weapons and caps item stacks', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    const s = openStrip(g, 300);
    place(p, s.x, s.y);
    g.addLoot({ kind: 'weapon', weapon: 'ranger', rarity: 1, n: 28 }, s.x + 45, s.y);
    g.action(p.id, { t: 'pickup' });
    expect(p.weapons[0]).toEqual({ id: 'ranger', rarity: 1, mag: 28 });
    g.addLoot({ kind: 'weapon', weapon: 'scatter', rarity: 0, n: 5 }, s.x + 45, s.y);
    g.action(p.id, { t: 'pickup' });
    expect(p.weapons[1]?.id).toBe('scatter');
    // both slots full: E swaps the active weapon and leaves the old one on the ground
    g.addLoot({ kind: 'weapon', weapon: 'longshot', rarity: 3, n: 4 }, s.x + 45, s.y);
    g.action(p.id, { t: 'pickup' });
    expect(p.weapons[0]?.id).toBe('longshot');
    expect([...g.loot.values()].some((l) => l.weapon === 'ranger' && l.n === 28)).toBe(true);
    g.action(p.id, { t: 'slot', i: 1 });
    expect(p.active).toBe(1);
    p.aim = Math.PI;
    g.action(p.id, { t: 'drop' });
    expect(p.weapons[1]).toBeNull();
    // out of reach: nothing happens
    g.loot.clear();
    g.addLoot({ kind: 'weapon', weapon: 'popper', rarity: 0, n: 12 }, s.x + 200, s.y);
    g.action(p.id, { t: 'pickup' });
    expect(p.weapons[1]).toBeNull();
    // stackables are collected by walking over them, up to the cap
    g.loot.clear();
    g.addLoot({ kind: 'ammo', ammo: 'medium', n: 30 }, s.x, s.y);
    g.addLoot({ kind: 'item', item: 'medkit', n: 5 }, s.x + 5, s.y);
    g.tick();
    expect(p.ammo.medium).toBe(30);
    expect(p.items.medkit).toBe(ITEMS.medkit.max);
    expect([...g.loot.values()].find((l) => l.item === 'medkit')?.n).toBe(5 - ITEMS.medkit.max);
  });

  it('healing items take time, heal and are consumed', () => {
    const { g, ps: [p] } = makeGame('solo', [-1]);
    p.hp = 40; p.items.bandage = 1; p.items.cell = 1;
    g.action(p.id, { t: 'use', item: 'bandage' });
    run(g, 30);
    expect(p.hp).toBe(40);
    run(g, 35);
    expect(p.hp).toBe(60);
    expect(p.items.bandage).toBe(0);
    g.action(p.id, { t: 'use', item: 'bandage' });
    expect(p.useItem).toBeNull();
    g.action(p.id, { t: 'use', item: 'cell' });
    run(g, 80);
    expect(p.armor).toBe(ITEMS.cell.armor);
  });

  it('eliminated players drop their inventory', () => {
    const { g, ps: [a, b] } = makeGame('solo', [-1, -1, -1]);
    b.weapons[0] = { id: 'buzzer', rarity: 2, mag: 10 }; b.ammo.light = 44; b.items.cell = 2;
    g.damage(b, 500, a.id, 'popper');
    const drops = [...g.loot.values()];
    expect(drops.some((l) => l.weapon === 'buzzer' && l.rarity === 2)).toBe(true);
    expect(drops.some((l) => l.ammo === 'light' && l.n === 44)).toBe(true);
    expect(drops.some((l) => l.item === 'cell' && l.n === 2)).toBe(true);
  });
});

describe('safe zone', () => {
  it('shrinks through its stages and hurts players outside, ignoring armor', () => {
    const { g, ps: [a, b] } = makeGame('solo', [-1, -1]);
    expect(g.zone.phase).toBe('wait');
    const r0 = g.zone.r;
    place(a, g.zone.nx, g.zone.ny);
    place(b, 100, 100);
    g.zone.t = 0.01;
    g.tick();
    expect(g.zone.phase).toBe('shrink');
    run(g, Math.ceil(ZONE_STAGES[0].shrink / DT) + 5);
    expect(g.zone.stage).toBe(1);
    expect(g.zone.r).toBeLessThan(r0);
    expect(g.zone.r).toBeCloseTo(ZONE_STAGES[0].radius * MAP_SIZE / 2, 0);
    b.armor = 50; b.hp = 100; a.hp = 100;
    place(b, g.zone.x + g.zone.r + 300, g.zone.y);
    run(g, 90);
    expect(b.hp).toBeLessThan(100);
    expect(b.armor).toBe(50);
    expect(a.hp).toBe(100);
  });
});

describe('elimination and victory', () => {
  it('last player standing wins and placements are assigned', () => {
    const { g, ps: [a, b, c] } = makeGame('solo', [-1, -1, -1]);
    g.damage(c, 999, a.id, 'popper');
    expect(c.alive).toBe(false);
    expect(c.place).toBe(3);
    expect(g.phase).toBe('play');
    g.damage(b, 999, a.id, 'popper');
    expect(b.place).toBe(2);
    expect(a.place).toBe(1);
    expect(a.kills).toBe(2);
    expect(g.phase).toBe('over');
    expect(g.winnerTeam).toBe(a.team);
    expect(g.events.filter((e) => e.e === 'kill').length).toBe(2);
  });

  it('landing players are invulnerable and dead players cannot act', () => {
    const { g, ps: [a, b, c] } = makeGame('solo', [-1, -1, -1]);
    b.landT = 1;
    g.damage(b, 50, a.id, 'popper');
    expect(b.hp).toBe(100);
    g.damage(c, 999, a.id, 'popper');
    const x = c.x;
    g.applyInput(c.id, inp(1, 0, 0, BTN_SHOOT));
    g.action(c.id, { t: 'pickup' });
    expect(c.x).toBe(x);
  });
});

describe('duos', () => {
  it('no friendly fire; knocked players can be revived; a full knock wipes the team', () => {
    const { g, ps: [a1, a2, b1, b2] } = makeGame('duos', [1, 1, 2, 2]);
    const s = openStrip(g, 300);
    place(a1, s.x, s.y); place(a2, s.x + 40, s.y); place(b1, s.x + 250, s.y); place(b2, s.x + 290, s.y);
    g.damage(a2, 60, a1.id, 'popper');
    expect(a2.hp).toBe(100);
    g.damage(a2, 150, b1.id, 'popper');
    expect(a2.downed).toBe(true);
    expect(a2.alive).toBe(true);
    expect(b1.kills).toBe(0);
    // revive by holding interact next to the teammate
    run(g, Math.ceil(REVIVE_TIME / DT) + 3, () => g.applyInput(a1.id, inp(0, 0, 0, BTN_USE)));
    expect(a2.downed).toBe(false);
    expect(a2.hp).toBe(REVIVE_HP);
    // knock both: the second knock eliminates the whole team
    g.damage(a2, 150, b1.id, 'popper');
    expect(a2.downed).toBe(true);
    g.damage(a1, 150, b2.id, 'popper');
    expect(a1.alive).toBe(false);
    expect(a2.alive).toBe(false);
    expect(g.phase).toBe('over');
    expect(g.winnerTeam).toBe(2);
    expect(b1.place).toBe(1); expect(b2.place).toBe(1);
    expect(a1.place).toBe(2); expect(a2.place).toBe(2);
  });

  it('a knocked player bleeds out', () => {
    const { g, ps: [a1, a2, b1] } = makeGame('duos', [1, 1, 2, 2]);
    place(a1, 2000, 1500); place(a2, 3000, 1500);
    g.damage(a2, 150, b1.id, 'popper');
    run(g, 30 * 30);
    expect(a2.alive).toBe(false);
    expect(a1.alive).toBe(true);
    expect(b1.kills).toBe(1);
  });
});

describe('full simulated matches', () => {
  for (const mode of ['solo', 'duos'] as const) {
    it(`16 bots play a complete ${mode} match to a single winner`, () => {
      const g = new Game({ seed: mode === 'solo' ? 11 : 12, mode, zoneScale: 0.5, dropTime: 1 });
      const brains = new Map<number, ReturnType<typeof newBrain>>();
      for (let i = 0; i < 16; i++) {
        const p = g.addPlayer('Bot' + i, 'bruno', '#fff', mode === 'duos' ? 1 + Math.floor(i / 2) : -1, true);
        brains.set(p.id, newBrain());
      }
      let ticks = 0, shots = 0, pickups = 0;
      while (g.phase !== 'over' && ticks < 30 * 60 * 8) {
        for (const p of g.players) { const i = botThink(g, p, brains.get(p.id)!); if (i) g.applyInput(p.id, i); }
        g.tick(); ticks++;
        for (const e of g.events) { if (e.e === 'shot') shots++; if (e.e === 'loot-') pickups++; }
        g.events.length = 0;
        for (const p of g.players) {
          expect(p.hp).toBeLessThanOrEqual(100);
          if (p.alive && p.landT <= 0) expect(collides(g.map, p.x, p.y, PLAYER_RADIUS - 5)).toBe(false);
        }
      }
      expect(g.phase).toBe('over');
      const winners = g.players.filter((p) => p.place === 1);
      expect(winners.length).toBeGreaterThanOrEqual(g.winnerTeam >= 0 ? 1 : 0);
      expect(new Set(winners.map((p) => p.team)).size).toBeLessThanOrEqual(1);
      expect(g.players.every((p) => p.place >= 1)).toBe(true);
      expect(shots).toBeGreaterThan(50);
      expect(pickups).toBeGreaterThan(20);
      expect(g.players.reduce((n, p) => n + p.kills, 0)).toBeGreaterThan(3);
      console.log(`${mode}: ${(g.time / 60).toFixed(1)} min, ${shots} shots, ${pickups} pickups, kills ${g.players.map((p) => p.kills).join(',')}`);
    });
  }
});
