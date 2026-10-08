<script setup lang="ts">
import { computed } from 'vue';
import type { EntryClass } from '../api/entry-classes';
import ClassChip from './ClassChip.vue';

const props = defineProps<{
  classes: EntryClass[];
  density?: 'compact' | 'comfortable';
}>();
const classIds = defineModel<string[]>({ required: true });

const isMain = (id: string) => props.classes.some((c) => c.id === id && c.main);
// Classes arrive sorted main-first from the server; selections follow that.
const inOrder = (ids: string[]) =>
  props.classes.map((c) => c.id).filter((id) => ids.includes(id));

// One main class per entry: picking another replaces it. The server doesn't
// enforce this, so an entry could still carry two from elsewhere.
const selected = computed({
  get: () => inOrder(classIds.value),
  set: (ids: string[]) => {
    const newMain = ids.find(
      (id) => isMain(id) && !classIds.value.includes(id),
    );
    classIds.value = inOrder(
      newMain ? ids.filter((id) => !isMain(id) || id === newMain) : ids,
    );
  },
});
</script>

<template>
  <v-select
    v-model="selected"
    :items="classes"
    :item-props="
      (c: EntryClass) => ({ prependIcon: c.main ? 'mdi-star' : undefined })
    "
    item-title="name"
    item-value="id"
    label="Classes"
    multiple
    clearable
    :density="density ?? 'comfortable'"
    hide-details
    style="min-width: 220px"
  >
    <template #selection="{ item }">
      <ClassChip :name="item.name" :main="item.main" class="me-1" />
    </template>
  </v-select>
</template>
