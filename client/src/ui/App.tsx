import { useStore } from '../store';
import { GameScreen } from './Game';
import { Lobby } from './Lobby';
import { Menu } from './Menu';

export function App() {
  const screen = useStore((s) => s.screen);
  const connected = useStore((s) => s.connected);
  const toast = useStore((s) => s.toast);
  return (
    <>
      {screen === 'menu' && <Menu />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <GameScreen />}
      {toast && <div className="toast">{toast}</div>}
      {!connected && <div className="conn">Connecting to server…</div>}
    </>
  );
}
