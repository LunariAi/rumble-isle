import { useMemo, useState } from 'react';
import { CHARACTERS, COLORS } from '../../../shared/config';
import { buildMap } from '../../../shared/map';
import { audio } from '../game/audio';
import { renderMapImage } from '../game/draw';
import { net } from '../net';
import { useStore } from '../store';
import { CharPortrait } from './bits';

export function useBackdrop(): string {
  return useMemo(() => renderMapImage(buildMap(20260), 1000).toDataURL('image/jpeg', 0.8), []);
}

export function Menu() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const connected = useStore((s) => s.connected);
  const [mode, setMode] = useState<'solo' | 'duos'>('solo');
  const [code, setCode] = useState('');
  const [settings, setSettings] = useState(false);
  const bg = useBackdrop();
  const update = (p: Parameters<typeof setProfile>[0]) => { setProfile(p); net.syncProfile(); audio.click(); };
  const who = CHARACTERS.find((c) => c.id === profile.char)!;

  return (
    <div className="screen menu" onMouseDown={() => audio.unlock()}>
      <div className="backdrop" style={{ backgroundImage: `url(${bg})` }} />
      <header className="topbar">
        <div className="logo"><span>RUMBLE</span><span className="logo2">ISLE</span></div>
        <button className="btn ghost" onClick={() => setSettings(true)}>⚙ Settings</button>
      </header>
      <main className="menu-grid">
        <section className="panel play">
          <h2>Play</h2>
          <div className="seg">
            <button className={mode === 'solo' ? 'on' : ''} onClick={() => { setMode('solo'); audio.click(); }}>Solo</button>
            <button className={mode === 'duos' ? 'on' : ''} onClick={() => { setMode('duos'); audio.click(); }}>Duos</button>
          </div>
          <p className="hint">{mode === 'solo' ? 'Every player for themselves. Last one standing wins.' : 'Teams of two. Knocked teammates can be revived.'}</p>
          <button className="btn big primary" disabled={!connected} onClick={() => net.quick(mode)}>PLAY</button>
          <div className="divider"><span>with friends</span></div>
          <button className="btn wide" disabled={!connected} onClick={() => net.create(mode)}>Create private lobby</button>
          <form className="join" onSubmit={(e) => { e.preventDefault(); if (code.trim()) net.join(code); }}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="CODE" aria-label="Invite code" />
            <button className="btn" disabled={!connected || code.trim().length < 5}>Join</button>
          </form>
          <p className="hint small">Your lobby is your party: everyone in it plays together and returns to it after each match.</p>
        </section>

        <section className="panel hero">
          <div className="hero-stage">
            <CharPortrait char={profile.char} color={profile.color} size={210} animate />
          </div>
          <h3>{who.name}</h3>
          <p className="hint">{who.blurb}</p>
          <input className="name" value={profile.name} maxLength={14} aria-label="Player name"
            onChange={(e) => setProfile({ name: e.target.value })} onBlur={() => net.syncProfile()} />
          <div className="stats">
            <div><b>{profile.matches}</b><span>Matches</span></div>
            <div><b>{profile.wins}</b><span>Wins</span></div>
            <div><b>{profile.kills}</b><span>Eliminations</span></div>
            <div><b>{profile.best ? '#' + profile.best : '–'}</b><span>Best place</span></div>
          </div>
        </section>

        <section className="panel locker">
          <h2>Locker</h2>
          <div className="chars">
            {CHARACTERS.map((c) => (
              <button key={c.id} className={'char' + (c.id === profile.char ? ' on' : '')} onClick={() => update({ char: c.id })} title={c.name}>
                <CharPortrait char={c.id} color={profile.color} size={68} />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
          <h4>Colour</h4>
          <div className="colors">
            {COLORS.map((c) => (
              <button key={c} className={'swatch' + (c === profile.color ? ' on' : '')} style={{ background: c }} onClick={() => update({ color: c })} aria-label={'Colour ' + c} />
            ))}
          </div>
          <p className="hint small">Cosmetics are visual only — every character plays the same.</p>
        </section>
      </main>
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const s = useStore((st) => st.settings);
  const set = useStore((st) => st.setSettings);
  const slider = (label: string, key: 'master' | 'sfx' | 'music') => (
    <label className="row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={s[key]} onChange={(e) => { set({ [key]: Number(e.target.value) }); }} onMouseUp={() => audio.pickup()} />
      <em>{Math.round(s[key] * 100)}</em>
    </label>
  );
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="panel modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        {slider('Master volume', 'master')}
        {slider('Effects', 'sfx')}
        {slider('Music', 'music')}
        <label className="row check"><span>Mute all sound</span><input type="checkbox" checked={s.muted} onChange={(e) => set({ muted: e.target.checked })} /></label>
        <label className="row check"><span>Screen shake</span><input type="checkbox" checked={s.shake} onChange={(e) => set({ shake: e.target.checked })} /></label>
        <h4>Controls</h4>
        <div className="keys">
          {[['WASD', 'Move'], ['Mouse', 'Aim'], ['Left click', 'Shoot'], ['R', 'Reload'], ['E', 'Pick up / hold to revive'], ['Space', 'Dash'], ['1 · 2 · Q', 'Switch weapon'],
            ['3 · 4 · 5', 'Bandage · Medkit · Shield'], ['G', 'Throw Boom Berry'], ['X', 'Drop weapon'], ['M / Tab', 'Map']].map(([k, v]) => (
            <div key={k}><kbd>{k}</kbd><span>{v}</span></div>
          ))}
        </div>
        <button className="btn primary wide" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
