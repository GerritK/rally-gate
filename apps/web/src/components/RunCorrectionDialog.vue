<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  formatClockTime,
  formatStageDuration,
  openTimePicker,
  parseStageDuration,
  t,
} from '@rally-gate/ui';
import type { Entry } from '../api/entries';
import {
  correctStageRun,
  createStageRun,
  type StageRun,
} from '../api/stage-runs';
import { combineDateAndTime, entryName, required } from '../format';
import FormDialog from './FormDialog.vue';

/**
 * Corrects a run's times, or enters one for a car with no run — a missed
 * start, typically on a closed stage where Start now is long gone. Opened
 * with `correct(run)` / `enter(entryId)`, which set the form before the
 * dialog opens and takes the snapshot it compares against on close.
 */
const props = defineProps<{ stageId: string; entries: Entry[] }>();
const emit = defineEmits<{ saved: [run: StageRun] }>();

const open = ref(false);
const correcting = ref<StageRun | null>(null);
const enteringEntryId = ref<string | null>(null);
const correction = ref({ start: '', finish: '', stageTime: '' });
const initialStageTime = ref('');

watch(
  () => props.stageId,
  () => (open.value = false),
);

function correct(run: StageRun) {
  correcting.value = run;
  enteringEntryId.value = null;
  initialStageTime.value =
    run.durationMs != null ? formatStageDuration(run.durationMs) : '';
  correction.value = {
    start: formatClockTime(run.startTime),
    finish: formatClockTime(run.finishTime),
    stageTime: initialStageTime.value,
  };
  open.value = true;
}

function enter(entryId: string) {
  correcting.value = null;
  enteringEntryId.value = entryId;
  initialStageTime.value = '';
  correction.value = { start: '', finish: '', stageTime: '' };
  open.value = true;
}

defineExpose({ correct, enter });

const title = computed(() =>
  correcting.value
    ? t('correction.correctTitle', {
        entry: entryName(props.entries, correcting.value.entryId),
        attempt: correcting.value.attempt,
      })
    : enteringEntryId.value
      ? t('correction.enterTitle', {
          entry: entryName(props.entries, enteringEntryId.value),
        })
      : '',
);

/** A changed stage time sets the finish (correcting) or the start (entering),
 * so that field is derived instead of typed. */
const stageTimeChanged = computed(
  () =>
    correction.value.stageTime.trim() !== '' &&
    correction.value.stageTime !== initialStageTime.value,
);

function stageTimeRule(value: string) {
  return !value.trim() || parseStageDuration(value) !== null
    ? true
    : t('correction.stageTimeRule');
}

/** Start as it will be saved: the stored one, to the millisecond, unless
 * the field was changed. */
function startIso(run: StageRun): string {
  const { start } = correction.value;
  return start === formatClockTime(run.startTime)
    ? run.startTime
    : combineDateAndTime(run.startTime, start);
}

/** The finish (correcting) or start (entering) a changed stage time gives,
 * to the millisecond, so the result is exactly the stopwatch's. Entering,
 * it counts back from the finish, dated today like any correction without
 * a run. */
const derivedIso = computed(() => {
  const { start, finish, stageTime } = correction.value;
  const durationMs = stageTimeChanged.value
    ? parseStageDuration(stageTime)
    : null;
  if (!durationMs) return null;
  const run = correcting.value;
  if (run) {
    if (!start) return null;
    return new Date(Date.parse(startIso(run)) + durationMs).toISOString();
  }
  if (!finish) return null;
  const finishMs = Date.parse(combineDateAndTime(new Date(), finish));
  return new Date(finishMs - durationMs).toISOString();
});

/**
 * Sends only the times that changed: the fields hold whole seconds, so
 * resending an untouched time would drop its milliseconds and mark a gate's
 * time as hand-set.
 */
async function onSave() {
  const { start, finish } = correction.value;
  const entryId = enteringEntryId.value;
  if (entryId) {
    const finishTime = combineDateAndTime(new Date(), finish);
    emit(
      'saved',
      await createStageRun({
        entryId,
        stageId: props.stageId,
        startTime: derivedIso.value ?? combineDateAndTime(finishTime, start),
        finishTime,
      }),
    );
    return;
  }
  const run = correcting.value;
  if (!run) return;
  const patch: { startTime?: string; finishTime?: string | null } = {};
  if (start !== formatClockTime(run.startTime)) {
    patch.startTime = startIso(run);
  }
  if (derivedIso.value) {
    patch.finishTime = derivedIso.value;
  } else if ((finish || '') !== formatClockTime(run.finishTime)) {
    patch.finishTime = finish
      ? combineDateAndTime(run.finishTime ?? run.startTime, finish)
      : null;
  }
  if (Object.keys(patch).length === 0) return;
  emit('saved', await correctStageRun(run.id, patch));
}
</script>

<template>
  <FormDialog
    v-model="open"
    :title="title"
    :form="correction"
    :save="onSave"
    :saved="
      enteringEntryId ? $t('correction.entered') : $t('correction.corrected')
    "
  >
    <p class="text-body-2 text-medium-emphasis">
      {{ $t('correction.intro') }}
      {{
        enteringEntryId
          ? $t('correction.introEnter')
          : $t('correction.introCorrect')
      }}
      {{ $t('correction.introManual') }}
    </p>
    <v-text-field
      v-if="enteringEntryId && derivedIso"
      :model-value="formatClockTime(derivedIso)"
      type="time"
      step="1"
      :label="$t('gateRole.start')"
      class="rg-timing"
      :hint="$t('correction.setByStageTime')"
      persistent-hint
      disabled
    />
    <v-text-field
      v-else
      v-model="correction.start"
      type="time"
      step="1"
      :label="$t('gateRole.start')"
      class="rg-timing"
      append-inner-icon="mdi-clock-outline"
      :rules="enteringEntryId && stageTimeChanged ? [] : [required]"
      @click:append-inner="openTimePicker"
    />
    <v-text-field
      v-if="!enteringEntryId && derivedIso"
      :model-value="formatClockTime(derivedIso)"
      type="time"
      step="1"
      :label="$t('gateRole.finish')"
      class="rg-timing"
      :hint="$t('correction.setByStageTime')"
      persistent-hint
      disabled
    />
    <v-text-field
      v-else
      v-model="correction.finish"
      type="time"
      step="1"
      :label="$t('gateRole.finish')"
      class="rg-timing"
      :hint="enteringEntryId ? '' : $t('correction.finishHint')"
      persistent-hint
      :clearable="!enteringEntryId"
      :rules="enteringEntryId ? [required] : []"
      append-inner-icon="mdi-clock-outline"
      @click:append-inner="openTimePicker"
    />
    <v-text-field
      v-model="correction.stageTime"
      :label="$t('correction.stageTime')"
      placeholder="3:12.4"
      class="rg-timing"
      :rules="[stageTimeRule]"
    />
  </FormDialog>
</template>
