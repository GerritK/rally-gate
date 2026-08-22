<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { createVehicle, fetchVehicles, type Vehicle } from '../api';

const vehicles = ref<Vehicle[]>([]);
const newVehicle = ref({ startNumber: '', driverName: '', coDriverName: '' });

async function refresh() {
  vehicles.value = await fetchVehicles();
}

async function onCreateVehicle() {
  if (!newVehicle.value.startNumber || !newVehicle.value.driverName) return;
  try {
    await createVehicle({
      startNumber: newVehicle.value.startNumber,
      driverName: newVehicle.value.driverName,
      coDriverName: newVehicle.value.coDriverName || undefined,
    });
    newVehicle.value = { startNumber: '', driverName: '', coDriverName: '' };
    await refresh();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to add vehicle');
  }
}

onMounted(refresh);
</script>

<template>
  <v-card>
    <v-card-title>Vehicles</v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicle in vehicles" :key="vehicle.id">
            <td>{{ vehicle.startNumber }}</td>
            <td>{{ vehicle.driverName }}</td>
            <td>{{ vehicle.coDriverName ?? '-' }}</td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-if="vehicles.length === 0" type="info" variant="tonal">
        No vehicles registered yet.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateVehicle"
      >
        <v-text-field
          v-model="newVehicle.startNumber"
          label="Start #"
          density="comfortable"
          hide-details
          style="max-width: 140px"
        />
        <v-text-field
          v-model="newVehicle.driverName"
          label="Driver"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-text-field
          v-model="newVehicle.coDriverName"
          label="Co-Driver (optional)"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn type="submit" color="primary" prepend-icon="mdi-plus">
          Add Vehicle
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
