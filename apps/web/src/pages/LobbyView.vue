<script setup lang="ts">
import { ApiErrorCode } from '@rally-gate/shared';
import { onMounted, onUnmounted, ref } from 'vue';
import { session } from '../api/auth';
import { ApiError } from '../api/client';
import {
  createEvent,
  fetchEventInfo,
  openEvent,
  switchEvent,
  type EventInfo,
} from '../api/event';
import EventSwitchOverlay from '../components/EventSwitchOverlay.vue';
import EventTable from '../components/EventTable.vue';
import ImportEventButton from '../components/ImportEventButton.vue';
import NewEventDialog from '../components/NewEventDialog.vue';
import { eventName } from '../format';

/**
 * The standalone package's first start, before any event is open: the
 * organiser picks one, everyone else waits here until it is open.
 */
const info = ref<EventInfo | null>(null);
const newDialog = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;

async function load() {
  info.value = await fetchEventInfo();
}

const onOpen = (file: string) => switchEvent(() => openEvent(file), '/live');

/** Anything but "no event open" means the organiser has picked one. */
async function checkOpen() {
  try {
    await fetchEventInfo();
  } catch (err) {
    if (err instanceof ApiError && err.code === ApiErrorCode.NO_EVENT_OPEN) {
      return;
    }
    if (!(err instanceof ApiError)) return; // restarting
  }
  location.assign('/');
}

// A file copied into the folder shows up with the window open, and at once
// on coming back to it.
const onFocus = () => void load();

onMounted(() => {
  if (session.value?.role) {
    window.addEventListener('focus', onFocus);
    poll = setInterval(onFocus, 5000);
    return load();
  }
  poll = setInterval(() => void checkOpen(), 3000);
});

onUnmounted(() => {
  window.removeEventListener('focus', onFocus);
  clearInterval(poll);
});
</script>

<template>
  <v-row justify="center">
    <v-col cols="12" md="10" lg="8">
      <v-alert
        v-if="!session?.role"
        type="info"
        variant="tonal"
        icon="mdi-timer-sand"
        :title="$t('lobby.waitingTitle')"
        :text="$t('lobby.waitingText')"
      />

      <v-card v-else-if="info">
        <v-card-item>
          <v-card-title>{{ $t('lobby.title') }}</v-card-title>
          <template #append>
            <div class="d-flex flex-wrap align-center ga-2">
              <ImportEventButton variant="tonal" @imported="load" />
              <v-btn
                variant="tonal"
                prepend-icon="mdi-plus"
                @click="newDialog = true"
              >
                {{ $t('setup.newEvent') }}
              </v-btn>
            </div>
          </template>
        </v-card-item>
        <v-card-text>
          <p :class="{ 'mb-4': info.last }">{{ $t('lobby.hint') }}</p>
          <v-btn
            v-if="info.last"
            color="primary"
            size="large"
            prepend-icon="mdi-play"
            block
            @click="onOpen(info.last)"
          >
            {{ $t('lobby.continue', { name: eventName(info.last) }) }}
          </v-btn>
        </v-card-text>
        <EventTable
          v-if="info.events.length > 0"
          :events="info.events"
          :open-file="null"
          @open="onOpen"
          @deleted="load"
        />
      </v-card>
    </v-col>
  </v-row>

  <NewEventDialog
    v-model="newDialog"
    :create="(input) => switchEvent(() => createEvent(input), '/setup')"
  />
  <EventSwitchOverlay />
</template>
