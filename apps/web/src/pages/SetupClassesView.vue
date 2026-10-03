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
import FormDialog from '../components/FormDialog.vue';
import { required } from '../format';
import { notify, useConfirm } from '@rally-gate/ui';

const confirm = useConfirm();

const classes = ref<VehicleClass[]>([]);
const vehicles = ref<Vehicle[]>([]);

const dialogOpen = ref(false);
const editing = ref<VehicleClass | null>(null);
const draft = ref({ name: '', main: false });

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

function openDialog(vehicleClass: VehicleClass | null) {
  editing.value = vehicleClass;
  draft.value = {
    name: vehicleClass?.name ?? '',
    main: vehicleClass?.main ?? false,
  };
  dialogOpen.value = true;
}

async function onSave() {
  const input = { name: draft.value.name.trim(), main: draft.value.main };
  if (editing.value) await updateVehicleClass(editing.value.id, input);
  else await createVehicleClass(input);
  await refresh();
}

async function onDeleteClass(vehicleClass: VehicleClass) {
  const count = countOf(vehicleClass);
  if (
    !(await confirm({
      title: `Delete class "${vehicleClass.name}"?`,
      text:
        count > 0
          ? `${count} vehicle${count === 1 ? '' : 's'} will leave it; the vehicles themselves are kept.`
          : 'No vehicle is in it.',
      confirmText: 'Delete class',
      color: 'error',
    }))
  )
    return;
  await deleteVehicleClass(vehicleClass.id);
  await refresh();
  notify('Class deleted');
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title class="d-flex align-center">
      Classes
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="openDialog(null)">
        Add Class
      </v-btn>
    </v-card-title>
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
            <th>Kind</th>
            <th>Vehicles</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="vehicleClass in classes" :key="vehicleClass.id">
            <td>{{ vehicleClass.name }}</td>
            <td>
              <v-chip
                size="small"
                :color="vehicleClass.main ? 'secondary' : undefined"
                :prepend-icon="vehicleClass.main ? 'mdi-star' : 'mdi-tag'"
              >
                {{ vehicleClass.main ? 'Main class' : 'Category' }}
              </v-chip>
            </td>
            <td>{{ countOf(vehicleClass) }}</td>
            <td class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openDialog(vehicleClass)"
              >
                Edit
              </v-btn>
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="`More for ${vehicleClass.name}`"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    title="Delete"
                    base-color="error"
                    @click="onDeleteClass(vehicleClass)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-else type="info" variant="tonal">
        No classes yet. Without any, results are one overall ranking. Add one
        with + Add Class.
      </v-alert>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="editing ? `Edit class ${editing.name}` : 'Add class'"
    :form="draft"
    :save="onSave"
    :saved="editing ? 'Class saved' : 'Class added'"
    :save-text="editing ? 'Save' : 'Add class'"
  >
    <v-text-field
      v-model="draft.name"
      label="Name"
      :rules="[required]"
      autofocus
    />
    <v-switch
      v-model="draft.main"
      label="Main class (a vehicle has one)"
      color="secondary"
      hide-details
    />
  </FormDialog>
</template>
