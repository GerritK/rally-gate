<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  createVehicle,
  fetchVehicles,
  updateVehicle,
  VehicleStatus,
  type Vehicle,
  type VehiclePatch,
} from '../api/vehicles';
import ClassPicker from '../components/ClassPicker.vue';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';

const STATUS_OPTIONS = Object.values(VehicleStatus);

const vehicles = ref<Vehicle[]>([]);
const classes = ref<VehicleClass[]>([]);
const emptyVehicle = () => ({
  startNumber: '',
  driverName: '',
  coDriverName: '',
  transponderId: '',
  classIds: [] as string[],
});
const newVehicle = ref(emptyVehicle());
const editingVehicleId = ref<string | null>(null);

async function refresh() {
  vehicles.value = await fetchVehicles();
  classes.value = await fetchVehicleClasses();
}

function toggleEditVehicle(id: string) {
  editingVehicleId.value = editingVehicleId.value === id ? null : id;
}

async function onUpdateVehicle(vehicle: Vehicle, patch: VehiclePatch) {
  try {
    const updated = await updateVehicle(vehicle.id, patch);
    const idx = vehicles.value.findIndex((v) => v.id === vehicle.id);
    if (idx !== -1) vehicles.value[idx] = updated;
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to update vehicle');
  }
}

function onUpdateStartNumber(vehicle: Vehicle, value: string) {
  if (!value) return;
  onUpdateVehicle(vehicle, { startNumber: Number(value) });
}

function onUpdateDriverName(vehicle: Vehicle, value: string) {
  if (!value) return;
  onUpdateVehicle(vehicle, { driverName: value });
}

function onUpdateCoDriverName(vehicle: Vehicle, value: string) {
  onUpdateVehicle(vehicle, { coDriverName: value || null });
}

function onUpdateTransponderId(vehicle: Vehicle, value: string) {
  onUpdateVehicle(vehicle, { transponderId: value || null });
}

function onUpdateStatus(vehicle: Vehicle, status: VehicleStatus) {
  onUpdateVehicle(vehicle, { status });
}

function onUpdateClasses(vehicle: Vehicle, classIds: string[]) {
  onUpdateVehicle(vehicle, { classIds });
}

async function onCreateVehicle() {
  if (!newVehicle.value.startNumber || !newVehicle.value.driverName) return;
  try {
    await createVehicle({
      startNumber: Number(newVehicle.value.startNumber),
      driverName: newVehicle.value.driverName,
      coDriverName: newVehicle.value.coDriverName || undefined,
      transponderId: newVehicle.value.transponderId || undefined,
      classIds: newVehicle.value.classIds,
    });
    newVehicle.value = emptyVehicle();
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
            <th>Transponder</th>
            <th v-if="classes.length > 0">Classes</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicle in vehicles" :key="vehicle.id">
            <template v-if="editingVehicleId === vehicle.id">
              <td>
                <v-text-field
                  :model-value="vehicle.startNumber"
                  type="number"
                  min="1"
                  density="compact"
                  hide-details
                  @change="
                    onUpdateStartNumber(
                      vehicle,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </td>
              <td>
                <v-text-field
                  :model-value="vehicle.driverName"
                  density="compact"
                  hide-details
                  @change="
                    onUpdateDriverName(
                      vehicle,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </td>
              <td>
                <v-text-field
                  :model-value="vehicle.coDriverName"
                  density="compact"
                  hide-details
                  @change="
                    onUpdateCoDriverName(
                      vehicle,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </td>
              <td>
                <v-text-field
                  :model-value="vehicle.transponderId"
                  density="compact"
                  hide-details
                  @change="
                    onUpdateTransponderId(
                      vehicle,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </td>
            </template>
            <template v-else>
              <td>{{ vehicle.startNumber }}</td>
              <td>{{ vehicle.driverName }}</td>
              <td>{{ vehicle.coDriverName ?? '-' }}</td>
              <td>{{ vehicle.transponderId ?? '-' }}</td>
            </template>
            <td v-if="classes.length > 0">
              <ClassPicker
                :model-value="vehicle.classes.map((c) => c.id)"
                :classes="classes"
                density="compact"
                @update:model-value="onUpdateClasses(vehicle, $event)"
              />
            </td>
            <td>
              <v-select
                :model-value="vehicle.status"
                :items="STATUS_OPTIONS"
                density="compact"
                hide-details
                style="min-width: 160px"
                @update:model-value="onUpdateStatus(vehicle, $event)"
              />
            </td>
            <td>
              <v-btn
                size="small"
                variant="text"
                :prepend-icon="
                  editingVehicleId === vehicle.id ? 'mdi-check' : 'mdi-pencil'
                "
                @click="toggleEditVehicle(vehicle.id)"
              >
                {{ editingVehicleId === vehicle.id ? 'Done' : 'Edit' }}
              </v-btn>
            </td>
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
          type="number"
          min="1"
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
        <v-text-field
          v-model="newVehicle.transponderId"
          label="Transponder ID (optional)"
          density="comfortable"
          hide-details
          style="min-width: 200px"
        />
        <ClassPicker v-model="newVehicle.classIds" :classes="classes" />
        <v-btn type="submit" color="primary" prepend-icon="mdi-plus">
          Add Vehicle
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
