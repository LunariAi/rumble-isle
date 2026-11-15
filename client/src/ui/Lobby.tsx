import { useState } from 'react';
import { MAX_PLAYERS } from '../../../shared/config';
import { audio } from '../game/audio';
import { net } from '../net';
import { useStore } from '../store';
import { CharPortrait } from './bits';
import { useBackdrop } from './Menu';

export function Lobby() {
  const room = useStore((s) => s.room);
  const [copied, setCopied] = useState(false);
  const bg = useBackdrop();
  if (!room) return null;
  const me = room.members.find((m) => m.id === room.you);
  const host = !!me?.host && !room.pub;
  const duos = room.settings.mode === 'duos';
  const link = `${location.origin}${location.pathname}?join=${room.code}`;
  const copy = () => {
    void navigator.clipboard?.writeText(link);
    setCopied(true); audio.pickup();
    setTimeout(() => setCopied(false), 1500);
  };
  const teams = duos ? Array.from({ length: Math.max(2, Math.ceil(room.members.length / 2) + 1) }, (_, i) => i + 1) : [];
  const total = Math.min(MAX_PLAYERS, room.members.length + room.settings.bots);

  return (
    <div className="screen lobby">
      <div className="backdrop" style={{ backgroundImage: `url(${bg})` }} />
      <header className="topbar">
        <div className="logo small"><span>RUMBLE</span><span className="logo2">ISLE</span></div>
        <button className="btn ghost" onClick={() => net.leave()}>← Leave lobby</button>
      </header>
      <main className="lobby-grid">
        <section className="panel">
          <h2>{room.pub ? 'Finding players…' : 'Private lobby'} <small>{duos ? 'Duos' : 'Solo'}</small></h2>
          {!room.pub && (
            <div className="invite">
              <div className="code" title="Invite code">{room.code}</div>
              <button className="btn" onClick={copy}>{copied ? 'Copied!' : 'Copy invite link'}</button>
            </div>
          )}
          {room.pub && <div className="countdown">Match starts in <b>{room.countdown ?? 0}</b>s — empty slots are filled with bots</div>}
          {!duos && (
            <div className="members">
              {room.members.map((m) => (
                <div key={m.id} className={'member' + (m.online ? '' : ' off') + (m.id === room.you ? ' you' : '')}>
                  <CharPortrait char={m.char} color={m.color} size={64} />
                  <span>{m.name}{m.host && !room.pub ? ' ★' : ''}</span>
                </div>
              ))}
            </div>
          )}
          {duos && (
            <div className="teams">
              {teams.map((t) => {
                const ms = room.members.filter((m) => m.team === t);
                return (
                  <div key={t} className={'team' + (me?.team === t ? ' mine' : '')}>
                    <h4>Team {t}</h4>
                    {ms.map((m) => (
                      <div key={m.id} className={'member row' + (m.online ? '' : ' off') + (m.id === room.you ? ' you' : '')}>
                        <CharPortrait char={m.char} color={m.color} size={44} /><span>{m.name}{m.host && !room.pub ? ' ★' : ''}</span>
                      </div>
                    ))}
                    {ms.length < 2 && me?.team !== t && <button className="btn small" onClick={() => net.team(t)}>Join team</button>}
                    {ms.length < 2 && me?.team === t && <div className="slot">Open slot — a bot fills in</div>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {!room.pub && (
          <section className="panel settings">
            <h2>Match settings</h2>
            <label>Mode</label>
            <div className="seg">
              {(['solo', 'duos'] as const).map((m) => <button key={m} disabled={!host} className={room.settings.mode === m ? 'on' : ''} onClick={() => net.settings({ mode: m })}>{m === 'solo' ? 'Solo' : 'Duos'}</button>)}
            </div>
            <label>Bots: {room.settings.bots} <em>({total} players total)</em></label>
            <input type="range" min={0} max={MAX_PLAYERS - 1} value={room.settings.bots} disabled={!host} onChange={(e) => net.settings({ bots: Number(e.target.value) })} />
            <label>Storm speed</label>
            <div className="seg">
              {(['slow', 'normal', 'fast'] as const).map((z) => <button key={z} disabled={!host} className={room.settings.zone === z ? 'on' : ''} onClick={() => net.settings({ zone: z })}>{z}</button>)}
            </div>
            {host
              ? <button className="btn big primary" onClick={() => net.start()}>START MATCH</button>
              : <p className="hint">Waiting for the host to start…</p>}
            {host && total < 2 && <p className="hint small">Solo practice: with no opponents the match runs until the storm gets you.</p>}
          </section>
        )}
      </main>
    </div>
  );
}
