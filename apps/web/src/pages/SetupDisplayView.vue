<script setup lang="ts">
import {
  FLAGS_SHOWN_KEY,
  NAME_FORMAT_KEY,
  NameFormat,
  PODIUM_SHOWN_KEY,
  type Crew,
} from '@rally-gate/shared';
import { notify } from '@rally-gate/ui';
import { onMounted, provide, reactive, ref } from 'vue';
import { saveSetting } from '../api/settings';
import { DISPLAY, display, loadDisplaySettings } from '../crew';
import { useUnsavedChanges } from '../unsaved-changes';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';

const NAME_FORMATS = [
  { value: NameFormat.FIRST_INITIAL, title: 'Max M.' },
  { value: NameFormat.INITIAL_LAST, title: 'M. Mustermann' },
  { value: NameFormat.FULL, title: 'Max Mustermann' },
];

/** The example crew, named like the format choices above. */
const EXAMPLE: Crew = {
  driverFirstName: 'Max',
  driverLastName: 'Mustermann',
  driverFlag: 'de',
  coDriverFirstName: 'Erika',
  coDriverLastName: 'Musterfrau',
  coDriverFlag: 'at',
  chassis: null,
  body: null,
};

const form = reactive({ ...display });
// The example below draws with the form, before it is saved.
provide(DISPLAY, form);
const saving = ref(false);
const { markSaved } = useUnsavedChanges(() => form);

async function onSave() {
  if (saving.value) return;
  saving.value = true;
  try {
    await Promise.all([
      saveSetting(NAME_FORMAT_KEY, form.nameFormat),
      saveSetting(FLAGS_SHOWN_KEY, String(form.flags)),
      saveSetting(PODIUM_SHOWN_KEY, String(form.podium)),
    ]);
    Object.assign(display, form);
    markSaved();
    notify('Display saved');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadDisplaySettings();
  Object.assign(form, display);
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
        <div class="rg-section-title">Crew</div>
        <div class="rg-display-crew">
          <div class="rg-display-fields">
            <v-select
              v-model="form.nameFormat"
              :items="NAME_FORMATS"
              label="Name format"
              hide-details
            />
            <v-switch
              v-model="form.flags"
              label="Show flags beside crew names"
              color="secondary"
              persistent-hint
              hint="Printed start lists and results never show flags."
            />
          </div>
          <div>
            <div class="text-caption text-medium-emphasis mb-1">
              As it appears in Live Timing and Results
            </div>
            <v-sheet border rounded class="d-flex align-center ga-3 pa-3">
              <StartNumber :number="7" />
              <CrewName :crew="EXAMPLE" />
            </v-sheet>
          </div>
        </div>

        <div class="rg-section-title">Results</div>
        <v-switch
          v-model="form.podium"
          label="Show the podium above results"
          color="secondary"
          persistent-hint
          hint="Printed results never show the podium."
          class="rg-display-fields"
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
}
.rg-display-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 420px;
}
/* Settings left, the example beside them; stacked on a phone. */
.rg-display-crew {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 360px);
  gap: 16px 32px;
  align-items: start;
}
@media (max-width: 759px) {
  .rg-display-crew {
    grid-template-columns: 1fr;
  }
}
</style>
