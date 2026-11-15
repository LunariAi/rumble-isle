import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { connect } from './net';
import './ui/styles.css';

connect();
createRoot(document.getElementById('root')!).render(<App />);
