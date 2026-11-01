<script setup lang="ts">
import { formatStageDuration } from '@rally-gate/ui';
import { computed } from 'vue';
import type { StageRun } from '../api/stage-runs';
import { jumpStartMs } from '../countdown';

/**
 * A start passing before slot minus the tolerance. The mark always shows;
 * with `suggest` it offers the jump-start penalty or Dismiss, never priced
 * by itself (`docs/event-model.md` "Start slots").
 */
const props = defineProps<{
  run: StageRun;
  toleranceMs: number;
  suggest?: boolean;
}>();
const emit = defineEmits<{ penalty: []; dismiss: [] }>();

const earlyMs = computed(() => jumpStartMs(props.run, props.toleranceMs));
</script>

<template>
  <v-menu v-if="earlyMs !== null" :disabled="!suggest">
    <template #activator="{ props: menu }">
      <v-chip
        v-bind="menu"
        size="small"
        color="error"
        :variant="suggest ? 'flat' : 'tonal'"
        prepend-icon="mdi-alert-octagon-outline"
        :append-icon="suggest ? 'mdi-menu-down' : undefined"
        class="ml-1"
        v-tooltip:top="
          $t('countdown.jumpStartEarly', {
            time: formatStageDuration(earlyMs),
          })
        "
      >
        {{ $t('countdown.jumpStart') }}
      </v-chip>
    </template>
    <v-list density="compact">
      <v-list-item
        prepend-icon="mdi-flag-variant-outline"
        :title="$t('countdown.givePenalty')"
        @click="emit('penalty')"
      />
      <v-list-item
        prepend-icon="mdi-check"
        :title="$t('countdown.dismissJumpStart')"
        @click="emit('dismiss')"
      />
    </v-list>
  </v-menu>
</template>
