/**
 * Launch the Kimi Code desktop app from the `kimi` command.
 *
 * The desktop app is distributed as its own installer (dmg / nsis / AppImage),
 * not through the CLI package, so the CLI locates an installed app per
 * platform and hands the launch off to it as a detached process. When no app
 * is installed (or the environment has no display, e.g. SSH/CI on Linux), the
 * caller falls back to the terminal UI (`--tui` forces it unconditionally).
 *
 * All side-effecting bits (platform, env, app discovery, spawn) are
 * injectable so unit tests never touch the real filesystem or processes.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DESKTOP_APP_NAME = 'Kimi Code';
export const DESKTOP_APP_HOMEPAGE = 'https://www.kimi.com/code';

export type DesktopLaunchFailureReason = 'no-display' | 'not-installed' | 'spawn-failed';

export interface DesktopLaunchResult {
  readonly launched: boolean;
  /** Present when `launched` is false. */
  readonly reason?: DesktopLaunchFailureReason;
  /** The command that was (or would be) launched, for diagnostics. */
  readonly command?: string;
}

export interface InstalledApp {
  /** Executable to spawn — `open` on macOS, the app binary elsewhere. */
  readonly command: string;
  readonly args: readonly string[];
}

export interface DesktopLaunchDeps {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly findInstalledApp: (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) => InstalledApp | undefined;
  readonly spawnApp: (app: InstalledApp) => Promise<DesktopLaunchResult>;
}

/** True when the environment can show a GUI window. Always true off Linux. */
export function hasDisplayEnvironment(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  if (platform !== 'linux') return true;
  return Boolean(env['DISPLAY'] || env['WAYLAND_DISPLAY']);
}

/**
 * Locate an installed Kimi Code desktop app. Standard install locations only —
 * a user who installed elsewhere can still use `kimi --tui`.
 */
export function findInstalledDesktopApp(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): InstalledApp | undefined {
  switch (platform) {
    case 'darwin': {
      if (existsSync(`/Applications/${DESKTOP_APP_NAME}.app`)) {
        return { command: 'open', args: ['-a', DESKTOP_APP_NAME] };
      }
      return undefined;
    }
    case 'win32': {
      const candidates: string[] = [];
      const localAppData = env['LOCALAPPDATA'];
      if (localAppData !== undefined) {
        candidates.push(join(localAppData, 'Programs', DESKTOP_APP_NAME, `${DESKTOP_APP_NAME}.exe`));
      }
      const programFiles = env['ProgramFiles'];
      if (programFiles !== undefined) {
        candidates.push(join(programFiles, DESKTOP_APP_NAME, `${DESKTOP_APP_NAME}.exe`));
      }
      const exe = candidates.find((candidate) => existsSync(candidate));
      return exe === undefined ? undefined : { command: exe, args: [] };
    }
    case 'linux': {
      const candidates = [
        `/opt/${DESKTOP_APP_NAME}/kimi-code`,
        '/usr/bin/kimi-code-desktop',
        join(homedir(), '.local', 'bin', 'kimi-code-desktop'),
      ];
      const exe = candidates.find((candidate) => existsSync(candidate));
      return exe === undefined ? undefined : { command: exe, args: [] };
    }
    default:
      return undefined;
  }
}

/**
 * Spawn the app detached so it outlives the CLI process. Resolves only after
 * the spawn either succeeded or failed (never on a race between them).
 */
export async function spawnInstalledApp(app: InstalledApp): Promise<DesktopLaunchResult> {
  try {
    const spawned = await new Promise<boolean>((resolve) => {
      const child = spawn(app.command, [...app.args], { detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => resolve(true));
      child.unref();
    });
    return spawned
      ? { launched: true, command: app.command }
      : { launched: false, reason: 'spawn-failed', command: app.command };
  } catch {
    return { launched: false, reason: 'spawn-failed', command: app.command };
  }
}

export async function tryLaunchDesktopApp(
  deps: DesktopLaunchDeps = defaultDesktopLaunchDeps(),
): Promise<DesktopLaunchResult> {
  const { platform, env } = deps;
  if (!hasDisplayEnvironment(platform, env)) {
    return { launched: false, reason: 'no-display' };
  }
  const app = deps.findInstalledApp(platform, env);
  if (app === undefined) {
    return { launched: false, reason: 'not-installed' };
  }
  return deps.spawnApp(app);
}

export function defaultDesktopLaunchDeps(): DesktopLaunchDeps {
  return {
    platform: process.platform,
    env: process.env,
    findInstalledApp: findInstalledDesktopApp,
    spawnApp: spawnInstalledApp,
  };
}
