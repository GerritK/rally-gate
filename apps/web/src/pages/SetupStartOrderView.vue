<script setup lang="ts">
import {
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
} from '@rally-gate/shared';
import { computed, onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify, t } from '@rally-gate/ui';

const groupingOptions = computed(() => [
  { value: StartOrderGrouping.MAIN_CLASS, title: t('startOrder.byMainClass') },
  { value: StartOrderGrouping.NONE, title: t('startOrder.noGrouping') },
]);
const keyOptions = computed(() => [
  { value: StartOrderKey.START_NUMBER, title: t('startOrder.startNumber') },
  { value: StartOrderKey.OVERALL_TIME, title: t('startOrder.overallTime') },
  {
    value: StartOrderKey.LAST_STAGE_TIME,
    title: t('startOrder.lastStageTime'),
  },
]);
const directionOptions = computed(() => [
  {
    value: StartOrderDirection.FASTEST_FIRST,
    title: t('startOrder.fastestFirst'),
  },
  {
    value: StartOrderDirection.SLOWEST_FIRST,
    title: t('startOrder.slowestFirst'),
  },
]);

// Defaults mirror StartOrderService's, which also applies them while unset.
const grouping = ref(StartOrderGrouping.MAIN_CLASS);
const key = ref(StartOrderKey.START_NUMBER);
const direction = ref(StartOrderDirection.FASTEST_FIRST);
const saving = ref(false);
const { markSaved } = useUnsavedChanges(() => [
  grouping.value,
  key.value,
  direction.value,
]);

async function onSave() {
  if (saving.value) return;
  saving.value = true;
  try {
    await Promise.all([
      saveSetting(START_ORDER_GROUPING_KEY, grouping.value),
      saveSetting(START_ORDER_KEY_KEY, key.value),
      saveSetting(START_ORDER_DIRECTION_KEY, direction.value),
    ]);
    markSaved();
    notify(t('startOrder.saved'));
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [g, k, d] = await Promise.all([
    fetchSetting(START_ORDER_GROUPING_KEY),
    fetchSetting(START_ORDER_KEY_KEY),
    fetchSetting(START_ORDER_DIRECTION_KEY),
  ]);
  grouping.value = (g ?? grouping.value) as StartOrderGrouping;
  key.value = (k ?? key.value) as StartOrderKey;
  direction.value = (d ?? direction.value) as StartOrderDirection;
  markSaved();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>

  <v-card>
    <v-card-title>{{ $t('startOrder.title') }}</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        <i18n-t keypath="startOrder.explain" scope="global">
          <template #frozen>
            <strong>{{ $t('startOrder.frozen') }}</strong>
          </template>
        </i18n-t>
      </v-alert>
      <form class="d-flex flex-column ga-4" @submit.prevent="onSave">
        <v-select
          v-model="grouping"
          :items="groupingOptions"
          :label="$t('startOrder.grouping')"
          :hint="$t('startOrder.groupingHint')"
          persistent-hint
          style="max-width: 420px"
        />
        <v-select
          v-model="key"
          :items="keyOptions"
          :label="$t('startOrder.orderWithin')"
          style="max-width: 420px"
        />
        <v-select
          v-model="direction"
          :items="directionOptions"
          :label="$t('startOrder.direction')"
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
            {{ $t('common.save') }}
          </v-btn>
        </div>
      </form>
    </v-card-text>
  </v-card>
</template>
