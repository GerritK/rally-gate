<script setup lang="ts">
import {
  FLAGS_SHOWN_KEY,
  NAME_FORMAT_KEY,
  NameFormat,
  PODIUM_SHOWN_KEY,
} from '@rally-gate/shared';
import { notify } from '@rally-gate/ui';
import { onMounted, ref } from 'vue';
import { saveSetting } from '../api/settings';
import { display, loadDisplaySettings } from '../crew';
import { useUnsavedChanges } from '../unsaved-changes';

const NAME_FORMATS = [
  { value: NameFormat.FIRST_INITIAL, title: 'Max M.' },
  { value: NameFormat.INITIAL_LAST, title: 'M. Mustermann' },
  { value: NameFormat.FULL, title: 'Max Mustermann' },
];
const SHOWN = [
  { value: true, title: 'Yes' },
  { value: false, title: 'No' },
];

const form = ref({ ...display });
const saving = ref(false);
const { markSaved } = useUnsavedChanges(() => form.value);

async function onSave() {
  if (saving.value) return;
  saving.value = true;
  try {
    await Promise.all([
      saveSetting(NAME_FORMAT_KEY, form.value.nameFormat),
      saveSetting(FLAGS_SHOWN_KEY, String(form.value.flags)),
      saveSetting(PODIUM_SHOWN_KEY, String(form.value.podium)),
    ]);
    Object.assign(display, form.value);
    markSaved();
    notify('Display saved');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadDisplaySettings();
  form.value = { ...display };
  markSaved();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title>Display</v-card-title>
    <v-card-text>
      <form class="rg-display-form" @submit.prevent="onSave">
        <v-select
          v-model="form.nameFormat"
          :items="NAME_FORMATS"
          label="Crew names"
          hide-details
        />
        <v-select
          v-model="form.flags"
          :items="SHOWN"
          label="Flags"
          persistent-hint
          hint="On screen: start lists and results print as plain PDFs, without flags."
        />
        <v-select
          v-model="form.podium"
          :items="SHOWN"
          label="Podium above results"
          persistent-hint
          hint="On screen: printed results have no podium."
        />
        <div>
          <v-btn
            type="submit"
            color="primary"
            :loading="saving"
            prepend-icon="mdi-content-save"
          >
            Save
          </v-btn>
        </div>
      </form>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.rg-display-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
}
</style>
