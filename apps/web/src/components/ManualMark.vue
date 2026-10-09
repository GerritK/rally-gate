<script setup lang="ts">
import { TIMING_MARKS } from '../format';
</script>

<template>
  <!-- A hand time carries the marshal's reaction time; a protest asks which
       times were hand-set. Icon plus tooltip, not color alone. -->
  <v-icon
    v-tooltip:top="TIMING_MARKS.manual.label"
    :icon="TIMING_MARKS.manual.icon"
    :color="TIMING_MARKS.manual.color"
    size="small"
    :aria-label="TIMING_MARKS.manual.label"
  />
</template>
