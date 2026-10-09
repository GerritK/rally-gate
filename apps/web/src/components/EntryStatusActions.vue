<script setup lang="ts">
import { computed, ref } from 'vue';
import { EntryStatus } from '@rally-gate/shared';
import { notifyError } from '@rally-gate/ui';
import type { Entry, EntryPatch } from '../api/entries';
import { isForward, statusActions, useEntryStatus } from '../entry-status';

/** An entry's status changes: the next step as the direct action, the
 *  rest in ⋮ (Tables: one direct action, one menu). `large` fills a card's
 *  footer: the step on the left, the slot's own buttons (Edit) on the right
 *  before ⋮, all one height. */
const props = defineProps<{
  entry: Entry;
  large?: boolean;
  /** More steps as buttons beside the next one rather than in ⋮ (the desk's
   *  Check in and pass). */
  alsoShow?: EntryStatus[];
  /** Saved with a step forward, in the same request. */
  withStep?: EntryPatch;
}>();
const emit = defineEmits<{ saved: [entry: Entry] }>();

const setStatus = useEntryStatus();
const actions = computed(() => {
  const { next, others } = statusActions(props.entry.status);
  const shown = (to: EntryStatus) =>
    props.large && props.alsoShow?.includes(to);
  return {
    next,
    extra: others.filter((a) => shown(a.to)),
    others: others.filter((a) => !shown(a.to)),
  };
});
const saving = ref(false);

async function apply(to: EntryStatus) {
  if (saving.value) return;
  saving.value = true;
  try {
    const saved = await setStatus(
      props.entry,
      to,
      isForward(to) ? props.withStep : undefined,
    );
    if (saved) emit('saved', saved);
  } catch (err) {
    notifyError(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div
    :class="
      large
        ? 'd-flex align-center ga-2 w-100'
        : 'd-inline-flex align-center ga-1'
    "
    @click.stop
  >
    <v-btn
      v-if="actions.next"
      v-tooltip="{
        text: actions.next.label,
        location: 'top',
        disabled: large || !actions.next.short,
      }"
      :size="large ? 'default' : 'small'"
      :variant="large ? 'flat' : 'text'"
      :color="large ? 'primary' : undefined"
      :prepend-icon="actions.next.icon"
      :loading="saving"
      @click="apply(actions.next.to)"
    >
      {{
        large ? actions.next.label : (actions.next.short ?? actions.next.label)
      }}
    </v-btn>
    <v-btn
      v-for="a in actions.extra"
      :key="a.to"
      variant="tonal"
      :prepend-icon="a.icon"
      :disabled="saving"
      @click="apply(a.to)"
    >
      {{ a.label }}
    </v-btn>
    <template v-if="large">
      <v-spacer />
      <slot />
    </template>
    <v-menu v-if="actions.others.length > 0">
      <template #activator="{ props: menu }">
        <v-btn
          v-bind="menu"
          :size="large ? 'default' : 'small'"
          variant="text"
          icon="mdi-dots-vertical"
          :aria-label="$t('entryAction.more')"
        />
      </template>
      <v-list density="compact">
        <v-list-item
          v-for="a in actions.others"
          :key="a.to"
          :prepend-icon="a.icon"
          :title="a.label"
          :base-color="a.to === EntryStatus.DISQUALIFIED ? 'error' : undefined"
          @click="apply(a.to)"
        />
      </v-list>
    </v-menu>
  </div>
</template>
