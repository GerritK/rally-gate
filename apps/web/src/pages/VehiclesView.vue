<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  createVehicle,
  fetchVehicles,
  updateVehicle,
  VehicleStatus,
  type Vehicle,
} from '../api/vehicles';
import ClassPicker from '../components/ClassPicker.vue';
import FormDialog from '../components/FormDialog.vue';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import { required, VEHICLE_STATUS_DISPLAY } from '../format';

const STATUS_OPTIONS = Object.values(VehicleStatus).map((value) => ({
  value,
  title: VEHICLE_STATUS_DISPLAY[value].label,
}));

const vehicles = ref<Vehicle[]>([]);
const classes = ref<VehicleClass[]>([]);

const dialogOpen = ref(false);
const editing = ref<Vehicle | null>(null);
const draft = ref(toDraft(null));

function toDraft(vehicle: Vehicle | null) {
  return {
    startNumber: vehicle?.startNumber ?? null,
    driverName: vehicle?.driverName ?? '',
    coDriverName: vehicle?.coDriverName ?? '',
    transponderId: vehicle?.transponderId ?? '',
    status: vehicle?.status ?? VehicleStatus.REGISTERED,
    classIds: vehicle?.classes.map((c) => c.id) ?? [],
  };
}

function openDialog(vehicle: Vehicle | null) {
  editing.value = vehicle;
  draft.value = toDraft(vehicle);
  dialogOpen.value = true;
}

async function refresh() {
  vehicles.value = await fetchVehicles();
  classes.value = await fetchVehicleClasses();
}

async function onSave() {
  const input = {
    ...draft.value,
    startNumber: Number(draft.value.startNumber),
    driverName: draft.value.driverName.trim(),
    // null, not undefined: only null clears the column (CLAUDE.md).
    coDriverName: draft.value.coDriverName.trim() || null,
    transponderId: draft.value.transponderId.trim() || null,
  };
  if (editing.value) await updateVehicle(editing.value.id, input);
  else await createVehicle(input);
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      Vehicles
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openDialog(null)">
        Add Vehicle
      </v-btn>
    </v-card-title>
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
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicle in vehicles" :key="vehicle.id">
            <td class="rg-timing">{{ vehicle.startNumber }}</td>
            <td>{{ vehicle.driverName }}</td>
            <td>{{ vehicle.coDriverName ?? '-' }}</td>
            <td class="rg-timing">{{ vehicle.transponderId ?? '-' }}</td>
            <td v-if="classes.length > 0">
              <v-chip
                v-for="c in vehicle.classes"
                :key="c.id"
                size="small"
                :color="c.main ? 'secondary' : undefined"
                :prepend-icon="c.main ? 'mdi-star' : undefined"
                class="me-1"
              >
                {{ c.name }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                :color="VEHICLE_STATUS_DISPLAY[vehicle.status].color"
                :prepend-icon="VEHICLE_STATUS_DISPLAY[vehicle.status].icon"
              >
                {{ VEHICLE_STATUS_DISPLAY[vehicle.status].label }}
              </v-chip>
            </td>
            <td class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openDialog(vehicle)"
              >
                Edit
              </v-btn>
            </td>
          </tr>
          <tr v-if="vehicles.length === 0">
            <td colspan="7" class="rg-empty">
              No vehicles yet. Add one with + Add Vehicle.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="editing ? `Edit vehicle ${editing.startNumber}` : 'Add vehicle'"
    :form="draft"
    :save="onSave"
    :saved="editing ? 'Vehicle saved' : 'Vehicle added'"
    :save-text="editing ? 'Save' : 'Add vehicle'"
  >
    <v-text-field
      v-model.number="draft.startNumber"
      label="Start #"
      type="number"
      min="1"
      :rules="[required]"
      autofocus
    />
    <v-text-field
      v-model="draft.driverName"
      label="Driver"
      :rules="[required]"
    />
    <v-text-field v-model="draft.coDriverName" label="Co-Driver (optional)" />
    <v-text-field
      v-model="draft.transponderId"
      label="Transponder ID (optional)"
    />
    <ClassPicker
      v-if="classes.length > 0"
      v-model="draft.classIds"
      :classes="classes"
    />
    <v-select v-model="draft.status" :items="STATUS_OPTIONS" label="Status" />
  </FormDialog>
</template>
