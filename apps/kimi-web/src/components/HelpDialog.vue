<!-- apps/kimi-web/src/components/HelpDialog.vue -->
<!-- Help dialog: slash-command reference + keyboard shortcuts. -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { SLASH_COMMANDS } from '../lib/slashCommands';
import Dialog from './ui/Dialog.vue';

const { t } = useI18n();

const emit = defineEmits<{ close: [] }>();

const SHORTCUTS: Array<{ keys: string; labelKey: string }> = [
  { keys: 'Ctrl+S', labelKey: 'help.shortcuts.steer' },
  { keys: 'Ctrl+C', labelKey: 'help.shortcuts.interrupt' },
  { keys: '↑ / ↓', labelKey: 'help.shortcuts.history' },
  { keys: 'Ctrl+V', labelKey: 'help.shortcuts.paste' },
];
</script>

<template>
  <Dialog :open="true" :close-on-esc="false" :title="t('help.title')" size="md" height="fixed" @close="emit('close')">
    <div class="help">
      <section class="help-sec">
        <h4 class="help-title">{{ t('help.commands') }}</h4>
        <div v-for="cmd in SLASH_COMMANDS" :key="cmd.name" class="help-row">
          <code class="help-key">{{ cmd.name }}</code>
          <span class="help-desc">{{ t(cmd.desc) }}</span>
        </div>
      </section>
      <section class="help-sec">
        <h4 class="help-title">{{ t('help.shortcutsTitle') }}</h4>
        <div v-for="shortcut in SHORTCUTS" :key="shortcut.labelKey" class="help-row">
          <code class="help-key">{{ shortcut.keys }}</code>
          <span class="help-desc">{{ t(shortcut.labelKey) }}</span>
        </div>
      </section>
    </div>
  </Dialog>
</template>

<style scoped>
.help { display: flex; flex-direction: column; gap: var(--space-4); }
.help-sec { display: flex; flex-direction: column; gap: var(--space-2); }
.help-title {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.help-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}
.help-key {
  flex: none;
  min-width: 96px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.help-desc {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
