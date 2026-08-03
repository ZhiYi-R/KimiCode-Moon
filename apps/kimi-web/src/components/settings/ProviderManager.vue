<!-- apps/kimi-web/src/components/settings/ProviderManager.vue -->
<!-- Modal overlay for managing providers: list, add, refresh, delete. -->
<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppProvider, WireCatalogProvider } from '../../api/types';
import { getKimiWebApi } from '../../api';
import { useDialogFocus } from '../../composables/useDialogFocus';
import Dialog from '../ui/Dialog.vue';
import Button from '../ui/Button.vue';
import Badge from '../ui/Badge.vue';
import Spinner from '../ui/Spinner.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';
import Icon from '../ui/Icon.vue';
import Tooltip from '../ui/Tooltip.vue';

const { t } = useI18n();

const dialogRef = ref<HTMLElement | null>(null);
// Move focus into the dialog on open; restore it to the opener on close.
useDialogFocus(dialogRef);

const props = defineProps<{
  providers: AppProvider[];
  loading?: boolean;
  /** If true, providers could not be fetched (daemon 404 / unsupported) */
  unavailable?: boolean;
}>();

const emit = defineEmits<{
  add: [input: { type: string; apiKey?: string; baseUrl?: string; defaultModel?: string }];
  refresh: [id: string];
  delete: [id: string];
  /** Open the login dialog for the given platform (OAuth flow) */
  openLogin: [platform: string];
  close: [];
}>();

// -------------------------------------------------------------------------
// Delete confirmation
// -------------------------------------------------------------------------

// Delete — the modal confirm and the async delete live in App.vue
// (confirmDeleteProvider); the manager only emits the intent.
function onDeleteProvider(id: string): void {
  emit('delete', id);
}

// -------------------------------------------------------------------------
// Add-provider form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({
  type: 'moonshot',
  apiKey: '',
  baseUrl: '',
  defaultModel: '',
});
const addError = ref('');

const PROVIDER_TYPES = ['moonshot', 'anthropic', 'openai', 'custom'];

function openAdd(): void {
  addForm.type = 'moonshot';
  addForm.apiKey = '';
  addForm.baseUrl = '';
  addForm.defaultModel = '';
  addError.value = '';
  showAddForm.value = true;
}
function cancelAdd(): void {
  showAddForm.value = false;
}
function submitAdd(): void {
  if (!addForm.apiKey.trim()) {
    addError.value = t('providers.apiKeyRequired');
    return;
  }
  addError.value = '';
  emit('add', {
    type: addForm.type,
    apiKey: addForm.apiKey.trim() || undefined,
    baseUrl: addForm.baseUrl.trim() || undefined,
    defaultModel: addForm.defaultModel.trim() || undefined,
  });
  showAddForm.value = false;
}

// -------------------------------------------------------------------------
// Catalog / registry import
// -------------------------------------------------------------------------

const api = getKimiWebApi();
const showCatalogImport = ref(false);
const showRegistryImport = ref(false);
const catalogItems = ref<WireCatalogProvider[]>([]);
const catalogLoading = ref(false);
const catalogError = ref('');
const importForm = reactive({
  catalogId: '',
  apiKey: '',
  baseUrl: '',
  registryUrl: '',
  registryApiKey: '',
});
const importing = ref(false);
const importError = ref('');
const importSuccess = ref('');

async function openCatalogImport(): Promise<void> {
  showRegistryImport.value = false;
  importError.value = '';
  importSuccess.value = '';
  Object.assign(importForm, { catalogId: '', apiKey: '', baseUrl: '' });
  showCatalogImport.value = true;
  if (catalogItems.value.length === 0 && !catalogLoading.value) {
    catalogLoading.value = true;
    catalogError.value = '';
    try {
      catalogItems.value = (await api.listCatalogProviders()).filter(
        (item) => !item.rejected,
      );
    } catch (error) {
      catalogError.value = error instanceof Error ? error.message : String(error);
    } finally {
      catalogLoading.value = false;
    }
  }
}

function openRegistryImport(): void {
  showCatalogImport.value = false;
  importError.value = '';
  importSuccess.value = '';
  Object.assign(importForm, { registryUrl: '', registryApiKey: '' });
  showRegistryImport.value = true;
}

async function submitCatalogImport(): Promise<void> {
  if (importForm.catalogId.length === 0) {
    importError.value = t('providers.catalogRequired');
    return;
  }
  importing.value = true;
  importError.value = '';
  importSuccess.value = '';
  try {
    await api.importCatalogProvider({
      catalogId: importForm.catalogId,
      apiKey: importForm.apiKey.trim() || undefined,
      baseUrl: importForm.baseUrl.trim() || undefined,
    });
    importSuccess.value = t('providers.imported');
    showCatalogImport.value = false;
    emit('refresh', importForm.catalogId);
  } catch (error) {
    importError.value = error instanceof Error ? error.message : String(error);
  } finally {
    importing.value = false;
  }
}

async function submitRegistryImport(): Promise<void> {
  const url = importForm.registryUrl.trim();
  if (url.length === 0) {
    importError.value = t('providers.registryUrlRequired');
    return;
  }
  importing.value = true;
  importError.value = '';
  importSuccess.value = '';
  try {
    await api.importRegistry({
      url,
      apiKey: importForm.registryApiKey.trim() || undefined,
    });
    importSuccess.value = t('providers.imported');
    showRegistryImport.value = false;
  } catch (error) {
    importError.value = error instanceof Error ? error.message : String(error);
  } finally {
    importing.value = false;
  }
}

// -------------------------------------------------------------------------
// Keyboard — Esc closes
// -------------------------------------------------------------------------

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (showAddForm.value) { cancelAdd(); return; }
    emit('close');
  }
}

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

// -------------------------------------------------------------------------
// Status helpers
// -------------------------------------------------------------------------

function statusColor(status: AppProvider['status']): string {
  if (status === 'connected') return 'var(--color-success)';
  if (status === 'error') return 'var(--color-danger)';
  return 'var(--color-text-faint)';
}
function statusLabel(status: AppProvider['status']): string {
  if (status === 'connected') return t('providers.status.connected');
  if (status === 'error') return t('providers.status.error');
  return t('providers.status.unconfigured');
}
</script>

<template>
  <Dialog :open="true" :close-on-esc="false" :title="t('providers.title')" size="xl" height="fixed" @close="emit('close')">
    <div ref="dialogRef" class="pm">
      <!-- Provider list -->
      <div class="prov-list">
        <!-- Loading state -->
        <div v-if="loading" class="state-row">
          <Spinner size="sm" />
          <span>{{ t('providers.loading') }}</span>
        </div>
        <!-- Unavailable (daemon 404) -->
        <div v-else-if="unavailable" class="state-row unavail">
          <Icon name="alert-triangle" size="md" />
          <span>{{ t('providers.unavailable') }}</span>
        </div>
        <!-- Empty -->
        <div v-else-if="providers.length === 0" class="empty">{{ t('providers.empty') }}</div>
        <!-- Provider rows -->
        <template v-else>
          <div v-for="p in providers" :key="p.id" class="prov-row">
            <!-- Status dot -->
            <Tooltip :text="statusLabel(p.status)">
              <span
                class="status-dot"
                :class="{ 'status-dot--empty': p.status !== 'connected' && p.status !== 'error' }"
                :style="p.status === 'connected' || p.status === 'error' ? { background: statusColor(p.status) } : undefined"
              />
            </Tooltip>
            <div class="prov-info">
              <span class="prov-type">{{ p.type }}</span>
              <span v-if="p.baseUrl" class="prov-url">{{ p.baseUrl }}</span>
              <span class="prov-meta">
                <Badge :variant="p.hasApiKey ? 'success' : 'neutral'" size="sm">
                  {{ p.hasApiKey ? t('providers.keySet') : t('providers.keyNotSet') }}
                </Badge>
                <span v-if="p.models && p.models.length > 0"> · {{ t('providers.modelCount', { count: p.models.length }) }}</span>
              </span>
            </div>
            <!-- Actions -->
            <div class="prov-actions">
              <Tooltip :text="t('providers.refreshTitle', { type: p.type })">
                <Button variant="secondary" size="sm" @click="emit('refresh', p.id)">{{ t('providers.refresh') }}</Button>
              </Tooltip>
              <Tooltip :text="t('providers.deleteTitle', { type: p.type })">
                <Button variant="danger-soft" size="sm" @click="onDeleteProvider(p.id)">{{ t('providers.delete') }}</Button>
              </Tooltip>
            </div>
          </div>
        </template>
      </div>

      <!-- Add provider form / button -->
      <div v-if="!unavailable" class="add-section">
        <template v-if="!showAddForm">
          <div class="add-btns">
            <!-- OAuth login shortcuts for common platforms -->
            <Button variant="secondary" size="sm" @click="emit('openLogin', 'moonshot')">
              <Icon name="user" size="sm" />
              {{ t('providers.loginKimi') }}
            </Button>
            <Button variant="secondary" size="sm" @click="emit('openLogin', 'anthropic')">
              <Icon name="user" size="sm" />
              {{ t('providers.loginAnthropic') }}
            </Button>
            <Button variant="secondary" size="sm" @click="openCatalogImport">
              <Icon name="globe" size="sm" />
              {{ t('providers.importCatalog') }}
            </Button>
            <Button variant="secondary" size="sm" @click="openRegistryImport">
              <Icon name="link" size="sm" />
              {{ t('providers.importRegistry') }}
            </Button>
            <Button variant="primary" size="sm" @click="openAdd">
              <Icon name="plus" size="sm" />
              {{ t('providers.enterApiKey') }}
            </Button>
          </div>

          <div v-if="showCatalogImport" class="import-form">
            <div v-if="catalogLoading" class="import-state">
              <Spinner size="sm" />
              <span>{{ t('providers.catalogLoading') }}</span>
            </div>
            <div v-else-if="catalogError" class="import-error">
              {{ t('providers.catalogFailed') }} {{ catalogError }}
            </div>
            <template v-else>
              <Field :label="t('providers.catalogProvider')">
                <Select v-model="importForm.catalogId">
                  <option value="" disabled>{{ t('providers.catalogChoose') }}</option>
                  <option v-for="item in catalogItems" :key="item.id" :value="item.id">
                    {{ item.name }} ({{ item.id }})
                  </option>
                </Select>
              </Field>
              <Field :label="t('providers.catalogApiKey')">
                <Input
                  v-model="importForm.apiKey"
                  type="password"
                  placeholder="sk-…"
                  autocomplete="off"
                  spellcheck="false"
                />
              </Field>
              <Field :label="t('providers.catalogBaseUrl')">
                <Input
                  v-model="importForm.baseUrl"
                  :placeholder="t('providers.optional')"
                  autocomplete="off"
                  spellcheck="false"
                />
              </Field>
            </template>
          </div>

          <div v-if="showRegistryImport" class="import-form">
            <Field :label="t('providers.registryUrl')">
              <Input v-model="importForm.registryUrl" placeholder="https://…/api.json" autocomplete="off" spellcheck="false" />
            </Field>
            <Field :label="t('providers.registryApiKey')">
              <Input
                v-model="importForm.registryApiKey"
                type="password"
                :placeholder="t('providers.optional')"
                autocomplete="off"
                spellcheck="false"
              />
            </Field>
          </div>

          <div v-if="importError" class="add-error">{{ importError }}</div>
          <div v-if="importSuccess" class="import-ok">{{ importSuccess }}</div>
          <div v-if="showCatalogImport && !catalogLoading && !catalogError" class="form-btns">
            <Button variant="primary" size="sm" :disabled="importing" @click="submitCatalogImport">
              <Spinner v-if="importing" size="sm" />
              {{ t('providers.importSubmit') }}
            </Button>
            <Button variant="secondary" size="sm" @click="showCatalogImport = false">{{ t('common.cancel') }}</Button>
          </div>
          <div v-if="showRegistryImport" class="form-btns">
            <Button variant="primary" size="sm" :disabled="importing" @click="submitRegistryImport">
              <Spinner v-if="importing" size="sm" />
              {{ t('providers.importSubmit') }}
            </Button>
            <Button variant="secondary" size="sm" @click="showRegistryImport = false">{{ t('common.cancel') }}</Button>
          </div>
        </template>
        <template v-else>
          <div class="add-form">
            <Field :label="t('providers.fieldType')">
              <Select v-model="addForm.type">
                <option v-for="pt in PROVIDER_TYPES" :key="pt" :value="pt">{{ pt }}</option>
              </Select>
            </Field>
            <Field :label="t('providers.fieldApiKey')">
              <Input
                v-model="addForm.apiKey"
                type="password"
                placeholder="sk-…"
                autocomplete="off"
                spellcheck="false"
              />
            </Field>
            <Field :label="t('providers.fieldBaseUrl')">
              <Input
                v-model="addForm.baseUrl"
                :placeholder="t('providers.baseUrlPlaceholder')"
                autocomplete="off"
                spellcheck="false"
              />
            </Field>
            <Field :label="t('providers.fieldDefaultModel')">
              <Input
                v-model="addForm.defaultModel"
                :placeholder="t('providers.optional')"
                autocomplete="off"
                spellcheck="false"
              />
            </Field>
            <div v-if="addError" class="add-error">{{ addError }}</div>
            <div class="form-btns">
              <Button variant="primary" size="sm" @click="submitAdd">{{ t('providers.add') }}</Button>
              <Button variant="secondary" size="sm" @click="cancelAdd">{{ t('common.cancel') }}</Button>
            </div>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="footer-hint">{{ t('providers.escClose') }}</div>
    </div>
  </Dialog>
</template>

<style scoped>
.pm { display: flex; flex-direction: column; gap: var(--space-4); }

/* Provider list */
.prov-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.state-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
}
.state-row.unavail { color: var(--color-warning); }
.empty {
  padding: var(--space-4) 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
}
.prov-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
  transition: background var(--duration-fast) var(--ease-out);
}
.prov-row:last-child { border-bottom: none; }

.status-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  box-sizing: border-box;
}
.status-dot--empty {
  background: transparent;
  border: 1.5px solid var(--color-text-faint);
}
.prov-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.prov-type {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.prov-url {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.prov-actions {
  display: flex;
  gap: var(--space-2);
  flex: none;
  align-items: center;
  flex-wrap: wrap;
}
/* Add section */
.add-section {
  border-top: 1px solid var(--color-line);
  padding-top: var(--space-4);
}
.add-btns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.import-form { display: flex; flex-direction: column; gap: var(--space-3); }
.import-state {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
.import-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.import-ok {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-success);
}

/* Form */
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.add-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.form-btns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Footer */
.footer-hint {
  padding-top: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  border-top: 1px solid var(--color-line);
}

@media (max-width: 640px) {
  .prov-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .prov-actions {
    flex: 1 1 100%;
    justify-content: flex-end;
  }
}
</style>
