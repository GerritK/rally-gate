<script setup lang="ts">
import type { Gate } from '../api/gates';
import {
  clockOffsetColor,
  clockOffsetHint,
  formatClockOffset,
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
        :prepend-icon="
          gate.clockOffsetMs != null &&
          Math.abs(gate.clockOffsetMs) >= correctionThresholdMs
            ? 'mdi-clock-alert-outline'
            : 'mdi-clock-check-outline'
        "
      >
        {{ formatClockOffset(gate.clockOffsetMs) }}
      </v-chip>
    </template>
  </v-tooltip>
  <v-chip
    v-if="gate.ntpSynced != null"
    size="small"
    class="rg-timing ml-1"
    :color="gate.ntpSynced ? 'success' : 'error'"
    :prepend-icon="gate.ntpSynced ? 'mdi-sync' : 'mdi-sync-alert'"
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
