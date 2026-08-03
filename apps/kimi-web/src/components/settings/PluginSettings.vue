<!-- apps/kimi-web/src/components/settings/PluginSettings.vue -->
<!-- Plugin management panel (Settings → Plugins): marketplace listing merged
     with installed state, install / uninstall. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../../api';
import type { WirePluginEntry, WirePluginInfo } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Button from '../ui/Button.vue';
import Spinner from '../ui/Spinner.vue';
import Badge from '../ui/Badge.vue';
import Icon from '../ui/Icon.vue';
import Switch from '../ui/Switch.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const api = getKimiWebApi();

const plugins = ref<WirePluginEntry[]>([]);
const loading = ref(true);
const loadError = ref('');
const busy = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    plugins.value = await api.listPlugins();
  } catch (error) {
    loadError.value = String(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function install(plugin: WirePluginEntry): Promise<void> {
  if (busy.value !== null) return;
  busy.value = plugin.id;
  try {
    await api.installPlugin(plugin.id);
    await load();
  } catch (error) {
    loadError.value = t('plugins.installFailed', { name: plugin.display_name }) + ` ${String(error)}`;
  } finally {
    busy.value = null;
  }
}

async function uninstall(plugin: WirePluginEntry): Promise<void> {
  const ok = await confirm({
    title: t('plugins.uninstallConfirmTitle'),
    message: t('plugins.uninstallConfirmMessage', { name: plugin.display_name }),
    variant: 'danger',
    action: async () => {
      await api.uninstallPlugin(plugin.id);
    },
  });
  if (ok) await load();
}

/** Per-plugin detail state (loaded on expand): MCP server toggles. */
const expandedId = ref<string | null>(null);
const details = ref<Record<string, WirePluginInfo>>({});
const toggling = ref<string | null>(null);

async function toggleDetails(plugin: WirePluginEntry): Promise<void> {
  if (expandedId.value === plugin.id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = plugin.id;
  if (details.value[plugin.id] === undefined) {
    try {
      details.value[plugin.id] = await api.getPluginInfo(plugin.id);
    } catch {
      details.value[plugin.id] = { ...plugin, mcp_servers: [] };
    }
  }
}

async function setEnabled(plugin: WirePluginEntry, enabled: boolean): Promise<void> {
  if (toggling.value !== null) return;
  toggling.value = plugin.id;
  try {
    await api.setPluginEnabled(plugin.id, enabled);
    await load();
  } catch (error) {
    loadError.value = t('plugins.enableFailed', { name: plugin.display_name }) + ` ${String(error)}`;
  } finally {
    toggling.value = null;
  }
}

async function setMcpEnabled(
  plugin: WirePluginEntry,
  server: string,
  enabled: boolean,
): Promise<void> {
  if (toggling.value !== null) return;
  toggling.value = `${plugin.id}:${server}`;
  try {
    await api.setPluginMcpServerEnabled(plugin.id, server, enabled);
    const info = details.value[plugin.id];
    if (info !== undefined) {
      details.value[plugin.id] = {
        ...info,
        mcp_servers: info.mcp_servers.map((s) => (s.name === server ? { ...s, enabled } : s)),
      };
    }
    await load();
  } catch (error) {
    loadError.value = t('plugins.enableFailed', { name: plugin.display_name }) + ` ${String(error)}`;
  } finally {
    toggling.value = null;
  }
}

function tierLabel(tier: string | undefined): string {
  if (tier === 'official') return t('plugins.tierOfficial');
  if (tier === 'curated') return t('plugins.tierCurated');
  return tier ?? '';
}
</script>

<template>
  <div class="plugins">
    <p class="panel-hint">{{ t('plugins.hint') }}</p>

    <div v-if="loading" class="state-row">
      <Spinner size="sm" />
      <span>{{ t('plugins.loading') }}</span>
    </div>
    <div v-else-if="loadError" class="state-row unavail">
      <Icon name="alert-triangle" size="md" />
      <span>{{ t('plugins.loadFailed') }} {{ loadError }}</span>
    </div>
    <div v-else-if="plugins.length === 0" class="state-row empty">
      {{ t('plugins.empty') }}
    </div>
    <template v-else>
      <div v-for="plugin in plugins" :key="plugin.id" class="plugin-row">
        <div class="plugin-info">
          <span class="plugin-name">{{ plugin.display_name }}</span>
          <span v-if="plugin.description" class="plugin-desc">{{ plugin.description }}</span>
          <span class="plugin-meta">
            <Badge v-if="plugin.tier" variant="neutral" size="sm">{{ tierLabel(plugin.tier) }}</Badge>
            <Badge v-if="plugin.installed" variant="success" size="sm">
              {{ plugin.installed_version !== undefined ? t('plugins.installedVersion', { version: plugin.installed_version }) : t('plugins.installed') }}
            </Badge>
          </span>
        </div>
        <div class="plugin-actions">
          <template v-if="!plugin.installed">
            <Button variant="primary" size="sm" :disabled="busy !== null" @click="install(plugin)">
              <Spinner v-if="busy === plugin.id" size="sm" />
              {{ busy === plugin.id ? t('plugins.installing') : t('plugins.install') }}
            </Button>
          </template>
          <template v-else>
            <Switch
              :model-value="plugin.enabled !== false"
              :disabled="toggling !== null"
              @update:model-value="setEnabled(plugin, $event as boolean)"
            />
            <Button variant="secondary" size="sm" :disabled="busy !== null" @click="toggleDetails(plugin)">
              {{ expandedId === plugin.id ? t('plugins.detailsHide') : t('plugins.details') }}
            </Button>
            <Button variant="danger-soft" size="sm" :disabled="busy !== null" @click="uninstall(plugin)">
              {{ t('plugins.uninstall') }}
            </Button>
          </template>
        </div>
      </div>
      <div v-if="expandedId !== null && details[expandedId]" class="detail-block">
        <div v-if="details[expandedId]!.mcp_servers.length > 0" class="mcp-list">
          <div class="mcp-head">{{ t('plugins.mcpServers') }}</div>
          <div v-for="server in details[expandedId]!.mcp_servers" :key="server.name" class="mcp-row">
            <span class="mcp-name">{{ server.name }}</span>
            <span class="mcp-meta">{{ server.transport }}<template v-if="server.url"> · {{ server.url }}</template></span>
            <Switch
              :model-value="server.enabled"
              :disabled="toggling !== null"
              @update:model-value="setMcpEnabled(details[expandedId]!, server.name, $event as boolean)"
            />
          </div>
        </div>
        <div v-else class="mcp-empty">{{ t('plugins.mcpServers') }} —</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.plugins { display: flex; flex-direction: column; gap: var(--space-3); }
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

.plugin-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}
.plugin-row:last-child { border-bottom: none; }
.plugin-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.plugin-name {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.plugin-desc {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.plugin-actions { flex: none; display: flex; gap: var(--space-2); align-items: center; }

.detail-block {
  border-left: 2px solid var(--color-line);
  margin-left: var(--space-1);
  padding-left: var(--space-3);
  margin-bottom: var(--space-2);
}
.mcp-list { display: flex; flex-direction: column; gap: var(--space-2); }
.mcp-head {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.mcp-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.mcp-name {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.mcp-meta {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcp-empty {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

@media (max-width: 640px) {
  .plugin-row { align-items: flex-start; flex-wrap: wrap; }
  .plugin-actions { flex: 1 1 100%; justify-content: flex-end; }
}
</style>
