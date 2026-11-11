<script setup lang="ts">
import { useLoad } from '../load';
import LoadedPage from '../components/LoadedPage.vue';
import { can } from '../api/auth';
import {
  COUNTDOWN_MS_KEY,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_JUMP_START_TOLERANCE_MS,
  DEFAULT_MIN_START_GAP_MS,
  JUMP_START_PENALTY_TYPE_ID_KEY,
  JUMP_START_TOLERANCE_MS_KEY,
  MIN_START_GAP_MS_KEY,
  START_ORDER_DIRECTION_KEY,
  START_ORDER_GROUPING_KEY,
  START_ORDER_KEY_KEY,
  StartOrderDirection,
  StartOrderGrouping,
  StartOrderKey,
  RallyStatus,
} from '@rally-gate/shared';
import { computed, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import { fetchPenaltyTypes, type PenaltyType } from '../api/penalties';
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

// The countdown settings lock separately: only the tolerance moves marks
// already shown, so it alone is fixed once the rally runs.
const countdownLocked = lockedWhen(RallyStatus.CLOSED);
const toleranceLocked = lockedWhen(RallyStatus.RUNNING, RallyStatus.CLOSED);
const countdownS = ref(DEFAULT_COUNTDOWN_MS / 1000);
const toleranceMs = ref(DEFAULT_JUMP_START_TOLERANCE_MS);
const gapS = ref(DEFAULT_MIN_START_GAP_MS / 1000);
const penaltyTypes = ref<PenaltyType[]>([]);
/** '' is none: v-select can't offer null. A jump start is then only marked. */
const jumpStartTypeId = ref('');
const jumpStartItems = computed(() => [
  { value: '', title: t('countdown.jumpStartNone') },
  ...penaltyTypes.value.map((type) => ({ value: type.id, title: type.name })),
]);
const savingCountdown = ref(false);
const countdownForm = ref<{ validate: () => Promise<{ valid: boolean }> }>();
const { markSaved: markCountdownSaved } = useUnsavedChanges(() => [
  countdownS.value,
  toleranceMs.value,
  gapS.value,
  jumpStartTypeId.value,
]);

/** The start lights are always the countdown's last 5 s. */
const countdownRule = (v: number) =>
  (Number.isInteger(v) && v >= 5) || t('countdown.countdownRule');
const wholeRule = (min: number) => (v: number) =>
  (Number.isInteger(v) && v >= min) || t('countdown.wholeRule', { min });

async function onSaveCountdown() {
  if (savingCountdown.value) return;
  if (!(await countdownForm.value?.validate())?.valid) return;
  savingCountdown.value = true;
  try {
    await Promise.all([
      saveSetting(COUNTDOWN_MS_KEY, String(countdownS.value * 1000)),
      ...(toleranceLocked.value
        ? []
        : [
            saveSetting(JUMP_START_TOLERANCE_MS_KEY, String(toleranceMs.value)),
          ]),
      saveSetting(MIN_START_GAP_MS_KEY, String(gapS.value * 1000)),
      saveSetting(JUMP_START_PENALTY_TYPE_ID_KEY, jumpStartTypeId.value),
    ]);
    markCountdownSaved();
    notify(t('countdown.saved'));
  } finally {
    savingCountdown.value = false;
  }
}

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

const load = useLoad(async () => {
  const [g, k, d, c, tol, gap, types, jumpType] = await Promise.all([
    fetchSetting(START_ORDER_GROUPING_KEY),
    fetchSetting(START_ORDER_KEY_KEY),
    fetchSetting(START_ORDER_DIRECTION_KEY),
    fetchSetting(COUNTDOWN_MS_KEY),
    fetchSetting(JUMP_START_TOLERANCE_MS_KEY),
    fetchSetting(MIN_START_GAP_MS_KEY),
    fetchPenaltyTypes(),
    fetchSetting(JUMP_START_PENALTY_TYPE_ID_KEY),
  ]);
  if (c) countdownS.value = Number(c) / 1000;
  if (tol) toleranceMs.value = Number(tol);
  if (gap) gapS.value = Number(gap) / 1000;
  penaltyTypes.value = types;
  // A deleted type falls back to none rather than a dangling id.
  jumpStartTypeId.value = types.some((type) => type.id === jumpType)
    ? jumpType!
    : '';
  markCountdownSaved();
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
  <LoadedPage :load="load">
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
            class="rg-field-narrow"
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
            class="rg-field-narrow"
          />
          <v-select
            v-model="direction"
            :items="directionOptions"
            :label="$t('startOrder.direction')"
            :disabled="locked || key === StartOrderKey.START_NUMBER"
            class="rg-field-narrow"
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

    <v-card class="mt-4">
      <v-card-title>{{ $t('countdown.title') }}</v-card-title>
      <v-card-subtitle>{{ $t('countdown.explain') }}</v-card-subtitle>
      <v-card-text>
        <v-form
          ref="countdownForm"
          :readonly="!can('setup')"
          class="d-flex flex-column ga-4"
          @submit.prevent="onSaveCountdown"
        >
          <v-text-field
            v-model.number="countdownS"
            type="number"
            min="5"
            :suffix="$t('countdown.seconds')"
            :label="$t('countdown.countdown')"
            :hint="$t('countdown.countdownHint')"
            persistent-hint
            :rules="[countdownRule]"
            :disabled="countdownLocked"
            class="rg-timing rg-field-narrow"
          />
          <v-text-field
            v-model.number="toleranceMs"
            type="number"
            min="0"
            :suffix="$t('countdown.milliseconds')"
            :label="$t('countdown.tolerance')"
            :hint="$t('countdown.toleranceHint')"
            persistent-hint
            :rules="[wholeRule(0)]"
            :disabled="toleranceLocked"
            class="rg-timing rg-field-narrow"
          />
          <v-text-field
            v-model.number="gapS"
            type="number"
            min="1"
            :suffix="$t('countdown.seconds')"
            :label="$t('countdown.gap')"
            :hint="$t('countdown.gapHint')"
            persistent-hint
            :rules="[wholeRule(1)]"
            :disabled="countdownLocked"
            class="rg-timing rg-field-narrow"
          />
          <div>
            <v-select
              v-model="jumpStartTypeId"
              :items="jumpStartItems"
              :label="$t('countdown.jumpStartPenalty')"
              :disabled="countdownLocked"
              hide-details
              class="rg-field-narrow"
            />
            <router-link
              to="/setup/scoring"
              class="rg-link text-body-2 d-inline-block mt-2"
            >
              {{ $t('countdown.managePenalties') }}
            </router-link>
          </div>
          <div>
            <v-btn
              v-if="can('setup')"
              type="submit"
              color="primary"
              :loading="savingCountdown"
              :disabled="countdownLocked"
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
