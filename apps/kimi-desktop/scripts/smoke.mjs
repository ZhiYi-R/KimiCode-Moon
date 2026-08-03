/**
 * Smoke-run the desktop app headlessly-ish: boot the in-process server, load
 * the web UI in a real window, then report `{ ok, title, bodyLength }` on
 * stdout and exit. Used by local verification and CI (Linux Xvfb).
 */

import { spawn } from 'node:child_process';

process.env.KIMI_DESKTOP_SMOKE = '1';

// `electron` resolves through node_modules/.bin (pnpm run adds it to PATH).
// Windows needs a shell to run the .cmd shim.
const child = spawn('electron', ['.'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(`failed to spawn electron: ${error.message}`);
  process.exit(1);
});
