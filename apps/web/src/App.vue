<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue';
import { REPO_URL, SUPPORT_URL } from '@rally-gate/ui';
import { fetchEventInfo } from './api/event';
import { fetchRallyInfo, rallyName } from './api/rally-info';
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

onMounted(async () => {
  void fetchServerVersion();
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
.app-bar-event {
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
