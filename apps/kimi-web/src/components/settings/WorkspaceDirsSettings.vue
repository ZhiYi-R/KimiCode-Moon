<!-- apps/kimi-web/src/components/settings/WorkspaceDirsSettings.vue -->
<!-- Workspace additional-directories panel (Settings → Directories): list,
     add, remove the directories a workspace can access. -->
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../../api';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Spinner from '../ui/Spinner.vue';
import Icon from '../ui/Icon.vue';
import Switch from '../ui/Switch.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const api = getKimiWebApi();

const props = defineProps<{
  /** Active workspace id; null when no workspace is selected. */
  workspaceId: string | null;
}>();

const dirs = ref<string[]>([]);
const loading = ref(false);
const loadError = ref('');

async function load(): Promise<void> {
  if (props.workspaceId === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    dirs.value = await api.listWorkspaceDirs(props.workspaceId);
  } catch (error) {
    loadError.value = String(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.workspaceId, load);

// -------------------------------------------------------------------------
// Add-dir form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({ dir: '', persist: true });
const addError = ref('');
const adding = ref(false);

function openAdd(): void {
  addForm.dir = '';
  addForm.persist = true;
  addError.value = '';
  showAddForm.value = true;
}

async function submitAdd(): Promise<void> {
  const dir = addForm.dir.trim();
  if (dir.length === 0) {
    addError.value = t('workspaceDirs.dirRequired');
    return;
  }
  addError.value = '';
  adding.value = true;
  try {
    await api.addWorkspaceDir(props.workspaceId as string, dir, addForm.persist);
    showAddForm.value = false;
    await load();
  } catch (error) {
    addError.value = error instanceof Error ? error.message : String(error);
  } finally {
    adding.value = false;
  }
}

// -------------------------------------------------------------------------
// Remove
// -------------------------------------------------------------------------

async function removeDir(dir: string): Promise<void> {
  const ok = await confirm({
    title: t('workspaceDirs.removeConfirmTitle'),
    message: t('workspaceDirs.removeConfirmMessage', { dir }),
    variant: 'danger',
    action: async () => {
      await api.removeWorkspaceDir(props.workspaceId as string, dir);
    },
  });
  if (ok) await load();
}
</script>

<template>
  <div class="dirs">
    <p class="panel-hint">{{ t('workspaceDirs.hint') }}</p>

    <div v-if="workspaceId === null" class="state-row empty">
      {{ t('workspaceDirs.noWorkspace') }}
    </div>
    <template v-else>
      <div v-if="loading" class="state-row">
        <Spinner size="sm" />
        <span>{{ t('workspaceDirs.loading') }}</span>
      </div>
      <div v-else-if="loadError" class="state-row unavail">
        <Icon name="alert-triangle" size="md" />
        <span>{{ t('workspaceDirs.loadFailed') }} {{ loadError }}</span>
      </div>
      <div v-else-if="dirs.length === 0" class="state-row empty">
        {{ t('workspaceDirs.empty') }}
      </div>
      <template v-else>
        <div v-for="dir in dirs" :key="dir" class="dir-row">
          <span class="dir-path">{{ dir }}</span>
          <div class="dir-actions">
            <Button variant="danger-soft" size="sm" @click="removeDir(dir)">
              {{ t('workspaceDirs.remove') }}
            </Button>
          </div>
        </div>
      </template>

      <div class="add-section">
        <template v-if="!showAddForm">
          <Button variant="primary" size="sm" @click="openAdd">
            <Icon name="plus" size="sm" />
            {{ t('workspaceDirs.add') }}
          </Button>
        </template>
        <template v-else>
          <div class="add-form">
            <Field :label="t('workspaceDirs.fieldDir')">
              <Input v-model="addForm.dir" :placeholder="t('workspaceDirs.fieldDirPlaceholder')" spellcheck="false" />
            </Field>
            <div class="persist-row">
              <Switch v-model="addForm.persist" />
              <span>{{ t('workspaceDirs.persistLabel') }}</span>
            </div>
            <div v-if="addError" class="add-error">{{ addError }}</div>
            <div class="form-btns">
              <Button variant="primary" size="sm" :disabled="adding" @click="submitAdd">
                <Spinner v-if="adding" size="sm" />
                {{ t('workspaceDirs.add') }}
              </Button>
              <Button variant="secondary" size="sm" @click="showAddForm = false">{{ t('workspaceDirs.cancel') }}</Button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dirs { display: flex; flex-direction: column; gap: var(--space-3); }
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

.dir-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}
.dir-row:last-child { border-bottom: none; }
.dir-path {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-actions { flex: none; }

.add-section { border-top: 1px solid var(--color-line); padding-top: var(--space-3); }
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.persist-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.add-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.form-btns { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
