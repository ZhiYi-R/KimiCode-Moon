import { mkdirSync } from 'node:fs';
import { join } from 'pathe';

import { resolveDefaultKimiHome } from '@moonshot-ai/kimi-code-oauth';

export function resolveKimiHome(homeDir?: string | undefined): string {
  return homeDir ?? resolveDefaultKimiHome();
}

export function resolveConfigPath(input: {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}): string {
  return input.configPath ?? join(resolveKimiHome(input.homeDir), 'config.toml');
}

export function ensureKimiHome(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
}
