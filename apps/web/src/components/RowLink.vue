<script setup lang="ts">
/**
 * What identifies a row with a detail page, as a real link: the row's own
 * click reaches a pointer only, this one also the keyboard, a screen reader
 * and "open in new tab". Without `to` (the public page) just the content.
 */
defineProps<{ to?: string }>();
</script>

<template>
  <!-- The row navigates on click too; once is enough. -->
  <router-link v-if="to" :to="to" class="rg-row-link" @click.stop>
    <slot />
  </router-link>
  <slot v-else />
</template>
