/**
 * Home-directory relocation: copy the legacy `~/.kimi-code` data root into
 * the platform application-data directory (the new default home).
 *
 * Unlike the kimi-cli → kimi-code migration (which translates content), this
 * is a plain directory copy of user data:
 *  - copy, not move — the source stays untouched for manual cleanup;
 *  - idempotent — a marker in the source suppresses re-runs, and a
 *    target that already holds data (`config.toml` or `sessions/`) skips;
 *  - retry-safe — the marker is written only after every entry succeeded,
 *    so an interrupted run just re-runs (fs.cp merges/overwrites);
 *  - concurrency-safe — a `wx` lock file in the source prevents a CLI and
 *    the desktop app from migrating at the same time.
 *
 * The caller resolves `sourceHome` / `targetHome` (the legacy `~/.kimi-code`
 * and the new platform default); this module stays dependency-free.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const HOME_MIGRATION_MARKER_NAME = '.migrated-to-app-data';
export const HOME_MIGRATION_LOCK_NAME = '.migrating-to-app-data';

/**
 * User-data entries copied from the legacy home. Runtime artifacts are
 * deliberately excluded: `server/` (instances + event journals), 
 * `search-index/` (minidb rebuilds from session data), `server.token`
 * (re-generated per host), and the old `desktop/` (Electron cache).
 */
export const HOME_USER_DATA_ENTRIES = [
  'config.toml',
  'mcp.json',
  'workspaces.json',
  'session_index.jsonl',
  'sessions',
  'store',
  'cron',
  'credentials',
  'plugins',
  'blobs',
  'logs',
  'cache',
] as const;

export interface HomeMigrationInput {
  readonly sourceHome: string;
  readonly targetHome: string;
}

export type HomeMigrationReason =
  | 'no-source'
  | 'already-migrated'
  | 'target-populated'
  | 'locked'
  | 'done';

export interface HomeMigrationResult {
  readonly migrated: boolean;
  readonly reason: HomeMigrationReason;
  /** Entries actually copied (present when `reason === 'done'`). */
  readonly copied?: readonly string[];
}

export function homeMigrationMarker(sourceHome: string): string {
  return join(sourceHome, HOME_MIGRATION_MARKER_NAME);
}

export function homeMigrationLock(sourceHome: string): string {
  return join(sourceHome, HOME_MIGRATION_LOCK_NAME);
}

/** True when the target already holds product data (config or sessions). */
export function targetHasData(targetHome: string): boolean {
  return (
    existsSync(join(targetHome, 'config.toml')) || existsSync(join(targetHome, 'sessions'))
  );
}

/** Decide whether the home migration should run at all. */
export function shouldSuppressHomeMigration(input: HomeMigrationInput): boolean {
  if (!existsSync(input.sourceHome)) return true;
  if (existsSync(homeMigrationMarker(input.sourceHome))) return true;
  if (targetHasData(input.targetHome)) return true;
  return false;
}

/**
 * Run the home migration. Returns without migrating when suppressed or when
 * another process holds the lock; throws on I/O failure (the caller decides
 * whether to block startup — the marker is never written on failure, so a
 * retry is always safe).
 */
export async function runHomeMigration(
  input: HomeMigrationInput,
): Promise<HomeMigrationResult> {
  const { sourceHome, targetHome } = input;

  if (!existsSync(sourceHome)) {
    return { migrated: false, reason: 'no-source' };
  }
  if (existsSync(homeMigrationMarker(sourceHome))) {
    return { migrated: false, reason: 'already-migrated' };
  }
  if (targetHasData(targetHome)) {
    return { migrated: false, reason: 'target-populated' };
  }

  const lockPath = homeMigrationLock(sourceHome);
  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      { flag: 'wx' },
    );
  } catch {
    return { migrated: false, reason: 'locked' };
  }

  try {
    const copied: string[] = [];
    for (const entry of HOME_USER_DATA_ENTRIES) {
      const src = join(sourceHome, entry);
      if (!existsSync(src)) continue;
      await cp(src, join(targetHome, entry), { recursive: true });
      copied.push(entry);
    }
    await mkdir(sourceHome, { recursive: true });
    await writeFile(
      homeMigrationMarker(sourceHome),
      `${JSON.stringify(
        {
          version: 1,
          migrated_at: new Date().toISOString(),
          target_path: targetHome,
        },
        null,
        2,
      )}\n`,
    );
    return { migrated: true, reason: 'done', copied };
  } finally {
    await rm(lockPath, { force: true }).catch(() => {
      // best-effort: a stale lock is harmless (next run just re-migrates)
    });
  }
}
