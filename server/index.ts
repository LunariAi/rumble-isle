import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
// built: dist/server.js sits next to dist/client. dev (tsx): serve the last build if there is one; Vite serves the live client.
const staticDir = path.basename(here) === 'dist' ? path.join(here, 'client') : path.join(here, '../dist/client');
startServer(Number(process.env.PORT) || 3000, staticDir).then((s) => {
  console.log(`Rumble Isle server listening on http://localhost:${s.port}`);
});
