<script setup lang="ts">
import type { Crew } from '@rally-gate/shared';
import { coDriverName } from '../crew';
import PersonName from './PersonName.vue';

/** Driver above co-driver, as on a rally car's side window. */
defineProps<{ crew: Crew }>();
</script>

<template>
  <div class="rg-crew-name">
    <PersonName :crew="crew" />
    <PersonName
      v-if="coDriverName(crew)"
      :crew="crew"
      co-driver
      class="rg-co-driver"
    />
  </div>
</template>

<style scoped>
.rg-crew-name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
/* Smaller, so the driver leads. */
.rg-co-driver {
  font-size: 0.85em;
}
</style>
