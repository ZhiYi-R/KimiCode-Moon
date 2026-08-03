// packages/oauth/test/home.test.ts
// Platform application-data resolution for the Kimi data root.
// Run: pnpm --filter @moonshot-ai/kimi-code-oauth exec vitest run test/home.test.ts

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  kimiAppDataDirName,
  kimiPlatformAppDataRoot,
  resolveDefaultKimiHome,
} from '../src/home';

describe('kimiAppDataDirName', () => {
  it('uses the product name on Windows and macOS, lowercase on Linux', () => {
    expect(kimiAppDataDirName('win32')).toBe('Kimi Code');
    expect(kimiAppDataDirName('darwin')).toBe('Kimi Code');
    expect(kimiAppDataDirName('linux')).toBe('kimi-code');
  });
});

describe('kimiPlatformAppDataRoot', () => {
  it('resolves %APPDATA% on Windows with a home fallback', () => {
    // Expectations are built with node:path join so the separator semantics
    // come from the platform's own path module (this suite runs on Windows).
    expect(kimiPlatformAppDataRoot('win32', {}, 'C:\\Users\\me')).toBe(
      join('C:\\Users\\me', 'AppData', 'Roaming'),
    );
    expect(kimiPlatformAppDataRoot('win32', { APPDATA: 'D:\\AppData' }, 'C:\\Users\\me')).toBe(
      'D:\\AppData',
    );
  });

  it('resolves ~/Library/Application Support on macOS', () => {
    expect(kimiPlatformAppDataRoot('darwin', {}, '/Users/me')).toBe(
      join('/Users/me', 'Library', 'Application Support'),
    );
  });

  it('resolves $XDG_CONFIG_HOME on Linux with a ~/.config fallback', () => {
    expect(kimiPlatformAppDataRoot('linux', {}, '/home/me')).toBe(join('/home/me', '.config'));
    expect(kimiPlatformAppDataRoot('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/me')).toBe(
      '/xdg',
    );
  });
});

describe('resolveDefaultKimiHome', () => {
  it('combines the platform root with the app directory', () => {
    expect(resolveDefaultKimiHome({}, '/home/me', 'linux')).toBe(
      join('/home/me', '.config', 'kimi-code'),
    );
    expect(resolveDefaultKimiHome({}, 'C:\\Users\\me', 'win32')).toBe(
      join('C:\\Users\\me', 'AppData', 'Roaming', 'Kimi Code'),
    );
    expect(resolveDefaultKimiHome({}, '/Users/me', 'darwin')).toBe(
      join('/Users/me', 'Library', 'Application Support', 'Kimi Code'),
    );
  });

  it('lets KIMI_CODE_HOME override the platform directory', () => {
    expect(
      resolveDefaultKimiHome({ KIMI_CODE_HOME: '/custom/home' }, '/home/me', 'linux'),
    ).toBe('/custom/home');
    // An empty env value falls through to the platform default.
    expect(resolveDefaultKimiHome({ KIMI_CODE_HOME: '' }, '/home/me', 'linux')).toBe(
      join('/home/me', '.config', 'kimi-code'),
    );
  });
});
