// apps/kimi-web/test/config-surface.test.ts
// Phase-3 config-surface REST adapter: MCP server management, cron tasks,
// plugins, and workspace additional directories.
// Wiring: real client; fetch is stubbed at the network boundary.
// Run: pnpm --filter @moonshot-ai/kimi-web exec vitest run test/config-surface.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonKimiWebApi } from '../src/api/daemon/client';
import { DaemonApiError } from '../src/api/errors';

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, msg: '', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorEnvelope(code: number, msg: string): Response {
  return new Response(JSON.stringify({ code, msg, data: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createApi(): DaemonKimiWebApi {
  return new DaemonKimiWebApi({
    serverHttpUrl: 'http://daemon.test',
    clientId: 'web_test',
    clientName: 'test',
    clientVersion: '0.0.0',
    clientUiMode: 'test',
  });
}

describe('DaemonKimiWebApi MCP config surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gets the global config from /mcp/config', async () => {
    const servers = [
      { name: 'db', config: { transport: 'stdio', command: 'npx' } },
    ];
    vi.mocked(fetch).mockResolvedValue(envelope({ servers }));

    const result = await createApi().getMcpConfig();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://daemon.test/api/v1/mcp/config');
    expect(result).toEqual(servers);
  });

  it('adds a server with a name+config body', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ servers: [] }));

    await createApi().addMcpServer('db', { transport: 'stdio', command: 'npx -y mcp' });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/mcp/servers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'db',
      config: { transport: 'stdio', command: 'npx -y mcp' },
    });
  });

  it('removes a server by encoded name', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ servers: [] }));

    await createApi().removeMcpServer('my/db');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/mcp/servers/my%2Fdb',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });

  it('tests a server and returns the probe result', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ success: true, output: 'Connected.' }));

    const result = await createApi().testMcpServer('db');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/mcp/servers/db/test',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(result).toEqual({ success: true, output: 'Connected.' });
  });

  it('begins an OAuth flow and completes it with the flow id', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        envelope({
          status: 'authorization-required',
          flow_id: 'db',
          authorization_url: 'https://auth.example.com/start',
        }),
      )
      .mockResolvedValueOnce(envelope({ authorized: true }));

    const api = createApi();
    const begun = await api.beginMcpServerAuth('db');
    expect(begun).toEqual({
      status: 'authorization-required',
      flow_id: 'db',
      authorization_url: 'https://auth.example.com/start',
    });

    await api.completeMcpServerAuth('db', 'db');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://daemon.test/api/v1/mcp/servers/db/auth/complete',
    );
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      flow_id: 'db',
    });
  });

  it('resets stored OAuth tokens via DELETE auth', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ reset: true }));

    await createApi().resetMcpServerAuth('db');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/mcp/servers/db/auth',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });

  it('surfaces a non-zero envelope as DaemonApiError', async () => {
    vi.mocked(fetch).mockResolvedValue(errorEnvelope(40408, 'MCP server "db" was not found'));

    await expect(createApi().testMcpServer('db')).rejects.toBeInstanceOf(DaemonApiError);
  });
});

describe('DaemonKimiWebApi cron surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists tasks for a session', async () => {
    const tasks = [
      { id: 't1', cron: '30 14 28 2 *', prompt: 'remind', created_at: 1, next_fire_at: null },
    ];
    vi.mocked(fetch).mockResolvedValue(envelope({ tasks }));

    const result = await createApi().listCronTasks('sess/1');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/cron',
    );
    expect(result).toEqual(tasks);
  });

  it('creates a task with cron/prompt/recurring', async () => {
    const task = { id: 't1', cron: '30 14 28 2 *', prompt: 'remind', created_at: 1, next_fire_at: null };
    vi.mocked(fetch).mockResolvedValue(envelope({ task }));

    const result = await createApi().createCronTask('sess/1', {
      cron: '30 14 28 2 *',
      prompt: 'remind',
      recurring: false,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/sessions/sess%2F1/cron');
    expect(JSON.parse(String(init.body))).toEqual({
      cron: '30 14 28 2 *',
      prompt: 'remind',
      recurring: false,
    });
    expect(result).toEqual(task);
  });

  it('omits recurring when undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(
      envelope({ task: { id: 't', cron: '* * * * *', prompt: 'x', created_at: 1, next_fire_at: null } }),
    );

    await createApi().createCronTask('sess/1', { cron: '* * * * *', prompt: 'x' });

    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body['recurring']).toBeUndefined();
  });

  it('deletes a task', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ removed: ['t1'] }));

    await createApi().deleteCronTask('sess/1', 't1');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/cron/t1',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });
});

describe('DaemonKimiWebApi plugins surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists marketplace plugins merged with installed state', async () => {
    const plugins = [{ id: 'p1', display_name: 'P1', source: 'https://x', installed: false }];
    vi.mocked(fetch).mockResolvedValue(envelope({ plugins }));

    const result = await createApi().listPlugins();

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://daemon.test/api/v1/plugins');
    expect(result).toEqual(plugins);
  });

  it('installs a plugin by id', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ plugin: { id: 'p1' }, reload: { added: [], removed: [], errors: [] } }));

    await createApi().installPlugin('p1');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/plugins/p1/install',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
  });

  it('uninstalls a plugin by id', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ removed: true }));

    await createApi().uninstallPlugin('p1');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/plugins/p1/uninstall',
    );
  });
});

describe('DaemonKimiWebApi workspace dirs surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists additional directories', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ additional_dirs: ['/data'] }));

    const result = await createApi().listWorkspaceDirs('wd_1');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/workspaces/wd_1/dirs',
    );
    expect(result).toEqual(['/data']);
  });

  it('adds a directory with a dir body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      envelope({ additional_dirs: ['/data'], project_root: '/p', config_path: '/p/.kimi-code/local.toml', persisted: true }),
    );

    const result = await createApi().addWorkspaceDir('wd_1', '/data');

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/workspaces/wd_1/dirs');
    expect(JSON.parse(String(init.body))).toEqual({ dir: '/data' });
    expect(result.persisted).toBe(true);
  });

  it('removes a directory via the dir query param', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ additional_dirs: [] }));

    await createApi().removeWorkspaceDir('wd_1', '/data/x');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/workspaces/wd_1/dirs?dir=%2Fdata%2Fx',
    );
    expect((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');
  });
});

describe('DaemonKimiWebApi workspace trust surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads trust state', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ trusted: true }));
    const result = await createApi().getWorkspaceTrust('wd_1');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/workspaces/wd_1/trust',
    );
    expect(result).toEqual({ trusted: true });
  });

  it('trusts and untrusts a workspace', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(envelope({ trusted: true })).mockResolvedValueOnce(envelope({ trusted: false }));

    const api = createApi();
    await api.trustWorkspace('wd_1');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://daemon.test/api/v1/workspaces/wd_1/trust');

    await api.untrustWorkspace('wd_1');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://daemon.test/api/v1/workspaces/wd_1/untrust');
  });
});

describe('DaemonKimiWebApi goal queue surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the queue', async () => {
    const goals = [{ id: 'g1', objective: 'fix lint', created_at: 't', updated_at: 't' }];
    vi.mocked(fetch).mockResolvedValue(envelope({ goals }));
    const result = await createApi().listGoalQueue('sess/1');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/goals',
    );
    expect(result).toEqual(goals);
  });

  it('appends a goal', async () => {
    const goal = { id: 'g1', objective: 'fix lint', created_at: 't', updated_at: 't' };
    vi.mocked(fetch).mockResolvedValue(envelope({ goal }));
    const result = await createApi().appendGoal('sess/1', 'fix lint');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/sessions/sess%2F1/goals');
    expect(JSON.parse(String(init.body))).toEqual({ objective: 'fix lint' });
    expect(result).toEqual(goal);
  });

  it('removes and moves a goal', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(envelope({ removed: true })).mockResolvedValueOnce(envelope({ moved: true }));

    const api = createApi();
    await api.removeGoal('sess/1', 'g1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/goals/g1',
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('DELETE');

    await api.moveGoal('sess/1', 'g1', 'up');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/goals/g1/move',
    );
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      direction: 'up',
    });
  });
});

describe('DaemonKimiWebApi plugin enabled surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets plugin enabled state', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ enabled: true }));
    await createApi().setPluginEnabled('p1', false);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/plugins/p1/enabled');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
  });

  it('sets plugin MCP server enabled state', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ enabled: true }));
    await createApi().setPluginMcpServerEnabled('p1', 'db', true);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/plugins/p1/mcp-servers/db/enabled',
    );
  });

  it('gets plugin info with mcp servers', async () => {
    const plugin = {
      id: 'p1',
      display_name: 'P1',
      source: 'https://x',
      installed: true,
      mcp_servers: [{ name: 'db', enabled: true, transport: 'stdio' }],
    };
    vi.mocked(fetch).mockResolvedValue(envelope({ plugin }));
    const result = await createApi().getPluginInfo('p1');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://daemon.test/api/v1/plugins/p1');
    expect(result.mcp_servers).toEqual([{ name: 'db', enabled: true, transport: 'stdio' }]);
  });
});

describe('DaemonKimiWebApi phase-B gap-closure surface', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs /init via the :init session action', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ generated: true }));
    const result = await createApi().initSession('sess/1');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1:init',
    );
    expect(result).toEqual({ generated: true });
  });

  it('submits feedback with session id and content', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ submitted: true, feedback_id: 42 }));
    const result = await createApi().submitFeedback({ sessionId: 'sess/1', content: 'great' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/feedback');
    expect(JSON.parse(String(init.body))).toEqual({ session_id: 'sess/1', content: 'great' });
    expect(result.feedbackId).toBe(42);
  });

  it('lists plugins with a custom source query', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ plugins: [] }));
    await createApi().listPlugins('https://market.example/plugins.json');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/plugins?source=https%3A%2F%2Fmarket.example%2Fplugins.json',
    );
  });

  it('lists plugins without a source query when absent', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ plugins: [] }));
    await createApi().listPlugins();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://daemon.test/api/v1/plugins');
  });

  it('adds a workspace dir with persist false', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ additional_dirs: ['/x'], persisted: false }));
    await createApi().addWorkspaceDir('wd_1', '/x', false);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/workspaces/wd_1/dirs');
    expect(JSON.parse(String(init.body))).toEqual({ dir: '/x', persist: false });
  });

  it('lists catalog providers', async () => {
    const items = [{ id: 'anthropic', name: 'Anthropic', rejected: false }];
    vi.mocked(fetch).mockResolvedValue(envelope({ items }));
    const result = await createApi().listCatalogProviders();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/catalog/providers',
    );
    expect(result).toEqual(items);
  });

  it('imports a catalog provider via the :import_catalog action', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ provider: { id: 'anthropic' } }));
    await createApi().importCatalogProvider({
      catalogId: 'anthropic',
      apiKey: 'sk-x',
      baseUrl: 'https://api.example.com',
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/providers:import_catalog');
    expect(JSON.parse(String(init.body))).toEqual({
      catalog_id: 'anthropic',
      api_key: 'sk-x',
      base_url: 'https://api.example.com',
    });
  });

  it('imports a registry via the :import_registry action', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope({ imported: 3 }));
    await createApi().importRegistry({ url: 'https://x/api.json' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://daemon.test/api/v1/providers:import_registry');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://x/api.json' });
  });
});
