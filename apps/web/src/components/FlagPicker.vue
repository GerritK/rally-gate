<script setup lang="ts">
import { FLAG_OPTIONS, flagUrl } from '../crew';

const flag = defineModel<string | null>({ required: true });

/** Tabbing into a picked flag and typing should search, not append to the
 *  flag's name. Vuetify writes the name into the input after focus, so the
 *  select waits a frame. */
function selectText(e: FocusEvent) {
  const input = e.target as HTMLInputElement;
  requestAnimationFrame(() => input.select());
}
</script>

<template>
  <v-autocomplete
    v-model="flag"
    :items="FLAG_OPTIONS"
    label="Flag"
    placeholder="None (chequered flag)"
    persistent-placeholder
    clearable
    auto-select-first
    @focus="selectText"
  >
    <template #prepend-inner>
      <img :src="flagUrl(flag)" alt="" class="rg-flag-pick" />
    </template>
    <template #item="{ props: itemProps, item }">
      <v-list-item v-bind="itemProps">
        <template #prepend>
          <img :src="flagUrl(item.value)" alt="" class="rg-flag-pick me-3" />
        </template>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<style scoped>
.rg-flag-pick {
  height: 16px;
  aspect-ratio: 4 / 3;
}
</style>
