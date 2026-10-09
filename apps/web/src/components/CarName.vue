<script setup lang="ts">
import type { Crew } from '@rally-gate/shared';

/** Body above chassis: the car people recognise leads. */
defineProps<{ car: Pick<Crew, 'body' | 'chassis'> }>();
</script>

<template>
  <div class="rg-car-name">
    <span>{{ car.body }}</span>
    <span class="rg-chassis">{{ car.chassis }}</span>
  </div>
</template>

<style scoped>
.rg-car-name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  white-space: nowrap;
}
/* Smaller, like the co-driver under the driver. */
.rg-chassis {
  font-size: 0.85em;
}
</style>
