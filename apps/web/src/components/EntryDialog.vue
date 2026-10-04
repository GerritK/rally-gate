<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  createEntry,
  updateEntry,
  EntryStatus,
  type Entry,
} from '../api/entries';
import type { EntryClass } from '../api/entry-classes';
import { FLAG_OPTIONS, flagUrl } from '../crew';
import { required, ENTRY_STATUS_DISPLAY } from '../format';
import { transponderWarning } from '../entry-status';
import ClassPicker from './ClassPicker.vue';
import FormDialog from './FormDialog.vue';

const props = defineProps<{
  /** `null` adds an entry. */
  entry: Entry | null;
  classes: EntryClass[];
  /** Every entry, for chassis and body suggestions. */
  entries: Entry[];
}>();
const emit = defineEmits<{ saved: [entry: Entry] }>();
const open = defineModel<boolean>({ required: true });

const STATUS_OPTIONS = Object.values(EntryStatus).map((value) => ({
  value,
  title: ENTRY_STATUS_DISPLAY[value].label,
}));

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
    transponderId: entry?.transponderId ?? '',
    status: entry?.status ?? EntryStatus.REGISTERED,
    classIds: entry?.classes.map((c) => c.id) ?? [],
  };
}

const suggestions = (pick: (v: Entry) => string | null) =>
  [...new Set(props.entries.map(pick).filter((v): v is string => !!v))].sort();
const bodies = computed(() => suggestions((v) => v.body));
const chassis = computed(() => suggestions((v) => v.chassis));

// null, not undefined: only null clears the column (CLAUDE.md).
const transponderShared = computed(() =>
  transponderWarning(
    props.entries,
    draft.value.transponderId,
    props.entry?.id ?? undefined,
  ),
);

/** Tabbing into a picked flag and typing should search, not append to the
 *  flag's name. Vuetify writes the name into the input after focus, so the
 *  select waits a frame. */
function selectText(e: FocusEvent) {
  const input = e.target as HTMLInputElement;
  requestAnimationFrame(() => input.select());
}

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
    transponderId: orNull(d.transponderId),
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
    :title="entry ? `Edit entry ${entry.startNumber}` : 'Add entry'"
    :form="draft"
    :save="onSave"
    :saved="entry ? 'Entry saved' : 'Entry added'"
    :save-text="entry ? 'Save' : 'Add entry'"
    :max-width="880"
  >
    <v-text-field
      v-model.number="draft.startNumber"
      label="Start #"
      type="number"
      min="1"
      :rules="[required]"
      autofocus
      class="rg-start-number"
    />
    <div class="rg-columns">
      <section>
        <div class="rg-section-title">Driver</div>
        <div class="rg-pair">
          <v-text-field
            v-model="draft.driverFirstName"
            label="First name"
            :rules="[required]"
          />
          <v-text-field v-model="draft.driverLastName" label="Last name" />
        </div>
        <v-autocomplete
          v-model="draft.driverFlag"
          :items="FLAG_OPTIONS"
          label="Flag"
          placeholder="None (chequered flag)"
          persistent-placeholder
          clearable
          auto-select-first
          @focus="selectText"
        >
          <template #prepend-inner>
            <img :src="flagUrl(draft.driverFlag)" alt="" class="rg-flag-pick" />
          </template>
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template #prepend>
                <img
                  :src="flagUrl(item.value)"
                  alt=""
                  class="rg-flag-pick me-3"
                />
              </template>
            </v-list-item>
          </template>
        </v-autocomplete>
      </section>
      <section>
        <div class="rg-section-title">Co-driver (optional)</div>
        <div class="rg-pair">
          <v-text-field v-model="draft.coDriverFirstName" label="First name" />
          <v-text-field v-model="draft.coDriverLastName" label="Last name" />
        </div>
        <v-autocomplete
          v-model="draft.coDriverFlag"
          :items="FLAG_OPTIONS"
          label="Flag"
          placeholder="None (chequered flag)"
          persistent-placeholder
          clearable
          auto-select-first
          @focus="selectText"
        >
          <template #prepend-inner>
            <img
              :src="flagUrl(draft.coDriverFlag)"
              alt=""
              class="rg-flag-pick"
            />
          </template>
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps">
              <template #prepend>
                <img
                  :src="flagUrl(item.value)"
                  alt=""
                  class="rg-flag-pick me-3"
                />
              </template>
            </v-list-item>
          </template>
        </v-autocomplete>
      </section>
    </div>
    <div class="rg-columns">
      <section>
        <div class="rg-section-title">Car</div>
        <v-combobox
          v-model="draft.body"
          :items="bodies"
          label="Body (optional)"
          placeholder="Ford Focus"
        />
        <v-combobox
          v-model="draft.chassis"
          :items="chassis"
          label="Chassis (optional)"
          placeholder="HPI WR8"
        />
      </section>
      <section>
        <div class="rg-section-title">Registration</div>
        <v-text-field
          v-model="draft.transponderId"
          label="Transponder ID (optional)"
          :messages="transponderShared"
          class="rg-field-warning"
        />
        <ClassPicker
          v-if="classes.length > 0"
          v-model="draft.classIds"
          :classes="classes"
        />
        <v-select
          v-model="draft.status"
          :items="STATUS_OPTIONS"
          label="Status"
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
.rg-flag-pick {
  height: 16px;
  aspect-ratio: 4 / 3;
}
</style>
