<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  createEvent,
  fetchEventInfo,
  fetchKnownGates,
  forgetKnownGate,
  openEvent,
  waitForEvent,
  type EventInfo,
  type KnownGate,
} from '../api/event';
import { eventName } from '../format';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const info = ref<EventInfo | null>(null);
const knownGates = ref<KnownGate[]>([]);
const newEvent = ref({ name: '', date: today() });
const switchingTo = ref<string | null>(null);
const error = ref('');

/** Reloads the whole app afterwards: every page holds the old event's data. */
async function switchEvent(
  request: () => Promise<{ file: string }>,
  landing: string,
) {
  error.value = '';
  try {
    const { file } = await request();
    switchingTo.value = file;
    await waitForEvent(file);
    location.assign(landing);
  } catch (err) {
    switchingTo.value = null;
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function onCreate() {
  if (!newEvent.value.name || !newEvent.value.date) return;
  void switchEvent(() => createEvent(newEvent.value), '/setup');
}

function onOpen(file: string) {
  void switchEvent(() => openEvent(file), '/live');
}

async function onForget(id: string) {
  await forgetKnownGate(id);
  knownGates.value = knownGates.value.filter((gate) => gate.id !== id);
}

onMounted(async () => {
  info.value = await fetchEventInfo();
  if (info.value.switchable) knownGates.value = await fetchKnownGates();
});
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" class="mb-6" closable>
    {{ error }}
  </v-alert>

  <template v-if="info && !info.switchable">
    <v-card>
      <v-card-title>{{ eventName(info.file) }}</v-card-title>
      <v-card-text>
        This server's event is fixed by its configuration (<code>DB_PATH</code>
        or Postgres). Creating and opening events is available in the standalone
        package.
      </v-card-text>
    </v-card>
  </template>

  <template v-else-if="info">
    <v-card class="mb-6">
      <v-card-title>New Event</v-card-title>
      <v-card-subtitle>
        A new, empty event file. The current one stays as it is.
      </v-card-subtitle>
      <v-card-text>
        <form
          class="d-flex flex-wrap align-center ga-3"
          @submit.prevent="onCreate"
        >
          <v-text-field
            v-model="newEvent.name"
            label="Rally name"
            density="comfortable"
            hide-details
            style="min-width: 260px"
          />
          <v-text-field
            v-model="newEvent.date"
            type="date"
            label="Date"
            density="comfortable"
            hide-details
            style="min-width: 180px"
          />
          <v-btn
            type="submit"
            color="primary"
            prepend-icon="mdi-plus"
            :disabled="!newEvent.name"
          >
            Create and open
          </v-btn>
        </form>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title>Events</v-card-title>
      <v-card-subtitle
        >{{ info.events.length }} on this computer</v-card-subtitle
      >
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Event</th>
            <th>Last changed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in info.events" :key="event.file">
            <td>{{ eventName(event.file) }}</td>
            <td>{{ new Date(event.modifiedAt).toLocaleString() }}</td>
            <td class="text-right">
              <v-chip v-if="event.file === info.file" size="small">
                open
              </v-chip>
              <v-btn
                v-else
                size="small"
                variant="text"
                prepend-icon="mdi-folder-open-outline"
                @click="onOpen(event.file)"
              >
                Open
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card class="mt-6">
      <v-card-title>Known Gates</v-card-title>
      <v-card-subtitle>
        Remembered by this computer and listed, offline, in every new event.
      </v-card-subtitle>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="gate in knownGates" :key="gate.id">
            <td>{{ gate.id }}</td>
            <td>{{ gate.name }}</td>
            <td class="text-right">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-close"
                title="Not listed in new events any more; the open event keeps it"
                @click="onForget(gate.id)"
              >
                Forget
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-text v-if="knownGates.length === 0">
        None yet — every gate that sends a heartbeat is remembered.
      </v-card-text>
    </v-card>
  </template>

  <v-overlay
    :model-value="!!switchingTo"
    persistent
    class="align-center justify-center"
  >
    <v-card class="pa-6 d-flex align-center ga-4">
      <v-progress-circular indeterminate color="primary" />
      Opening {{ switchingTo && eventName(switchingTo) }}…
    </v-card>
  </v-overlay>
</template>
