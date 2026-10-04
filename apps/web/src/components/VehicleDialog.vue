<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  createVehicle,
  updateVehicle,
  VehicleStatus,
  type Vehicle,
} from '../api/vehicles';
import type { VehicleClass } from '../api/vehicle-classes';
import { FLAG_OPTIONS, flagUrl } from '../crew';
import { required, VEHICLE_STATUS_DISPLAY } from '../format';
import ClassPicker from './ClassPicker.vue';
import FormDialog from './FormDialog.vue';

const props = defineProps<{
  /** `null` adds a vehicle. */
  vehicle: Vehicle | null;
  classes: VehicleClass[];
  /** Every vehicle, for chassis and body suggestions. */
  vehicles: Vehicle[];
}>();
const emit = defineEmits<{ saved: [vehicle: Vehicle] }>();
const open = defineModel<boolean>({ required: true });

const STATUS_OPTIONS = Object.values(VehicleStatus).map((value) => ({
  value,
  title: VEHICLE_STATUS_DISPLAY[value].label,
}));

const draft = ref(toDraft(null));
watch(open, (isOpen) => {
  if (isOpen) draft.value = toDraft(props.vehicle);
});

function toDraft(vehicle: Vehicle | null) {
  return {
    startNumber: vehicle?.startNumber ?? null,
    driverFirstName: vehicle?.driverFirstName ?? '',
    driverLastName: vehicle?.driverLastName ?? '',
    driverFlag: vehicle?.driverFlag ?? null,
    coDriverFirstName: vehicle?.coDriverFirstName ?? '',
    coDriverLastName: vehicle?.coDriverLastName ?? '',
    coDriverFlag: vehicle?.coDriverFlag ?? null,
    body: vehicle?.body ?? '',
    chassis: vehicle?.chassis ?? '',
    transponderId: vehicle?.transponderId ?? '',
    status: vehicle?.status ?? VehicleStatus.REGISTERED,
    classIds: vehicle?.classes.map((c) => c.id) ?? [],
  };
}

const suggestions = (pick: (v: Vehicle) => string | null) =>
  [...new Set(props.vehicles.map(pick).filter((v): v is string => !!v))].sort();
const bodies = computed(() => suggestions((v) => v.body));
const chassis = computed(() => suggestions((v) => v.chassis));

// null, not undefined: only null clears the column (CLAUDE.md).
const orNull = (value: string | null) => value?.trim() || null;

async function onSave() {
  const d = draft.value;
  const input = {
    ...d,
    startNumber: Number(d.startNumber),
    driverFirstName: d.driverFirstName.trim(),
    driverLastName: orNull(d.driverLastName),
    coDriverFirstName: orNull(d.coDriverFirstName),
    coDriverLastName: orNull(d.coDriverLastName),
    body: orNull(d.body),
    chassis: orNull(d.chassis),
    transponderId: orNull(d.transponderId),
  };
  emit(
    'saved',
    props.vehicle
      ? await updateVehicle(props.vehicle.id, input)
      : await createVehicle(input),
  );
}
</script>

<template>
  <FormDialog
    v-model="open"
    :title="vehicle ? `Edit vehicle ${vehicle.startNumber}` : 'Add vehicle'"
    :form="draft"
    :save="onSave"
    :saved="vehicle ? 'Vehicle saved' : 'Vehicle added'"
    :save-text="vehicle ? 'Save' : 'Add vehicle'"
  >
    <v-text-field
      v-model.number="draft.startNumber"
      label="Start #"
      type="number"
      min="1"
      :rules="[required]"
      autofocus
    />
    <div class="rg-section-title">Driver</div>
    <div class="rg-person">
      <v-text-field
        v-model="draft.driverFirstName"
        label="First name"
        :rules="[required]"
      />
      <v-text-field v-model="draft.driverLastName" label="Last name" />
    </div>
    <v-autocomplete
      v-model="draft.driverFlag"
      :items="FLAG_OPTIONS"
      label="Flag"
      placeholder="None (chequered flag)"
      persistent-placeholder
      clearable
    >
      <template #prepend-inner>
        <img :src="flagUrl(draft.driverFlag)" alt="" class="rg-flag-pick" />
      </template>
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps">
          <template #prepend>
            <img :src="flagUrl(item.value)" alt="" class="rg-flag-pick me-3" />
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>
    <div class="rg-section-title">Co-driver (optional)</div>
    <div class="rg-person">
      <v-text-field v-model="draft.coDriverFirstName" label="First name" />
      <v-text-field v-model="draft.coDriverLastName" label="Last name" />
    </div>
    <v-autocomplete
      v-model="draft.coDriverFlag"
      :items="FLAG_OPTIONS"
      label="Flag"
      placeholder="None (chequered flag)"
      persistent-placeholder
      clearable
    >
      <template #prepend-inner>
        <img :src="flagUrl(draft.coDriverFlag)" alt="" class="rg-flag-pick" />
      </template>
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps">
          <template #prepend>
            <img :src="flagUrl(item.value)" alt="" class="rg-flag-pick me-3" />
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>
    <div class="rg-section-title">Car</div>
    <div class="rg-person">
      <v-combobox
        v-model="draft.body"
        :items="bodies"
        label="Body (optional)"
        placeholder="Ford Focus"
      />
      <v-combobox
        v-model="draft.chassis"
        :items="chassis"
        label="Chassis (optional)"
        placeholder="HPI WR8"
      />
    </div>
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

<style scoped>
.rg-person {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  column-gap: 12px;
}
.rg-flag-pick {
  height: 16px;
  aspect-ratio: 4 / 3;
}
</style>
