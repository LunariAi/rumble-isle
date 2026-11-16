// Home screen: also the party/lobby screen. Everything shown here works in the game.
import { useEffect, useRef, useState } from 'react';
import { CHARACTERS, COLORS, MAX_PLAYERS } from '../../../shared/config';
import type { Member, RoomState } from '../../../shared/protocol';
import { audio } from '../game/audio';
import { net } from '../net';
import { useStore } from '../store';
import { CharPortrait } from './bits';
import { SettingsModal } from './Menu';

type Tab = 'play' | 'fighter' | 'profile';

const Svg = ({ d, size = 30 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);
const ICON = {
  play: 'M3 7l4.5 3.5L12 4l4.5 6.5L21 7l-2 11H5L3 7zm2 13h14v2H5v-2z',
  fighter: 'M12 2a5 5 0 110 10 5 5 0 010-10zm0 12c5 0 9 2.5 9 5.5V22H3v-2.5C3 16.5 7 14 12 14z',
  profile: 'M4 20h4V10H4v10zm6 0h4V4h-4v16zm6 0h4v-7h-4v7z',
  gear: 'M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 00-1.7-1l-.4-2.7h-4l-.4 2.7a7.4 7.4 0 00-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 001.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 001.7-1l2.5 1 2-3.5L19.4 13zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
  trophy: 'M6 3h12v2h3v3a5 5 0 01-5 5h-.3A6 6 0 0113 15.9V18h3v3H8v-3h3v-2.1A6 6 0 018.3 13H8a5 5 0 01-5-5V5h3V3zm0 4H5v1a3 3 0 001 2.2V7zm12 0v3.2A3 3 0 0019 8V7h-1z',
  skull: 'M12 2c5 0 9 3.6 9 8.5 0 2.6-1.2 4.4-3 5.5V20a2 2 0 01-2 2H8a2 2 0 01-2-2v-4C4.2 14.9 3 13.1 3 10.5 3 5.6 7 2 12 2zm-3.5 8a2 2 0 100 4 2 2 0 000-4zm7 0a2 2 0 100 4 2 2 0 000-4z',
};

export function Home() {
  const room = useStore((s) => s.room);
  const profile = useStore((s) => s.profile);
  const connected = useStore((s) => s.connected);
  const [tab, setTab] = useState<Tab>('play');
  const [mode, setMode] = useState<'solo' | 'duos'>('solo');
  const [settings, setSettings] = useState(false);
  const [matchCfg, setMatchCfg] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const copyWhenReady = useRef(false);

  const priv = !!room && !room.pub;
  const me = room?.members.find((m) => m.id === room.you);
  const host = priv && !!me?.host;
  const curMode = room ? room.settings.mode : mode;

  const copyLink = (r: RoomState) => {
    void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?join=${r.code}`).catch(() => {});
    setCopied(true); audio.pickup();
    setTimeout(() => setCopied(false), 1800);
  };
  useEffect(() => {
    if (room && !room.pub && copyWhenReady.current) { copyWhenReady.current = false; copyLink(room); }
  }, [room?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  // "+" next to your character: makes a private lobby (if needed) and copies its invite link
  const invite = () => {
    audio.unlock(); audio.click();
    if (priv) copyLink(room!);
    else if (!room) { copyWhenReady.current = true; net.create(mode); }
  };
  const toggleMode = () => {
    const next = curMode === 'solo' ? 'duos' : 'solo';
    if (host) net.settings({ mode: next });
    else if (!room) setMode(next);
    else return;
    audio.click();
  };
  const battle = () => {
    audio.unlock();
    if (host) net.start();
    else if (!room) net.quick(mode);
  };

  return (
    <div className="screen home" onMouseDown={() => audio.unlock()}>
      <div className="home-bg" />

      <nav className="rail">
        {([['play', 'Play'], ['fighter', 'Fighter'], ['profile', 'Profile']] as const).map(([t, label]) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); audio.click(); }}>
            <Svg d={ICON[t]} /><span>{label}</span>
          </button>
        ))}
      </nav>

      <header className="home-top">
        <button className="player-chip" onClick={() => setTab('profile')}>
          <span className="mini"><CharPortrait char={profile.char} color={profile.color} size={44} /></span>
          <span className="who"><b>{profile.name}</b><em><Svg d={ICON.trophy} size={15} /> {profile.wins} <Svg d={ICON.skull} size={15} /> {profile.kills}</em></span>
        </button>
        <button className="round-btn" onClick={() => setSettings(true)} aria-label="Settings"><Svg d={ICON.gear} size={26} /></button>
        <div className="top-mid">
          {priv && (
            <button className="code-chip" onClick={() => copyLink(room!)} title="Copy invite link">
              <span>Lobby code</span><b>{room!.code}</b><i>{copied ? 'Link copied!' : 'Copy link'}</i>
            </button>
          )}
          {room?.pub && <div className="code-chip queue"><span>Finding players</span><b>{room.countdown ?? 0}</b></div>}
        </div>
        {room && <button className="btn ghost leave" onClick={() => net.leave()}>{room.pub ? 'Cancel' : 'Leave lobby'}</button>}
      </header>

      {tab === 'play' && (
        <>
          <Party room={room} profile={profile} copied={copied} onInvite={invite} />

          {!room && (
            <form className="join-card" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 5) net.join(code); }}>
              <span>Join a friend</span>
              <div>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={5} placeholder="CODE" aria-label="Invite code" />
                <button className="btn small" disabled={!connected || code.trim().length < 5}>Join</button>
              </div>
            </form>
          )}

          <div className="play-dock">
            {!room && <button className="side-btn" disabled={!connected} onClick={() => net.create(mode)}><small>With friends</small>Private match</button>}
            {host && <button className="side-btn" onClick={() => setMatchCfg(true)}><small>Bots · Storm</small>Match settings</button>}
            <div className="dock-row">
              <button className="mode-btn" onClick={toggleMode} disabled={!!room && !host}>
                <small>Game mode</small><b>{curMode === 'solo' ? 'SOLO' : 'DUOS'}</b>
              </button>
              {room?.pub
                ? <button className="battle-btn waiting" disabled>Starting in {room.countdown ?? 0}</button>
                : priv && !host
                  ? <button className="battle-btn waiting" disabled>Waiting for host…</button>
                  : <button className="battle-btn" disabled={!connected} onClick={battle}>BATTLE</button>}
            </div>
          </div>
        </>
      )}

      {tab === 'fighter' && <FighterTab />}
      {tab === 'profile' && <ProfileTab />}

      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {matchCfg && room && <MatchSettings room={room} onClose={() => setMatchCfg(false)} />}
    </div>
  );
}

/** Your character in the middle, the rest of your lobby around you, "+" to invite. */
function Party({ room, profile, copied, onInvite }: { room: RoomState | null; profile: { name: string; char: string; color: string }; copied: boolean; onInvite: () => void }) {
  const me: Member = room?.members.find((m) => m.id === room.you) ?? { id: -1, name: profile.name, char: profile.char, color: profile.color, team: 0, bot: false, host: false, online: true };
  const priv = !!room && !room.pub;
  const full = !!room && room.members.length >= MAX_PLAYERS;
  const plus = (label: string) => (
    <button className="slot-plus" onClick={onInvite} disabled={full || !!room?.pub}>
      <span>+</span><em>{copied ? 'Link copied!' : label}</em>
    </button>
  );

  if (room && room.settings.mode === 'duos') {
    const mate = room.members.find((m) => m.team === me.team && m.id !== me.id);
    const teams = [...new Set(room.members.map((m) => m.team))].filter((t) => t !== me.team).sort((a, b) => a - b);
    let free = 1;
    while (room.members.some((m) => m.team === free)) free++;
    return (
      <main className="party">
        <div className="party-row">
          <Fighter m={me} big you />
          {mate ? <Fighter m={mate} big /> : priv ? plus('Invite teammate') : <div className="slot-plus idle"><span /><em>Teammate found in match</em></div>}
        </div>
        {priv && (teams.length > 0 || room.members.length > 1) && (
          <div className="team-strip">
            {teams.map((t) => {
              const ms = room.members.filter((m) => m.team === t);
              return (
                <div key={t} className="team-chip">
                  {ms.map((m) => <span key={m.id}><CharPortrait char={m.char} color={m.color} size={30} />{m.name}</span>)}
                  {ms.length < 2 && <button className="btn small" onClick={() => net.team(t)}>Join</button>}
                </div>
              );
            })}
            {mate && <button className="btn small" onClick={() => net.team(free)}>Switch team</button>}
          </div>
        )}
      </main>
    );
  }

  const others = room ? room.members.filter((m) => m.id !== me.id) : [];
  const shown = others.slice(0, 4);
  const left = shown.filter((_, i) => i % 2 === 1), right = shown.filter((_, i) => i % 2 === 0);
  return (
    <main className="party">
      <div className="party-row">
        {left.map((m) => <Fighter key={m.id} m={m} />)}
        <Fighter m={me} big you />
        {right.map((m) => <Fighter key={m.id} m={m} />)}
        {!room?.pub && plus(priv ? 'Invite' : 'Invite friends')}
      </div>
      {others.length > shown.length && <div className="more">+{others.length - shown.length} more in lobby</div>}
    </main>
  );
}

function Fighter({ m, big, you }: { m: Member; big?: boolean; you?: boolean }) {
  return (
    <div className={'fighter' + (big ? ' big' : '') + (m.online ? '' : ' off')}>
      <CharPortrait char={m.char} color={m.color} size={big ? 230 : 130} animate />
      <em className={you ? 'you' : ''}>{m.host ? '★ ' : ''}{m.name}</em>
    </div>
  );
}

function FighterTab() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const pick = (p: { char?: string; color?: string }) => { setProfile(p); net.syncProfile(); audio.click(); };
  const who = CHARACTERS.find((c) => c.id === profile.char)!;
  return (
    <main className="tab-page">
      <div className="fighter big"><CharPortrait char={profile.char} color={profile.color} size={260} animate /><em className="you">{who.name}</em><p>{who.blurb}</p></div>
      <section className="panel picker">
        <h2>Choose your fighter</h2>
        <div className="chars">
          {CHARACTERS.map((c) => (
            <button key={c.id} className={'char' + (c.id === profile.char ? ' on' : '')} onClick={() => pick({ char: c.id })}>
              <CharPortrait char={c.id} color={profile.color} size={72} /><span>{c.name}</span>
            </button>
          ))}
        </div>
        <h4>Colour</h4>
        <div className="colors">
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === profile.color ? ' on' : '')} style={{ background: c }} onClick={() => pick({ color: c })} aria-label={'Colour ' + c} />)}
        </div>
        <p className="hint small">Looks only — every fighter plays exactly the same.</p>
      </section>
    </main>
  );
}

function ProfileTab() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  return (
    <main className="tab-page">
      <div className="fighter big"><CharPortrait char={profile.char} color={profile.color} size={260} animate /></div>
      <section className="panel picker">
        <h2>Profile</h2>
        <label className="field">Player name
          <input value={profile.name} maxLength={14} onChange={(e) => setProfile({ name: e.target.value })} onBlur={() => net.syncProfile()} />
        </label>
        <div className="stats">
          <div><b>{profile.matches}</b><span>Matches</span></div>
          <div><b>{profile.wins}</b><span>Wins</span></div>
          <div><b>{profile.kills}</b><span>Eliminations</span></div>
          <div><b>{profile.best ? '#' + profile.best : '–'}</b><span>Best place</span></div>
        </div>
        <p className="hint small">Stats are saved in this browser.</p>
      </section>
    </main>
  );
}

function MatchSettings({ room, onClose }: { room: RoomState; onClose: () => void }) {
  const total = Math.min(MAX_PLAYERS, room.members.length + room.settings.bots);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="panel modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Match settings</h2>
        <label className="field">Bots: {room.settings.bots} <em>({total} players in the match)</em>
          <input type="range" min={0} max={MAX_PLAYERS - 1} value={room.settings.bots} onChange={(e) => net.settings({ bots: Number(e.target.value) })} />
        </label>
        <label className="field">Storm speed</label>
        <div className="seg">
          {(['slow', 'normal', 'fast'] as const).map((z) => <button key={z} className={room.settings.zone === z ? 'on' : ''} onClick={() => net.settings({ zone: z })}>{z}</button>)}
        </div>
        <button className="btn primary wide" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
