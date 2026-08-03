/**
 * In-process kap-server for the desktop shell.
 *
 * Mirrors what `kimi web` does (same `startServer`, same persistent
 * `server.token`, same `webAssetsDir` contract) with three differences suited
 * to an embedded host:
 *  - ephemeral port (`port: 0`): the kernel picks a free port, so the shell
 *    never contends with other kimi instances sharing the home dir, and the
 *    instance registry records the actually-bound port;
 *  - no signal/exit wiring: the server's lifetime is bound to the Electron
 *    app lifecycle (`before-quit` → `close()`), not to SIGINT/process.exit;
 *  - the ready banner/token printing is skipped — the token travels straight
 *    into the window URL fragment.
 */

import {
  startServer,
  type ServerLogLevel,
  type ServerStartOptions,
} from '@moonshot-ai/kap-server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DESKTOP_PLATFORM,
  DESKTOP_PRODUCT_NAME,
  DESKTOP_USER_AGENT_SUFFIX,
} from './identity';

/** Filename (under KIMI_CODE_HOME) of the persistent server bearer token. */
export const SERVER_TOKEN_FILE = 'server.token';

export interface DesktopServer {
  /** `http://127.0.0.1:<port>` — the origin the window loads. */
  readonly origin: string;
  /** Persistent bearer token (written by the server on first boot), if readable. */
  readonly token: string | undefined;
  close(): Promise<void>;
}

export interface StartDesktopServerOptions {
  readonly homeDir: string;
  /** Built Kimi web UI directory; omitted to run API-only. */
  readonly webAssetsDir?: string;
  readonly version: string;
}

export async function startDesktopServer(
  opts: StartDesktopServerOptions,
): Promise<DesktopServer> {
  const serverOptions: ServerStartOptions = {
    host: '127.0.0.1',
    port: 0,
    homeDir: opts.homeDir,
    hostIdentity: {
      productName: DESKTOP_PRODUCT_NAME,
      version: opts.version,
      platform: DESKTOP_PLATFORM,
      userAgentSuffix: DESKTOP_USER_AGENT_SUFFIX,
    },
    serverVersion: opts.version,
    // Same opt-in as `kimi web`: engine telemetry, still gated by the config
    // `telemetry` toggle.
    telemetry: true,
    webAssetsDir: opts.webAssetsDir,
    // Silent by default; `KIMI_DESKTOP_LOG_LEVEL` opts into server logs.
    logLevel: (process.env['KIMI_DESKTOP_LOG_LEVEL'] ?? 'silent') as ServerLogLevel,
  };
  const running = await startServer(serverOptions);
  return {
    origin: `http://127.0.0.1:${running.port}`,
    token: tryResolveServerToken(opts.homeDir),
    close: () => running.close(),
  };
}

/** Best-effort read of `<homeDir>/server.token`; undefined when unreadable. */
export function tryResolveServerToken(homeDir: string): string | undefined {
  try {
    return readFileSync(join(homeDir, SERVER_TOKEN_FILE), 'utf8').trim();
  } catch {
    return undefined;
  }
}
