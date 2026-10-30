<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from 'vue';
import {
  currentLocale,
  LocaleMenu,
  logoUrl,
  RallyFeedback,
  REPO_URL,
  SUPPORT_URL,
  t,
} from '@rally-gate/ui';
import { session, sessionName } from './api/auth';
import { fetchEventInfo } from './api/event';
import { fetchRallyInfo, rallyName, rallyStatus } from './api/rally-info';
import { liveStatus } from './api/live';
import { serverNow, syncServerClock } from './api/time';
import { fetchServerVersion, serverVersion } from './api/version';
import { loadDisplaySettings } from './crew';
import { eventName, RALLY_STATUS_DISPLAY } from './format';
import { useRoute, useRouter } from 'vue-router';
import { isPublicPath, NAV_ITEMS } from './router';

const drawer = ref(true);
const route = useRoute();
const router = useRouter();
const loggedIn = computed(() => !!session.value?.role);
/** By first path segment: sub-pages (/setup/stages, /hardware/gates/…,
 *  /results/stages/…) aren't nested routes, so the link's own active state
 *  misses them. */
const section = (path: string) => path.split('/')[1];
/** For an event whose rally details were never filled in. */
const fileName = ref('');

watchEffect(() => {
  const event = rallyName.value || fileName.value;
  document.title = event ? `${event} · Rally Gate` : 'Rally Gate';
});

const LIVE_DISPLAY = {
  connecting: {
    label: 'live.connecting',
    color: 'timing-idle',
    icon: 'mdi-sync',
  },
  live: { label: 'live.live', color: 'success', icon: 'mdi-circle' },
  offline: {
    label: 'live.offline',
    color: 'error',
    icon: 'mdi-lan-disconnect',
  },
} as const;

// Pages with a live stream get a status change pushed; the others pick it
// up here, on the next navigation (the first one too: nothing matches before
// it). The session is the router's.
watch(
  () => route.path,
  () => {
    if (route.matched.length > 0 && !route.meta.live) {
      fetchRallyInfo().catch(() => undefined);
    }
  },
  { immediate: true },
);

// A 401/403 reloads the session; a device blocked mid-page lands here.
watch(loggedIn, (now) => {
  if (!now && session.value && !isPublicPath(route.path)) {
    void router.replace('/public');
  }
});

// The file name is internal (`/event`), so only for a login.
watch(
  loggedIn,
  async (now) => {
    if (now) fileName.value = eventName((await fetchEventInfo()).file);
  },
  { immediate: true },
);

onMounted(() => {
  void fetchServerVersion();
  syncServerClock().catch(() => undefined);
  void loadDisplaySettings();
});
</script>

<template>
  <v-app>
    <!-- Dark, not primary: orange is kept for the one main action on a page
         (packages/ui/theme.ts). The logo names the product, so the title is
         just the open event. -->
    <v-app-bar>
      <template #prepend>
        <v-app-bar-nav-icon v-if="loggedIn" @click="drawer = !drawer" />
      </template>
      <v-app-bar-title>
        <div class="d-flex align-center ga-3">
          <img :src="logoUrl" alt="Rally Gate" class="app-bar-logo" />
          <div class="app-bar-event">
            {{ rallyName || fileName }}
          </div>
        </div>
      </v-app-bar-title>
      <template #append>
        <!-- Links to where it is changed; the change itself never sits in
             the app bar, where a stray tap on a tablet would end a rally. -->
        <v-chip
          :to="loggedIn ? '/setup' : undefined"
          :color="RALLY_STATUS_DISPLAY[rallyStatus].color"
          :prepend-icon="RALLY_STATUS_DISPLAY[rallyStatus].icon"
          size="small"
          variant="tonal"
          v-tooltip:bottom="t('rallyStatus.title')"
        >
          {{ RALLY_STATUS_DISPLAY[rallyStatus].label }}
        </v-chip>
        <v-divider vertical inset class="mx-4" />
        <v-chip
          v-if="liveStatus"
          :color="LIVE_DISPLAY[liveStatus].color"
          :prepend-icon="LIVE_DISPLAY[liveStatus].icon"
          size="small"
          variant="tonal"
        >
          {{ t(LIVE_DISPLAY[liveStatus].label) }}
        </v-chip>
        <v-divider v-if="liveStatus" vertical inset class="mx-4" />
        <div v-tooltip:bottom="t('app.serverTime')" class="text-center">
          <div class="rg-timing app-bar-clock">
            {{
              new Date(serverNow).toLocaleTimeString(currentLocale(), {
                hourCycle: 'h23',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            }}
          </div>
          <div class="text-caption text-medium-emphasis app-bar-label">
            {{
              new Date(serverNow).toLocaleDateString(currentLocale(), {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            }}
          </div>
        </div>
        <v-divider vertical inset class="mx-4" />
        <LocaleMenu />
        <!-- No active state: the drawer already marks Setup, and a lit cog
             in the app bar reads as a pressed button. -->
        <v-btn
          v-if="loggedIn"
          to="/setup"
          :active="false"
          icon="mdi-cog-outline"
          v-tooltip:bottom="t('nav.setup')"
          :aria-label="t('nav.setup')"
        />
        <v-btn
          v-else-if="route.path !== '/login'"
          to="/login"
          variant="text"
          prepend-icon="mdi-login"
        >
          {{ t('login.title') }}
        </v-btn>
      </template>
    </v-app-bar>
    <v-navigation-drawer v-if="loggedIn" v-model="drawer">
      <v-list nav density="comfortable">
        <v-list-item
          v-for="item in NAV_ITEMS"
          :key="item.to"
          :to="item.to"
          :active="section(route.path) === section(item.to)"
          :prepend-icon="item.icon"
          :title="t(item.label)"
        />
      </v-list>
      <template #append>
        <v-list nav density="compact">
          <v-list-item
            to="/login"
            :prepend-icon="session?.role ? 'mdi-account-check' : 'mdi-login'"
            :title="session?.role ? sessionName(session) : t('login.title')"
          />
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
            :title="t('app.support')"
          />
        </v-list>
        <div class="text-center text-disabled pa-3" style="font-size: 0.7rem">
          {{ t('app.version', { version: serverVersion }) }}
        </div>
      </template>
    </v-navigation-drawer>
    <v-main>
      <v-container fluid class="py-6">
        <router-view />
      </v-container>
    </v-main>
    <RallyFeedback />
  </v-app>
</template>

<style scoped>
.app-bar-label {
  line-height: 1.1;
}
.app-bar-logo {
  height: 22px;
  flex-shrink: 0;
}
.app-bar-clock {
  font-size: 1.15rem;
  font-weight: 600;
  line-height: 1.2;
}
.app-bar-event {
  min-width: 0;
  font-size: 1.3rem;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
