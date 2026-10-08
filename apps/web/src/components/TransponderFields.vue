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

// Short in the field, which is narrow; spelled out in the list.
const KIND_OPTIONS = Object.values(TransponderKind).map((value) => ({
  value,
  title: value,
  subtitle: TRANSPONDER_KINDS[value],
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
    <template v-for="(t, i) in list" :key="i">
      <div class="rg-transponder">
        <v-select
          v-model="t.kind"
          :items="KIND_OPTIONS"
          :item-props="true"
          label="Kind"
        />
        <v-text-field v-model="t.identifier" label="ID" class="rg-timing" />
        <v-text-field
          v-model="t.label"
          label="Label"
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
      <div v-if="warnings.rows[i]" class="rg-transponder-warning">
        {{ warnings.rows[i] }}
      </div>
    </template>
    <div v-if="warnings.list" class="rg-transponder-warning">
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
/* One row per transponder, even in the entry dialog's half column. */
.rg-transponder {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 8px;
}
/* A phone has no room for the label beside the ID: it goes underneath. */
@media (max-width: 599px) {
  .rg-transponder {
    grid-template-columns: 96px minmax(0, 1fr) auto;
  }
  .rg-transponder-label {
    grid-column: 2 / 3;
    grid-row: 2;
  }
}
.rg-transponder-warning {
  color: rgb(var(--v-theme-warning));
  font-size: 0.75rem;
  margin-top: -4px;
}
</style>
