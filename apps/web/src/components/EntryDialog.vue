<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  createEntry,
  updateEntry,
  EntryStatus,
  type Entry,
} from '../api/entries';
import type { EntryClass } from '../api/entry-classes';
import { required, ENTRY_STATUS_DISPLAY } from '../format';
import { toTransponderDrafts, toTransponderInput } from '../entry-status';
import ClassPicker from './ClassPicker.vue';
import FlagPicker from './FlagPicker.vue';
import FormDialog from './FormDialog.vue';
import TransponderFields from './TransponderFields.vue';

const props = defineProps<{
  /** `null` adds an entry. */
  entry: Entry | null;
  classes: EntryClass[];
  /** Every entry, for chassis and body suggestions. */
  entries: Entry[];
}>();
const emit = defineEmits<{ saved: [entry: Entry] }>();
const open = defineModel<boolean>({ required: true });

const statusOptions = computed(() =>
  Object.values(EntryStatus).map((value) => ({
    value,
    title: ENTRY_STATUS_DISPLAY[value].label,
  })),
);

const draft = ref(toDraft(null));
watch(open, (isOpen) => {
  if (isOpen) draft.value = toDraft(props.entry);
});

function toDraft(entry: Entry | null) {
  return {
    startNumber: entry?.startNumber ?? null,
    driverFirstName: entry?.driverFirstName ?? '',
    driverLastName: entry?.driverLastName ?? '',
    driverFlag: entry?.driverFlag ?? null,
    coDriverFirstName: entry?.coDriverFirstName ?? '',
    coDriverLastName: entry?.coDriverLastName ?? '',
    coDriverFlag: entry?.coDriverFlag ?? null,
    body: entry?.body ?? '',
    chassis: entry?.chassis ?? '',
    transponders: toTransponderDrafts(entry),
    status: entry?.status ?? EntryStatus.REGISTERED,
    classIds: entry?.classes.map((c) => c.id) ?? [],
  };
}

const suggestions = (pick: (v: Entry) => string | null) =>
  [...new Set(props.entries.map(pick).filter((v): v is string => !!v))].sort();
const bodies = computed(() => suggestions((v) => v.body));
const chassis = computed(() => suggestions((v) => v.chassis));

// null, not undefined: only null clears the column (CLAUDE.md).
const orNull = (value: string | null) => value?.trim() || null;

async function onSave() {
  const d = draft.value;
  const input = {
    ...d,
    startNumber: Number(d.startNumber),
    driverFirstName: d.driverFirstName.trim(),
    driverLastName: orNull(d.driverLastName),
    coDriverFirstName: orNull(d.coDriverFirstName),
    coDriverLastName: orNull(d.coDriverLastName),
    body: orNull(d.body),
    chassis: orNull(d.chassis),
    transponders: toTransponderInput(d.transponders),
  };
  emit(
    'saved',
    props.entry
      ? await updateEntry(props.entry.id, input)
      : await createEntry(input),
  );
}
</script>

<template>
  <FormDialog
    v-model="open"
    :title="
      entry
        ? $t('entryForm.editTitle', { nr: entry.startNumber })
        : $t('entryForm.add')
    "
    :form="draft"
    :save="onSave"
    :saved="entry ? $t('entryForm.saved') : $t('entryForm.added')"
    :save-text="entry ? $t('common.save') : $t('entryForm.add')"
    :max-width="880"
  >
    <v-text-field
      v-model.number="draft.startNumber"
      :label="$t('entry.startNumber')"
      type="number"
      min="1"
      :rules="[required]"
      autofocus
      class="rg-start-number"
    />
    <div class="rg-columns">
      <section>
        <div class="rg-section-title">{{ $t('entry.driver') }}</div>
        <div class="rg-pair">
          <v-text-field
            v-model="draft.driverFirstName"
            :label="$t('entry.firstName')"
            :rules="[required]"
          />
          <v-text-field
            v-model="draft.driverLastName"
            :label="$t('entry.lastName')"
          />
        </div>
        <FlagPicker v-model="draft.driverFlag" />
      </section>
      <section>
        <div class="rg-section-title">
          {{ $t('entryForm.coDriverOptional') }}
        </div>
        <div class="rg-pair">
          <v-text-field
            v-model="draft.coDriverFirstName"
            :label="$t('entry.firstName')"
          />
          <v-text-field
            v-model="draft.coDriverLastName"
            :label="$t('entry.lastName')"
          />
        </div>
        <FlagPicker v-model="draft.coDriverFlag" />
      </section>
    </div>
    <div class="rg-columns">
      <section>
        <div class="rg-section-title">{{ $t('entry.car') }}</div>
        <v-combobox
          v-model="draft.body"
          :items="bodies"
          :label="$t('entryForm.bodyOptional')"
          placeholder="Ford Focus"
        />
        <v-combobox
          v-model="draft.chassis"
          :items="chassis"
          :label="$t('entryForm.chassisOptional')"
          placeholder="HPI WR8"
        />
      </section>
      <section>
        <div class="rg-section-title">{{ $t('entryForm.registration') }}</div>
        <TransponderFields
          v-model="draft.transponders"
          :entries="entries"
          :self-id="entry?.id"
        />
        <ClassPicker
          v-if="classes.length > 0"
          v-model="draft.classIds"
          :classes="classes"
        />
        <v-select
          v-model="draft.status"
          :items="statusOptions"
          :label="$t('entry.status')"
        />
      </section>
    </div>
  </FormDialog>
</template>

<style scoped>
.rg-start-number {
  max-width: 200px;
}
/* Two sections side by side; each row of them starts under a rule, the
   one .rg-section-title draws between stacked sections. */
.rg-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  row-gap: 16px;
  /* Each section its own height: stretched to its taller neighbour, its
     fields would grow into the gap (a Vuetify input is flex: 1 1 auto). */
  align-items: start;
  padding-top: 16px;
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.rg-columns > section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* Stacked on a phone: back to one section after another. */
@media (max-width: 599px) {
  .rg-columns {
    grid-template-columns: 1fr;
  }
  .rg-columns > section + section {
    padding-top: 16px;
    border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
}
.rg-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  column-gap: 12px;
}
</style>
