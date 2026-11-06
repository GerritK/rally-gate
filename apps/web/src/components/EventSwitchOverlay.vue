<script setup lang="ts">
import { switchingTo } from '../api/event';
import { eventName } from '../format';
</script>

<template>
  <v-overlay
    :model-value="!!switchingTo"
    persistent
    class="align-center justify-center"
  >
    <v-card class="pa-6 d-flex align-center ga-4">
      <v-progress-circular indeterminate color="primary" />
      {{ $t('setup.opening', { name: switchingTo && eventName(switchingTo) }) }}
    </v-card>
  </v-overlay>
</template>
