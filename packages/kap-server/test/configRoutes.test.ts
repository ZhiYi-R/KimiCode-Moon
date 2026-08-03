/**
 * Phase-3 configuration-surface routes: user-global MCP server management
 * (`/mcp/servers` CRUD + auth guards + probe), session cron tasks
 * (`/sessions/{id}/cron`), plugin management (`/plugins`), and workspace
 * additional directories (`/workspaces/{id}/dirs`).
 *
 * These routes were added for the desktop/web GUI (the TUI drives the same
 * services over in-process RPC). The tests exercise the wire contract with a
 * real server on an ephemeral port; marketplace fetches are stubbed via
 * `KIMI_CODE_PLUGIN_MARKETPLACE_URL` + a conditional global fetch, and OAuth
 * begin is only exercised on its guard path (a live remote server would be
 * needed for the happy path).
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authHeaders } from './helpers/auth';

const MARKETPLACE_URL = 'https://marketplace.test/plugins.json';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

const FAKE_MARKETPLACE = {
  version: '1',
  plugins: [
    {
      id: 'fake-plugin',
      displayName: 'Fake Plugin',
      source: 'https://example.test/fake-plugin.zip',
      tier: 'official',
      version: '1.0.0',
    },
  ],
};

describe('server-v2 phase-3 config routes', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kimi-server-v2-config-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
    vi.stubEnv('KIMI_CODE_PLUGIN_MARKETPLACE_URL', MARKETPLACE_URL);
    // Only marketplace fetches are stubbed; everything else uses the real
    // fetch (the server itself talks to loopback, never the network here).
    const realFetch = globalThis.fetch.bind(globalThis);
    vi.stubGlobal('fetch', ((input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.href;
      if (url.startsWith(MARKETPLACE_URL)) {
        return Promise.resolve(
          new Response(JSON.stringify(FAKE_MARKETPLACE), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return realFetch(input, init);
    }) as typeof fetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as never);
      home = undefined;
    }
  });

  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Envelope<T> }> {
    const hasBody = body !== undefined;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: authHeaders(
        server as RunningServer,
        hasBody ? { 'content-type': 'application/json' } : {},
      ),
      body: hasBody ? JSON.stringify(body) : undefined,
    } as never);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) as Envelope<T> };
  }

  const get = <T>(path: string) => request<T>('GET', path);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
  const del = <T>(path: string, body?: unknown) => request<T>('DELETE', path, body);

  // ---------------------------------------------------------------------
  // MCP server management
  // ---------------------------------------------------------------------

  describe('/mcp/servers management', () => {
    it('lists the persisted global config via GET /mcp/config', async () => {
      await post('/api/v1/mcp/servers', {
        name: 'listed',
        config: { transport: 'stdio', command: 'npx' },
      });
      const { status, body } = await get<{ servers: unknown[] }>('/api/v1/mcp/config');
      expect(status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.servers).toEqual([
        expect.objectContaining({ name: 'listed', config: expect.objectContaining({ transport: 'stdio' }) }),
      ]);
    });

    it('adds a server to <home>/mcp.json and lists it back', async () => {
      const { status, body } = await post<{ servers: unknown[] }>('/api/v1/mcp/servers', {
        name: 'stdio-test',
        config: { transport: 'stdio', command: 'npx', args: ['-y', 'some-mcp'] },
      });

      expect(status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.servers).toEqual([
        expect.objectContaining({ name: 'stdio-test', config: expect.objectContaining({ transport: 'stdio' }) }),
      ]);
      // Persisted on disk under the home dir.
      const onDisk = JSON.parse(await readFile(join(home as string, 'mcp.json'), 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      expect(onDisk.mcpServers['stdio-test']).toEqual(
        expect.objectContaining({ command: 'npx' }),
      );
    });

    it('rejects a duplicate server name with 40001', async () => {
      const body = { name: 'dup', config: { transport: 'stdio', command: 'npx' } };
      await post('/api/v1/mcp/servers', body);
      const { body: dup } = await post<null>('/api/v1/mcp/servers', body);
      expect(dup.code).toBe(40001);
    });

    it('removes a server and drops the on-disk entry', async () => {
      await post('/api/v1/mcp/servers', {
        name: 'gone',
        config: { transport: 'stdio', command: 'npx' },
      });
      const { body } = await del<{ servers: unknown[] }>('/api/v1/mcp/servers/gone');
      expect(body.code).toBe(0);
      expect(body.data.servers).toEqual([]);
      const onDisk = JSON.parse(await readFile(join(home as string, 'mcp.json'), 'utf8')) as {
        mcpServers: Record<string, unknown>;
      };
      expect(onDisk.mcpServers['gone']).toBeUndefined();
    });

    it('removing an unknown server is a no-op success', async () => {
      const { body } = await del<{ servers: unknown[] }>('/api/v1/mcp/servers/nope');
      expect(body.code).toBe(0);
      expect(body.data.servers).toEqual([]);
    });

    it('probes an unknown server with 40408', async () => {
      const { body } = await post<null>('/api/v1/mcp/servers/nope/test');
      expect(body.code).toBe(40408);
    });

    it('probes a known-but-unreachable server with success:false', async () => {
      await post('/api/v1/mcp/servers', {
        name: 'dead',
        config: { transport: 'stdio', command: 'kimi-definitely-not-a-real-command-xyz' },
      });
      const { body } = await post<{ success: boolean; output: string }>(
        '/api/v1/mcp/servers/dead/test',
      );
      expect(body.code).toBe(0);
      expect(body.data.success).toBe(false);
      expect(body.data.output.length).toBeGreaterThan(0);
    });

    it('rejects OAuth begin on a stdio server with 40001', async () => {
      await post('/api/v1/mcp/servers', {
        name: 'local',
        config: { transport: 'stdio', command: 'npx' },
      });
      const { body } = await post<null>('/api/v1/mcp/servers/local/auth');
      expect(body.code).toBe(40001);
    });
  });

  // ---------------------------------------------------------------------
  // Session cron tasks
  // ---------------------------------------------------------------------

  describe('/sessions/{id}/cron', () => {
    async function createSession(): Promise<string> {
      const { body } = await post<{ id: string }>('/api/v1/sessions', {
        metadata: { cwd: home as string },
      });
      expect(body.code).toBe(0);
      return body.data.id;
    }

    it('reports session.not_found for an unknown session', async () => {
      const { body } = await get<null>('/api/v1/sessions/nope/cron');
      expect(body.code).toBe(40401);
    });

    it('lists, creates, and deletes tasks on a live session', async () => {
      const sessionId = await createSession();

      const empty = await get<{ tasks: unknown[] }>(`/api/v1/sessions/${sessionId}/cron`);
      expect(empty.body.code).toBe(0);
      expect(empty.body.data.tasks).toEqual([]);

      const created = await post<{ task: { id: string; cron: string; prompt: string } }>(
        `/api/v1/sessions/${sessionId}/cron`,
        { cron: '30 14 28 2 *', prompt: 'remind me' },
      );
      expect(created.body.code).toBe(0);
      expect(created.body.data.task.cron).toBe('30 14 28 2 *');
      expect(created.body.data.task.prompt).toBe('remind me');

      const listed = await get<{ tasks: unknown[] }>(`/api/v1/sessions/${sessionId}/cron`);
      expect(listed.body.code).toBe(0);
      expect(listed.body.data.tasks).toHaveLength(1);

      const removed = await del<{ removed: string[] }>(
        `/api/v1/sessions/${sessionId}/cron/${created.body.data.task.id}`,
      );
      expect(removed.body.code).toBe(0);
      expect(removed.body.data.removed).toEqual([created.body.data.task.id]);

      const after = await get<{ tasks: unknown[] }>(`/api/v1/sessions/${sessionId}/cron`);
      expect(after.body.data.tasks).toEqual([]);
    });

    it('rejects a malformed cron expression with 40001', async () => {
      const sessionId = await createSession();
      const { body } = await post<null>(`/api/v1/sessions/${sessionId}/cron`, {
        cron: 'not a cron',
        prompt: 'x',
      });
      expect(body.code).toBe(40001);
    });

    it('rejects an oversized prompt with 40001 (zod)', async () => {
      const sessionId = await createSession();
      const { body } = await post<null>(`/api/v1/sessions/${sessionId}/cron`, {
        cron: '30 14 28 2 *',
        prompt: 'x'.repeat(8 * 1024 + 1),
      });
      expect(body.code).toBe(40001);
    });
  });

  // ---------------------------------------------------------------------
  // Plugins
  // ---------------------------------------------------------------------

  describe('/plugins', () => {
    it('lists marketplace entries merged with installed state', async () => {
      const { status, body } = await get<{
        plugins: Array<{ id: string; installed: boolean }>;
      }>('/api/v1/plugins');
      expect(status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.plugins).toEqual([
        expect.objectContaining({ id: 'fake-plugin', installed: false }),
      ]);
    });

    it('rejects installing an unknown marketplace id with 40418', async () => {
      const { body } = await post<null>('/api/v1/plugins/ghost/install');
      expect(body.code).toBe(40418);
    });

    it('rejects uninstalling a plugin that is not installed with 40418', async () => {
      const { body } = await post<null>('/api/v1/plugins/fake-plugin/uninstall');
      expect(body.code).toBe(40418);
    });
  });

  // ---------------------------------------------------------------------
  // Workspace additional directories
  // ---------------------------------------------------------------------

  describe('/workspaces/{id}/dirs', () => {
    async function createWorkspace(): Promise<string> {
      const { body } = await post<{ id: string }>('/api/v1/workspaces', {
        root: home as string,
        name: 'proj',
      });
      expect(body.code).toBe(0);
      return body.data.id;
    }

    it('reports workspace.not_found for an unknown workspace', async () => {
      const { body } = await get<null>('/api/v1/workspaces/nope/dirs');
      expect(body.code).toBe(40410);
    });

    it('adds, lists, and removes an additional directory', async () => {
      const workspaceId = await createWorkspace();
      const extra = join(home as string, 'extra-dir');
      await mkdir(extra);

      const empty = await get<{ additional_dirs: string[] }>(
        `/api/v1/workspaces/${workspaceId}/dirs`,
      );
      expect(empty.body.code).toBe(0);
      expect(empty.body.data.additional_dirs).toEqual([]);

      const added = await post<{ additional_dirs: string[]; persisted: boolean }>(
        `/api/v1/workspaces/${workspaceId}/dirs`,
        { dir: extra },
      );
      expect(added.body.code).toBe(0);
      expect(added.body.data.additional_dirs).toEqual([extra.replaceAll('\\', '/')]);
      expect(added.body.data.persisted).toBe(true);

      const listed = await get<{ additional_dirs: string[] }>(
        `/api/v1/workspaces/${workspaceId}/dirs`,
      );
      expect(listed.body.data.additional_dirs).toEqual([extra.replaceAll('\\', '/')]);

      const removed = await del<{ additional_dirs: string[] }>(
        `/api/v1/workspaces/${workspaceId}/dirs?dir=${encodeURIComponent(extra)}`,
      );
      expect(removed.body.code).toBe(0);
      expect(removed.body.data.additional_dirs).toEqual([]);

      const after = await get<{ additional_dirs: string[] }>(
        `/api/v1/workspaces/${workspaceId}/dirs`,
      );
      expect(after.body.data.additional_dirs).toEqual([]);
    });

    it('rejects adding a non-existent directory with 40001', async () => {
      const workspaceId = await createWorkspace();
      const { body } = await post<null>(`/api/v1/workspaces/${workspaceId}/dirs`, {
        dir: join(home as string, 'does-not-exist'),
      });
      expect(body.code).toBe(40001);
    });
  });

  // ---------------------------------------------------------------------
  // Workspace trust
  // ---------------------------------------------------------------------

  describe('workspace trust', () => {
    it('lists workspaces with their trust state', async () => {
      await post('/api/v1/workspaces', { root: home as string, name: 'proj' });
      const { body } = await get<{ items: Array<{ trusted?: boolean }> }>('/api/v1/workspaces');
      expect(body.code).toBe(0);
      const ws = body.data.items.find((w) => 'trusted' in w);
      expect(ws?.trusted).toBe(false);
    });

    it('reads, sets, and clears trust', async () => {
      const { body: created } = await post<{ id: string }>('/api/v1/workspaces', {
        root: home as string,
        name: 'proj',
      });
      const id = created.data.id;

      const before = await get<{ trusted: boolean }>(`/api/v1/workspaces/${id}/trust`);
      expect(before.body.data.trusted).toBe(false);

      const trusted = await post<{ trusted: boolean }>(`/api/v1/workspaces/${id}/trust`);
      expect(trusted.body.data.trusted).toBe(true);

      const after = await get<{ trusted: boolean }>(`/api/v1/workspaces/${id}/trust`);
      expect(after.body.data.trusted).toBe(true);

      const untrusted = await post<{ trusted: boolean }>(`/api/v1/workspaces/${id}/untrust`);
      expect(untrusted.body.data.trusted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Session goal queue
  // ---------------------------------------------------------------------

  describe('/sessions/{id}/goals', () => {
    async function createSession(): Promise<string> {
      const { body } = await post<{ id: string }>('/api/v1/sessions', {
        metadata: { cwd: home as string },
      });
      expect(body.code).toBe(0);
      return body.data.id;
    }

    it('lists, appends, moves, and removes queued goals', async () => {
      const sessionId = await createSession();

      const empty = await get<{ goals: unknown[] }>(`/api/v1/sessions/${sessionId}/goals`);
      expect(empty.body.code).toBe(0);
      expect(empty.body.data.goals).toEqual([]);

      const first = await post<{ goal: { id: string; objective: string } }>(
        `/api/v1/sessions/${sessionId}/goals`,
        { objective: 'first goal' },
      );
      expect(first.body.code).toBe(0);
      expect(first.body.data.goal.objective).toBe('first goal');

      const second = await post<{ goal: { id: string } }>(
        `/api/v1/sessions/${sessionId}/goals`,
        { objective: 'second goal' },
      );
      expect(second.body.code).toBe(0);

      const listed = await get<{ goals: Array<{ id: string; objective: string }> }>(
        `/api/v1/sessions/${sessionId}/goals`,
      );
      expect(listed.body.data.goals.map((g) => g.objective)).toEqual([
        'first goal',
        'second goal',
      ]);

      const moved = await post<{ moved: true }>(
        `/api/v1/sessions/${sessionId}/goals/${second.body.data.goal.id}/move`,
        { direction: 'up' },
      );
      expect(moved.body.code).toBe(0);
      const reordered = await get<{ goals: Array<{ objective: string }> }>(
        `/api/v1/sessions/${sessionId}/goals`,
      );
      expect(reordered.body.data.goals.map((g) => g.objective)).toEqual([
        'second goal',
        'first goal',
      ]);

      const removed = await del<{ removed: true }>(
        `/api/v1/sessions/${sessionId}/goals/${first.body.data.goal.id}`,
      );
      expect(removed.body.code).toBe(0);
      const after = await get<{ goals: unknown[] }>(`/api/v1/sessions/${sessionId}/goals`);
      expect(after.body.data.goals).toHaveLength(1);
    });

    it('rejects an unknown goal id with 40914', async () => {
      const sessionId = await createSession();
      const { body } = await del<null>(`/api/v1/sessions/${sessionId}/goals/nope`);
      expect(body.code).toBe(40914);
    });

    it('rejects an empty objective with 40001', async () => {
      const sessionId = await createSession();
      const { body } = await post<null>(`/api/v1/sessions/${sessionId}/goals`, {
        objective: '   ',
      });
      expect(body.code).toBe(40001);
    });
  });

  // ---------------------------------------------------------------------
  // Plugin enabled state
  // ---------------------------------------------------------------------

  describe('/plugins enabled state', () => {
    it('rejects toggling an uninstalled plugin with 40418', async () => {
      const { body } = await post<null>('/api/v1/plugins/ghost/enabled', { enabled: false });
      expect(body.code).toBe(40418);
    });

    it('rejects toggling an uninstalled plugin MCP server with 40418', async () => {
      const { body } = await post<null>('/api/v1/plugins/ghost/mcp-servers/db/enabled', {
        enabled: false,
      });
      expect(body.code).toBe(40418);
    });

    it('rejects info for an uninstalled plugin with 40418', async () => {
      const { body } = await get<null>('/api/v1/plugins/ghost');
      expect(body.code).toBe(40418);
    });
  });
});
