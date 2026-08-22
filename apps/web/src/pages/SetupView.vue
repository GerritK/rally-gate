<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchRallyInfo, saveRallyInfo, type RallyInfo } from '../api';

const rallyInfo = ref<RallyInfo>({ name: '', date: '', location: '' });
const saving = ref(false);

async function onSave() {
  if (!rallyInfo.value.name || saving.value) return;
  saving.value = true;
  try {
    rallyInfo.value = await saveRallyInfo(rallyInfo.value);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const existing = await fetchRallyInfo();
  if (existing) rallyInfo.value = existing;
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-title>Rally Details</v-card-title>
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
      <v-card to="/hardware" prepend-icon="mdi-router-wireless">
        <v-card-title>Gates</v-card-title>
        <v-card-text>Check gate identity and heartbeat status.</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card to="/vehicles" prepend-icon="mdi-car">
        <v-card-title>Drivers</v-card-title>
        <v-card-text>Register vehicles and drivers.</v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
