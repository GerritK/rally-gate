<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import VehicleDialog from '../components/VehicleDialog.vue';
import { VEHICLE_STATUS_DISPLAY } from '../format';

const router = useRouter();
const vehicles = ref<Vehicle[]>([]);
const classes = ref<VehicleClass[]>([]);
const dialogOpen = ref(false);

/** In the order of the class list (main first, then by name), which the
 * server sorts; a vehicle's own classes come back in no particular order. */
function classesOf(vehicle: Vehicle): VehicleClass[] {
  return classes.value.filter((c) =>
    vehicle.classes.some((own) => own.id === c.id),
  );
}

async function refresh() {
  vehicles.value = await fetchVehicles();
  classes.value = await fetchVehicleClasses();
}

onMounted(refresh);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      Vehicles
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="dialogOpen = true">
        Add Vehicle
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>#</th>
            <th>Crew</th>
            <th>Car</th>
            <th>Transponder</th>
            <th v-if="classes.length > 0">Classes</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="vehicle in vehicles"
            :key="vehicle.id"
            class="cursor-pointer"
            @click="router.push(`/vehicles/${vehicle.id}`)"
          >
            <td><StartNumber :number="vehicle.startNumber" /></td>
            <td><CrewName :crew="vehicle" /></td>
            <td>{{ vehicle.body ?? '-' }}</td>
            <td class="rg-timing">{{ vehicle.transponderId ?? '-' }}</td>
            <td v-if="classes.length > 0">
              <ClassChip
                v-for="c in classesOf(vehicle)"
                :key="c.id"
                :name="c.name"
                :main="c.main"
                class="me-1"
              />
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
          </tr>
          <tr v-if="vehicles.length === 0">
            <td colspan="6" class="rg-empty">
              No vehicles yet. Add one with + Add Vehicle.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <VehicleDialog
    v-model="dialogOpen"
    :vehicle="null"
    :classes="classes"
    :vehicles="vehicles"
    @saved="refresh"
  />
</template>
