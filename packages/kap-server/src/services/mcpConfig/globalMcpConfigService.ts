/**
 * User-global MCP server management for the REST surface: CRUD on
 * `<home>/mcp.json` (the same file the CLI's TUI manages), the OAuth
 * authorization flow orchestration, and the standalone connectivity probe.
 *
 * agent-core-v2 only READS `mcp.json` (its workspace config service watches
 * the file and applies increments live — see `workspaceMcpConfigService`), so
 * writes live here; this is the server-side counterpart of the CLI's
 * `GlobalMcpConfigStore` (`packages/node-sdk/src/v2/global-mcp.ts`), sharing
 * its semantics: v1-wire validation (the `auth: 'oauth'` marker must survive a
 * round-trip, which the v2 schema would strip), a per-server OAuth flow
 * registry, and a throwaway-connection-manager probe.
 *
 * Errors are raised as coded `Error2`; routes map them to wire codes.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  Error2,
  ErrorCodes,
  IConfigService,
  IMcpOAuthStore,
  type Scope,
} from '@moonshot-ai/agent-core-v2';
import { MCP_SECTION, type McpSection } from '@moonshot-ai/agent-core-v2/app/mcpConfig/configSection';
import { atomicWrite } from '@moonshot-ai/agent-core-v2/_base/utils/fs';
import { McpConnectionManager } from '@moonshot-ai/agent-core-v2/mcpCore/connection-manager';
import {
  AlreadyAuthorizedError,
  McpOAuthService,
  type BeginAuthorizationResult,
} from '@moonshot-ai/agent-core-v2/mcpCore/oauth/service';

import {
  mcpServerConfigSchema,
  type McpRemoteServerConfig,
  type McpServerConfig,
} from '../../protocol/mcp-server-config';

export const GLOBAL_MCP_CONFIG_FILE = 'mcp.json';
export const DEFAULT_GLOBAL_MCP_AUTH_TIMEOUT_MS = 10 * 60_000;

export interface McpTestResult {
  readonly success: boolean;
  readonly output: string;
}

export interface BeginMcpAuthResult {
  readonly status: 'authorization-required' | 'already-authorized';
  readonly flowId?: string;
  readonly authorizationUrl?: string;
}

/**
 * A named `<home>/mcp.json` entry in its stored shape: the config fields
 * spread alongside the name (the file maps `name → config`; the wire protocol
 * nests them as `{name, config}`, converted at the route boundary).
 */
export type GlobalMcpServerConfig = McpServerConfig & { readonly name: string };

interface GlobalMcpConfigFile {
  readonly raw: Record<string, unknown>;
  readonly rawServers: Record<string, unknown>;
  readonly servers: readonly GlobalMcpServerConfig[];
}

export class GlobalMcpConfigService {
  readonly path: string;

  private readonly oauth: McpOAuthService;
  /** Active OAuth flows, keyed by server name (one flow per server; beginning a
   *  new one cancels the previous). `flowId` on the wire is the server name. */
  private readonly flows = new Map<string, BeginAuthorizationResult>();

  constructor(
    private readonly core: Scope,
    homeDir: string,
  ) {
    this.path = join(homeDir, GLOBAL_MCP_CONFIG_FILE);
    this.oauth = new McpOAuthService({ store: core.accessor.get(IMcpOAuthStore) });
  }

  // -- CRUD ------------------------------------------------------------------

  async list(): Promise<readonly GlobalMcpServerConfig[]> {
    return (await this.read()).servers;
  }

  async get(name: string): Promise<GlobalMcpServerConfig> {
    const normalizedName = normalizeServerName(name);
    const server = (await this.read()).servers.find((entry) => entry.name === normalizedName);
    if (server !== undefined) return server;
    throw serverNotFound(normalizedName);
  }

  async add(server: GlobalMcpServerConfig): Promise<readonly GlobalMcpServerConfig[]> {
    const normalized = parseServerInput(server);
    const file = await this.read();
    if (Object.hasOwn(file.rawServers, normalized.name)) {
      throw new Error2(
        ErrorCodes.REQUEST_INVALID,
        `MCP server "${normalized.name}" already exists`,
      );
    }
    await this.write(file, {
      ...file.rawServers,
      [normalized.name]: persistedEntry(normalized),
    });
    return this.list();
  }

  async remove(name: string): Promise<readonly GlobalMcpServerConfig[]> {
    const normalizedName = normalizeServerName(name);
    const file = await this.read();
    if (!Object.hasOwn(file.rawServers, normalizedName)) return file.servers;
    const nextServers = Object.fromEntries(
      Object.entries(file.rawServers).filter(([entryName]) => entryName !== normalizedName),
    );
    await this.write(file, nextServers);
    // Drop any in-flight authorization for the removed server.
    const flow = this.flows.get(normalizedName);
    if (flow !== undefined) {
      this.flows.delete(normalizedName);
      await flow.cancel().catch(() => {});
    }
    return this.list();
  }

  // -- OAuth -----------------------------------------------------------------

  async beginAuth(name: string): Promise<BeginMcpAuthResult> {
    const server = await this.get(name);
    const config = requireOAuthMcpServer(server);
    try {
      const flow = await this.oauth.beginAuthorization(server.name, config.url);
      const previous = this.flows.get(server.name);
      if (previous !== undefined) {
        await previous.cancel().catch(() => {});
      }
      this.flows.set(server.name, flow);
      return {
        status: 'authorization-required',
        flowId: server.name,
        authorizationUrl: flow.authorizationUrl.toString(),
      };
    } catch (error) {
      if (error instanceof AlreadyAuthorizedError) {
        return { status: 'already-authorized' };
      }
      throw error;
    }
  }

  async completeAuth(name: string, timeoutMs?: number): Promise<void> {
    const flow = this.flows.get(name);
    if (flow === undefined) {
      throw new Error2(
        ErrorCodes.REQUEST_INVALID,
        `No active OAuth flow for MCP server "${name}"`,
      );
    }
    try {
      await flow.complete({ timeoutMs: timeoutMs ?? DEFAULT_GLOBAL_MCP_AUTH_TIMEOUT_MS });
    } finally {
      this.flows.delete(name);
    }
  }

  async cancelAuth(name: string): Promise<void> {
    const flow = this.flows.get(name);
    if (flow === undefined) return;
    this.flows.delete(name);
    await flow.cancel();
  }

  async resetAuth(name: string): Promise<void> {
    const server = await this.get(name);
    const config = requireRemoteMcpServer(server);
    await this.oauth.invalidate(server.name, config.url);
  }

  // -- Probe -----------------------------------------------------------------

  async test(name: string, cwd?: string): Promise<McpTestResult> {
    const server = await this.get(name);
    const config = mcpConfigWithoutName(server);
    const section = this.core.accessor
      .get(IConfigService)
      .get<McpSection | undefined>(MCP_SECTION);
    const manager = new McpConnectionManager({
      stdioCwd: cwd,
      oauthService: this.oauth,
      resolveDefaultTimeouts: () => ({
        startupTimeoutMs: section?.startupTimeoutMs,
        toolTimeoutMs: section?.toolTimeoutMs,
      }),
    });
    try {
      await manager.connectAll({ [server.name]: config });
      return standaloneMcpTestResult(server.name, manager);
    } finally {
      await manager.shutdown();
    }
  }

  // -- Store internals --------------------------------------------------------

  private async read(): Promise<GlobalMcpConfigFile> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf-8');
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') {
        return { raw: {}, rawServers: {}, servers: [] };
      }
      throw configError(`Failed to read ${this.path}: ${describeError(error)}`, error);
    }

    if (text.trim().length === 0) {
      return { raw: {}, rawServers: {}, servers: [] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      throw configError(`Invalid JSON in ${this.path}: ${describeError(error)}`, error);
    }
    if (!isRecord(parsed)) {
      throw configError(`Invalid MCP config in ${this.path}: expected a JSON object`);
    }
    const rawServersValue = parsed['mcpServers'];
    if (rawServersValue !== undefined && !isRecord(rawServersValue)) {
      throw configError(`Invalid MCP config in ${this.path}: "mcpServers" must be an object`);
    }
    const rawServers = rawServersValue ?? {};
    const servers = Object.entries(rawServers).map(([name, value]) => parseServer(name, value));
    return { raw: parsed, rawServers, servers };
  }

  private async write(file: GlobalMcpConfigFile, rawServers: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await atomicWrite(
      this.path,
      `${JSON.stringify({ ...file.raw, mcpServers: rawServers }, null, 2)}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Guards + projections (semantics match the CLI's v1 port).
// ---------------------------------------------------------------------------

export function requireRemoteMcpServer(server: GlobalMcpServerConfig): McpRemoteServerConfig {
  const config = mcpConfigWithoutName(server);
  if (config.transport !== 'stdio') return config;
  throw new Error2(
    ErrorCodes.REQUEST_INVALID,
    `MCP server "${server.name}" does not use a remote transport`,
  );
}

export function requireOAuthMcpServer(server: GlobalMcpServerConfig): McpRemoteServerConfig {
  const config = requireRemoteMcpServer(server);
  if (config.bearerTokenEnvVar !== undefined) {
    throw new Error2(
      ErrorCodes.REQUEST_INVALID,
      `MCP server "${server.name}" uses a static bearer token`,
    );
  }
  if (config.headers !== undefined && config.auth !== 'oauth') {
    throw new Error2(
      ErrorCodes.REQUEST_INVALID,
      `MCP server "${server.name}" uses static headers and is not marked for OAuth`,
    );
  }
  return config;
}

export function mcpConfigWithoutName(server: GlobalMcpServerConfig): McpServerConfig {
  const { name: _name, ...config } = server;
  return config;
}

export function standaloneMcpTestResult(
  name: string,
  manager: McpConnectionManager,
): McpTestResult {
  const entry = manager.get(name);
  if (entry?.status !== 'connected') {
    return {
      success: false,
      output:
        entry?.error ?? `MCP server "${name}" finished with status ${entry?.status ?? 'unknown'}`,
    };
  }
  const tools = manager.resolved(name)?.rawTools ?? [];
  const lines = [
    `Connected to MCP server "${name}".`,
    `Available tools: ${tools.length}`,
    ...tools.map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`),
  ];
  return { success: true, output: lines.join('\n') };
}

function parseServerInput(server: GlobalMcpServerConfig): GlobalMcpServerConfig {
  return parseServer(normalizeServerName(server.name), server);
}

function parseServer(name: string, value: unknown): GlobalMcpServerConfig {
  const result = mcpServerConfigSchema.safeParse(value);
  if (!result.success) {
    throw configError(`Invalid MCP server "${name}" in global config: ${result.error.message}`);
  }
  return { name, ...result.data };
}

function persistedEntry(server: GlobalMcpServerConfig): McpServerConfig {
  const { name: _name, ...entry } = server;
  return entry;
}

function normalizeServerName(name: string): string {
  const normalized = name.trim();
  if (normalized.length > 0) return normalized;
  throw new Error2(ErrorCodes.REQUEST_INVALID, 'MCP server name cannot be empty');
}

function serverNotFound(name: string): Error2 {
  return new Error2(ErrorCodes.MCP_SERVER_NOT_FOUND, `MCP server "${name}" was not found`);
}

function configError(message: string, cause?: unknown): Error2 {
  return new Error2(ErrorCodes.CONFIG_INVALID, message, { cause });
}

function errorCode(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error['code'];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
