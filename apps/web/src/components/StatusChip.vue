<script setup lang="ts">
/** One entry of a `*_DISPLAY` map (`format.ts`): colour, icon and word, so
 *  a status is never colour alone. */
defineProps<{ display: { label: string; color: string; icon: string } }>();
</script>

<template>
  <v-chip size="small" :color="display.color" :prepend-icon="display.icon">
    {{ display.label }}
  </v-chip>
</template>
