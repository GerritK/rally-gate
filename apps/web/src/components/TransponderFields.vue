<script setup lang="ts">
import { computed } from 'vue';
import { TransponderKind } from '@rally-gate/shared';
import type { Entry } from '../api/entries';
import {
  TRANSPONDER_KINDS,
  transponderWarnings,
  type TransponderDraft,
} from '../entry-status';

const props = defineProps<{
  /** Every entry, to warn about a transponder already on another car. */
  entries: Entry[];
  selfId?: string;
}>();
const list = defineModel<TransponderDraft[]>({ required: true });

const KIND_OPTIONS = Object.values(TransponderKind).map((value) => ({
  value,
  title: TRANSPONDER_KINDS[value],
}));

const warnings = computed(() =>
  transponderWarnings(props.entries, list.value, props.selfId),
);

function add() {
  list.value = [
    ...list.value,
    { kind: TransponderKind.RC, identifier: '', label: '' },
  ];
}

function remove(index: number) {
  list.value = list.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div class="rg-transponders">
    <div v-for="(t, i) in list" :key="i" class="rg-transponder">
      <v-select
        v-model="t.kind"
        :items="KIND_OPTIONS"
        label="Kind"
        class="rg-transponder-kind"
      />
      <v-text-field
        v-model="t.identifier"
        label="Transponder ID"
        :messages="warnings.rows[i]"
        class="rg-field-warning rg-transponder-id"
      />
      <v-text-field
        v-model="t.label"
        label="Label (optional)"
        placeholder="spare car"
        class="rg-transponder-label"
      />
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        aria-label="Remove transponder"
        class="mt-2"
        @click="remove(i)"
      />
    </div>
    <div v-if="warnings.list" class="text-warning text-caption">
      {{ warnings.list }}
    </div>
    <div>
      <v-btn variant="text" prepend-icon="mdi-plus" @click="add">
        Add transponder
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.rg-transponders {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Kind and ID side by side; the label wraps under them when the column is
 * narrow (the entry dialog's half), the remove button stays at the end. */
.rg-transponder {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  column-gap: 8px;
}
.rg-transponder-kind {
  flex: 0 0 150px;
}
.rg-transponder-id {
  flex: 1 1 140px;
}
.rg-transponder-label {
  flex: 1 1 140px;
  order: 1;
}
</style>
