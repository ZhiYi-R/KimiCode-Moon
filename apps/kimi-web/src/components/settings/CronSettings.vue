<!-- apps/kimi-web/src/components/settings/CronSettings.vue -->
<!-- Cron task panel (Settings → Cron): scheduled prompts for the current
     session — list, create, delete. -->
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../../api';
import type { WireCronTask } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Spinner from '../ui/Spinner.vue';
import Switch from '../ui/Switch.vue';
import Icon from '../ui/Icon.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const api = getKimiWebApi();

const props = defineProps<{
  /** Active session id; null when no session is open. */
  sessionId: string | null;
}>();

const tasks = ref<WireCronTask[]>([]);
const loading = ref(false);
const loadError = ref('');

async function load(): Promise<void> {
  if (props.sessionId === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    tasks.value = await api.listCronTasks(props.sessionId);
  } catch (error) {
    loadError.value = String(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.sessionId, load);

// -------------------------------------------------------------------------
// Add-task form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({
  cron: '',
  prompt: '',
  recurring: true,
});
const addError = ref('');
const adding = ref(false);

function openAdd(): void {
  addForm.cron = '';
  addForm.prompt = '';
  addForm.recurring = true;
  addError.value = '';
  showAddForm.value = true;
}

async function submitAdd(): Promise<void> {
  const cron = addForm.cron.trim();
  if (cron.length === 0) {
    addError.value = t('cronSettings.cronRequired');
    return;
  }
  const prompt = addForm.prompt.trim();
  if (prompt.length === 0) {
    addError.value = t('cronSettings.promptRequired');
    return;
  }
  if (prompt.length > 8 * 1024) {
    addError.value = t('cronSettings.promptTooLong');
    return;
  }
  addError.value = '';
  adding.value = true;
  try {
    await api.createCronTask(props.sessionId as string, {
      cron,
      prompt,
      recurring: addForm.recurring,
    });
    showAddForm.value = false;
    await load();
  } catch (error) {
    addError.value = error instanceof Error ? error.message : String(error);
  } finally {
    adding.value = false;
  }
}

// -------------------------------------------------------------------------
// Task rows
// -------------------------------------------------------------------------

async function removeTask(task: WireCronTask): Promise<void> {
  const ok = await confirm({
    title: t('cronSettings.removeConfirmTitle'),
    message: t('cronSettings.removeConfirmMessage', { prompt: task.prompt }),
    variant: 'danger',
    action: async () => {
      await api.deleteCronTask(props.sessionId as string, task.id);
    },
  });
  if (ok) await load();
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function nextFireLabel(task: WireCronTask): string {
  if (task.next_fire_at === null) return t('cronSettings.neverFires');
  return t('cronSettings.nextFire', { time: formatTime(task.next_fire_at) });
}
</script>

<template>
  <div class="cron">
    <p class="panel-hint">{{ t('cronSettings.hint') }}</p>

    <div v-if="sessionId === null" class="state-row empty">
      {{ t('cronSettings.noSession') }}
    </div>
    <template v-else>
      <div v-if="loading" class="state-row">
        <Spinner size="sm" />
        <span>{{ t('cronSettings.loading') }}</span>
      </div>
      <div v-else-if="loadError" class="state-row unavail">
        <Icon name="alert-triangle" size="md" />
        <span>{{ t('cronSettings.loadFailed') }} {{ loadError }}</span>
      </div>
      <div v-else-if="tasks.length === 0" class="state-row empty">
        {{ t('cronSettings.empty') }}
      </div>
      <template v-else>
        <div v-for="task in tasks" :key="task.id" class="task-row">
          <div class="task-info">
            <span class="task-cron">{{ task.cron }}</span>
            <span class="task-prompt">{{ task.prompt }}</span>
            <span class="task-meta">
              <span>{{ task.recurring === false ? t('cronSettings.oneShot') : t('cronSettings.recurring') }}</span>
              <span> · {{ nextFireLabel(task) }}</span>
            </span>
          </div>
          <div class="task-actions">
            <Button variant="danger-soft" size="sm" @click="removeTask(task)">
              {{ t('cronSettings.remove') }}
            </Button>
          </div>
        </div>
      </template>

      <div class="add-section">
        <template v-if="!showAddForm">
          <Button variant="primary" size="sm" @click="openAdd">
            <Icon name="plus" size="sm" />
            {{ t('cronSettings.add') }}
          </Button>
        </template>
        <template v-else>
          <div class="add-form">
            <Field :label="t('cronSettings.fieldCron')">
              <Input v-model="addForm.cron" :placeholder="t('cronSettings.fieldCronPlaceholder')" spellcheck="false" />
            </Field>
            <Field :label="t('cronSettings.fieldPrompt')">
              <Input v-model="addForm.prompt" :placeholder="t('cronSettings.fieldPromptPlaceholder')" />
            </Field>
            <div class="recurring-row">
              <Switch v-model="addForm.recurring" />
              <span>{{ t('cronSettings.fieldRecurring') }}</span>
            </div>
            <div v-if="addError" class="add-error">{{ addError }}</div>
            <div class="form-btns">
              <Button variant="primary" size="sm" :disabled="adding" @click="submitAdd">
                <Spinner v-if="adding" size="sm" />
                {{ t('cronSettings.add') }}
              </Button>
              <Button variant="secondary" size="sm" @click="showAddForm = false">{{ t('cronSettings.cancel') }}</Button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cron { display: flex; flex-direction: column; gap: var(--space-3); }
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

.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}
.task-row:last-child { border-bottom: none; }
.task-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.task-cron {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.task-prompt {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-meta {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.task-actions { flex: none; }

.add-section { border-top: 1px solid var(--color-line); padding-top: var(--space-3); }
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.recurring-row {
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
