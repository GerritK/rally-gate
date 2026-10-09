<script setup lang="ts">
import type { Crew } from '@rally-gate/shared';
import { computed } from 'vue';
import { coDriverName, driverName, flagUrl, useDisplay } from '../crew';

const props = defineProps<{ crew: Crew; coDriver?: boolean }>();
const display = useDisplay();

const name = computed(() =>
  props.coDriver
    ? coDriverName(props.crew, display.nameFormat)
    : driverName(props.crew, display.nameFormat),
);
const flag = computed(() =>
  props.coDriver ? props.crew.coDriverFlag : props.crew.driverFlag,
);
</script>

<template>
  <span v-if="name" class="rg-person-name">
    <img
      v-if="display.flags"
      :src="flagUrl(flag)"
      alt=""
      class="rg-flag me-2"
    />{{ name }}
  </span>
</template>

<style scoped>
/* Lettered like a rally car's side window, wherever a name appears. */
.rg-person-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 700;
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
