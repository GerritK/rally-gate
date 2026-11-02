<script setup lang="ts">
import { notice, pendingConfirm, type Choice } from './feedback';

function answer(choice: Choice) {
  pendingConfirm.value?.resolve(choice);
  pendingConfirm.value = null;
}

function dismiss() {
  notice.value = null;
}
</script>

<template>
  <v-dialog
    :model-value="!!pendingConfirm"
    max-width="480"
    @update:model-value="answer(null)"
  >
    <v-card v-if="pendingConfirm">
      <v-card-title>{{ pendingConfirm.options.title }}</v-card-title>
      <v-card-text v-if="pendingConfirm.options.text" class="confirm-text">
        {{ pendingConfirm.options.text }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="answer(null)">{{
          $t('ui.cancel')
        }}</v-btn>
        <v-btn
          v-if="pendingConfirm.options.alternativeText"
          variant="text"
          color="error"
          @click="answer('alternative')"
        >
          {{ pendingConfirm.options.alternativeText }}
        </v-btn>
        <v-btn
          :color="pendingConfirm.options.color ?? 'primary'"
          @click="answer('confirm')"
        >
          {{ pendingConfirm.options.confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar
    :model-value="!!notice"
    :color="notice?.error ? 'error' : undefined"
    :timeout="notice?.error ? 8000 : 3000"
    @update:model-value="dismiss"
  >
    {{ notice?.text }}
    <template #actions>
      <v-btn variant="text" icon="mdi-close" @click="dismiss" />
    </template>
  </v-snackbar>
</template>

<style scoped>
.confirm-text {
  white-space: pre-line;
}
</style>
