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

export const listPluginsQuerySchema = z.object({
  /** Custom marketplace source URL (overrides the env / default). */
  source: z.string().url().optional(),
});
export type ListPluginsQuery = z.infer<typeof listPluginsQuerySchema>;

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

export const setPluginEnabledBodySchema = z.object({
  enabled: z.boolean(),
});
export type SetPluginEnabledBody = z.infer<typeof setPluginEnabledBodySchema>;

export const setPluginEnabledResponseSchema = z.object({
  enabled: z.literal(true),
});
export type SetPluginEnabledResponse = z.infer<typeof setPluginEnabledResponseSchema>;

export const pluginMcpServerParamSchema = z.object({
  plugin_id: z.string().min(1),
  mcp_server: z.string().min(1),
});
export type PluginMcpServerParam = z.infer<typeof pluginMcpServerParamSchema>;

export const pluginMcpServerInfoSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  transport: z.enum(['stdio', 'http', 'sse']),
  url: z.string().optional(),
  command: z.string().optional(),
});
export type PluginMcpServerInfo = z.infer<typeof pluginMcpServerInfoSchema>;

export const pluginInfoResponseSchema = z.object({
  plugin: pluginEntrySchema.extend({
    mcp_servers: z.array(pluginMcpServerInfoSchema),
  }),
});
export type PluginInfoResponse = z.infer<typeof pluginInfoResponseSchema>;
