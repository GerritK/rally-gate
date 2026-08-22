<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  fetchRallyInfo,
  saveRallyInfo,
  type RallyInfo,
} from '../api/rally-info';
import { fetchSetting, saveSetting } from '../api/settings';

const NOTIONAL_PENALTY_KEY = 'notionalPenaltyMs';
/** Mirrors DEFAULT_NOTIONAL_PENALTY_MS server-side; only used until the
 * stored value loads, so the two can't drift in practice. */
const NOTIONAL_PENALTY_FALLBACK_S = 30;

const rallyInfo = ref<RallyInfo>({ name: '', date: '', location: '' });
const saving = ref(false);
const notionalPenaltyS = ref(NOTIONAL_PENALTY_FALLBACK_S);
const savingPenalty = ref(false);

async function onSave() {
  if (!rallyInfo.value.name || saving.value) return;
  saving.value = true;
  try {
    rallyInfo.value = await saveRallyInfo(rallyInfo.value);
  } finally {
    saving.value = false;
  }
}

async function onSavePenalty() {
  if (savingPenalty.value) return;
  savingPenalty.value = true;
  try {
    await saveSetting(
      NOTIONAL_PENALTY_KEY,
      String(Math.round(notionalPenaltyS.value * 1000)),
    );
  } finally {
    savingPenalty.value = false;
  }
}

onMounted(async () => {
  const existing = await fetchRallyInfo();
  if (existing) rallyInfo.value = existing;
  const storedMs = Number(await fetchSetting(NOTIONAL_PENALTY_KEY));
  if (Number.isFinite(storedMs) && storedMs > 0) {
    notionalPenaltyS.value = storedMs / 1000;
  }
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-title>Rally Details</v-card-title>
    <v-card-text>
      <form class="d-flex flex-wrap align-center ga-3" @submit.prevent="onSave">
        <v-text-field
          v-model="rallyInfo.name"
          label="Rally name"
          density="comfortable"
          hide-details
          style="min-width: 260px"
        />
        <v-text-field
          v-model="rallyInfo.date"
          label="Date (optional)"
          density="comfortable"
          hide-details
          style="min-width: 180px"
        />
        <v-text-field
          v-model="rallyInfo.location"
          label="Location (optional)"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="saving"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card class="mb-6">
    <v-card-title>Scoring</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        A crew that doesn't complete a closed stage is charged a
        <strong>notional time</strong> for it: the slowest time anyone set on
        that stage, plus this penalty. Without it, retiring early would look
        like winning — a shorter total is otherwise just the result of driving
        less. Raise it to make a retirement more costly; a penalty smaller than
        the spread between crews still lets a quick car lead on fewer stages.
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
          :loading="savingPenalty"
          variant="outlined"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-row>
    <v-col cols="12" sm="4">
      <v-card to="/setup/stages" prepend-icon="mdi-flag-checkered">
        <v-card-title>Stages</v-card-title>
        <v-card-text>Create stages and assign gates to them.</v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
