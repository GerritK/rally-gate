<script setup lang="ts">
import { useLoad } from '../load';
import LoadedPage from '../components/LoadedPage.vue';
import { can } from '../api/auth';
import {
  FLAGS_SHOWN_KEY,
  NAME_FORMAT_KEY,
  NameFormat,
  PODIUM_SHOWN_KEY,
  type Crew,
} from '@rally-gate/shared';
import { notify, t } from '@rally-gate/ui';
import { provide, reactive, ref } from 'vue';
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
    notify(t('displaySetup.saved'));
  } finally {
    saving.value = false;
  }
}

const load = useLoad(async () => {
  await loadDisplaySettings();
  Object.assign(form, display);
  markSaved();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>
  <LoadedPage :load="load">
    <v-card>
      <v-card-title>{{ $t('displaySetup.title') }}</v-card-title>
      <v-card-text>
        <v-form
          :readonly="!can('setup')"
          class="rg-display-form"
          @submit.prevent="onSave"
        >
          <h3 class="rg-section-title">{{ $t('table.crew') }}</h3>
          <div class="rg-display-crew">
            <div class="rg-display-fields">
              <v-select
                v-model="form.nameFormat"
                :items="NAME_FORMATS"
                :label="$t('displaySetup.nameFormat')"
                hide-details
              />
              <v-switch
                v-model="form.flags"
                :label="$t('displaySetup.flags')"
                color="secondary"
                persistent-hint
                :hint="$t('displaySetup.flagsHint')"
              />
            </div>
            <div>
              <div class="text-caption text-medium-emphasis mb-1">
                {{ $t('displaySetup.example') }}
              </div>
              <v-sheet border rounded class="d-flex align-center ga-3 pa-3">
                <StartNumber :number="7" />
                <CrewName :crew="EXAMPLE" />
              </v-sheet>
            </div>
          </div>

          <h3 class="rg-section-title">{{ $t('nav.results') }}</h3>
          <v-switch
            v-model="form.podium"
            :label="$t('displaySetup.podium')"
            color="secondary"
            persistent-hint
            :hint="$t('displaySetup.podiumHint')"
            class="rg-display-fields"
          />
          <div>
            <v-btn
              v-if="can('setup')"
              type="submit"
              color="primary"
              :loading="saving"
              prepend-icon="mdi-content-save"
            >
              {{ $t('common.save') }}
            </v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
  </LoadedPage>
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
/* Settings left, the example beside them; stacked below md. */
.rg-display-crew {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 360px);
  gap: 16px 32px;
  align-items: start;
}
@media (max-width: 959px) {
  .rg-display-crew {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
