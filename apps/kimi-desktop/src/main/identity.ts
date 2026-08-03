/**
 * Host identity + home-dir resolution for the desktop shell.
 *
 * The desktop app is a distinct Kimi host: it states its own product name,
 * platform, and User-Agent suffix (`kimi-code-desktop` / `kimi_code_desktop` /
 * `(desktop)`) so upstream telemetry and OAuth traffic can tell desktop
 * sessions apart from CLI / web traffic — see `KimiHostIdentity` in
 * `@moonshot-ai/kimi-code-oauth`, which explicitly forbids silently inheriting
 * the CLI's values.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DESKTOP_PRODUCT_NAME = 'kimi-code-desktop';
export const DESKTOP_PLATFORM = 'kimi_code_desktop';
/** User-Agent suffix for the desktop host, mirroring `web` for `kimi web`. */
export const DESKTOP_USER_AGENT_SUFFIX = 'desktop';

/** App version, read from `package.json` one level above `dist/`. */
export function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

/** Same home resolution as the CLI: `KIMI_CODE_HOME` env override, else `~/.kimi-code`. */
export function resolveDesktopHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['KIMI_CODE_HOME'] ?? resolve(homedir(), '.kimi-code');
}
