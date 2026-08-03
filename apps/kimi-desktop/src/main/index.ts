/**
 * Kimi Code desktop shell — Electron entry point.
 *
 * Lifecycle:
 *  1. single-instance lock (a second launch focuses the existing window);
 *  2. on app ready: start the in-process kap-server (ephemeral port, persistent
 *     bearer token under KIMI_CODE_HOME), then create the main window loading
 *     the local web UI;
 *  3. on quit: close the server first (`before-quit` → `close()`), so the
 *     home-dir locks and the instance registration are released cleanly.
 *
 * `KIMI_DESKTOP_SMOKE=1` runs a self-check instead of interactive use: boot,
 * load the page, print a JSON verdict to stdout, exit 0/1 (CI / local
 * verification; see scripts/smoke.mjs).
 */

// The Electron main process has no project logger; console is the standard
// sink here (visible when launched from a terminal, ignored otherwise).
// oxlint-disable no-console

import { app, dialog, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { getVersion, resolveDesktopHomeDir } from './identity';
import { startDesktopServer, type DesktopServer } from './server';
import { createMainWindow } from './window';

// Per-home user data: the single-instance lock keys off the userData dir, so
// instances running against different KIMI_CODE_HOMEs must not contend, and
// this app's caches never bleed into the CLI's home layout.
app.setPath('userData', join(resolveDesktopHomeDir(), 'desktop'));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Another instance owns the app; it will surface its window via
  // `second-instance`. Quit silently.
  app.quit();
}

// Surface main-process errors on stdout/stderr instead of Electron's default
// "A JavaScript error occurred in the main process" modal dialog.
process.on('uncaughtException', (error) => {
  console.error('[desktop] uncaughtException:', error);
});
process.on('unhandledRejection', (error) => {
  console.error('[desktop] unhandledRejection:', error);
});

let server: DesktopServer | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;

/**
 * Built web UI lives at `<app>/resources/web` in both dev and packaged runs
 * (`scripts/copy-web-assets.mjs` stages `apps/kimi-web/dist` there).
 */
function resolveWebAssetsDir(): string | undefined {
  const dir = join(app.getAppPath(), 'resources', 'web');
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

async function bootstrap(): Promise<void> {
  const version = getVersion();
  const homeDir = resolveDesktopHomeDir();
  const webAssetsDir = resolveWebAssetsDir();
  if (webAssetsDir === undefined) {
    console.warn(
      '[desktop] web assets not found at resources/web — starting API-only. Run `pnpm build:web` first.',
    );
  }
  server = await startDesktopServer({ homeDir, webAssetsDir, version });
  mainWindow = createMainWindow({ origin: server.origin, token: server.token });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  await runSmokeCheckIfRequested();
}

function openWindow(): void {
  if (mainWindow === undefined && server !== undefined) {
    mainWindow = createMainWindow({ origin: server.origin, token: server.token });
    mainWindow.on('closed', () => {
      mainWindow = undefined;
    });
  }
}

// The single-instance lock must be requested before app.whenReady; this
// promise chain is Electron's standard boot idiom, not a TLA candidate.
// oxlint-disable-next-line prefer-top-level-await
app.whenReady().then(() => {
  void bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[desktop] bootstrap failed:', error);
    if (process.env['KIMI_DESKTOP_SMOKE'] === '1') {
      // Smoke mode: no modal dialog (it would block CI); report and exit.
      console.log(JSON.stringify({ ok: false, reason: 'bootstrap-failed', error: message }));
      app.exit(1);
      return;
    }
    dialog.showErrorBox('Kimi Code failed to start', message);
    app.exit(1);
  });
});

app.on('second-instance', () => {
  if (mainWindow !== undefined) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// macOS convention: clicking the dock icon with no window open re-creates one.
app.on('activate', () => {
  openWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  // Close the in-process server before the app exits so home-dir locks and
  // the instance registration are released cleanly. Re-entrant via app.quit().
  if (quitting || server === undefined) return;
  event.preventDefault();
  quitting = true;
  void server
    .close()
    .catch((error: unknown) => console.error('[desktop] server close failed:', error))
    .finally(() => app.quit());
});

const SMOKE_TIMEOUT_MS = 30_000;

/** `KIMI_DESKTOP_SMOKE=1`: boot + page-load self-check, then exit. */
async function runSmokeCheckIfRequested(): Promise<void> {
  if (process.env['KIMI_DESKTOP_SMOKE'] !== '1' || mainWindow === undefined) return;
  const win = mainWindow;
  // `app.quit()` (not `app.exit()`) so `before-quit` runs and the in-process
  // server is closed cleanly: instance registration released, no stale files.
  const finish = (payload: Record<string, unknown>): void => {
    console.log(JSON.stringify({ ok: true, origin: server?.origin, ...payload }));
    app.quit();
  };
  const fail = (reason: string, extra?: Record<string, unknown>): void => {
    console.log(JSON.stringify({ ok: false, reason, ...extra }));
    app.quit();
  };
  const timeout = setTimeout(
    () => fail('timeout', { timeoutMs: SMOKE_TIMEOUT_MS }),
    SMOKE_TIMEOUT_MS,
  );

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    clearTimeout(timeout);
    fail('did-fail-load', { errorCode, errorDescription });
  });

  win.webContents.once('did-finish-load', () => {
    void win.webContents
      .executeJavaScript(
        `({ title: document.title, bodyLength: document.body ? document.body.innerText.length : 0, hasAppRoot: !!document.querySelector('#app') })`,
      )
      .then((result: { title: string; bodyLength: number; hasAppRoot: boolean }) => {
        clearTimeout(timeout);
        finish(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        fail('execute-javascript-failed', { error: String(error) });
      });
  });
}
