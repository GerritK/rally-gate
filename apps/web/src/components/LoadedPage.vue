<script setup lang="ts">
import type { PageLoad } from '../load';
import LoadError from './LoadError.vue';

/** A page's content once its first load has answered. Before that a form
 *  would show defaults as if they were the stored values, and saving them
 *  would overwrite the real ones. A table keeps its header through the
 *  load instead: `EmptyRow`. */
defineProps<{ load: PageLoad }>();
</script>

<template>
  <LoadError :load="load" />
  <v-card v-if="load.state === 'loading'">
    <v-card-text class="rg-empty">{{ $t('common.loading') }}</v-card-text>
  </v-card>
  <slot v-else-if="load.state === 'ready'" />
</template>
