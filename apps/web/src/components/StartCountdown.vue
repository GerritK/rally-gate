<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverOffsetMs } from '../api/time';
import { countdownState, START_LIGHTS } from '../countdown';

/**
 * The countdown to a slot: the five start lights, one out per second, then
 * green; until they come on, the seconds left stand in the middle one. Its
 * own 100 ms timer like `RunningTime`, so a light changes on the second,
 * not up to a second late.
 */
const props = defineProps<{ slot: string }>();

const MIDDLE = Math.ceil(START_LIGHTS / 2);

const now = ref(Date.now() + serverOffsetMs.value);
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  timer = setInterval(
    () => (now.value = Date.now() + serverOffsetMs.value),
    100,
  );
});
onUnmounted(() => clearInterval(timer));

const state = computed(() =>
  countdownState(new Date(props.slot).getTime(), now.value),
);
</script>

<template>
  <div class="rg-lights" role="img" :aria-label="$t('countdown.lights')">
    <span
      v-for="i in START_LIGHTS"
      :key="i"
      class="rg-light rg-timing"
      :class="{
        'rg-light--red': i <= state.lit,
        'rg-light--green': state.green,
      }"
      >{{
        i === MIDDLE && !state.lit && !state.green ? state.secondsLeft : ''
      }}</span
    >
  </div>
</template>

<style scoped>
.rg-lights {
  display: flex;
  gap: 0.4em;
}
.rg-light {
  display: grid;
  place-items: center;
  width: 2em;
  height: 2em;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.12);
}
.rg-light--red {
  background: rgb(var(--v-theme-error));
}
.rg-light--green {
  background: rgb(var(--v-theme-success));
}
</style>
