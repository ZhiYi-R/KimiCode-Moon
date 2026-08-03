/**
 * REST wire schemas for the user-global MCP server management endpoints
 * (`<home>/mcp.json` CRUD, OAuth authorization, connectivity probe).
 */

import { z } from 'zod';

import { globalMcpServerConfigSchema } from './mcp-server-config';

export const addMcpServerBodySchema = globalMcpServerConfigSchema;
export type AddMcpServerBody = z.infer<typeof addMcpServerBodySchema>;

export const mcpServerNameParamSchema = z.object({
  mcp_server_id: z.string().min(1),
});
export type McpServerNameParam = z.infer<typeof mcpServerNameParamSchema>;

export const listGlobalMcpServersResponseSchema = z.object({
  servers: z.array(globalMcpServerConfigSchema),
});
export type ListGlobalMcpServersResponse = z.infer<typeof listGlobalMcpServersResponseSchema>;

export const testMcpServerBodySchema = z
  .object({
    cwd: z.string().optional(),
  })
  .optional();
export type TestMcpServerBody = z.infer<typeof testMcpServerBodySchema>;

export const testMcpServerResponseSchema = z.object({
  success: z.boolean(),
  output: z.string(),
});
export type TestMcpServerResponse = z.infer<typeof testMcpServerResponseSchema>;

/** Begin an OAuth authorization flow (short-circuits when already authorized). */
export const beginMcpAuthResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('authorization-required'),
    flow_id: z.string(),
    authorization_url: z.string().url(),
  }),
  z.object({ status: z.literal('already-authorized') }),
]);
export type BeginMcpAuthResponse = z.infer<typeof beginMcpAuthResponseSchema>;

export const completeMcpAuthBodySchema = z.object({
  flow_id: z.string().min(1),
  timeout_ms: z.number().int().min(1).max(3_600_000).optional(),
});
export type CompleteMcpAuthBody = z.infer<typeof completeMcpAuthBodySchema>;

export const completeMcpAuthResponseSchema = z.object({
  authorized: z.literal(true),
});
export type CompleteMcpAuthResponse = z.infer<typeof completeMcpAuthResponseSchema>;

export const cancelMcpAuthBodySchema = z.object({
  flow_id: z.string().min(1),
});
export type CancelMcpAuthBody = z.infer<typeof cancelMcpAuthBodySchema>;

export const cancelMcpAuthResponseSchema = z.object({
  cancelled: z.literal(true),
});
export type CancelMcpAuthResponse = z.infer<typeof cancelMcpAuthResponseSchema>;

export const resetMcpAuthResponseSchema = z.object({
  reset: z.literal(true),
});
export type ResetMcpAuthResponse = z.infer<typeof resetMcpAuthResponseSchema>;
