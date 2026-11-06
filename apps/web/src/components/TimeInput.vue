<script setup lang="ts">
import { ref, watch } from 'vue';
import { t } from '@rally-gate/ui';
import { parseClockTime } from '../clock-time';

/**
 * A clock time, `HH:MM:SS` (24 h) or '': typed leniently (`parseClockTime`)
 * or picked from the clock icon. Text that isn't a time keeps the field in
 * error and leaves the model at its last valid value. Other attributes
 * (label, hint, clearable, …) go to the `v-text-field`.
 */
const model = defineModel<string>({ default: '' });
const props = defineProps<{
  rules?: ((value: string) => true | string)[];
  disabled?: boolean;
}>();

const text = ref(model.value);
const picking = ref(false);

watch(model, (value) => {
  if (parseClockTime(text.value) !== value) text.value = value;
});

function onInput(value: string | null) {
  text.value = value ?? '';
  const parsed = parseClockTime(text.value);
  if (parsed !== null) model.value = parsed;
}

function normalise() {
  const parsed = parseClockTime(text.value);
  if (parsed !== null) text.value = parsed;
}

const validTime = (value: string) =>
  parseClockTime(value ?? '') !== null || t('common.invalidTime');
</script>

<template>
  <v-text-field
    :model-value="text"
    class="rg-timing"
    autocomplete="off"
    :rules="[validTime, ...(props.rules ?? [])]"
    :disabled="props.disabled"
    @update:model-value="onInput"
    @blur="normalise"
    @keydown.enter="normalise"
  >
    <template v-if="!props.disabled" #append-inner>
      <v-menu
        v-model="picking"
        :close-on-content-click="false"
        location="bottom end"
      >
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            icon="mdi-clock-outline"
            variant="text"
            density="compact"
            size="small"
            tabindex="-1"
            :aria-label="$t('common.pickTime')"
          />
        </template>
        <v-time-picker
          :model-value="model || null"
          format="24hr"
          use-seconds
          @update:model-value="model = $event ?? ''"
        />
      </v-menu>
    </template>
  </v-text-field>
</template>
