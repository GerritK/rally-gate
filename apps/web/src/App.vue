<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchEventInfo } from './api/event';
import { eventName } from './format';
import { NAV_ITEMS } from './router';

const drawer = ref(true);
const event = ref('');

onMounted(async () => {
  event.value = eventName((await fetchEventInfo()).file);
});
</script>

<template>
  <v-app>
    <v-app-bar title="Rally Gate" color="primary">
      <template #prepend>
        <v-app-bar-nav-icon @click="drawer = !drawer" />
      </template>
      <template #append>
        <v-btn to="/event" variant="text" prepend-icon="mdi-folder-outline">
          {{ event }}
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
    </v-navigation-drawer>
    <v-main>
      <v-container fluid class="py-6">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
