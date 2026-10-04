<script setup lang="ts">
import { Shown, type Crew } from '@rally-gate/shared';
import { computed } from 'vue';
import {
  coDriverName,
  display,
  driverName,
  flagUrl,
  printClass,
} from '../crew';

const props = defineProps<{ crew: Crew; coDriver?: boolean }>();

const name = computed(() =>
  props.coDriver ? coDriverName(props.crew) : driverName(props.crew),
);
const flag = computed(() =>
  props.coDriver ? props.crew.coDriverFlag : props.crew.driverFlag,
);
</script>

<template>
  <span v-if="name" class="rg-person-name">
    <img
      v-if="display.flags !== Shown.NEVER"
      :src="flagUrl(flag)"
      alt=""
      class="rg-flag me-2"
      :class="printClass(display.flags)"
    />{{ name }}
  </span>
</template>

<style scoped>
/* Lettered like a rally car's side window, wherever a name appears. */
.rg-person-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
  font-style: italic;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.rg-flag {
  height: 0.9em;
  aspect-ratio: 4 / 3;
  vertical-align: -0.05em;
  /* White flag stripes would melt into a light print page. */
  outline: 1px solid rgb(var(--v-theme-on-surface), 0.25);
}
</style>
