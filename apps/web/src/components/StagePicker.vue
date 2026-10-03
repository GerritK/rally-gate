<script setup lang="ts">
import { StageStatus } from '@rally-gate/shared';
import type { Stage } from '../api/stages';

// `overall` adds the overall result as the track's finish, selected when no
// stage is.
defineProps<{ stages: Stage[]; modelValue?: string; overall?: boolean }>();
const emit = defineEmits<{
  'update:modelValue': [stageId: string];
  overall: [];
}>();

/**
 * Progress first, selection second: a marshal rarely switches stage, but
 * everyone wants to see where the rally stands: done, running, to come.
 * The icon shapes differ, so colour is never the only signal. Stage details
 * (a published start list) belong in the stage's own header, not here.
 */
function display(stage: Stage): {
  icon: string;
  color?: string;
  label: string;
} {
  if (stage.status === StageStatus.ACTIVE) {
    return { icon: 'mdi-circle', color: 'success', label: 'running' };
  }
  if (stage.status === StageStatus.CLOSED) {
    return { icon: 'mdi-check-circle-outline', label: 'closed' };
  }
  return { icon: 'mdi-circle-outline', label: 'upcoming' };
}
</script>

<template>
  <nav class="rg-stage-track-scroll" aria-label="Stages">
    <div
      class="rg-stage-track"
      :class="{ 'rg-stage-track--overall': overall && stages.length > 0 }"
      :style="{ '--stages': stages.length + (overall ? 1 : 0) }"
    >
      <button
        v-for="stage in stages"
        :key="stage.id"
        type="button"
        class="rg-stage-node"
        :class="{ 'rg-stage-node--selected': stage.id === modelValue }"
        :aria-current="stage.id === modelValue ? 'page' : undefined"
        :title="`${stage.id} · ${stage.name}: ${display(stage).label}`"
        @click="emit('update:modelValue', stage.id)"
      >
        <span class="rg-stage-dot">
          <v-icon
            :icon="display(stage).icon"
            :color="display(stage).color"
            size="small"
          />
        </span>
        <span class="rg-stage-name"> {{ stage.id }} </span>
      </button>
      <button
        v-if="overall"
        type="button"
        class="rg-stage-node"
        :class="{ 'rg-stage-node--selected': !modelValue }"
        :aria-current="!modelValue ? 'page' : undefined"
        title="Overall classification"
        @click="emit('overall')"
      >
        <span class="rg-stage-dot">
          <v-icon icon="mdi-flag-checkered" size="small" />
        </span>
        <span class="rg-stage-name">Overall</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
/* Same track as Live Timing's gate line, one level up: stages along the rally. */
.rg-stage-track-scroll {
  overflow-x: auto;
  padding: 4px 0;
}
.rg-stage-track {
  position: relative;
  display: flex;
  min-width: calc(var(--stages) * 110px);
}
.rg-stage-track::before {
  content: '';
  position: absolute;
  top: 20px;
  left: calc(50% / var(--stages));
  right: calc(50% / var(--stages));
  height: 2px;
  background: rgb(var(--v-border-color));
}
/* The last leg, to the finish, is dashed: the overall is a result, not
   another stage. */
.rg-stage-track--overall::before {
  right: calc(150% / var(--stages));
}
.rg-stage-track--overall::after {
  content: '';
  position: absolute;
  top: 20px;
  right: calc(50% / var(--stages));
  width: calc(100% / var(--stages));
  border-top: 2px dashed rgb(var(--v-border-color));
}
.rg-stage-node {
  position: relative;
  /* Above the track lines, so each dot's background hides the line behind it. */
  z-index: 1;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.rg-stage-node:hover .rg-stage-dot,
.rg-stage-node:focus-visible .rg-stage-dot {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-on-surface), 0.3);
}
.rg-stage-node:focus-visible {
  outline: none;
}
/* Neutral ring, not orange: orange is the page's one main action. */
.rg-stage-node--selected .rg-stage-dot {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-on-surface));
}
.rg-stage-node--selected .rg-stage-name {
  font-weight: 700;
}
.rg-stage-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgb(var(--v-theme-background));
}
.rg-stage-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media print {
  .rg-stage-track-scroll {
    display: none;
  }
}
</style>
