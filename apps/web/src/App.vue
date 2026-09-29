<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchEventInfo } from './api/event';
import { fetchRallyInfo, rallyName } from './api/rally-info';
import { fetchServerVersion, serverVersion } from './api/version';
import { eventName } from './format';
import { NAV_ITEMS } from './router';

const drawer = ref(true);
/** For an event whose rally details were never filled in. */
const fileName = ref('');

onMounted(async () => {
  void fetchServerVersion();
  await fetchRallyInfo();
  fileName.value = eventName((await fetchEventInfo()).file);
});
</script>

<template>
  <v-app>
    <v-app-bar title="Rally Gate" color="primary">
      <template #prepend>
        <v-app-bar-nav-icon @click="drawer = !drawer" />
      </template>
      <template #append>
        <v-btn to="/setup" variant="text" prepend-icon="mdi-trophy-outline">
          {{ rallyName || fileName }}
        </v-btn>
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
        <div class="text-caption text-medium-emphasis pa-4">
          Rally Gate {{ serverVersion }}
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
