<script setup lang="ts">
import { formatClockTime } from '@rally-gate/ui';
import type { DetectionEventRecord } from '../api/events';

defineProps<{
  passing: DetectionEventRecord;
  /** "Finish", "Split 1"; absent for a gate no stage owns any more. */
  role?: string;
  gateName: string;
  vehicleId?: string;
  vehicleOptions: { id: string; title: string }[];
}>();
defineEmits<{
  pick: [vehicleId: string];
  assign: [];
  dismiss: [];
}>();
</script>

<template>
  <div class="rg-passing">
    <v-icon icon="mdi-account-question" color="warning" />
    <div class="rg-passing-what">
      <div class="font-weight-bold">
        Unidentified {{ role?.toLowerCase() ?? 'passing' }}
        <span class="rg-timing ml-1">
          {{ formatClockTime(passing.timestampGate) }}
        </span>
      </div>
      <div class="text-caption text-medium-emphasis text-truncate">
        {{ gateName }}
      </div>
    </div>
    <!-- Fixed width: sized to its content, picking a driver would resize it
         and shift the buttons under the marshal's pointer. -->
    <v-select
      :model-value="vehicleId"
      :items="vehicleOptions"
      item-title="title"
      item-value="id"
      placeholder="Pick a vehicle"
      density="compact"
      variant="outlined"
      hide-details
      class="rg-passing-vehicle"
      @update:model-value="$emit('pick', $event)"
    />
    <v-btn
      variant="tonal"
      prepend-icon="mdi-check"
      :disabled="!vehicleId"
      @click="$emit('assign')"
    >
      Assign
    </v-btn>
    <v-menu>
      <template #activator="{ props: menu }">
        <v-btn
          v-bind="menu"
          size="small"
          variant="text"
          icon="mdi-dots-vertical"
          aria-label="More actions"
        />
      </template>
      <v-list density="compact">
        <v-list-item
          prepend-icon="mdi-close"
          title="Not a car"
          subtitle="Dismiss this passing"
          @click="$emit('dismiss')"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.rg-passing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 12px;
  border-left: 3px solid rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.1);
  border-radius: 4px;
}
.rg-passing-what {
  flex: 1 1 140px;
  min-width: 0;
}
.rg-passing-vehicle {
  flex: 0 0 240px;
}
</style>
