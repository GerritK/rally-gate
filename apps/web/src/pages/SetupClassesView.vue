<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  createVehicleClass,
  deleteVehicleClass,
  fetchVehicleClasses,
  updateVehicleClass,
  type VehicleClass,
} from '../api/vehicle-classes';
import { fetchVehicles, type Vehicle } from '../api/vehicles';

const classes = ref<VehicleClass[]>([]);
const vehicles = ref<Vehicle[]>([]);
const newClass = ref({ name: '', main: false });

const vehicleCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles.value) {
    for (const c of vehicle.classes) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
  }
  return counts;
});
const countOf = (vehicleClass: VehicleClass) =>
  vehicleCounts.value.get(vehicleClass.id) ?? 0;

async function refresh() {
  classes.value = await fetchVehicleClasses();
  vehicles.value = await fetchVehicles();
}

async function guarded(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to save class');
  }
  await refresh();
}

function onCreateClass() {
  const name = newClass.value.name.trim();
  if (!name) return;
  guarded(async () => {
    await createVehicleClass({ name, main: newClass.value.main });
    newClass.value = { name: '', main: false };
  });
}

function onUpdateClass(
  vehicleClass: VehicleClass,
  patch: { name?: string; main?: boolean },
) {
  const name = (patch.name ?? vehicleClass.name).trim();
  if (!name) return;
  guarded(() =>
    updateVehicleClass(vehicleClass.id, {
      name,
      main: patch.main ?? vehicleClass.main,
    }),
  );
}

function onDeleteClass(vehicleClass: VehicleClass) {
  const count = countOf(vehicleClass);
  const effect =
    count > 0
      ? `${count} vehicle${count === 1 ? '' : 's'} will leave it; the vehicles themselves are kept.`
      : 'No vehicle is in it.';
  if (!confirm(`Delete class "${vehicleClass.name}"? ${effect}`)) return;
  guarded(() => deleteVehicleClass(vehicleClass.id));
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title>Classes</v-card-title>
    <v-card-text>
      <p class="mb-4">
        <strong>Main classes</strong> (4WD, 2WD) split the field — a vehicle has
        one. <strong>Categories</strong> (Rookie, Stock) cut across them — a
        vehicle has any number. Results combine any of them, e.g. Stock Rookie
        2WD, with positions, gaps and notional times computed within that group.
        Assign them on the Vehicles page; the overall ranking always includes
        everyone.
      </p>
      <v-table v-if="classes.length > 0" density="comfortable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Main class</th>
            <th>Vehicles</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicleClass in classes" :key="vehicleClass.id">
            <td>
              <v-text-field
                :model-value="vehicleClass.name"
                :prepend-inner-icon="vehicleClass.main ? 'mdi-star' : undefined"
                density="compact"
                hide-details
                style="max-width: 260px"
                @change="
                  onUpdateClass(vehicleClass, {
                    name: ($event.target as HTMLInputElement).value,
                  })
                "
              />
            </td>
            <td>
              <v-switch
                :model-value="vehicleClass.main"
                color="secondary"
                density="compact"
                hide-details
                :aria-label="`${vehicleClass.name} is a main class`"
                @update:model-value="
                  onUpdateClass(vehicleClass, { main: !!$event })
                "
              />
            </td>
            <td>{{ countOf(vehicleClass) }}</td>
            <td>
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                size="small"
                :aria-label="`Delete class ${vehicleClass.name}`"
                @click="onDeleteClass(vehicleClass)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-else type="info" variant="tonal">
        No classes yet. Without any, results are one overall ranking.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateClass"
      >
        <v-text-field
          v-model="newClass.name"
          label="New class"
          density="comfortable"
          hide-details
          style="max-width: 260px"
        />
        <v-switch
          v-model="newClass.main"
          label="Main class"
          color="secondary"
          density="compact"
          hide-details
        />
        <v-btn type="submit" variant="tonal" prepend-icon="mdi-plus">
          Add Class
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
