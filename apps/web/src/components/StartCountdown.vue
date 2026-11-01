<script setup lang="ts">
import { formatClockTime } from '@rally-gate/ui';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { serverOffsetMs } from '../api/time';
import { countdownState, isCountingDown, START_LIGHTS } from '../countdown';

/**
 * The countdown to a slot: the five start lights, one out per second over the
 * last 5 s, then green; over them the slot's clock time until `countdownMs`
 * before it, then the seconds left until the lights take over. Its own 100 ms timer like
 * `RunningTime`, so a light changes on the second, not up to a second late.
 * Without a slot run (`idle`) only the posted slot, or nothing, over grey
 * lights: never a countdown or green for a time that isn't a run yet.
 */
const props = defineProps<{
  slot: string | null;
  countdownMs: number;
  idle?: boolean;
}>();

const now = ref(Date.now() + serverOffsetMs.value);
let timer: ReturnType<typeof setInterval>;
onMounted(() => {
  timer = setInterval(
    () => (now.value = Date.now() + serverOffsetMs.value),
    100,
  );
});
onUnmounted(() => clearInterval(timer));

const slotMs = computed(() =>
  props.slot && !props.idle ? new Date(props.slot).getTime() : null,
);
const state = computed(() =>
  slotMs.value === null
    ? { lit: 0, green: false, secondsLeft: 0 }
    : countdownState(slotMs.value, now.value),
);
const counting = computed(
  () =>
    slotMs.value !== null &&
    isCountingDown(slotMs.value, now.value, props.countdownMs),
);
</script>

<template>
  <!-- Time and seconds lie over the lights, so the card stays compact. -->
  <div class="rg-start-countdown">
    <div class="rg-lights" role="img" :aria-label="$t('countdown.lights')">
      <span
        v-for="i in START_LIGHTS"
        :key="i"
        class="rg-light"
        :class="{
          'rg-light--red': i <= state.lit,
          'rg-light--green': state.green,
        }"
      />
    </div>
    <div class="rg-seconds rg-timing">
      <span v-if="!counting && slot" class="rg-slot-time">{{
        formatClockTime(slot)
      }}</span>
      <template v-else-if="counting && !state.lit && !state.green">{{
        state.secondsLeft
      }}</template>
    </div>
  </div>
</template>

<style scoped>
.rg-start-countdown {
  display: grid;
  place-items: center;
}
.rg-start-countdown > * {
  grid-area: 1 / 1;
}
/* Readable over a grey, red or green light alike. */
.rg-seconds {
  /* No height of its own, centred on the lights: the seconds are taller
     than a light, and the card would grow when a countdown starts. */
  display: flex;
  align-items: center;
  height: 0;
  font-size: 2.6em;
  line-height: 1;
  font-weight: 700;
  text-shadow:
    0 0 0.15em rgb(var(--v-theme-background)),
    0 0 0.3em rgb(var(--v-theme-background));
}
/* A block, or it sits on the baseline of the larger seconds font around
   it and shows below the middle of the lights. */
.rg-slot-time {
  display: block;
  font-size: 0.5em;
}
.rg-lights {
  display: flex;
  gap: 0.4em;
}
.rg-light {
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
