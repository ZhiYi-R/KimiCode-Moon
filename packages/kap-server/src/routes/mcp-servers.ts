/**
 * `/mcp/servers` management routes — user-global MCP server CRUD, OAuth
 * authorization, and the connectivity probe.
 *
 * Complements the read/restart surface in `routes/tools.ts` (GET
 * `/mcp/servers`, POST `/mcp/servers/{id}:restart`) with the mutation surface
 * the TUI exposes over RPC:
 *
 *   POST   /mcp/servers                       body: {name, config}   data: {servers: [{name, config}]}
 *   DELETE /mcp/servers/{mcp_server_id}                             data: {servers: [...]}
 *   POST   /mcp/servers/{mcp_server_id}/test body: {cwd?}           data: {success, output}
 *   POST   /mcp/servers/{mcp_server_id}/auth                        data: {status, flow_id?, authorization_url?}
 *   POST   /mcp/servers/{mcp_server_id}/auth/complete body: {flow_id, timeout_ms?}  data: {authorized: true}
 *   POST   /mcp/servers/{mcp_server_id}/auth/cancel  body: {flow_id} data: {cancelled: true}
 *   DELETE /mcp/servers/{mcp_server_id}/auth                         data: {reset: true}
 *
 * Writes land in `<home>/mcp.json`; the engine's workspace config service
 * watches that file and applies changes to live sessions incrementally, so no
 * explicit reconnect is needed (same behavior as the TUI's add/remove).
 *
 * Error mapping: `mcp.server_not_found` → 40408; `request.invalid` /
 * `config.invalid` / `mcp.oauth_failed` → 40001; everything else → 50001 via
 * the global error handler.
 */

import { Error2, ErrorCodes } from '@moonshot-ai/agent-core-v2';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import type { AddMcpServerBody } from '../protocol/rest-mcp-config';
import {
  addMcpServerBodySchema,
  beginMcpAuthResponseSchema,
  cancelMcpAuthBodySchema,
  cancelMcpAuthResponseSchema,
  completeMcpAuthBodySchema,
  completeMcpAuthResponseSchema,
  listGlobalMcpServersResponseSchema,
  mcpServerNameParamSchema,
  resetMcpAuthResponseSchema,
  testMcpServerBodySchema,
  testMcpServerResponseSchema,
} from '../protocol/rest-mcp-config';
import {
  mcpConfigWithoutName,
  type GlobalMcpConfigService,
  type GlobalMcpServerConfig,
} from '../services/mcpConfig/globalMcpConfigService';

interface McpConfigRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerMcpConfigRoutes(
  app: McpConfigRouteHost,
  mcpConfig: GlobalMcpConfigService,
): void {
  // GET /mcp/config ------------------------------------------------------
  // The configured (persisted) global list — distinct from GET /mcp/servers
  // in routes/tools.ts, which serves the live session's connection view.
  const getConfigRoute = defineRoute(
    {
      method: 'GET',
      path: '/mcp/config',
      success: { data: listGlobalMcpServersResponseSchema },
      description: 'List user-global MCP server configs from <home>/mcp.json',
      tags: ['tools'],
      operationId: 'getGlobalMcpConfig',
    },
    async (req, reply) => {
      const servers = await mcpConfig.list();
      reply.send(okEnvelope({ servers: servers.map(toWireServer) }, req.id));
    },
  );
  app.get(
    getConfigRoute.path,
    getConfigRoute.options,
    getConfigRoute.handler as Parameters<McpConfigRouteHost['get']>[2],
  );

  // POST /mcp/servers -----------------------------------------------------
  const addServerRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers',
      body: addMcpServerBodySchema,
      success: { data: listGlobalMcpServersResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
      },
      description: 'Add a user-global MCP server to <home>/mcp.json',
      tags: ['tools'],
      operationId: 'addMcpServer',
    },
    async (req, reply) => {
      const { name, config } = req.body as AddMcpServerBody;
      try {
        const servers = await mcpConfig.add({ name, ...config });
        reply.send(
          okEnvelope({ servers: servers.map(toWireServer) }, req.id),
        );
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    addServerRoute.path,
    addServerRoute.options,
    addServerRoute.handler as Parameters<McpConfigRouteHost['post']>[2],
  );

  // DELETE /mcp/servers/{mcp_server_id} ----------------------------------
  const removeServerRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/mcp/servers/{mcp_server_id}',
      params: mcpServerNameParamSchema,
      success: { data: listGlobalMcpServersResponseSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
      },
      description: 'Remove a user-global MCP server from <home>/mcp.json',
      tags: ['tools'],
      operationId: 'removeMcpServer',
    },
    async (req, reply) => {
      const { mcp_server_id } = req.params as { mcp_server_id: string };
      try {
        const servers = await mcpConfig.remove(mcp_server_id);
        reply.send(okEnvelope({ servers: servers.map(toWireServer) }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    removeServerRoute.path,
    removeServerRoute.options,
    removeServerRoute.handler as Parameters<McpConfigRouteHost['delete']>[2],
  );

  // POST /mcp/servers/{mcp_server_id}/test -------------------------------
  const testServerRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers/{mcp_server_id}/test',
      params: mcpServerNameParamSchema,
      body: testMcpServerBodySchema,
      success: { data: testMcpServerResponseSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Probe an MCP server with a throwaway connection',
      tags: ['tools'],
      operationId: 'testMcpServer',
    },
    async (req, reply) => {
      const { mcp_server_id } = req.params as { mcp_server_id: string };
      const body = req.body as { cwd?: string } | undefined;
      try {
        const result = await mcpConfig.test(mcp_server_id, body?.cwd);
        reply.send(okEnvelope(result, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    testServerRoute.path,
    testServerRoute.options,
    testServerRoute.handler as Parameters<McpConfigRouteHost['post']>[2],
  );

  // POST /mcp/servers/{mcp_server_id}/auth (begin) -----------------------
  const beginAuthRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers/{mcp_server_id}/auth',
      params: mcpServerNameParamSchema,
      success: { data: beginMcpAuthResponseSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Begin the OAuth authorization flow for a remote MCP server',
      tags: ['tools'],
      operationId: 'beginMcpServerAuth',
    },
    async (req, reply) => {
      const { mcp_server_id } = req.params as { mcp_server_id: string };
      try {
        const result = await mcpConfig.beginAuth(mcp_server_id);
        reply.send(
          okEnvelope(
            result.status === 'authorization-required'
              ? {
                  status: result.status,
                  flow_id: result.flowId,
                  authorization_url: result.authorizationUrl,
                }
              : { status: result.status },
            req.id,
          ),
        );
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    beginAuthRoute.path,
    beginAuthRoute.options,
    beginAuthRoute.handler as Parameters<McpConfigRouteHost['post']>[2],
  );

  // POST /mcp/servers/{mcp_server_id}/auth/complete ----------------------
  const completeAuthRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers/{mcp_server_id}/auth/complete',
      params: mcpServerNameParamSchema,
      body: completeMcpAuthBodySchema,
      success: { data: completeMcpAuthResponseSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Finish the code exchange for an in-flight MCP OAuth flow',
      tags: ['tools'],
      operationId: 'completeMcpServerAuth',
    },
    async (req, reply) => {
      const body = req.body as { flow_id: string; timeout_ms?: number };
      try {
        await mcpConfig.completeAuth(body.flow_id, body.timeout_ms);
        reply.send(okEnvelope({ authorized: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    completeAuthRoute.path,
    completeAuthRoute.options,
    completeAuthRoute.handler as Parameters<McpConfigRouteHost['post']>[2],
  );

  // POST /mcp/servers/{mcp_server_id}/auth/cancel ------------------------
  const cancelAuthRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers/{mcp_server_id}/auth/cancel',
      params: mcpServerNameParamSchema,
      body: cancelMcpAuthBodySchema,
      success: { data: cancelMcpAuthResponseSchema },
      description: 'Cancel an in-flight MCP OAuth flow',
      tags: ['tools'],
      operationId: 'cancelMcpServerAuth',
    },
    async (req, reply) => {
      const body = req.body as { flow_id: string };
      await mcpConfig.cancelAuth(body.flow_id);
      reply.send(okEnvelope({ cancelled: true }, req.id));
    },
  );
  app.post(
    cancelAuthRoute.path,
    cancelAuthRoute.options,
    cancelAuthRoute.handler as Parameters<McpConfigRouteHost['post']>[2],
  );

  // DELETE /mcp/servers/{mcp_server_id}/auth (reset) ---------------------
  const resetAuthRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/mcp/servers/{mcp_server_id}/auth',
      params: mcpServerNameParamSchema,
      success: { data: resetMcpAuthResponseSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Discard stored OAuth tokens for a remote MCP server',
      tags: ['tools'],
      operationId: 'resetMcpServerAuth',
    },
    async (req, reply) => {
      const { mcp_server_id } = req.params as { mcp_server_id: string };
      try {
        await mcpConfig.resetAuth(mcp_server_id);
        reply.send(okEnvelope({ reset: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    resetAuthRoute.path,
    resetAuthRoute.options,
    resetAuthRoute.handler as Parameters<McpConfigRouteHost['delete']>[2],
  );
}

// ---------------------------------------------------------------------------
// Projection — stored `{name, ...config}` shape → wire `{name, config}` shape.
// ---------------------------------------------------------------------------

function toWireServer(server: GlobalMcpServerConfig): { name: string; config: unknown } {
  return { name: server.name, config: mcpConfigWithoutName(server) };
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof Error2) {
    const code = MCP_ERROR_MAP[err.code];
    if (code !== undefined) {
      reply.send(errEnvelope(code, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

const MCP_ERROR_MAP: Record<string, ErrorCode> = {
  [ErrorCodes.MCP_SERVER_NOT_FOUND]: ErrorCode.MCP_SERVER_NOT_FOUND,
  [ErrorCodes.REQUEST_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.CONFIG_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.MCP_OAUTH_FAILED]: ErrorCode.VALIDATION_FAILED,
};
