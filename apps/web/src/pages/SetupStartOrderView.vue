<script setup lang="ts">
import { can } from '../api/auth';
import {
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
  RallyStatus,
} from '@rally-gate/shared';
import { computed, onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import { lockedWhen } from '../api/rally-info';
import RallyLockAlert from '../components/RallyLockAlert.vue';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify, t } from '@rally-gate/ui';

// Start lists of stages yet to run would reorder mid-rally.
const locked = lockedWhen(RallyStatus.RUNNING, RallyStatus.CLOSED);

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

  <RallyLockAlert :when="[RallyStatus.RUNNING, RallyStatus.CLOSED]" />
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
      <v-form
        :readonly="!can('setup')"
        class="d-flex flex-column ga-4"
        @submit.prevent="onSave"
      >
        <v-select
          v-model="grouping"
          :items="groupingOptions"
          :disabled="locked"
          :label="$t('startOrder.grouping')"
          :hint="$t('startOrder.groupingHint')"
          persistent-hint
          style="max-width: 420px"
        />
        <v-select
          v-model="key"
          :items="keyOptions"
          :disabled="locked"
          :label="$t('startOrder.orderWithin')"
          :hint="
            key === StartOrderKey.OVERALL_TIME
              ? $t('startOrder.orderWithinHint')
              : key === StartOrderKey.LAST_STAGE_TIME
                ? $t('startOrder.orderWithinFallback')
                : undefined
          "
          persistent-hint
          style="max-width: 420px"
        />
        <v-select
          v-model="direction"
          :items="directionOptions"
          :label="$t('startOrder.direction')"
          :disabled="locked || key === StartOrderKey.START_NUMBER"
          style="max-width: 420px"
        />
        <div class="d-flex align-center ga-3">
          <v-btn
            v-if="can('setup')"
            type="submit"
            color="primary"
            :loading="saving"
            :disabled="locked"
            prepend-icon="mdi-content-save"
          >
            {{ $t('common.save') }}
          </v-btn>
        </div>
      </v-form>
    </v-card-text>
  </v-card>
</template>
