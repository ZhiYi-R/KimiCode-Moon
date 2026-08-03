/**
 * Scenario: locating and launching the installed Kimi Code desktop app from
 * the `kimi` command. Responsibilities: per-platform app discovery, display
 * environment detection, and the launch/fallback decision.
 * Wiring: pure functions; side effects (fs, spawn) are injected.
 * Run: pnpm -C apps/kimi-code exec vitest run test/cli/desktop-launcher.test.ts
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_APP_NAME,
  findInstalledDesktopApp,
  hasDisplayEnvironment,
  tryLaunchDesktopApp,
  type DesktopLaunchDeps,
  type InstalledApp,
} from '#/cli/desktop-launcher';

// The discovery paths (/Applications, %LOCALAPPDATA%\Programs\…, /opt/…) are
// platform-specific and absent on most test hosts; stub existence so the
// candidate-order logic is what's under test, not the host's filesystem.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

function stubDeps(overrides: Partial<DesktopLaunchDeps>): DesktopLaunchDeps {
  return {
    platform: 'win32',
    env: {},
    findInstalledApp: vi.fn(() => undefined),
    spawnApp: vi.fn(async (app: InstalledApp) => ({ launched: true, command: app.command })),
    ...overrides,
  };
}

describe('hasDisplayEnvironment', () => {
  it('is always true off Linux', () => {
    expect(hasDisplayEnvironment('win32', {})).toBe(true);
    expect(hasDisplayEnvironment('darwin', {})).toBe(true);
  });

  it('requires DISPLAY or WAYLAND_DISPLAY on Linux', () => {
    expect(hasDisplayEnvironment('linux', {})).toBe(false);
    expect(hasDisplayEnvironment('linux', { DISPLAY: ':0' })).toBe(true);
    expect(hasDisplayEnvironment('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
  });
});

describe('findInstalledDesktopApp', () => {
  it('finds the macOS app bundle in /Applications', () => {
    const app = findInstalledDesktopApp('darwin', {});
    expect(app).toEqual({ command: 'open', args: ['-a', DESKTOP_APP_NAME] });
  });

  it('finds the Windows app under LOCALAPPDATA', () => {
    const app = findInstalledDesktopApp('win32', {
      LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    });
    expect(app).toEqual({
      command: 'C:\\Users\\test\\AppData\\Local\\Programs\\Kimi Code\\Kimi Code.exe',
      args: [],
    });
  });

  it('finds the Windows app under ProgramFiles as a fallback', () => {
    const app = findInstalledDesktopApp('win32', { ProgramFiles: 'C:\\Program Files' });
    expect(app).toEqual({
      command: 'C:\\Program Files\\Kimi Code\\Kimi Code.exe',
      args: [],
    });
  });

  it('returns undefined on Windows when no install location is known', () => {
    expect(findInstalledDesktopApp('win32', {})).toBeUndefined();
  });

  it('finds a Linux install under /opt', () => {
    const app = findInstalledDesktopApp('linux', {});
    expect(app).toEqual({ command: '/opt/Kimi Code/kimi-code', args: [] });
  });

  it('returns undefined on unsupported platforms', () => {
    expect(findInstalledDesktopApp('freebsd', {})).toBeUndefined();
  });
});

describe('tryLaunchDesktopApp', () => {
  it('launches when an app is installed', async () => {
    const spawnApp = vi.fn(async (app: InstalledApp) => ({ launched: true, command: app.command }));
    const result = await tryLaunchDesktopApp(
      stubDeps({
        findInstalledApp: () => ({ command: '/usr/bin/kimi-code-desktop', args: [] }),
        spawnApp,
      }),
    );
    expect(result).toEqual({ launched: true, command: '/usr/bin/kimi-code-desktop' });
    expect(spawnApp).toHaveBeenCalledTimes(1);
  });

  it('reports not-installed without spawning', async () => {
    const spawnApp = vi.fn();
    const result = await tryLaunchDesktopApp(stubDeps({ spawnApp }));
    expect(result).toEqual({ launched: false, reason: 'not-installed' });
    expect(spawnApp).not.toHaveBeenCalled();
  });

  it('reports no-display on a display-less Linux without spawning', async () => {
    const spawnApp = vi.fn();
    const result = await tryLaunchDesktopApp(
      stubDeps({ platform: 'linux', env: {}, spawnApp }),
    );
    expect(result).toEqual({ launched: false, reason: 'no-display' });
    expect(spawnApp).not.toHaveBeenCalled();
  });

  it('propagates a spawn failure', async () => {
    const result = await tryLaunchDesktopApp(
      stubDeps({
        findInstalledApp: () => ({ command: '/usr/bin/kimi-code-desktop', args: [] }),
        spawnApp: async () => ({ launched: false, reason: 'spawn-failed' }),
      }),
    );
    expect(result).toEqual({ launched: false, reason: 'spawn-failed' });
  });
});
