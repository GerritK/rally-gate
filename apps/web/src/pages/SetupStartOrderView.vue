<script setup lang="ts">
import {
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
} from '@rally-gate/shared';
import { onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';

const GROUPING_OPTIONS = [
  { value: StartOrderGrouping.MAIN_CLASS, title: 'By main class' },
  { value: StartOrderGrouping.NONE, title: 'None — one field' },
];
const KEY_OPTIONS = [
  { value: StartOrderKey.START_NUMBER, title: 'Start number' },
  { value: StartOrderKey.OVERALL_TIME, title: 'Overall time' },
  { value: StartOrderKey.LAST_STAGE_TIME, title: 'Last stage time' },
];
const DIRECTION_OPTIONS = [
  { value: StartOrderDirection.FASTEST_FIRST, title: 'Fastest first' },
  { value: StartOrderDirection.SLOWEST_FIRST, title: 'Slowest first' },
];

// Defaults mirror StartOrderService's, which also applies them while unset.
const grouping = ref(StartOrderGrouping.MAIN_CLASS);
const key = ref(StartOrderKey.START_NUMBER);
const direction = ref(StartOrderDirection.FASTEST_FIRST);
const saving = ref(false);
const saved = ref(false);

async function onSave() {
  if (saving.value) return;
  saving.value = true;
  saved.value = false;
  try {
    await saveSetting(START_ORDER_GROUPING_KEY, grouping.value);
    await saveSetting(START_ORDER_KEY_KEY, key.value);
    await saveSetting(START_ORDER_DIRECTION_KEY, direction.value);
    saved.value = true;
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  grouping.value = ((await fetchSetting(START_ORDER_GROUPING_KEY)) ??
    grouping.value) as StartOrderGrouping;
  key.value = ((await fetchSetting(START_ORDER_KEY_KEY)) ??
    key.value) as StartOrderKey;
  direction.value = ((await fetchSetting(START_ORDER_DIRECTION_KEY)) ??
    direction.value) as StartOrderDirection;
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title>Start order</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        Applies to every stage. A stage's list is <strong>frozen</strong> when
        it is frozen on the Start List or the stage is first activated — changes
        here only affect lists not yet frozen. Crews without a time start at the
        end of their group, and ties go by start number, so "Last stage time" on
        the first stage is simply start-number order.
      </v-alert>
      <form class="d-flex flex-column ga-4" @submit.prevent="onSave">
        <v-select
          v-model="grouping"
          :items="GROUPING_OPTIONS"
          label="Grouping"
          hint="Main classes start one after another, alphabetically; cars without a main class last."
          persistent-hint
          style="max-width: 420px"
        />
        <v-select
          v-model="key"
          :items="KEY_OPTIONS"
          label="Order within a group"
          style="max-width: 420px"
        />
        <v-select
          v-model="direction"
          :items="DIRECTION_OPTIONS"
          label="Direction"
          :disabled="key === StartOrderKey.START_NUMBER"
          style="max-width: 420px"
        />
        <div class="d-flex align-center ga-3">
          <v-btn
            type="submit"
            color="primary"
            :loading="saving"
            prepend-icon="mdi-content-save"
          >
            Save
          </v-btn>
          <v-chip
            v-if="saved"
            color="success"
            size="small"
            prepend-icon="mdi-check"
          >
            Saved
          </v-chip>
        </div>
      </form>
    </v-card-text>
  </v-card>
</template>
