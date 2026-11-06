<script setup lang="ts">
import { ApiErrorCode } from '@rally-gate/shared';
import { notify, t, useConfirm } from '@rally-gate/ui';
import { ref } from 'vue';
import { ApiError } from '../api/client';
import { importEvent } from '../api/event';
import { eventName } from '../format';

/** A `.rallygate` file from elsewhere into the folder; not opened. */
const emit = defineEmits<{ imported: [] }>();
const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const confirm = useConfirm();

async function upload(file: File) {
  try {
    return await importEvent(file, false);
  } catch (err) {
    if (!(
      err instanceof ApiError && err.code === ApiErrorCode.EVENT_FILE_EXISTS
    )) {
      throw err;
    }
    const name = eventName(String(err.params.file));
    const ok = await confirm({
      title: t('events.replaceTitle', { name }),
      text: t('events.replaceText'),
      confirmText: t('events.replace'),
      color: 'error',
    });
    return ok ? importEvent(file, true) : null;
  }
}

async function onPicked() {
  const file = input.value?.files?.[0];
  if (!input.value || !file) return;
  // So picking the same file again still fires `change`.
  input.value.value = '';
  busy.value = true;
  try {
    const done = await upload(file);
    if (!done) return;
    notify(t('events.imported', { name: eventName(done.file) }));
    emit('imported');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-btn
    v-bind="$attrs"
    prepend-icon="mdi-upload"
    :loading="busy"
    @click="input?.click()"
  >
    {{ $t('events.import') }}
  </v-btn>
  <input
    ref="input"
    type="file"
    accept=".rallygate"
    hidden
    @change="onPicked"
  />
</template>
