/**
 * Kimi Code data-directory resolution.
 *
 * The default data root lives in the platform's application-data directory
 * instead of `~/.kimi-code`:
 *
 *   - Windows:  `%APPDATA%\Kimi Code`
 *   - macOS:    `~/Library/Application Support/Kimi Code`
 *   - Linux:    `$XDG_CONFIG_HOME/kimi-code` (or `~/.config/kimi-code`)
 *
 * `KIMI_CODE_HOME` still overrides the default explicitly; when it is set the
 * platform directory is ignored. All hosts (CLI, desktop, engines) resolve
 * through here so one shared root serves the whole product.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const KIMI_CODE_HOME_ENV = 'KIMI_CODE_HOME';

/**
 * App-directory name inside the platform data root. Matches the
 * electron-builder `productName` on Windows/macOS; Linux uses the lowercase
 * XDG-style name.
 */
export function kimiAppDataDirName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'linux' ? 'kimi-code' : 'Kimi Code';
}

/**
 * Platform application-data root (without the app directory):
 * `%APPDATA%` / `~/Library/Application Support` / `$XDG_CONFIG_HOME` or
 * `~/.config`.
 */
export function kimiPlatformAppDataRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  osHomeDir: string = homedir(),
): string {
  if (platform === 'win32') {
    return env['APPDATA'] ?? join(osHomeDir, 'AppData', 'Roaming');
  }
  if (platform === 'darwin') {
    return join(osHomeDir, 'Library', 'Application Support');
  }
  return env['XDG_CONFIG_HOME'] ?? join(osHomeDir, '.config');
}

/**
 * Resolve the Kimi Code data root: `KIMI_CODE_HOME` env override, else the
 * platform application-data directory.
 */
export function resolveDefaultKimiHome(
  env: NodeJS.ProcessEnv = process.env,
  osHomeDir: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const override = env[KIMI_CODE_HOME_ENV];
  if (override !== undefined && override.length > 0) return override;
  return join(kimiPlatformAppDataRoot(platform, env, osHomeDir), kimiAppDataDirName(platform));
}
