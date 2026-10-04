<script setup lang="ts">
import type { ClassificationEntry } from '@rally-gate/shared';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { display } from '../crew';
import { formatDuration, formatGap } from '../format';
import CrewName from './CrewName.vue';
import StartNumber from './StartNumber.vue';

const props = defineProps<{
  /** Ranked, as the table below shows it; only the first three are used. */
  entries: ClassificationEntry[];
}>();
const router = useRouter();

const MEDALS = ['podium-gold', 'podium-silver', 'podium-bronze'];

/** 2-1-3, as a podium stands; an empty step stays, so it reads as one. */
const steps = computed(() =>
  [1, 0, 2].map((i) => ({
    place: i + 1,
    color: MEDALS[i],
    entry: props.entries[i] as ClassificationEntry | undefined,
  })),
);
</script>

<template>
  <div v-if="display.podium && entries.length > 0" class="mb-6">
    <div class="rg-podium">
      <div
        v-for="step in steps"
        :key="step.place"
        class="rg-podium-place"
        :class="{ 'cursor-pointer': step.entry }"
        @click="step.entry && router.push(`/vehicles/${step.entry.vehicleId}`)"
      >
        <template v-if="step.entry">
          <v-icon
            icon="mdi-trophy"
            :color="step.color"
            :size="step.place === 1 ? 56 : 40"
          />
          <StartNumber
            :number="step.entry.startNumber"
            class="rg-podium-number"
          />
          <CrewName :crew="step.entry" class="rg-podium-crew" />
          <div v-if="step.entry.body" class="text-medium-emphasis">
            {{ step.entry.body }}
          </div>
          <div class="rg-timing font-weight-bold">
            {{ formatDuration(step.entry.durationMs) }}
          </div>
          <div v-if="step.place > 1" class="rg-timing text-medium-emphasis">
            {{ formatGap(step.entry.gapMs) }}
          </div>
        </template>
        <div
          class="rg-podium-step"
          :class="`rg-podium-step-${step.place}`"
          :style="{ '--rg-medal': `var(--v-theme-${step.color})` }"
        >
          {{ step.place }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rg-podium {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 12px;
  max-width: 760px;
  margin: 0 auto;
}
.rg-podium-place {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.rg-podium-number {
  font-size: 1.25rem;
}
.rg-podium-crew {
  font-size: 1.15rem;
  align-items: center;
}
/* A border, not only a fill: print drops backgrounds by default. */
.rg-podium-step {
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  border: 2px solid rgb(var(--rg-medal));
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  background: rgba(var(--rg-medal), 0.15);
  font-family: 'Barlow', sans-serif;
  font-size: 2rem;
  font-weight: 700;
}
.rg-podium-step-1 {
  height: 96px;
}
.rg-podium-step-2 {
  height: 68px;
}
.rg-podium-step-3 {
  height: 48px;
}
</style>
