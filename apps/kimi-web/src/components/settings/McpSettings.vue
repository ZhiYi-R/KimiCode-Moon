<!-- apps/kimi-web/src/components/settings/McpSettings.vue -->
<!-- MCP server management panel (Settings → MCP): lists the user-global
     <home>/mcp.json config, adds/removes servers, runs the connectivity
     probe, and drives the OAuth authorization flow. -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../../api';
import type { WireGlobalMcpServer } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';
import Spinner from '../ui/Spinner.vue';
import Badge from '../ui/Badge.vue';
import Icon from '../ui/Icon.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const api = getKimiWebApi();

const servers = ref<WireGlobalMcpServer[]>([]);
const loading = ref(true);
const loadError = ref('');

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    servers.value = await api.getMcpConfig();
  } catch (error) {
    loadError.value = String(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// -------------------------------------------------------------------------
// Add-server form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({
  name: '',
  transport: 'stdio' as 'stdio' | 'http' | 'sse',
  command: '',
  args: '',
  url: '',
  env: '',
});
const addError = ref('');
const adding = ref(false);

function openAdd(): void {
  Object.assign(addForm, {
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    env: '',
  });
  addError.value = '';
  showAddForm.value = true;
}

function parseEnv(raw: string): Record<string, string> | undefined {
  const entries = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (entries.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const line of entries) {
    const eq = line.indexOf('=');
    if (eq <= 0) throw new Error(t('mcp.invalidEnv'));
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

async function submitAdd(): Promise<void> {
  const name = addForm.name.trim();
  if (name.length === 0) {
    addError.value = t('mcp.nameRequired');
    return;
  }
  let config: Record<string, unknown>;
  if (addForm.transport === 'stdio') {
    const command = addForm.command.trim();
    if (command.length === 0) {
      addError.value = t('mcp.commandRequired');
      return;
    }
    config = { transport: 'stdio', command };
    const args = addForm.args.trim();
    if (args.length > 0) config['args'] = args.split(/\s+/);
    try {
      const env = parseEnv(addForm.env);
      if (env !== undefined) config['env'] = env;
    } catch (error) {
      addError.value = error instanceof Error ? error.message : String(error);
      return;
    }
  } else {
    const url = addForm.url.trim();
    if (url.length === 0) {
      addError.value = t('mcp.urlRequired');
      return;
    }
    config = { transport: addForm.transport, url };
  }
  addError.value = '';
  adding.value = true;
  try {
    servers.value = await api.addMcpServer(name, config);
    showAddForm.value = false;
  } catch (error) {
    addError.value = String(error);
  } finally {
    adding.value = false;
  }
}

// -------------------------------------------------------------------------
// Per-server actions
// -------------------------------------------------------------------------

/** Server name currently busy with an action (test/auth/remove), if any. */
const busy = ref<string | null>(null);
const busyAction = ref('');
const actionError = ref('');
const testResults = reactive<Record<string, { ok: boolean; output: string }>>({});
/** In-flight OAuth flow: server name → authorization URL. */
const authFlow = ref<{ name: string; url: string } | null>(null);
const authFinished = ref(false);

function runAction(server: string, action: string, work: () => Promise<void>): void {
  if (busy.value !== null) return;
  busy.value = server;
  busyAction.value = action;
  actionError.value = '';
  void work().finally(() => {
    busy.value = null;
    busyAction.value = '';
  });
}

async function testServer(server: string): Promise<void> {
  delete testResults[server];
  runAction(server, 'test', async () => {
    const result = await api.testMcpServer(server);
    testResults[server] = { ok: result.success, output: result.output };
  });
}

async function beginAuth(server: string): Promise<void> {
  runAction(server, 'auth', async () => {
    const result = await api.beginMcpServerAuth(server);
    if (result.status === 'already-authorized') {
      authFinished.value = true;
      return;
    }
    authFlow.value = { name: server, url: result.authorization_url };
    openExternal(result.authorization_url);
  });
}

async function completeAuth(): Promise<void> {
  const flow = authFlow.value;
  if (flow === null) return;
  runAction(flow.name, 'auth', async () => {
    await api.completeMcpServerAuth(flow.name, flow.name);
    authFlow.value = null;
    authFinished.value = true;
  });
}

async function cancelAuth(): Promise<void> {
  authFlow.value = null;
}

async function resetAuth(server: string): Promise<void> {
  runAction(server, 'auth', async () => {
    await api.resetMcpServerAuth(server);
  });
}

async function removeServer(server: string): Promise<void> {
  const ok = await confirm({
    title: t('mcp.removeConfirmTitle'),
    message: t('mcp.removeConfirmMessage', { name: server }),
    variant: 'danger',
    action: async () => {
      servers.value = await api.removeMcpServer(server);
    },
  });
  if (ok) {
    delete testResults[server];
    if (authFlow.value?.name === server) authFlow.value = null;
  }
}

function isBusy(server: string, action?: string): boolean {
  return busy.value === server && (action === undefined || busyAction.value === action);
}

/** Open an external URL in a new browser tab (noopener). */
function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

function transportLabel(server: WireGlobalMcpServer): string {
  return server.config.transport;
}

function serverEndpoint(server: WireGlobalMcpServer): string {
  const config = server.config;
  if (config.transport === 'stdio') return config.command ?? '';
  return config.url ?? '';
}
</script>

<template>
  <div class="mcp">
    <p class="panel-hint">{{ t('mcp.hint') }}</p>

    <div v-if="loading" class="state-row">
      <Spinner size="sm" />
      <span>{{ t('mcp.loading') }}</span>
    </div>
    <div v-else-if="loadError" class="state-row unavail">
      <Icon name="alert-triangle" size="md" />
      <span>{{ t('mcp.loadFailed') }} {{ loadError }}</span>
    </div>
    <div v-else-if="servers.length === 0" class="state-row empty">
      {{ t('mcp.empty') }}
    </div>
    <template v-else>
      <div v-for="server in servers" :key="server.name" class="server-row">
        <div class="server-info">
          <span class="server-name">{{ server.name }}</span>
          <span class="server-endpoint">{{ serverEndpoint(server) }}</span>
          <span class="server-meta">
            <Badge variant="neutral" size="sm">{{ transportLabel(server) }}</Badge>
          </span>
        </div>
        <div class="server-actions">
          <Button
            variant="secondary"
            size="sm"
            :disabled="busy !== null"
            @click="testServer(server.name)"
          >
            <Spinner v-if="isBusy(server.name, 'test')" size="sm" />
            {{ isBusy(server.name, 'test') ? t('mcp.testing') : t('mcp.test') }}
          </Button>
          <Button
            v-if="server.config.transport !== 'stdio'"
            variant="secondary"
            size="sm"
            :disabled="busy !== null"
            @click="beginAuth(server.name)"
          >
            <Spinner v-if="isBusy(server.name, 'auth') && !authFlow" size="sm" />
            {{ t('mcp.authorize') }}
          </Button>
          <Button
            v-if="server.config.transport !== 'stdio'"
            variant="secondary"
            size="sm"
            :disabled="busy !== null"
            @click="resetAuth(server.name)"
          >
            {{ t('mcp.resetAuth') }}
          </Button>
          <Button variant="danger-soft" size="sm" :disabled="busy !== null" @click="removeServer(server.name)">
            {{ t('mcp.remove') }}
          </Button>
        </div>
        <div v-if="testResults[server.name]" class="test-result" :class="testResults[server.name]?.ok ? 'ok' : 'fail'">
          {{
            testResults[server.name]?.ok
              ? t('mcp.testOk', { output: testResults[server.name]?.output ?? '' })
              : t('mcp.testFail', { output: testResults[server.name]?.output ?? '' })
          }}
        </div>
      </div>
    </template>

    <div v-if="actionError" class="action-error">{{ actionError }}</div>
    <div v-if="authFinished" class="action-note">{{ t('mcp.authAlready') }}</div>

    <div v-if="authFlow" class="auth-flow">
      <p>{{ t('mcp.authFlowHint') }}</p>
      <div class="auth-btns">
        <Button variant="secondary" size="sm" @click="openExternal(authFlow.url)">
          {{ t('mcp.authOpen') }}
        </Button>
        <Button variant="primary" size="sm" :disabled="busy !== null" @click="completeAuth">
          {{ t('mcp.authFinish') }}
        </Button>
        <Button variant="secondary" size="sm" @click="cancelAuth">{{ t('mcp.authCancel') }}</Button>
      </div>
    </div>

    <div class="add-section">
      <template v-if="!showAddForm">
        <Button variant="primary" size="sm" @click="openAdd">
          <Icon name="plus" size="sm" />
          {{ t('mcp.add') }}
        </Button>
      </template>
      <template v-else>
        <div class="add-form">
          <Field :label="t('mcp.fieldName')">
            <Input v-model="addForm.name" :placeholder="t('mcp.fieldNamePlaceholder')" spellcheck="false" />
          </Field>
          <Field :label="t('mcp.fieldTransport')">
            <Select v-model="addForm.transport">
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </Select>
          </Field>
          <template v-if="addForm.transport === 'stdio'">
            <Field :label="t('mcp.fieldCommand')">
              <Input v-model="addForm.command" :placeholder="t('mcp.fieldCommandPlaceholder')" spellcheck="false" />
            </Field>
            <Field :label="t('mcp.fieldArgs')">
              <Input v-model="addForm.args" spellcheck="false" />
            </Field>
            <Field :label="t('mcp.fieldEnv')">
              <Input v-model="addForm.env" spellcheck="false" />
            </Field>
          </template>
          <template v-else>
            <Field :label="t('mcp.fieldUrl')">
              <Input v-model="addForm.url" :placeholder="t('mcp.fieldUrlPlaceholder')" spellcheck="false" />
            </Field>
          </template>
          <div v-if="addError" class="add-error">{{ addError }}</div>
          <div class="form-btns">
            <Button variant="primary" size="sm" :disabled="adding" @click="submitAdd">
              <Spinner v-if="adding" size="sm" />
              {{ t('mcp.add') }}
            </Button>
            <Button variant="secondary" size="sm" @click="showAddForm = false">{{ t('mcp.cancel') }}</Button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mcp { display: flex; flex-direction: column; gap: var(--space-3); }
.panel-hint {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin: 0;
}
.state-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
}
.state-row.unavail { color: var(--color-warning); }
.state-row.empty { color: var(--color-text-faint); }

.server-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}
.server-row:last-child { border-bottom: none; }
.server-info { display: flex; flex-direction: column; gap: var(--space-1); }
.server-name {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.server-endpoint {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.server-meta { display: flex; align-items: center; gap: var(--space-2); }
.server-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.test-result {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  word-break: break-all;
}
.test-result.ok { color: var(--color-success); }
.test-result.fail { color: var(--color-danger); }

.action-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.action-note {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-success);
}

.auth-flow {
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.auth-flow p {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin: 0;
}
.auth-btns { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.add-section { border-top: 1px solid var(--color-line); padding-top: var(--space-3); }
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.add-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.form-btns { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
