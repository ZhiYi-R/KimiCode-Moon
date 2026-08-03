<!-- apps/kimi-web/src/components/settings/GoalsSettings.vue -->
<!-- Goal queue panel (Settings → Goals): the current session's upcoming
     goals — list, queue, reorder, remove. -->
<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../../api';
import type { WireUpcomingGoal } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Spinner from '../ui/Spinner.vue';
import Icon from '../ui/Icon.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();
const api = getKimiWebApi();

const props = defineProps<{
  /** Active session id; null when no session is open. */
  sessionId: string | null;
}>();

const goals = ref<WireUpcomingGoal[]>([]);
const loading = ref(false);
const loadError = ref('');

async function load(): Promise<void> {
  if (props.sessionId === null) return;
  loading.value = true;
  loadError.value = '';
  try {
    goals.value = await api.listGoalQueue(props.sessionId);
  } catch (error) {
    loadError.value = String(error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.sessionId, load);

// -------------------------------------------------------------------------
// Add form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({ objective: '' });
const addError = ref('');
const adding = ref(false);

function openAdd(): void {
  addForm.objective = '';
  addError.value = '';
  showAddForm.value = true;
}

async function submitAdd(): Promise<void> {
  const objective = addForm.objective.trim();
  if (objective.length === 0) {
    addError.value = t('goals.objectiveRequired');
    return;
  }
  addError.value = '';
  adding.value = true;
  try {
    await api.appendGoal(props.sessionId as string, objective);
    showAddForm.value = false;
    await load();
  } catch (error) {
    addError.value = error instanceof Error ? error.message : String(error);
  } finally {
    adding.value = false;
  }
}

// -------------------------------------------------------------------------
// Row actions
// -------------------------------------------------------------------------

const busy = ref(false);

async function removeGoal(goal: WireUpcomingGoal): Promise<void> {
  const ok = await confirm({
    title: t('goals.removeConfirmTitle'),
    message: t('goals.removeConfirmMessage', { objective: goal.objective }),
    variant: 'danger',
    action: async () => {
      await api.removeGoal(props.sessionId as string, goal.id);
    },
  });
  if (ok) await load();
}

async function moveGoal(goal: WireUpcomingGoal, direction: 'up' | 'down'): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.moveGoal(props.sessionId as string, goal.id, direction);
    await load();
  } finally {
    busy.value = false;
  }
}

function canMove(goal: WireUpcomingGoal, direction: 'up' | 'down'): boolean {
  const index = goals.value.findIndex((g) => g.id === goal.id);
  if (index === -1) return false;
  if (direction === 'up') return index > 0;
  return index < goals.value.length - 1;
}
</script>

<template>
  <div class="goals">
    <p class="panel-hint">{{ t('goals.hint') }}</p>

    <div v-if="sessionId === null" class="state-row empty">
      {{ t('goals.noSession') }}
    </div>
    <template v-else>
      <div v-if="loading" class="state-row">
        <Spinner size="sm" />
        <span>{{ t('goals.loading') }}</span>
      </div>
      <div v-else-if="loadError" class="state-row unavail">
        <Icon name="alert-triangle" size="md" />
        <span>{{ t('goals.loadFailed') }} {{ loadError }}</span>
      </div>
      <div v-else-if="goals.length === 0" class="state-row empty">
        {{ t('goals.empty') }}
      </div>
      <template v-else>
        <div v-for="(goal, index) in goals" :key="goal.id" class="goal-row">
          <span class="goal-index">{{ index + 1 }}</span>
          <span class="goal-objective">{{ goal.objective }}</span>
          <div class="goal-actions">
            <Button variant="secondary" size="sm" :disabled="busy || !canMove(goal, 'up')" @click="moveGoal(goal, 'up')">
              <Icon name="arrow-up" size="sm" />
              <span class="sr-only">{{ t('goals.moveUp') }}</span>
            </Button>
            <Button variant="secondary" size="sm" :disabled="busy || !canMove(goal, 'down')" @click="moveGoal(goal, 'down')">
              <Icon name="arrow-down" size="sm" />
              <span class="sr-only">{{ t('goals.moveDown') }}</span>
            </Button>
            <Button variant="danger-soft" size="sm" :disabled="busy" @click="removeGoal(goal)">
              {{ t('goals.remove') }}
            </Button>
          </div>
        </div>
      </template>

      <div class="add-section">
        <template v-if="!showAddForm">
          <Button variant="primary" size="sm" @click="openAdd">
            <Icon name="plus" size="sm" />
            {{ t('goals.add') }}
          </Button>
        </template>
        <template v-else>
          <div class="add-form">
            <Field :label="t('goals.fieldObjective')">
              <Input v-model="addForm.objective" :placeholder="t('goals.fieldObjectivePlaceholder')" />
            </Field>
            <div v-if="addError" class="add-error">{{ addError }}</div>
            <div class="form-btns">
              <Button variant="primary" size="sm" :disabled="adding" @click="submitAdd">
                <Spinner v-if="adding" size="sm" />
                {{ t('goals.add') }}
              </Button>
              <Button variant="secondary" size="sm" @click="showAddForm = false">{{ t('goals.cancel') }}</Button>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.goals { display: flex; flex-direction: column; gap: var(--space-3); }
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

.goal-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
}
.goal-row:last-child { border-bottom: none; }
.goal-index {
  flex: none;
  width: 20px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.goal-objective {
  flex: 1;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.goal-actions { flex: none; display: flex; gap: var(--space-2); align-items: center; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.add-section { border-top: 1px solid var(--color-line); padding-top: var(--space-3); }
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.add-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.form-btns { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
