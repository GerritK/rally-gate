<script setup lang="ts">
import { onMounted, ref, watchEffect } from 'vue';
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
