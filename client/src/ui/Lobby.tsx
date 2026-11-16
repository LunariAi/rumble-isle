import { useState } from 'react';
import { MAX_PLAYERS } from '../../../shared/config';
import type { Member } from '../../../shared/protocol';
import { audio } from '../game/audio';
import { net } from '../net';
import { useStore } from '../store';
import { CharPortrait } from './bits';
import { useBackdrop } from './Menu';

/** One standing spot on the lobby stage: a player, or an open spot with an action. */
function Spot({ m, you, big, host, label, onClick }: { m?: Member; you?: boolean; big?: boolean; host?: boolean; label?: string; onClick?: () => void }) {
  const size = big ? 132 : 92;
  if (!m) {
    return (
      <button className={'spot open' + (onClick ? '' : ' idle')} onClick={onClick} disabled={!onClick} style={{ width: size + 16 }}>
        <span className="plus" style={{ width: size * 0.62, height: size * 0.62 }}>{onClick ? '+' : ''}</span>
        <em>{label}</em>
      </button>
    );
  }
  return (
    <div className={'spot' + (you ? ' you' : '') + (m.online ? '' : ' off')} style={{ width: size + 16 }}>
      <div className="stand"><CharPortrait char={m.char} color={m.color} size={size} animate /></div>
      <em>{host ? '★ ' : ''}{m.name}</em>
      {you && <i>YOU</i>}
    </div>
  );
}

export function Lobby() {
  const room = useStore((s) => s.room);
  const [copied, setCopied] = useState(false);
  const bg = useBackdrop();
  if (!room) return null;
  const me = room.members.find((m) => m.id === room.you);
  const host = !!me?.host && !room.pub;
  const duos = room.settings.mode === 'duos';
  const link = `${location.origin}${location.pathname}?join=${room.code}`;
  const invite = () => {
    void navigator.clipboard?.writeText(link);
    setCopied(true); audio.pickup();
    setTimeout(() => setCopied(false), 1600);
  };
  const total = room.pub ? Math.max(14, room.members.length) : Math.min(MAX_PLAYERS, room.members.length + room.settings.bots);
  const isHost = (m: Member) => m.host && !room.pub;
  const canInvite = !room.pub && room.members.length < MAX_PLAYERS;
  const few = room.members.length <= 5;

  // solo: you in the middle, everyone else around you, then open invite spots
  const others = room.members.filter((m) => m.id !== room.you);
  const left = others.filter((_, i) => i % 2 === 0).reverse(), right = others.filter((_, i) => i % 2 === 1);
  const openSpots = canInvite ? Math.max(0, Math.min(2, 4 - others.length)) : 0;
  const teams = duos ? Array.from({ length: Math.min(MAX_PLAYERS / 2, Math.max(2, Math.ceil(room.members.length / 2) + 1)) }, (_, i) => i + 1) : [];

  return (
    <div className="screen lobby">
      <div className="backdrop" style={{ backgroundImage: `url(${bg})` }} />
      <header className="topbar">
        <div className="logo small"><span>RUMBLE</span><span className="logo2">ISLE</span></div>
        <div className="lobby-title">
          <b>{room.pub ? 'Finding players' : 'Private lobby'}</b>
          <span>{duos ? 'Duos' : 'Solo'} · {room.members.length} in lobby · {total} in match</span>
        </div>
        <button className="btn ghost" onClick={() => net.leave()}>← Leave</button>
      </header>

      <main className="stage-wrap">
        <div className="stage-ground" />
        {!duos && (
          <div className={'stage' + (few ? '' : ' dense')}>
            {openSpots > 1 && <Spot label={copied ? 'Link copied!' : 'Invite'} onClick={invite} />}
            {left.map((m) => <Spot key={m.id} m={m} host={isHost(m)} big={few} />)}
            {me && <Spot m={me} you host={isHost(me)} big />}
            {right.map((m) => <Spot key={m.id} m={m} host={isHost(m)} big={few} />)}
            {openSpots > 0 && <Spot label={copied ? 'Link copied!' : 'Invite'} onClick={invite} />}
          </div>
        )}
        {duos && (
          <div className="stage duo">
            {teams.map((t) => {
              const ms = room.members.filter((m) => m.team === t);
              const mine = me?.team === t;
              return (
                <div key={t} className={'pad' + (mine ? ' mine' : '')}>
                  <h4>Team {t}</h4>
                  <div className="pair">
                    {ms.map((m) => <Spot key={m.id} m={m} you={m.id === room.you} host={isHost(m)} big={mine} />)}
                    {ms.length < 2 && (mine
                      ? <Spot big label={canInvite ? (copied ? 'Link copied!' : 'Invite a friend') : 'A bot fills in'} onClick={canInvite ? invite : undefined} />
                      : <Spot label={ms.length ? 'Join team' : 'Take this team'} onClick={() => net.team(t)} />)}
                    {ms.length === 0 && <Spot label="Open" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="lobby-bar">
        {!room.pub && (
          <div className="bar-box invite-box">
            <span>Invite code</span>
            <div className="code" title="Invite code">{room.code}</div>
            <button className="btn small" onClick={invite}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
        )}
        {!room.pub && (
          <div className="bar-box settings">
            <div>
              <label>Mode</label>
              <div className="seg">
                {(['solo', 'duos'] as const).map((m) => <button key={m} disabled={!host} className={room.settings.mode === m ? 'on' : ''} onClick={() => net.settings({ mode: m })}>{m}</button>)}
              </div>
            </div>
            <div className="grow">
              <label>Bots: {room.settings.bots}</label>
              <input type="range" min={0} max={MAX_PLAYERS - 1} value={room.settings.bots} disabled={!host} onChange={(e) => net.settings({ bots: Number(e.target.value) })} />
            </div>
            <div>
              <label>Storm</label>
              <div className="seg">
                {(['slow', 'normal', 'fast'] as const).map((z) => <button key={z} disabled={!host} className={room.settings.zone === z ? 'on' : ''} onClick={() => net.settings({ zone: z })}>{z}</button>)}
              </div>
            </div>
          </div>
        )}
        {room.pub && <div className="bar-box wide-box">Empty slots are filled with bots, so the match always starts.</div>}
        <div className="go">
          {room.pub
            ? <div className="btn big primary waiting">Starting in <b>{room.countdown ?? 0}</b></div>
            : host
              ? <button className="btn big primary" onClick={() => net.start()}>BATTLE!</button>
              : <div className="btn big waiting">Waiting for host…</div>}
        </div>
      </footer>
    </div>
  );
}
