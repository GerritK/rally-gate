<script setup lang="ts">
import type { Gate } from '../api/gates';
import { serverVersion } from '../api/version';

defineProps<{ gate: Gate }>();
</script>

<template>
  <!-- A gate on another build than the server is the one to re-install
       before the event, not a curiosity. -->
  <v-chip
    v-if="gate.version && serverVersion && gate.version !== serverVersion"
    v-tooltip:top="$t('gate.serverRuns', { version: serverVersion })"
    size="small"
    color="warning"
    prepend-icon="mdi-alert"
  >
    {{ gate.version }}
  </v-chip>
  <span v-else class="rg-timing">{{ gate.version ?? '-' }}</span>
</template>
