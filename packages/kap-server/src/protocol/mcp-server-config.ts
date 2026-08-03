/**
 * Wire schema for the user-global MCP server configuration (`<home>/mcp.json`
 * entries), carried by the `/mcp/servers` management endpoints.
 *
 * This is the wire port of the CLI's `McpServerConfigSchema`
 * (`packages/agent-core/src/config/schema.ts`): kap-server must not depend on
 * the v1 engine package, and the v2 schema drops the `auth: 'oauth'` marker
 * field (writing through it would strip the marker on save). The preprocess
 * step keeps legacy bare forms (`{command}` / `{url}` without `transport`)
 * parseable, matching the CLI's reader.
 */

import { z } from 'zod';

const MAX_MCP_TIMEOUT_MS = 2_147_483_647;

const StringRecordSchema = z.record(z.string(), z.string());
const McpTimeoutMsSchema = z.number().int().min(1).max(MAX_MCP_TIMEOUT_MS);

const McpServerCommonFields = {
  enabled: z.boolean().optional(),
  startupTimeoutMs: McpTimeoutMsSchema.optional(),
  toolTimeoutMs: McpTimeoutMsSchema.optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
} as const;

export const mcpServerStdioConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: StringRecordSchema.optional(),
  cwd: z.string().optional(),
  // Reserved for future kaos-backed stdio launchers. `undefined` and `'local'`
  // both mean direct child_process spawn for now.
  executor: z.enum(['local', 'kaos']).optional(),
  ...McpServerCommonFields,
});
export type McpServerStdioConfig = z.infer<typeof mcpServerStdioConfigSchema>;

export const mcpServerHttpConfigSchema = z.object({
  transport: z.literal('http'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  // Backward-compatible UI marker. OAuth is still discovered from a remote
  // server's 401 response; this flag only records that the user explicitly
  // chose OAuth and lets hosts expose login/reset controls before connecting.
  auth: z.literal('oauth').optional(),
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});
export type McpServerHttpConfig = z.infer<typeof mcpServerHttpConfigSchema>;

export const mcpServerSseConfigSchema = z.object({
  transport: z.literal('sse'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  auth: z.literal('oauth').optional(),
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});
export type McpServerSseConfig = z.infer<typeof mcpServerSseConfigSchema>;

export type McpRemoteServerConfig = McpServerHttpConfig | McpServerSseConfig;

const mcpServerConfigDiscriminatedSchema = z.discriminatedUnion('transport', [
  mcpServerStdioConfigSchema,
  mcpServerHttpConfigSchema,
  mcpServerSseConfigSchema,
]);

export const mcpServerConfigSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if ('transport' in obj) return obj;
  if (typeof obj['command'] === 'string') return { ...obj, transport: 'stdio' };
  if (typeof obj['url'] === 'string') return { ...obj, transport: 'http' };
  return obj;
}, mcpServerConfigDiscriminatedSchema);
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/** A named `<home>/mcp.json` entry: `{name}` + the server config. */
export const globalMcpServerConfigSchema = z.object({
  name: z.string().min(1),
  config: mcpServerConfigSchema,
});
export type GlobalMcpServerConfig = z.infer<typeof globalMcpServerConfigSchema>;
