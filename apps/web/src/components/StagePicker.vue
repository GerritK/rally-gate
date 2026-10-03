<script setup lang="ts">
import { StageStatus } from '@rally-gate/shared';
import type { Stage } from '../api/stages';

defineProps<{ stages: Stage[]; modelValue?: string }>();
const emit = defineEmits<{ 'update:modelValue': [stageId: string] }>();

/** Icon as the second signal next to color, for colorblind marshals. */
function statusIcon(stage: Stage): string {
  if (stage.status === StageStatus.ACTIVE) return 'mdi-play-circle';
  if (stage.status === StageStatus.CLOSED) return 'mdi-flag-checkered';
  return 'mdi-circle-outline';
}
</script>

<template>
  <v-chip-group
    :model-value="modelValue"
    mandatory
    selected-class="text-primary"
    @update:model-value="(id: string) => emit('update:modelValue', id)"
  >
    <v-chip
      v-for="stage in stages"
      :key="stage.id"
      :value="stage.id"
      :prepend-icon="statusIcon(stage)"
      :color="stage.status === StageStatus.ACTIVE ? 'success' : undefined"
      variant="outlined"
      filter
    >
      {{ stage.stageNumber }}. {{ stage.name }}
      <v-icon
        v-if="
          stage.startOrderFrozenAt && stage.status === StageStatus.NOT_STARTED
        "
        icon="mdi-lock"
        size="x-small"
        class="ml-1"
        title="Start list published"
      />
    </v-chip>
  </v-chip-group>
</template>
