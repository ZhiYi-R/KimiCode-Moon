/**
 * Main window creation.
 *
 * The window loads the local server origin with two decorations the web UI
 * already understands:
 *  - `?kimi_desktop=1&platform=<os>` — the desktop-mode signal consumed by
 *    `apps/kimi-web/src/lib/desktopFlag.ts` (persisted in sessionStorage);
 *  - `#token=<token>` — the persistent bearer token read from the fragment by
 *    `apps/kimi-web/src/api/daemon/serverAuth.ts`.
 *
 * Security posture: `contextIsolation` + `sandbox` on, `nodeIntegration` off,
 * no window.open — any link the web content opens (or navigates to) leaves
 * the local origin and is handed to the system browser.
 */

import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

// The Electron main process has no project logger; console is the standard
// sink here (visible when launched from a terminal, ignored otherwise).
// oxlint-disable no-console

export interface CreateMainWindowOptions {
  readonly origin: string;
  readonly token: string | undefined;
}

export function createMainWindow(opts: CreateMainWindowOptions): BrowserWindow {
  const { origin, token } = opts;

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    // macOS: hidden traffic lights; the web UI reserves space via
    // `isMacosDesktop` (desktopFlag.ts).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const desktopQuery = `kimi_desktop=1&platform=${process.platform}`;
  const url =
    token === undefined
      ? `${origin}/?${desktopQuery}`
      : `${origin}/?${desktopQuery}#token=${token}`;
  win.loadURL(url).catch((error: unknown) => {
    // Navigation failure surfaces here as well as via `did-fail-load`; log
    // instead of leaving an unhandled rejection (Electron would show a modal).
    console.error('[desktop] loadURL failed:', url, error);
  });

  // Popups (target=_blank etc.) and any navigation leaving the local server
  // go to the system browser; the app window itself never leaves the origin.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target).catch((error: unknown) => {
      console.error('[desktop] openExternal failed:', target, error);
    });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(origin)) {
      event.preventDefault();
      shell.openExternal(target).catch((error: unknown) => {
        console.error('[desktop] openExternal failed:', target, error);
      });
    }
  });

  win.once('ready-to-show', () => win.show());
  return win;
}
