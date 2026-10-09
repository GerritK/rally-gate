<script setup lang="ts">
import { computed, ref } from 'vue';
import { StageStatus } from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import type { Entry } from '../api/entries';
import {
  createPenalty,
  fetchPenaltyTypes,
  type PenaltyInput,
  type PenaltyType,
} from '../api/penalties';
import type { Stage } from '../api/stages';
import { entryName, parseWholeSeconds, wholeSeconds } from '../format';
import FormDialog from './FormDialog.vue';

/**
 * Gives an entry penalties, the way a roadbook is read out: a count per
 * type of the catalogue, plus optionally one free-text penalty with its time
 * typed in (a jury decision). Opened with `add(entryId, stageId)`; from Live
 * Timing the stage is fixed, from the entry page it is picked here.
 */
const props = defineProps<{ stages: Stage[]; entries: Entry[] }>();
const emit = defineEmits<{ saved: [] }>();

/** v-select can't offer `null` as a choice, so this stands in for it. */
const WHOLE_RALLY = 'whole-rally';

const open = ref(false);
const entryId = ref('');
const fixedStage = ref<Stage | null>(null);
const types = ref<PenaltyType[]>([]);
const draft = ref({
  stageId: WHOLE_RALLY,
  /** Per type id, as typed; empty is none. */
  counts: {} as Record<string, number | ''>,
  /** Applies to every typed penalty entered at once. */
  note: '',
  reason: '',
  /** As typed (`0:30`), parsed on save. */
  time: '',
});

// A stage that hasn't started has nothing to penalise yet (the server 409s).
const stageItems = computed(() => [
  ...props.stages
    .filter((s) => s.status !== StageStatus.NOT_STARTED)
    .map((s) => ({ title: `${s.id} · ${s.name}`, value: s.id })),
  { title: t('penalties.wholeRally'), value: WHOLE_RALLY },
]);

const title = computed(() => {
  const entry = entryName(props.entries, entryId.value);
  const stage = fixedStage.value;
  return stage
    ? t('penalties.addForStage', {
        entry,
        stage: `${stage.id} · ${stage.name}`,
      })
    : t('penalties.addFor', { entry });
});

const countRule = (value: unknown) =>
  value === '' ||
  value == null ||
  (Number.isInteger(value) && (value as number) >= 0) ||
  t('penalties.wholeCount');

// Free text is optional, but once begun needs both halves.
const timeRule = (value: string) =>
  (!value.trim() && !draft.value.reason.trim()) || wholeSeconds(value);
const reasonRule = (value: string) =>
  !!value.trim() || !draft.value.time.trim() || t('common.required');

async function add(forEntryId: string, stageId: string | null) {
  types.value = await fetchPenaltyTypes();
  entryId.value = forEntryId;
  fixedStage.value = props.stages.find((s) => s.id === stageId) ?? null;
  draft.value = {
    stageId: stageId ?? WHOLE_RALLY,
    counts: Object.fromEntries(types.value.map((type) => [type.id, ''])),
    note: '',
    reason: '',
    time: '',
  };
  open.value = true;
}

async function onSave() {
  const d = draft.value;
  const base = {
    entryId: entryId.value,
    stageId: d.stageId === WHOLE_RALLY ? null : d.stageId,
  };
  const penalties: PenaltyInput[] = types.value
    .filter((type) => Number(d.counts[type.id]) > 0)
    .map((type) => ({
      ...base,
      typeId: type.id,
      count: Number(d.counts[type.id]),
      seconds: null,
      note: d.note.trim() || null,
    }));
  if (d.reason.trim()) {
    penalties.push({
      ...base,
      typeId: null,
      count: 1,
      seconds: parseWholeSeconds(d.time),
      note: d.reason.trim(),
    });
  }
  if (penalties.length === 0) {
    throw new Error(t('penalties.nothingEntered'));
  }
  // ponytail: one request per penalty, no batch endpoint. The form is
  // validated first, so a partial save takes a server failure mid-way.
  for (const penalty of penalties) {
    await createPenalty(penalty);
  }
  emit('saved');
}

defineExpose({ add });
</script>

<template>
  <FormDialog
    v-model="open"
    :title="title"
    :form="draft"
    :save="onSave"
    :saved="$t('penalties.added')"
    :save-text="$t('penalties.add')"
  >
    <v-select
      v-if="!fixedStage"
      v-model="draft.stageId"
      :items="stageItems"
      :label="$t('entryDetail.stage')"
    />
    <div v-for="type in types" :key="type.id" class="d-flex align-center ga-3">
      <span class="flex-1-1-0">{{ type.name }}</span>
      <v-text-field
        v-model.number="draft.counts[type.id]"
        type="number"
        min="0"
        step="1"
        placeholder="0"
        :aria-label="type.name"
        :rules="[countRule]"
        density="compact"
        hide-details="auto"
        style="max-width: 120px"
      />
    </div>
    <v-text-field
      v-if="types.length > 0"
      v-model="draft.note"
      :label="$t('penalties.noteForAll')"
    />
    <div class="text-subtitle-2 mt-2">{{ $t('penalties.freeText') }}</div>
    <div class="d-flex ga-3">
      <v-text-field
        v-model="draft.reason"
        class="flex-1-1-0"
        :label="$t('penalties.reason')"
        :rules="[reasonRule]"
      />
      <v-text-field
        v-model="draft.time"
        :label="$t('penalties.time')"
        :rules="[timeRule]"
        placeholder="0:30"
        style="max-width: 140px"
      />
    </div>
  </FormDialog>
</template>
