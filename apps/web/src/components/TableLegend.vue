<script setup lang="ts">
import { TIMING_MARKS, type TimingMark } from '../format';

/** Only the marks the table actually shows: a legend listing absent icons is
 *  noise that gets skipped. Icons in the text colour, not their own: a
 *  lookup aid shouldn't pull the eye away from the times, and the shape
 *  alone identifies a mark. */
defineProps<{ marks: TimingMark[] }>();
</script>

<template>
  <div
    v-if="marks.length > 0"
    class="d-flex flex-wrap ga-4 mt-2 text-caption text-medium-emphasis"
  >
    <span v-for="mark in marks" :key="mark">
      <v-icon size="small" :icon="TIMING_MARKS[mark].icon" />
      {{ TIMING_MARKS[mark].label }}
    </span>
  </div>
</template>
