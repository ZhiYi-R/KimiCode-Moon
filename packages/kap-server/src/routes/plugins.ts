/**
 * `/plugins` routes — plugin marketplace listing (merged with installed
 * state), install, and uninstall.
 *
 * The marketplace is fetched from the CDN (or `KIMI_CODE_PLUGIN_MARKETPLACE_URL`)
 * per request; installed state comes from the App-scoped `IPluginService`.
 * install/uninstall run `reloadPlugins()` afterwards so live workspace
 * handlers pick up the plugin's MCP servers / skills / hooks (the engine's
 * consumers listen on `onDidReload`), matching the TUI's "run /reload to
 * apply" flow without a manual step.
 *
 * Error mapping: marketplace-unreachable → 40001; unknown plugin id → 40418
 * (`PLUGIN_NOT_FOUND`); plugin install/remove failures propagate as 50001.
 */

import { Error2, ErrorCodes, IPluginService, type Scope } from '@moonshot-ai/agent-core-v2';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  installPluginResponseSchema,
  listPluginsQuerySchema,
  listPluginsResponseSchema,
  pluginIdParamSchema,
  pluginInfoResponseSchema,
  pluginMcpServerParamSchema,
  setPluginEnabledBodySchema,
  setPluginEnabledResponseSchema,
  uninstallPluginResponseSchema,
  type PluginEntry,
  type PluginMcpServerInfo,
  type SetPluginEnabledBody,
} from '../protocol/rest-plugins';
import {
  loadPluginMarketplace,
  type PluginMarketplaceEntry,
} from '../services/plugin/marketplace';

interface PluginRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; query: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerPluginsRoutes(app: PluginRouteHost, core: Scope): void {
  const pluginService = (): IPluginService => core.accessor.get(IPluginService);

  // GET /plugins ----------------------------------------------------------
  const listPluginsRoute = defineRoute(
    {
      method: 'GET',
      path: '/plugins',
      querystring: listPluginsQuerySchema,
      success: { data: listPluginsResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'List marketplace plugins merged with installed state',
      tags: ['plugins'],
      operationId: 'listPlugins',
    },
    async (req, reply) => {
      try {
        const query = req.query as { source?: string } | undefined;
        const [marketplace, installed] = await Promise.all([
          loadPluginMarketplace(undefined, query?.source),
          pluginService().listPlugins(),
        ]);
        const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
        const plugins = marketplace.plugins.map((entry) =>
          projectPluginEntry(entry, installedById.get(entry.id)),
        );
        reply.send(okEnvelope({ plugins }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    listPluginsRoute.path,
    listPluginsRoute.options,
    listPluginsRoute.handler as Parameters<PluginRouteHost['get']>[2],
  );

  // POST /plugins/{plugin_id}/install -------------------------------------
  const installPluginRoute = defineRoute(
    {
      method: 'POST',
      path: '/plugins/{plugin_id}/install',
      params: pluginIdParamSchema,
      success: { data: installPluginResponseSchema },
      errors: {
        [ErrorCode.PLUGIN_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Install a marketplace plugin by id, then reload plugins',
      tags: ['plugins'],
      operationId: 'installPlugin',
    },
    async (req, reply) => {
      const { plugin_id } = req.params as { plugin_id: string };
      try {
        const marketplace = await loadPluginMarketplace();
        const entry = marketplace.plugins.find((candidate) => candidate.id === plugin_id);
        if (entry === undefined) {
          reply.send(pluginNotFound(plugin_id, req.id));
          return;
        }
        const summary = await pluginService().installPlugin({ source: entry.source });
        const reload = await pluginService().reloadPlugins();
        reply.send(
          okEnvelope(
            {
              plugin: projectPluginEntry(entry, summary),
              reload: {
                added: [...reload.added],
                removed: [...reload.removed],
                errors: [...reload.errors],
              },
            },
            req.id,
          ),
        );
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    installPluginRoute.path,
    installPluginRoute.options,
    installPluginRoute.handler as Parameters<PluginRouteHost['post']>[2],
  );

  // POST /plugins/{plugin_id}/uninstall -----------------------------------
  const uninstallPluginRoute = defineRoute(
    {
      method: 'POST',
      path: '/plugins/{plugin_id}/uninstall',
      params: pluginIdParamSchema,
      success: { data: uninstallPluginResponseSchema },
      errors: {
        [ErrorCode.PLUGIN_NOT_FOUND]: {},
      },
      description: 'Uninstall a plugin, then reload plugins',
      tags: ['plugins'],
      operationId: 'uninstallPlugin',
    },
    async (req, reply) => {
      const { plugin_id } = req.params as { plugin_id: string };
      try {
        const installed = await pluginService().listPlugins();
        if (!installed.some((plugin) => plugin.id === plugin_id)) {
          reply.send(pluginNotFound(plugin_id, req.id));
          return;
        }
        await pluginService().removePlugin({ id: plugin_id });
        await pluginService().reloadPlugins();
        reply.send(okEnvelope({ removed: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    uninstallPluginRoute.path,
    uninstallPluginRoute.options,
    uninstallPluginRoute.handler as Parameters<PluginRouteHost['post']>[2],
  );

  // POST /plugins/{plugin_id}/enabled ------------------------------------
  const setPluginEnabledRoute = defineRoute(
    {
      method: 'POST',
      path: '/plugins/{plugin_id}/enabled',
      params: pluginIdParamSchema,
      body: setPluginEnabledBodySchema,
      success: { data: setPluginEnabledResponseSchema },
      errors: {
        [ErrorCode.PLUGIN_NOT_FOUND]: {},
      },
      description: 'Enable or disable an installed plugin, then reload plugins',
      tags: ['plugins'],
      operationId: 'setPluginEnabled',
    },
    async (req, reply) => {
      const { plugin_id } = req.params as { plugin_id: string };
      const body = req.body as SetPluginEnabledBody;
      if (!(await isInstalled(pluginService(), plugin_id))) {
        reply.send(pluginNotFound(plugin_id, req.id));
        return;
      }
      try {
        await pluginService().setPluginEnabled({ id: plugin_id, enabled: body.enabled });
        await pluginService().reloadPlugins();
        reply.send(okEnvelope({ enabled: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    setPluginEnabledRoute.path,
    setPluginEnabledRoute.options,
    setPluginEnabledRoute.handler as Parameters<PluginRouteHost['post']>[2],
  );

  // POST /plugins/{plugin_id}/mcp-servers/{mcp_server}/enabled ------------
  const setPluginMcpEnabledRoute = defineRoute(
    {
      method: 'POST',
      path: '/plugins/{plugin_id}/mcp-servers/{mcp_server}/enabled',
      params: pluginMcpServerParamSchema,
      body: setPluginEnabledBodySchema,
      success: { data: setPluginEnabledResponseSchema },
      errors: {
        [ErrorCode.PLUGIN_NOT_FOUND]: {},
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Enable or disable one MCP server of an installed plugin, then reload plugins',
      tags: ['plugins'],
      operationId: 'setPluginMcpServerEnabled',
    },
    async (req, reply) => {
      const { plugin_id, mcp_server } = req.params as {
        plugin_id: string;
        mcp_server: string;
      };
      const body = req.body as SetPluginEnabledBody;
      if (!(await isInstalled(pluginService(), plugin_id))) {
        reply.send(pluginNotFound(plugin_id, req.id));
        return;
      }
      try {
        await pluginService().setPluginMcpServerEnabled({
          id: plugin_id,
          server: mcp_server,
          enabled: body.enabled,
        });
        await pluginService().reloadPlugins();
        reply.send(okEnvelope({ enabled: true }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    setPluginMcpEnabledRoute.path,
    setPluginMcpEnabledRoute.options,
    setPluginMcpEnabledRoute.handler as Parameters<PluginRouteHost['post']>[2],
  );

  // GET /plugins/{plugin_id} ---------------------------------------------
  const getPluginInfoRoute = defineRoute(
    {
      method: 'GET',
      path: '/plugins/{plugin_id}',
      params: pluginIdParamSchema,
      success: { data: pluginInfoResponseSchema },
      errors: {
        [ErrorCode.PLUGIN_NOT_FOUND]: {},
      },
      description: 'Get an installed plugin\'s detail (including per-MCP-server enabled state)',
      tags: ['plugins'],
      operationId: 'getPluginInfo',
    },
    async (req, reply) => {
      const { plugin_id } = req.params as { plugin_id: string };
      if (!(await isInstalled(pluginService(), plugin_id))) {
        reply.send(pluginNotFound(plugin_id, req.id));
        return;
      }
      try {
        const info = await pluginService().getPluginInfo({ id: plugin_id });
        reply.send(okEnvelope({ plugin: projectPluginInfo(info) }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    getPluginInfoRoute.path,
    getPluginInfoRoute.options,
    getPluginInfoRoute.handler as Parameters<PluginRouteHost['get']>[2],
  );
}

/** True when the plugin is installed (its id appears in the installed list). */
async function isInstalled(service: IPluginService, pluginId: string): Promise<boolean> {
  const installed = await service.listPlugins();
  return installed.some((plugin) => plugin.id === pluginId);
}

// ---------------------------------------------------------------------------
// Projection + errors
// ---------------------------------------------------------------------------

function projectPluginEntry(
  entry: PluginMarketplaceEntry,
  installed: { id: string; version?: string; enabled?: boolean } | undefined,
): PluginEntry {
  const base: PluginEntry = {
    id: entry.id,
    display_name: entry.displayName,
    source: entry.source,
    installed: installed !== undefined,
  };
  if (entry.tier !== undefined) base.tier = entry.tier;
  if (entry.version !== undefined) base.version = entry.version;
  if (entry.description !== undefined) base.description = entry.description;
  if (entry.homepage !== undefined) base.homepage = entry.homepage;
  if (entry.keywords !== undefined) base.keywords = [...entry.keywords];
  if (installed !== undefined) {
    if (installed.version !== undefined) base.installed_version = installed.version;
    if (installed.enabled !== undefined) base.enabled = installed.enabled;
  }
  return base;
}

function pluginNotFound(pluginId: string, requestId: string): unknown {
  return errEnvelope(
    ErrorCode.PLUGIN_NOT_FOUND,
    `Plugin "${pluginId}" was not found in the marketplace or is not installed`,
    requestId,
  );
}

/** Project `PluginInfo` onto the wire `{plugin}` shape (pluginEntry + mcp servers). */
function projectPluginInfo(info: {
  id: string;
  displayName: string;
  version?: string;
  enabled: boolean;
  mcpServers: readonly {
    name: string;
    enabled: boolean;
    transport: 'stdio' | 'http' | 'sse';
    url?: string;
    command?: string;
  }[];
}): PluginEntry & { mcp_servers: PluginMcpServerInfo[] } {
  const entry: PluginEntry = {
    id: info.id,
    display_name: info.displayName,
    source: '',
    installed: true,
  };
  if (info.version !== undefined) entry.installed_version = info.version;
  entry.enabled = info.enabled;
  return {
    ...entry,
    mcp_servers: info.mcpServers.map((server) => {
      const wire: PluginMcpServerInfo = {
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
      };
      if (server.url !== undefined) wire.url = server.url;
      if (server.command !== undefined) wire.command = server.command;
      return wire;
    }),
  };
}

function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof Error2) {
    const code = PLUGIN_ERROR_MAP[err.code];
    if (code !== undefined) {
      reply.send(errEnvelope(code, err.message, requestId, err.stack));
      return;
    }
  }
  throw err;
}

const PLUGIN_ERROR_MAP: Record<string, ErrorCode> = {
  [ErrorCodes.REQUEST_INVALID]: ErrorCode.VALIDATION_FAILED,
  [ErrorCodes.CONFIG_INVALID]: ErrorCode.VALIDATION_FAILED,
};
