<script setup lang="ts">
import { t } from '@rally-gate/ui';
import type { Gate } from '../api/gates';
import { serverNow } from '../api/time';
import { gateStatusColor, gateStatusIcon, isOnline, isReady } from '../format';

/** A stage's gates in the order a car meets them, so "split 2 is offline"
 *  reads off its place on the line. */
defineProps<{
  nodes: { gate: Gate; label: string }[];
  /** Gates that just reported something, pulsed briefly. */
  flashing: Record<string, boolean>;
}>();

function statusText(gate: Gate): string {
  if (!isOnline(gate, serverNow.value)) return t('gate.offlineTitle');
  return isReady(gate, serverNow.value) ? ' ' : t('gate.clockNotSynced');
}
</script>

<template>
  <div v-if="nodes.length > 0" class="rg-gate-scroll">
    <div class="rg-gate-flow" :style="{ '--gates': nodes.length }">
      <div v-for="node in nodes" :key="node.gate.id" class="rg-gate-node">
        <span
          class="rg-gate-icon"
          :class="{ 'gate-flash': flashing[node.gate.id] }"
        >
          <v-icon
            :icon="gateStatusIcon(node.gate, serverNow)"
            :color="gateStatusColor(node.gate, serverNow)"
          />
        </span>
        <div class="text-caption font-weight-bold">{{ node.label }}</div>
        <div class="text-caption text-medium-emphasis rg-gate-name">
          {{ node.gate.name }}
        </div>
        <!-- A problem in words, not a tooltip; the line is always there
             so a gate dropping out doesn't shift the page. -->
        <div
          class="text-caption rg-gate-name"
          :class="`text-${gateStatusColor(node.gate, serverNow)}`"
        >
          {{ statusText(node.gate) }}
        </div>
      </div>
    </div>
  </div>
  <div v-else class="rg-empty">{{ $t('gate.noneOnStage') }}</div>
</template>

<style scoped>
/*
 * Gates as nodes on one track, like the stage itself. Every node gets the
 * same width, so the track runs from the first icon's centre to the last
 * one's: half a node in from each side. Too many for the width scrolls
 * sideways rather than squeezing gates out.
 */
.rg-gate-scroll {
  overflow-x: auto;
  /* Scrolling clips vertically too; room for the passing pulse. */
  padding: 10px 0 4px;
}
.rg-gate-flow {
  position: relative;
  display: flex;
  min-width: calc(var(--gates) * 80px);
}
.rg-gate-flow::before {
  content: '';
  position: absolute;
  top: 15px;
  left: calc(50% / var(--gates));
  right: calc(50% / var(--gates));
  height: 2px;
  background: rgb(var(--v-border-color));
}
.rg-gate-node {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 4px;
}
/* A round node that cuts the track behind it; the passing pulse rings it. */
.rg-gate-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
}
.rg-gate-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gate-flash {
  animation: gate-flash-pulse 0.6s ease-out;
}

@keyframes gate-flash-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.7);
  }
  100% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-primary), 0);
  }
}
</style>
