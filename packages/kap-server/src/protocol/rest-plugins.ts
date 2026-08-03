/**
 * REST wire schemas for plugin management
 * (`/plugins`: marketplace + installed-state listing, install, uninstall).
 */

import { z } from 'zod';

const pluginTierSchema = z.enum(['official', 'curated']);

export const pluginEntrySchema = z.object({
  id: z.string(),
  display_name: z.string(),
  source: z.string(),
  tier: pluginTierSchema.optional(),
  version: z.string().optional(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** Installed-state projection from `IPluginService`. */
  installed: z.boolean(),
  installed_version: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type PluginEntry = z.infer<typeof pluginEntrySchema>;

export const listPluginsResponseSchema = z.object({
  plugins: z.array(pluginEntrySchema),
});
export type ListPluginsResponse = z.infer<typeof listPluginsResponseSchema>;

export const pluginIdParamSchema = z.object({
  plugin_id: z.string().min(1),
});
export type PluginIdParam = z.infer<typeof pluginIdParamSchema>;

export const installPluginResponseSchema = z.object({
  plugin: pluginEntrySchema,
  /** `IPluginService.reloadPlugins()` result after install. */
  reload: z.object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    errors: z.array(z.string()),
  }),
});
export type InstallPluginResponse = z.infer<typeof installPluginResponseSchema>;

export const uninstallPluginResponseSchema = z.object({
  removed: z.literal(true),
});
export type UninstallPluginResponse = z.infer<typeof uninstallPluginResponseSchema>;
