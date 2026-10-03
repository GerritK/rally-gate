<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchSetting, saveSetting } from '../api/settings';
import {
  createVehicleClass,
  deleteVehicleClass,
  fetchVehicleClasses,
  updateVehicleClass,
  type VehicleClass,
} from '../api/vehicle-classes';

const NOTIONAL_PENALTY_KEY = 'notionalPenaltyMs';
/** Mirrors DEFAULT_NOTIONAL_PENALTY_MS server-side; only used until the
 * stored value loads, so the two can't drift in practice. */
const NOTIONAL_PENALTY_FALLBACK_S = 120;

const notionalPenaltyS = ref(NOTIONAL_PENALTY_FALLBACK_S);
const savingPenalty = ref(false);
const saved = ref(false);

async function onSavePenalty() {
  if (savingPenalty.value) return;
  savingPenalty.value = true;
  saved.value = false;
  try {
    await saveSetting(
      NOTIONAL_PENALTY_KEY,
      String(Math.round(notionalPenaltyS.value * 1000)),
    );
    saved.value = true;
  } finally {
    savingPenalty.value = false;
  }
}

const classes = ref<VehicleClass[]>([]);
const newClass = ref({ name: '', main: false });

async function refreshClasses() {
  classes.value = await fetchVehicleClasses();
}

async function guarded(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to save class');
  }
  await refreshClasses();
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
  if (
    !confirm(
      `Delete class "${vehicleClass.name}"? Vehicles in it are kept, they just leave the class.`,
    )
  )
    return;
  guarded(() => deleteVehicleClass(vehicleClass.id));
}

onMounted(async () => {
  await refreshClasses();
  const storedMs = Number(await fetchSetting(NOTIONAL_PENALTY_KEY));
  if (Number.isFinite(storedMs) && storedMs > 0) {
    notionalPenaltyS.value = storedMs / 1000;
  }
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card class="mb-6">
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
      <div
        v-for="vehicleClass in classes"
        :key="vehicleClass.id"
        class="d-flex align-center ga-2 mb-2"
      >
        <v-text-field
          :model-value="vehicleClass.name"
          density="compact"
          hide-details
          style="max-width: 260px"
          @change="
            onUpdateClass(vehicleClass, {
              name: ($event.target as HTMLInputElement).value,
            })
          "
        />
        <v-switch
          :model-value="vehicleClass.main"
          label="Main class"
          color="secondary"
          density="compact"
          hide-details
          @update:model-value="onUpdateClass(vehicleClass, { main: !!$event })"
        />
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          size="small"
          :aria-label="`Delete class ${vehicleClass.name}`"
          @click="onDeleteClass(vehicleClass)"
        />
      </div>
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

  <v-card>
    <v-card-title>Notional times</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        A crew that doesn't complete a closed stage is charged a
        <strong>notional time</strong> for it: the slowest time anyone set on
        that stage, plus this penalty. Without it, retiring early would look
        like winning — a shorter total is otherwise just the result of driving
        less. <br /><br />
        Rule of thumb: set it to roughly <strong>one stage duration</strong>.
        The penalty only has to be big enough to outweigh the advantage a crew
        built on the stages it <em>did</em> finish — set it too low and a quick
        car can retire and still lead the rally.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSavePenalty"
      >
        <v-text-field
          v-model.number="notionalPenaltyS"
          type="number"
          min="0"
          step="1"
          label="Notional time penalty (seconds)"
          density="comfortable"
          hide-details
          style="max-width: 260px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="savingPenalty"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
        <v-chip
          v-if="saved"
          color="success"
          size="small"
          prepend-icon="mdi-check"
        >
          Saved
        </v-chip>
      </form>
    </v-card-text>
  </v-card>
</template>
