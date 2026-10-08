<script setup lang="ts">
import {
  DEFAULT_NOTIONAL_PENALTY_MS,
  NOTIONAL_PENALTY_MS_KEY,
} from '@rally-gate/shared';
import { onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify, t } from '@rally-gate/ui';

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
    notify(t('scoring.saved'));
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
    {{ $t('setup.back') }}
  </v-btn>

  <v-card>
    <v-card-title>{{ $t('scoring.title') }}</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        <i18n-t keypath="scoring.explain" tag="p" scope="global">
          <template #notionalTime>
            <strong>{{ $t('scoring.notionalTime') }}</strong>
          </template>
        </i18n-t>
        <br />
        <i18n-t keypath="scoring.ruleOfThumb" tag="p" scope="global">
          <template #oneStage>
            <strong>{{ $t('scoring.oneStage') }}</strong>
          </template>
        </i18n-t>
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
          :label="$t('scoring.penaltyLabel')"
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
          {{ $t('common.save') }}
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
