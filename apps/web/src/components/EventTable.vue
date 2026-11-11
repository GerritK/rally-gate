<script setup lang="ts">
import { currentLocale, notify, t, useConfirm } from '@rally-gate/ui';
import { deleteEvent, downloadUrl, type EventFile } from '../api/event';
import { eventName } from '../format';

/** The events folder's files, newest first: open one, or delete it. */
const props = defineProps<{
  events: EventFile[];
  /** Shown as open, with neither button. */
  openFile: string | null;
}>();
const emit = defineEmits<{ open: [file: string]; deleted: [] }>();
const confirm = useConfirm();

async function onDelete(file: string) {
  const name = eventName(file);
  const ok = await confirm({
    title: t('events.deleteTitle', { name }),
    text: t('events.deleteText'),
    confirmText: t('events.delete'),
    color: 'error',
  });
  if (!ok) return;
  await deleteEvent(file);
  notify(t('events.deleted', { name }));
  emit('deleted');
}
</script>

<template>
  <v-table density="comfortable">
    <thead>
      <tr>
        <th>{{ $t('setup.event') }}</th>
        <th>{{ $t('setup.lastChanged') }}</th>
        <th width="1%">
          <span class="d-sr-only">{{ $t('table.actions') }}</span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="event in props.events" :key="event.file">
        <td>{{ eventName(event.file) }}</td>
        <td>
          {{ new Date(event.modifiedAt).toLocaleString(currentLocale()) }}
        </td>
        <td class="text-right text-no-wrap">
          <!-- The open event can't be opened or deleted, so its menu would hold
               only Download: that is its direct action instead. -->
          <template v-if="event.file === props.openFile">
            <v-chip size="small">{{ $t('setup.isOpen') }}</v-chip>
            <v-btn
              size="small"
              variant="text"
              icon="mdi-download"
              :href="downloadUrl(event.file)"
              download
              v-tooltip:top="$t('events.download')"
              :aria-label="$t('events.download')"
            />
          </template>
          <template v-else>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-folder-open-outline"
              @click="emit('open', event.file)"
            >
              {{ $t('setup.open') }}
            </v-btn>
            <v-menu>
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  size="small"
                  variant="text"
                  :aria-label="
                    $t('common.moreFor', { name: eventName(event.file) })
                  "
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-download"
                  :title="$t('events.download')"
                  :href="downloadUrl(event.file)"
                  download
                />
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  :title="$t('events.delete')"
                  base-color="error"
                  @click="onDelete(event.file)"
                />
              </v-list>
            </v-menu>
          </template>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>
