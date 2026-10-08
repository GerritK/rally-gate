<script setup lang="ts">
import { ref, watch } from 'vue';
import { useDisplay, type SubmitEventPromise } from 'vuetify';
import { notify, t, useConfirm } from '@rally-gate/ui';

const props = defineProps<{
  title: string;
  /** The draft the fields edit; compared to how it opened to tell whether
   *  closing would lose anything. */
  form: unknown;
  save: () => Promise<unknown>;
  /** Snackbar text once saved. */
  saved: string;
  saveText?: string;
  /** Wider for a form laid out in columns. */
  maxWidth?: number;
}>();
const open = defineModel<boolean>({ required: true });

const { smAndDown } = useDisplay();
const confirm = useConfirm();
const saving = ref(false);
const error = ref('');
let opened = '';

watch(open, (isOpen) => {
  if (!isOpen) return;
  opened = JSON.stringify(props.form);
  error.value = '';
});

/** Esc, a click outside and Cancel all land here. */
async function close() {
  if (saving.value) return;
  if (
    JSON.stringify(props.form) !== opened &&
    !(await confirm({
      title: t('common.discardChanges'),
      confirmText: t('common.discard'),
      color: 'error',
    }))
  )
    return;
  open.value = false;
}

async function submit(event: SubmitEventPromise) {
  if (saving.value || !(await event).valid) return;
  saving.value = true;
  error.value = '';
  try {
    await props.save();
    open.value = false;
    notify(props.saved);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('common.couldNotSave');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="open"
    :max-width="maxWidth ?? 560"
    :fullscreen="smAndDown"
    @update:model-value="close"
  >
    <v-form @submit.prevent="submit">
      <v-card :title="title">
        <v-card-text>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            class="mb-4"
            :text="error"
          />
          <div class="d-flex flex-column ga-3">
            <slot />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="close">{{ $t('common.cancel') }}</v-btn>
          <v-btn type="submit" color="primary" :loading="saving">
            {{ saveText ?? $t('common.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>
</template>
