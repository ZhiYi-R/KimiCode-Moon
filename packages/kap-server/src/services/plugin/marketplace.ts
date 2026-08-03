/**
 * Plugin marketplace loading for the REST surface.
 *
 * Simplified port of the CLI's `apps/kimi-code/src/utils/plugin-marketplace.ts`:
 * same CDN default + `KIMI_CODE_PLUGIN_MARKETPLACE_URL` env override, same
 * entry validation (required `id`/`source`, tier whitelist, field aliases),
 * and the same relative-source resolution against a remote marketplace URL.
 * Deliberately dropped: local-checkout fallback (server has no repo checkout)
 * and per-entry GitHub release version derivation (extra network round-trips
 * per request; the installed version is reported by `IPluginService`).
 */

import { z } from 'zod';

/** Same CDN source of truth as the CLI (`KIMI_CODE_CDN_BASE`). */
export const PLUGIN_MARKETPLACE_URL = 'https://code.kimi.com/kimi-code/plugins/marketplace.json';
export const PLUGIN_MARKETPLACE_URL_ENV = 'KIMI_CODE_PLUGIN_MARKETPLACE_URL';

export const PLUGIN_MARKETPLACE_TIERS = ['official', 'curated'] as const;
export type PluginMarketplaceTier = (typeof PLUGIN_MARKETPLACE_TIERS)[number];

export interface PluginMarketplaceEntry {
  readonly id: string;
  readonly displayName: string;
  readonly source: string;
  readonly tier?: PluginMarketplaceTier;
  readonly version?: string;
  readonly description?: string;
  readonly homepage?: string;
  readonly keywords?: readonly string[];
}

export interface PluginMarketplace {
  readonly source: string;
  readonly version?: string;
  readonly plugins: readonly PluginMarketplaceEntry[];
}

const marketplaceSchema = z.object({
  version: z.string().optional(),
  plugins: z.array(z.unknown()),
});

export async function loadPluginMarketplace(
  fetchImpl: typeof fetch = fetch,
): Promise<PluginMarketplace> {
  const raw = process.env[PLUGIN_MARKETPLACE_URL_ENV] ?? PLUGIN_MARKETPLACE_URL;
  let response: Response;
  try {
    response = await fetchImpl(raw);
  } catch (error) {
    throw new Error(`Plugin marketplace is unreachable at ${raw}: ${describeError(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`Plugin marketplace returned HTTP ${response.status}`);
  }
  return parsePluginMarketplace(await response.text(), raw);
}

export function parsePluginMarketplace(raw: string, source: string): PluginMarketplace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Plugin marketplace is not valid JSON: ${describeError(error)}`, {
      cause: error,
    });
  }
  const validated = marketplaceSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('Plugin marketplace must be an object with a "plugins" array.');
  }
  return {
    source,
    version: validated.data.version,
    plugins: validated.data.plugins.map((entry, index) => parseMarketplaceEntry(entry, index, source)),
  };
}

function parseMarketplaceEntry(
  value: unknown,
  index: number,
  marketplaceSource: string,
): PluginMarketplaceEntry {
  if (!isRecord(value)) {
    throw new TypeError(`Plugin marketplace entry ${index + 1} must be an object.`);
  }
  const id = requiredString(value, 'id', index);
  const source =
    stringField(value, 'source') ??
    stringField(value, 'url') ??
    stringField(value, 'downloadUrl');
  if (source === undefined) {
    throw new Error(`Plugin marketplace entry ${id} must define "source".`);
  }
  return {
    id,
    displayName: stringField(value, 'displayName') ?? stringField(value, 'name') ?? id,
    source: resolveEntrySource(source, marketplaceSource),
    tier: parseMarketplaceTier(value, id),
    version: stringField(value, 'version'),
    description: stringField(value, 'description') ?? stringField(value, 'shortDescription'),
    homepage: stringField(value, 'homepage') ?? stringField(value, 'websiteURL'),
    keywords: stringArrayField(value, 'keywords'),
  };
}

function parseMarketplaceTier(
  value: Record<string, unknown>,
  id: string,
): PluginMarketplaceTier | undefined {
  const raw = value['tier'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new TypeError(`Plugin marketplace entry ${id} "tier" must be a string.`);
  }
  const tier = raw.trim();
  if (tier.length === 0) return undefined;
  if ((PLUGIN_MARKETPLACE_TIERS as readonly string[]).includes(tier)) {
    return tier as PluginMarketplaceTier;
  }
  throw new Error(
    `Plugin marketplace entry ${id} "tier" must be one of: ${PLUGIN_MARKETPLACE_TIERS.join(', ')}.`,
  );
}

function resolveEntrySource(source: string, marketplaceSource: string): string {
  const trimmed = source.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('~/') ||
    trimmed === '~' ||
    isAbsolutePath(trimmed)
  ) {
    return trimmed;
  }
  // Relative source: resolve against the marketplace URL (same as the CLI).
  return new URL(trimmed, marketplaceSource).toString();
}

function requiredString(value: Record<string, unknown>, key: string, index: number): string {
  const field = stringField(value, key);
  if (field === undefined || field.length === 0) {
    throw new TypeError(`Plugin marketplace entry ${index + 1} must define "${key}".`);
  }
  return field;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stringArrayField(value: Record<string, unknown>, key: string): readonly string[] | undefined {
  const raw = value[key];
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((entry): entry is string => typeof entry === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
