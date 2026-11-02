<script setup lang="ts">
import { computed } from 'vue';
import type { Gate } from '../api/gates';
import {
  clockOffsetColor,
  clockLagIcon,
  clockOffsetHint,
  formatClockLag,
  ntpOffsetColor,
} from '../format';

/** `combined`: one chip, the worse of both clocks, for a list row. */
const props = defineProps<{
  gate: Gate;
  combined?: boolean;
}>();

const SEVERITY = ['timing-idle', 'success', 'warning', 'error'];
const hasNtp = computed(() => props.gate.ntpSynced != null);
const offsetColor = computed(() => clockOffsetColor(props.gate.clockOffsetMs));
const worstColor = computed(() => {
  if (!hasNtp.value) return offsetColor.value;
  const ntp = ntpOffsetColor(props.gate);
  return SEVERITY.indexOf(ntp) > SEVERITY.indexOf(offsetColor.value)
    ? ntp
    : offsetColor.value;
});
/** The verdict for a list row; the numbers are in the tooltip and on the gate's page. */
const VERDICT: Record<string, { key: string; icon: string }> = {
  'timing-idle': { key: 'gate.notMeasured', icon: 'mdi-clock-outline' },
  success: { key: 'gate.clockInSync', icon: 'mdi-clock-check-outline' },
  warning: { key: 'gate.clockImprecise', icon: 'mdi-clock-alert-outline' },
  error: { key: 'gate.clockOutOfSync', icon: 'mdi-clock-remove-outline' },
};
const verdict = computed(() => VERDICT[worstColor.value]);
</script>

<template>
  <v-tooltip location="top">
    <template #activator="{ props: tooltip }">
      <v-chip
        v-bind="tooltip"
        size="small"
        class="rg-timing"
        :color="combined ? worstColor : offsetColor"
        :prepend-icon="
          combined ? verdict.icon : clockLagIcon(gate.clockOffsetMs)
        "
      >
        {{ combined ? $t(verdict.key) : formatClockLag(gate.clockOffsetMs) }}
      </v-chip>
    </template>
    <div>{{ clockOffsetHint(gate.clockOffsetMs) }}</div>
    <div v-if="combined && hasNtp" class="mt-1">
      {{
        gate.ntpSynced
          ? $t('gate.ntpAccuracy', { ms: (gate.ntpOffsetMs ?? 0).toFixed(1) })
          : $t('gate.ntpNotSyncedHint')
      }}
    </div>
  </v-tooltip>
  <v-chip
    v-if="!combined && hasNtp"
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
