<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  createEvent,
  fetchEventInfo,
  openEvent,
  waitForEvent,
  type EventInfo,
} from '../api/event';
import {
  fetchRallyInfo,
  saveRallyInfo,
  type RallyInfo,
} from '../api/rally-info';
import { eventName } from '../format';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const rallyInfo = ref<RallyInfo>({ name: '', date: '', location: '' });
const saving = ref(false);
const eventInfo = ref<EventInfo | null>(null);
const newDialog = ref(false);
const openDialog = ref(false);
const newEvent = ref({ name: '', date: today() });
const switchingTo = ref<string | null>(null);
const error = ref('');

async function onSave() {
  if (!rallyInfo.value.name || saving.value) return;
  saving.value = true;
  try {
    rallyInfo.value = await saveRallyInfo(rallyInfo.value);
  } finally {
    saving.value = false;
  }
}

/** Reloads the whole app afterwards: every page holds the old event's data. */
async function switchEvent(request: () => Promise<{ file: string }>) {
  newDialog.value = false;
  openDialog.value = false;
  error.value = '';
  try {
    const { file } = await request();
    switchingTo.value = file;
    await waitForEvent(file);
    location.reload();
  } catch (err) {
    switchingTo.value = null;
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function onCreate() {
  if (!newEvent.value.name || !newEvent.value.date) return;
  void switchEvent(() => createEvent(newEvent.value));
}

onMounted(async () => {
  const existing = await fetchRallyInfo();
  if (existing) rallyInfo.value = existing;
  eventInfo.value = await fetchEventInfo();
});
</script>

<template>
  <v-alert v-if="error" type="error" variant="tonal" class="mb-6" closable>
    {{ error }}
  </v-alert>

  <v-card class="mb-6">
    <v-card-item>
      <v-card-title>Event</v-card-title>
      <v-card-subtitle v-if="eventInfo">
        <v-icon icon="mdi-file-outline" size="small" />
        {{ eventInfo.file }}
      </v-card-subtitle>
      <template v-if="eventInfo?.switchable" #append>
        <v-btn variant="text" prepend-icon="mdi-plus" @click="newDialog = true">
          New Event
        </v-btn>
        <v-btn
          variant="text"
          prepend-icon="mdi-folder-open-outline"
          @click="openDialog = true"
        >
          Open Event
        </v-btn>
      </template>
    </v-card-item>
    <v-card-text>
      <form class="d-flex flex-wrap align-center ga-3" @submit.prevent="onSave">
        <v-text-field
          v-model="rallyInfo.name"
          label="Rally name"
          density="comfortable"
          hide-details
          style="min-width: 260px"
        />
        <v-text-field
          v-model="rallyInfo.date"
          label="Date (optional)"
          density="comfortable"
          hide-details
          style="min-width: 180px"
        />
        <v-text-field
          v-model="rallyInfo.location"
          label="Location (optional)"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="saving"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-row>
    <v-col cols="12" sm="4">
      <v-card to="/setup/stages" prepend-icon="mdi-flag-checkered">
        <v-card-title>Stages</v-card-title>
        <v-card-text>Create stages and assign gates to them.</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card to="/setup/scoring" prepend-icon="mdi-calculator-variant-outline">
        <v-card-title>Scoring</v-card-title>
        <v-card-text> How a stage a crew didn't finish is scored. </v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <v-dialog v-model="newDialog" max-width="480">
    <v-card>
      <v-card-title>New Event</v-card-title>
      <v-card-subtitle>
        A new, empty event file. The current one stays as it is.
      </v-card-subtitle>
      <form @submit.prevent="onCreate">
        <v-card-text class="d-flex flex-column ga-3">
          <v-text-field
            v-model="newEvent.name"
            label="Rally name"
            density="comfortable"
            hide-details
            autofocus
          />
          <v-text-field
            v-model="newEvent.date"
            type="date"
            label="Date"
            density="comfortable"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="newDialog = false">Cancel</v-btn>
          <v-btn type="submit" color="primary" :disabled="!newEvent.name">
            Create and open
          </v-btn>
        </v-card-actions>
      </form>
    </v-card>
  </v-dialog>

  <v-dialog v-model="openDialog" max-width="600">
    <v-card v-if="eventInfo">
      <v-card-title>Open Event</v-card-title>
      <v-card-subtitle>
        {{ eventInfo.events.length }} on this computer
      </v-card-subtitle>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Event</th>
            <th>Last changed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in eventInfo.events" :key="event.file">
            <td>{{ eventName(event.file) }}</td>
            <td>{{ new Date(event.modifiedAt).toLocaleString() }}</td>
            <td class="text-right">
              <v-chip v-if="event.file === eventInfo.file" size="small">
                open
              </v-chip>
              <v-btn
                v-else
                size="small"
                variant="text"
                prepend-icon="mdi-folder-open-outline"
                @click="switchEvent(() => openEvent(event.file))"
              >
                Open
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="openDialog = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

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
