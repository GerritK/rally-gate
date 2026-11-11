<script setup lang="ts">
import type { PageLoad } from '../load';

/** A table's one `.rg-empty` row: the slot once loaded and `empty`, before
 *  that what the load is doing, so the header stays and nothing jumps. */
defineProps<{ load: PageLoad; empty: boolean; colspan: number }>();
</script>

<template>
  <tr v-if="load.state !== 'ready' || empty">
    <td :colspan="colspan" class="rg-empty">
      <template v-if="load.state === 'loading'">
        {{ $t('common.loading') }}
      </template>
      <template v-else-if="load.state === 'failed'">
        {{ $t('common.notLoaded') }}
      </template>
      <slot v-else />
    </td>
  </tr>
</template>
