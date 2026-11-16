import { useMemo } from 'react';
import { buildMap } from '../../../shared/map';
import { audio } from '../game/audio';
import { renderMapImage } from '../game/draw';
import { useStore } from '../store';

export function useBackdrop(): string {
  return useMemo(() => renderMapImage(buildMap(20260), 1000).toDataURL('image/jpeg', 0.8), []);
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
