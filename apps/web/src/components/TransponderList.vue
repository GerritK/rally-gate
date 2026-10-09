<script setup lang="ts">
import type { Entry } from '../api/entries';
import { transponderLabels } from '../entry-status';

/** The `<dd>` of a facts list: one transponder per line. */
defineProps<{ entry: Entry }>();
</script>

<template>
  <dd
    :class="
      entry.transponders.length > 0 ? 'rg-timing' : 'text-medium-emphasis'
    "
  >
    <div v-for="label in transponderLabels(entry)" :key="label">
      {{ label }}
    </div>
    <template v-if="entry.transponders.length === 0">-</template>
  </dd>
</template>
