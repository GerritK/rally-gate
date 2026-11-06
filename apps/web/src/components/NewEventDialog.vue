<script setup lang="ts">
import { ref, watch } from 'vue';
import FormDialog from './FormDialog.vue';
import { required } from '../format';

const props = defineProps<{
  /** Throws to keep the dialog open with the error. */
  create: (input: { name: string; date: string }) => Promise<void>;
}>();
const open = defineModel<boolean>({ required: true });

/** The API's `YYYY-MM-DD`, in local time like the picker's day. */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const draft = ref<{ name: string; date: Date | null }>({
  name: '',
  date: new Date(),
});
// Sync and in place: FormDialog snapshots this same object when it opens,
// to tell whether closing would lose anything.
watch(
  open,
  (isOpen) => {
    if (isOpen) Object.assign(draft.value, { name: '', date: new Date() });
  },
  { flush: 'sync' },
);

const save = () =>
  props.create({ name: draft.value.name, date: isoDay(draft.value.date!) });
</script>

<template>
  <FormDialog
    v-model="open"
    :title="$t('setup.newEvent')"
    :form="draft"
    :save="save"
    :saved="$t('setup.eventCreated')"
    :save-text="$t('setup.createAndOpen')"
  >
    <p class="text-body-2 text-medium-emphasis">
      {{ $t('setup.newEventHint') }}
    </p>
    <v-text-field
      v-model="draft.name"
      :label="$t('setup.rallyName')"
      :rules="[required]"
      autofocus
    />
    <v-date-input
      v-model="draft.date"
      :label="$t('setup.date')"
      :rules="[required]"
    />
  </FormDialog>
</template>
