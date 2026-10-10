<script setup lang="ts">
import type { Gate } from '../api/gates';
import {
  clockOffsetColor,
  clockLagIcon,
  clockOffsetHint,
  formatClockLag,
  ntpOffsetColor,
} from '../format';

defineProps<{ gate: Gate; correctionThresholdMs: number }>();
</script>

<template>
  <v-tooltip
    :text="clockOffsetHint(gate.clockOffsetMs, correctionThresholdMs)"
    location="top"
  >
    <template #activator="{ props }">
      <v-chip
        v-bind="props"
        size="small"
        class="rg-timing"
        :color="clockOffsetColor(gate.clockOffsetMs, correctionThresholdMs)"
        :prepend-icon="clockLagIcon(gate.clockOffsetMs, correctionThresholdMs)"
      >
        {{ formatClockLag(gate.clockOffsetMs) }}
      </v-chip>
    </template>
  </v-tooltip>
  <v-chip
    v-if="gate.ntpSynced != null"
    size="small"
    class="rg-timing ml-1"
    :color="ntpOffsetColor(gate)"
    :prepend-icon="gate.ntpSynced ? 'mdi-target' : 'mdi-crosshairs-off'"
    v-tooltip:top="
      gate.ntpSynced ? $t('gate.ntpSyncedHint') : $t('gate.ntpNotSyncedHint')
    "
  >
    {{
      gate.ntpSynced
        ? $t('gate.ntpOffset', { ms: (gate.ntpOffsetMs ?? 0).toFixed(1) })
        : $t('gate.ntpNotSynced')
    }}
  </v-chip>
</template>
