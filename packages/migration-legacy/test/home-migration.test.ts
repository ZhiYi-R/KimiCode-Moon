// apps/../packages/migration-legacy/test/home-migration.test.ts
// Home-directory relocation: copy the legacy ~/.kimi-code root into the
// platform app-data directory — copy completeness, marker suppression,
// retry-safety, and the concurrency lock.
// Run: pnpm --filter @moonshot-ai/migration-legacy exec vitest run test/home-migration.test.ts

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  HOME_MIGRATION_LOCK_NAME,
  HOME_MIGRATION_MARKER_NAME,
  HOME_USER_DATA_ENTRIES,
  homeMigrationLock,
  homeMigrationMarker,
  runHomeMigration,
  shouldSuppressHomeMigration,
  targetHasData,
} from '../src/home-migration';

describe('home migration (legacy ~/.kimi-code → app-data root)', () => {
  let source: string;
  let target: string;
  let roots: string[];

  beforeEach(async () => {
    source = await mkdtemp(join(tmpdir(), 'kimi-home-src-'));
    target = await mkdtemp(join(tmpdir(), 'kimi-home-tgt-'));
    roots = [source, target];
  });

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function seedSource(): Promise<void> {
    await writeFile(join(source, 'config.toml'), '[models]\n');
    await writeFile(join(source, 'mcp.json'), '{"mcpServers":{}}');
    await mkdir(join(source, 'sessions', 'wd_x', 'session_1'), { recursive: true });
    await writeFile(join(source, 'sessions', 'wd_x', 'session_1', 'wire.jsonl'), '{}');
    await mkdir(join(source, 'credentials'), { recursive: true });
    await writeFile(join(source, 'credentials', 'device_id'), 'dev-1');
  }

  it('copies every user-data entry and writes the marker', async () => {
    await seedSource();
    const result = await runHomeMigration({ sourceHome: source, targetHome: target });

    expect(result.migrated).toBe(true);
    expect(result.reason).toBe('done');
    expect(result.copied?.sort()).toEqual(
      HOME_USER_DATA_ENTRIES.filter((entry) =>
        existsSync(join(source, entry)),
      ).sort(),
    );

    for (const entry of HOME_USER_DATA_ENTRIES) {
      if (!existsSync(join(source, entry))) continue;
      expect(existsSync(join(target, entry))).toBe(true);
    }
    expect(await readFile(join(target, 'config.toml'), 'utf8')).toBe('[models]\n');
    expect(
      await readFile(join(target, 'sessions', 'wd_x', 'session_1', 'wire.jsonl'), 'utf8'),
    ).toBe('{}');
    expect(await readFile(join(target, 'credentials', 'device_id'), 'utf8')).toBe('dev-1');

    // Marker written in the source; a re-run is suppressed.
    expect(existsSync(homeMigrationMarker(source))).toBe(true);
    const again = await runHomeMigration({ sourceHome: source, targetHome: target });
    expect(again.migrated).toBe(false);
    expect(again.reason).toBe('already-migrated');
  });

  it('skips when the source does not exist', async () => {
    const missing = join(tmpdir(), `kimi-no-src-${Date.now()}`);
    const result = await runHomeMigration({ sourceHome: missing, targetHome: target });
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('no-source');
  });

  it('skips when the target already holds data', async () => {
    await seedSource();
    await writeFile(join(target, 'config.toml'), 'existing');
    expect(targetHasData(target)).toBe(true);
    expect(shouldSuppressHomeMigration({ sourceHome: source, targetHome: target })).toBe(true);

    const result = await runHomeMigration({ sourceHome: source, targetHome: target });
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('target-populated');
    // The existing target data was not touched.
    expect(await readFile(join(target, 'config.toml'), 'utf8')).toBe('existing');
  });

  it('refuses to migrate while another process holds the lock', async () => {
    await seedSource();
    await writeFile(homeMigrationLock(source), '{"pid":99999}\n');
    const result = await runHomeMigration({ sourceHome: source, targetHome: target });
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('locked');
    expect(existsSync(homeMigrationMarker(source))).toBe(false);
  });

  it('is retry-safe: a failed run leaves no marker and a later run completes', async () => {
    await seedSource();
    // First run fails: the target is a plain file, so the copy throws.
    const fileTarget = join(tmpdir(), `kimi-tgt-file-${Date.now()}`);
    await writeFile(fileTarget, 'x');
    roots.push(fileTarget);

    await expect(runHomeMigration({ sourceHome: source, targetHome: fileTarget })).rejects.toThrow();
    expect(existsSync(homeMigrationMarker(source))).toBe(false);

    // A retry against a real directory completes and writes the marker.
    const result = await runHomeMigration({ sourceHome: source, targetHome: target });
    expect(result.migrated).toBe(true);
    expect(existsSync(homeMigrationMarker(source))).toBe(true);
  });

  it('exports the marker/lock path helpers consistently', () => {
    expect(homeMigrationMarker(source)).toBe(
      join(source, HOME_MIGRATION_MARKER_NAME),
    );
    expect(homeMigrationLock(source)).toBe(join(source, HOME_MIGRATION_LOCK_NAME));
  });
});
