<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { REPO_URL, SUPPORT_URL } from '@rally-gate/ui';
import { fetchEventInfo } from './api/event';
import { fetchRallyInfo, rallyName } from './api/rally-info';
import { liveStatus } from './api/live';
import { serverOffsetMs, syncServerClock } from './api/time';
import { fetchServerVersion, serverVersion } from './api/version';
import { eventName } from './format';
import { NAV_ITEMS } from './router';

const drawer = ref(true);
/** For an event whose rally details were never filled in. */
const fileName = ref('');

watchEffect(() => {
  const event = rallyName.value || fileName.value;
  document.title = event ? `${event} · Rally Gate` : 'Rally Gate';
});

const LIVE_DISPLAY = {
  connecting: { label: 'Connecting', color: 'timing-idle', icon: 'mdi-sync' },
  live: { label: 'Live', color: 'success', icon: 'mdi-circle' },
  offline: { label: 'Offline', color: 'error', icon: 'mdi-lan-disconnect' },
} as const;

/** Server time, which gates sync to: a marshal reads times off it. */
const now = ref(Date.now());
const serverNow = computed(() => new Date(now.value + serverOffsetMs.value));
const timer = setInterval(() => (now.value = Date.now()), 1000);
onUnmounted(() => clearInterval(timer));

onMounted(async () => {
  void fetchServerVersion();
  syncServerClock().catch(() => undefined);
  await fetchRallyInfo();
  fileName.value = eventName((await fetchEventInfo()).file);
});
</script>

<template>
  <v-app>
    <!-- Dark, not primary: orange is kept for the one main action on a page
         (packages/ui/theme.ts). Two-line title as in gate-config, the event
         first: which event is open matters, the product name doesn't. -->
    <v-app-bar flat>
      <template #prepend>
        <v-app-bar-nav-icon @click="drawer = !drawer" />
      </template>
      <v-app-bar-title>
        <div class="text-caption text-medium-emphasis app-bar-label">
          Rally Gate
        </div>
        <div class="text-subtitle-1 font-weight-medium app-bar-event">
          {{ rallyName || fileName }}
        </div>
      </v-app-bar-title>
      <template #append>
        <v-chip
          v-if="liveStatus"
          :color="LIVE_DISPLAY[liveStatus].color"
          :prepend-icon="LIVE_DISPLAY[liveStatus].icon"
          size="small"
          variant="tonal"
          class="mr-4"
        >
          {{ LIVE_DISPLAY[liveStatus].label }}
        </v-chip>
        <div
          class="text-right mr-2"
          title="Server time — the clock the gates are synced to"
        >
          <div class="rg-timing app-bar-clock">
            {{
              serverNow.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            }}
          </div>
          <div class="text-caption text-medium-emphasis app-bar-label">
            {{
              serverNow.toLocaleDateString([], {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            }}
          </div>
        </div>
        <v-btn
          to="/setup"
          icon="mdi-cog-outline"
          aria-label="Setup"
          title="Setup"
        />
      </template>
    </v-app-bar>
    <v-navigation-drawer v-model="drawer">
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in NAV_ITEMS"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.label"
        />
      </v-list>
      <template #append>
        <v-list nav density="compact">
          <v-list-item
            :href="REPO_URL"
            target="_blank"
            prepend-icon="mdi-github"
            title="GitHub"
          />
          <v-list-item
            :href="SUPPORT_URL"
            target="_blank"
            prepend-icon="mdi-heart-outline"
            title="Support the project"
          />
        </v-list>
        <div class="text-center text-disabled pa-3" style="font-size: 0.7rem">
          Version {{ serverVersion }}
        </div>
      </template>
    </v-navigation-drawer>
    <v-main>
      <v-container fluid class="py-6">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.app-bar-label {
  line-height: 1.1;
}
.app-bar-clock {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.2;
}
.app-bar-event {
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
