<script setup lang="ts">
defineProps<{ name: string; main: boolean }>();
</script>

<template>
  <v-chip
    size="small"
    :color="main ? 'secondary' : undefined"
    :prepend-icon="main ? 'mdi-star' : undefined"
  >
    {{ name }}
  </v-chip>
</template>
