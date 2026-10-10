<script setup lang="ts">
import { RallyStatus } from '@rally-gate/shared';
import { computed } from 'vue';
import { rallyStatus } from '../api/rally-info';

/** Above a page whose controls `lockedWhen` disables: the reason is on
 *  screen beside them, so disabling is allowed (`design-system.md`). */
const props = defineProps<{ when: RallyStatus[] }>();
const locked = computed(() => props.when.includes(rallyStatus.value));
</script>

<template>
  <v-alert
    v-if="locked"
    type="info"
    variant="tonal"
    density="compact"
    icon="mdi-lock-outline"
    class="mb-4"
  >
    {{
      rallyStatus === RallyStatus.CLOSED
        ? $t('errors.lockedWhileClosed')
        : $t('errors.lockedWhileRunning')
    }}
  </v-alert>
</template>
