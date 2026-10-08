<script setup lang="ts">
import { computed } from 'vue';
import type { Gate } from '../api/gates';
import { serverNow } from '../api/time';
import { isOnline } from '../format';

const props = defineProps<{ gate: Gate }>();
const online = computed(() => isOnline(props.gate, serverNow.value));
</script>

<template>
  <v-chip
    size="small"
    :color="online ? 'success' : 'error'"
    :prepend-icon="online ? 'mdi-lan-connect' : 'mdi-lan-disconnect'"
  >
    {{ online ? 'online' : 'offline' }}
  </v-chip>
</template>
