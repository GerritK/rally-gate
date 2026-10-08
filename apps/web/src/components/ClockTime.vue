<script setup lang="ts">
import { formatClockTime } from '@rally-gate/ui';
import ManualMark from './ManualMark.vue';

/** A start or finish instant with its `.rg-time-mark` slot, filled when a
 *  marshal set it by hand. */
defineProps<{ time: string; manual?: boolean }>();
</script>

<template>
  <span class="rg-timing text-no-wrap"
    >{{ formatClockTime(time)
    }}<span class="rg-time-mark"><ManualMark v-if="manual" /></span
  ></span>
</template>
