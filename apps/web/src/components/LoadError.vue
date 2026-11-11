<script setup lang="ts">
import type { PageLoad } from '../load';

defineProps<{ load: PageLoad }>();
</script>

<template>
  <v-alert
    v-if="load.state === 'failed'"
    type="error"
    variant="tonal"
    class="mb-4"
  >
    <div class="d-flex flex-wrap align-center ga-4">
      <div>
        <strong>{{ $t('common.loadFailed') }}</strong>
        {{ load.error }}
      </div>
      <v-spacer />
      <v-btn variant="outlined" prepend-icon="mdi-refresh" @click="load.reload">
        {{ $t('live.retryNow') }}
      </v-btn>
    </div>
  </v-alert>
</template>
