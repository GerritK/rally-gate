<script setup lang="ts">
import { computed } from 'vue';
import type { VehicleClass } from '../api/vehicle-classes';

const props = defineProps<{ classes: VehicleClass[] }>();
const classIds = defineModel<string[]>({ required: true });

// Class ids are uuids, so this can't collide with one.
const ALL = 'all';

const mains = computed(() => props.classes.filter((c) => c.main));
const categories = computed(() => props.classes.filter((c) => !c.main));
const isIn = (list: VehicleClass[], id: string) =>
  list.some((c) => c.id === id);

// Main class and categories are ANDed server-side, the same as the title
// spells out: "2WD · Rookie" is the 2WD Rookies.
const main = computed({
  get: () => classIds.value.find((id) => isIn(mains.value, id)) ?? ALL,
  set: (id: string) => {
    classIds.value = [...(id === ALL ? [] : [id]), ...selectedCategories.value];
  },
});
const selectedCategories = computed({
  get: () => classIds.value.filter((id) => isIn(categories.value, id)),
  set: (ids: string[]) => {
    classIds.value = [...(main.value === ALL ? [] : [main.value]), ...ids];
  },
});
</script>

<template>
  <div v-if="classes.length > 0" class="rg-class-filter d-print-none">
    <template v-if="mains.length > 0">
      <span class="text-medium-emphasis">Class</span>
      <v-chip-group v-model="main" mandatory color="secondary">
        <v-chip :value="ALL" filter variant="outlined">All</v-chip>
        <v-chip
          v-for="c in mains"
          :key="c.id"
          :value="c.id"
          filter
          variant="outlined"
          prepend-icon="mdi-star"
        >
          {{ c.name }}
        </v-chip>
      </v-chip-group>
    </template>
    <template v-if="categories.length > 0">
      <span class="text-medium-emphasis">Category</span>
      <v-chip-group v-model="selectedCategories" multiple color="secondary">
        <v-chip
          v-for="c in categories"
          :key="c.id"
          :value="c.id"
          filter
          variant="outlined"
        >
          {{ c.name }}
        </v-chip>
      </v-chip-group>
    </template>
  </div>
</template>

<style scoped>
.rg-class-filter {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: 16px;
}
</style>
