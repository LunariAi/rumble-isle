import { useEffect, useRef, useState } from 'react';
import { AMMO_COLORS, AMMO_NAMES, DASH_COOLDOWN, ITEMS, ITEM_IDS, ItemId, RARITIES, REVIVE_TIME, WEAPONS, WeaponId, weaponDamage } from '../../../shared/config';
import { drawAmmoIcon, drawItemIcon, drawWeaponIcon } from '../game/draw';
import { game, net } from '../net';
import { Prompt, useStore } from '../store';
import { Icon } from './bits';
import { SettingsModal } from './Menu';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const ITEM_KEYS: Record<ItemId, string> = { bandage: '3', medkit: '4', cell: '5', grenade: 'G' };

export function GameScreen() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const start = useStore((s) => s.start);
  useEffect(() => {
    if (!game || !canvas.current || !mini.current) return;
    game.attach(canvas.current, mini.current);
    const g = game;
    return () => g.destroy();
  }, [start]);
  return (
    <div className="screen game">
      <canvas ref={canvas} className="world" />
      <Hud mini={mini} />
    </div>
  );
}

function Hud({ mini }: { mini: React.RefObject<HTMLCanvasElement | null> }) {
  const h = useStore((s) => s.hud);
  const feed = useStore((s) => s.feed);
  const banner = useStore((s) => s.banner);
  const result = useStore((s) => s.result);
  const start = useStore((s) => s.start);
  const total = start?.roster.length ?? 0;
  const [settings, setSettings] = useState(false);
  const active = h.w[h.act];
  const def = active ? WEAPONS[active[0]] : null;
  const playing = h.phase === 'play' && !result;
  const progress = h.reload > 0 && def ? { label: 'Reloading', f: 1 - h.reload / def.reload }
    : h.use ? { label: 'Using ' + ITEMS[h.use].name, f: 1 - h.useT / ITEMS[h.use].useTime }
    : h.rev > 0 ? { label: 'Reviving', f: h.rev / REVIVE_TIME } : null;

  return (
    <div className="hud">
      <div className={'minimap' + (playing ? '' : ' hidden')}>
        <canvas ref={mini} width={380} height={380} />
        <div className={'zone-timer' + (h.zonePhase === 1 ? ' warn' : '')}>
          {h.zonePhase === 0 ? `Storm moves in ${fmt(h.zoneT)}` : h.zonePhase === 1 ? `Storm closing ${fmt(h.zoneT)}` : 'Final circle'}
        </div>
      </div>

      {playing && (
        <div className="top-center">
          <div className="pill"><b>{h.alive}</b> alive</div>
          <div className="pill"><b>{h.kills}</b> elims</div>
        </div>
      )}
      {banner && playing && <div className="banner" key={banner.id}><b>{banner.text}</b>{banner.sub && <span>{banner.sub}</span>}</div>}

      <div className="feed">
        {feed.map((f) => (
          <div key={f.id} className={'feed-item' + (f.mine ? ' mine' : '')}>
            {f.killer ? <><b>{f.killer}</b> {f.down ? 'knocked' : 'eliminated'} <b>{f.victim}</b> <i>{f.weapon}</i></>
              : <><b>{f.victim}</b> {f.down ? 'was knocked by' : 'was eliminated by'} <i>{f.weapon}</i></>}
          </div>
        ))}
      </div>

      {playing && h.outside && !h.dead && <div className="storm-warn">You are in the storm — get to the circle!</div>}

      {playing && !h.dead && (
        <>
          {h.prompt && <PromptCard p={h.prompt} />}
          {progress && <div className="progress"><span>{progress.label}</span><div><i style={{ width: `${Math.max(0, Math.min(1, progress.f)) * 100}%` }} /></div></div>}
          <div className="bottom">
            <div className="vitals">
              <div className="bar armor"><i style={{ width: `${h.armor}%` }} /><span>{h.armor}</span></div>
              <div className={'bar hp' + (h.downed ? ' downed' : h.hp <= 30 ? ' low' : '')}>
                <i style={{ width: `${h.downed ? h.downedHp : h.hp}%` }} /><span>{h.downed ? 'DOWNED' : h.hp}</span>
              </div>
            </div>
            <div className="slots">
              {[0, 1].map((i) => {
                const w = h.w[i];
                return (
                  <div key={i} className={'slot weapon' + (i === h.act ? ' on' : '')} style={w ? { borderColor: RARITIES[w[1]].color } : undefined}>
                    <kbd>{i + 1}</kbd>
                    {w ? <>
                      <Icon w={84} h={34} deps={[w[0]]} draw={(c) => drawWeaponIcon(c, w[0], 1.5)} />
                      <span className="wname">{WEAPONS[w[0]].name}</span>
                      <span className="ammo"><b>{w[2]}</b> / {h.ammo[WEAPONS[w[0]].ammo]}</span>
                    </> : <span className="empty">{i === h.act ? 'Fists' : 'Empty'}</span>}
                  </div>
                );
              })}
              {ITEM_IDS.map((id) => (
                <div key={id} className={'slot item' + (h.items[id] ? '' : ' none') + (h.use === id ? ' on' : '')}>
                  <kbd>{ITEM_KEYS[id]}</kbd>
                  <Icon w={34} h={34} deps={[id]} draw={(c) => drawItemIcon(c, id, 1.25)} />
                  <b>{h.items[id]}</b>
                </div>
              ))}
              <div className={'slot item dash' + (h.dashCd > 0 ? ' none' : '')}>
                <kbd>Space</kbd><span className="dash-label">Dash</span>
                {h.dashCd > 0 && <i style={{ height: `${(h.dashCd / DASH_COOLDOWN) * 100}%` }} />}
              </div>
            </div>
          </div>
        </>
      )}

      {h.phase === 'drop' && !result && <DropOverlay t={h.dropT} />}
      {h.showMap && playing && <div className="bigmap"><MapCanvas size={Math.min(window.innerHeight * 0.8, 760)} /></div>}
      {playing && h.dead && (
        <div className="dead panel">
          <h3>You placed <b>#{h.place || '?'}</b> <small>of {total}</small></h3>
          {h.spectating ? <p>Spectating <b>{h.spectating}</b> — click or ←/→ to switch</p> : <p>Waiting for the match to finish…</p>}
          <button className="btn" onClick={() => net.leave()}>Leave match</button>
        </div>
      )}
      {playing && (
        <div className="corner">
          <button className="btn ghost" onClick={() => setSettings(true)}>⚙</button>
          {!h.dead && <button className="btn ghost" onClick={() => { if (confirm('Leave the match? You will be eliminated.')) net.leave(); }}>Quit</button>}
        </div>
      )}
      {settings && <div className="over-hud"><SettingsModal onClose={() => setSettings(false)} /></div>}
      {result && <EndScreen />}
    </div>
  );
}

function PromptCard({ p }: { p: Prompt }) {
  if (p.kind === 'revive') return <div className="prompt"><kbd>E</kbd> Hold to revive teammate</div>;
  const l = p.loot!;
  if (l.kind !== 'weapon') {
    return (
      <div className="prompt">
        <Icon w={30} h={30} deps={[l.id]} draw={(c) => (l.kind === 'ammo' ? drawAmmoIcon(c, l.ammo!, 1.2) : drawItemIcon(c, l.item!, 1.2))} />
        <span style={{ color: l.kind === 'ammo' ? AMMO_COLORS[l.ammo!] : ITEMS[l.item!].color }}>{l.kind === 'ammo' ? AMMO_NAMES[l.ammo!] : ITEMS[l.item!].name} ×{l.n}</span>
        {l.kind === 'item' && <em>inventory full</em>}
      </div>
    );
  }
  const d = WEAPONS[l.weapon!], cur = p.current ? WEAPONS[p.current[0]] : null;
  const rows: [string, number, number | null, boolean][] = [
    ['Damage', weaponDamage(l.weapon!, l.rarity!) * d.pellets, cur ? weaponDamage(p.current![0] as WeaponId, p.current![1]) * cur.pellets : null, true],
    ['Shots / sec', +(1 / d.fireRate).toFixed(1), cur ? +(1 / cur.fireRate).toFixed(1) : null, true],
    ['Magazine', d.mag, cur ? cur.mag : null, true],
    ['Range', d.range, cur ? cur.range : null, true],
    ['Reload', d.reload, cur ? cur.reload : null, false],
  ];
  return (
    <div className="prompt card" style={{ borderColor: RARITIES[l.rarity!].color }}>
      <div className="card-head">
        <Icon w={70} h={30} deps={[l.id]} draw={(c) => drawWeaponIcon(c, l.weapon!, 1.3)} />
        <div><b>{d.name}</b><span style={{ color: RARITIES[l.rarity!].color }}>{RARITIES[l.rarity!].name} {d.cls}</span></div>
      </div>
      <table>
        <tbody>
          {rows.map(([name, v, c, higherBetter]) => {
            const diff = c === null ? 0 : (v - c) * (higherBetter ? 1 : -1);
            return <tr key={name}><td>{name}</td><td>{Math.round(v * 10) / 10}</td><td className={diff > 0.001 ? 'up' : diff < -0.001 ? 'down' : ''}>{c === null ? '' : diff > 0.001 ? '▲' : diff < -0.001 ? '▼' : '='}</td></tr>;
          })}
        </tbody>
      </table>
      <div className="card-foot"><kbd>E</kbd> {p.swap ? `Swap for ${cur?.name}` : 'Pick up'}</div>
    </div>
  );
}

function MapCanvas({ size, pick }: { size: number; pick?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (game && ref.current) game.drawMap(ref.current, true); };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  const px = Math.round(size);
  return (
    <canvas ref={ref} width={px * 1.5} height={px * 1.5} style={{ width: px, height: px, cursor: pick ? 'crosshair' : 'default' }}
      onMouseDown={(e) => {
        if (!pick || !game) return;
        const r = e.currentTarget.getBoundingClientRect();
        const w = game.mapToWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        game.setDrop(w.x, w.y);
      }} />
  );
}

function DropOverlay({ t }: { t: number }) {
  return (
    <div className="drop">
      <div className="panel drop-panel">
        <h2>Choose where to land <b>{Math.ceil(t)}</b></h2>
        <MapCanvas size={Math.min(window.innerHeight * 0.72, window.innerWidth * 0.6, 720)} pick />
        <p className="hint">Click the map to set your landing spot. Towns and the docks have the best loot — and the most company.</p>
      </div>
    </div>
  );
}

function EndScreen() {
  const result = useStore((s) => s.result)!;
  const start = useStore((s) => s.start)!;
  const room = useStore((s) => s.room);
  const me = result.rows.find((r) => r.id === start.you);
  const names = new Map(start.roster.map((r) => [r.id, r]));
  const teams = new Set(start.roster.map((r) => r.team)).size;
  const won = me?.place === 1;
  const sorted = [...result.rows].sort((a, b) => a.place - b.place || b.kills - a.kills);
  const rows = sorted.slice(0, 8);
  if (me && !rows.includes(me)) rows[7] = me;
  return (
    <div className="end">
      <div className={'panel end-panel' + (won ? ' won' : '')}>
        <h1>{won ? 'VICTORY!' : 'DEFEATED'}</h1>
        <p className="sub">{won ? 'Last one standing on Rumble Isle' : 'Better luck next drop'}</p>
        <div className="stats big">
          <div><b>#{me?.place ?? '–'}</b><span>Placement of {teams}</span></div>
          <div><b>{me?.kills ?? 0}</b><span>Eliminations</span></div>
          <div><b>{me?.dmg ?? 0}</b><span>Damage dealt</span></div>
          <div><b>{fmt(me?.survived ?? 0)}</b><span>Survived</span></div>
        </div>
        <table className="board">
          <thead><tr><th>#</th><th>Player</th><th>Elims</th><th>Damage</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.id === start.you ? 'you' : ''}>
                <td>{r.place}</td><td>{names.get(r.id)?.name}{names.get(r.id)?.bot ? ' (bot)' : ''}</td><td>{r.kills}</td><td>{r.dmg}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="end-actions">
          <button className="btn big primary" onClick={() => net.afterMatch(true)}>{room ? 'Back to lobby' : 'Play again'}</button>
          <button className="btn" onClick={() => (room ? net.leave() : net.afterMatch(false))}>Main menu</button>
        </div>
      </div>
    </div>
  );
}
