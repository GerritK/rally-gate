<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import VehicleDialog from '../components/VehicleDialog.vue';
import { VEHICLE_STATUS_DISPLAY } from '../format';

const props = defineProps<{ vehicleId: string }>();

const vehicles = ref<Vehicle[]>([]);
const classes = ref<VehicleClass[]>([]);
const loaded = ref(false);
const dialogOpen = ref(false);

const vehicle = computed(
  () => vehicles.value.find((v) => v.id === props.vehicleId) ?? null,
);
const ownClasses = computed(() =>
  classes.value.filter((c) =>
    vehicle.value?.classes.some((o) => o.id === c.id),
  ),
);

async function refresh() {
  [vehicles.value, classes.value] = await Promise.all([
    fetchVehicles(),
    fetchVehicleClasses(),
  ]);
  loaded.value = true;
}

onMounted(refresh);
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/vehicles"
    class="mb-4"
  >
    Back to Vehicles
  </v-btn>

  <v-alert v-if="loaded && !vehicle" type="info" variant="tonal">
    No such vehicle in this event.
  </v-alert>

  <v-card v-if="vehicle">
    <v-card-item class="rg-vehicle-head">
      <template #prepend>
        <StartNumber
          :number="vehicle.startNumber"
          class="me-4"
          style="font-size: 3rem"
        />
      </template>
      <CrewName :crew="vehicle" style="font-size: 1.75rem" />
      <template #append>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-pencil"
          @click="dialogOpen = true"
        >
          Edit
        </v-btn>
      </template>
    </v-card-item>
    <v-card-text v-if="vehicle.body || vehicle.chassis" class="pb-0">
      <span class="text-medium-emphasis">Car</span>
      {{ [vehicle.body, vehicle.chassis].filter(Boolean).join(' · ') }}
    </v-card-text>
    <v-card-text class="d-flex flex-wrap align-center ga-2">
      <v-chip
        size="small"
        :color="VEHICLE_STATUS_DISPLAY[vehicle.status].color"
        :prepend-icon="VEHICLE_STATUS_DISPLAY[vehicle.status].icon"
      >
        {{ VEHICLE_STATUS_DISPLAY[vehicle.status].label }}
      </v-chip>
      <ClassChip
        v-for="c in ownClasses"
        :key="c.id"
        :name="c.name"
        :main="c.main"
      />
      <span class="text-medium-emphasis ms-2">
        Transponder
        <span class="rg-timing">{{ vehicle.transponderId ?? '-' }}</span>
      </span>
    </v-card-text>
  </v-card>

  <VehicleDialog
    v-model="dialogOpen"
    :vehicle="vehicle"
    :classes="classes"
    :vehicles="vehicles"
    @saved="refresh"
  />
</template>

<style scoped>
/* Edit sits level with the top of the plate, as in every card header. */
.rg-vehicle-head :deep(.v-card-item__append) {
  align-self: flex-start;
}
</style>
