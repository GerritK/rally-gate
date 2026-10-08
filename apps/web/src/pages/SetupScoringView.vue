<script setup lang="ts">
import {
  DEFAULT_NOTIONAL_PENALTY_MS,
  NOTIONAL_PENALTY_MS_KEY,
} from '@rally-gate/shared';
import { onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify } from '@rally-gate/ui';

const notionalPenaltyS = ref(DEFAULT_NOTIONAL_PENALTY_MS / 1000);
const savingPenalty = ref(false);
const { markSaved } = useUnsavedChanges(() => notionalPenaltyS.value);

async function onSavePenalty() {
  if (savingPenalty.value) return;
  savingPenalty.value = true;
  try {
    await saveSetting(
      NOTIONAL_PENALTY_MS_KEY,
      String(Math.round(notionalPenaltyS.value * 1000)),
    );
    markSaved();
    notify('Penalty saved');
  } finally {
    savingPenalty.value = false;
  }
}

onMounted(async () => {
  const storedMs = Number(await fetchSetting(NOTIONAL_PENALTY_MS_KEY));
  if (Number.isFinite(storedMs) && storedMs > 0) {
    notionalPenaltyS.value = storedMs / 1000;
  }
  markSaved();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title>Notional times</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        A crew that doesn't complete a closed stage is charged a
        <strong>notional time</strong> for it: the slowest time anyone set on
        that stage, plus this penalty. Without it, retiring early would look
        like winning — a shorter total is otherwise just the result of driving
        less. <br /><br />
        Rule of thumb: set it to roughly <strong>one stage duration</strong>.
        The penalty only has to be big enough to outweigh the advantage a crew
        built on the stages it <em>did</em> finish — set it too low and a quick
        car can retire and still lead the rally.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSavePenalty"
      >
        <v-text-field
          v-model.number="notionalPenaltyS"
          type="number"
          min="0"
          step="1"
          label="Notional time penalty (seconds)"
          density="comfortable"
          hide-details
          style="max-width: 260px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="savingPenalty"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
