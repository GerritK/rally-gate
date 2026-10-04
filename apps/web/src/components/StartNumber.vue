<script setup lang="ts">
/** `null` only for an entry deleted after it drove. */
defineProps<{ number: number | null }>();
</script>

<template>
  <span class="rg-start-number">{{ number ?? '-' }}</span>
</template>

<style scoped>
/* A rally car's door plate. Sized by the surrounding font-size, so a table
   cell and Live Timing's "Up next" show the same plate. */
.rg-start-number {
  display: inline-block;
  min-width: 2.4em;
  padding: 0.25em 0.3em;
  border: 1px solid #000;
  border-radius: 0.2em;
  background: #fff;
  color: #000;
  font-family: 'Barlow', sans-serif;
  font-weight: 700;
  /* Box from cap height to baseline, so the padding alone centres the
     digits. Unsupported (older Firefox): they sit a little low. */
  text-box: trim-both cap alphabetic;
  text-align: center;
}
</style>
