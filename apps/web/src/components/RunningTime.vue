<script setup lang="ts">
import { formatStageDuration } from '@rally-gate/ui';
import { onMounted, onUnmounted, ref } from 'vue';
import { serverOffsetMs } from '../api/time';

/**
 * A car's stage time while it's still running, ticking in tenths. Its own
 * timer, so only this text re-renders ten times a second, not the page
 * around it (Live Timing's clock ticks once a second).
 */
const props = defineProps<{ startTime: string }>();

const elapsedMs = ref(0);
let timer: ReturnType<typeof setInterval>;

function tick() {
  // Clamped: the server clock and a fresh start can be a hair apart.
  elapsedMs.value = Math.max(
    0,
    Date.now() + serverOffsetMs.value - new Date(props.startTime).getTime(),
  );
}

onMounted(() => {
  tick();
  timer = setInterval(tick, 100);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <span>{{ formatStageDuration(elapsedMs) }}</span>
</template>
