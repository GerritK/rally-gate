<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  type OverallClassificationEntry,
} from '../api/classification';
import ClassPicker from '../components/ClassPicker.vue';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import { formatDuration, formatGap } from '../format';

const router = useRouter();
const overallClassification = ref<OverallClassificationEntry[]>([]);
const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const selectedClassIds = ref<string[]>([]);

/** Stages counted toward the overall — every closed stage that anyone
 * finished. A crew below this has notional time inside its total. */
const stagesCounted = computed(() =>
  Math.max(0, ...overallClassification.value.map((e) => e.stagesCompleted)),
);

const stageOptions = computed(() =>
  stages.value.map((s) => ({ id: s.id, title: `${s.stageNumber}. ${s.name}` })),
);

const selectedClassNames = computed(() =>
  classes.value
    .filter((c) => selectedClassIds.value.includes(c.id))
    .map((c) => c.name)
    .join(' · '),
);

function goToStage(stageId: string) {
  router.push(`/results/stages/${stageId}`);
}

async function refresh() {
  overallClassification.value = await fetchOverallClassification(
    selectedClassIds.value,
  );
}

watch(selectedClassIds, refresh);

onMounted(async () => {
  await refresh();
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
});
</script>

<template>
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <v-select
      v-if="stageOptions.length > 0"
      :items="stageOptions"
      item-title="title"
      item-value="id"
      label="View a stage's results"
      density="comfortable"
      hide-details
      style="max-width: 320px"
      @update:model-value="goToStage"
    />
    <ClassPicker v-model="selectedClassIds" :classes="classes" />
  </div>

  <v-card>
    <v-card-title>
      Overall Classification
      <template v-if="selectedClassNames"> — {{ selectedClassNames }}</template>
    </v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th>Total Time</th>
            <th>Gap</th>
            <th>Stages</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in overallClassification" :key="entry.vehicleId">
            <td>{{ entry.position }}</td>
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td class="rg-timing">{{ formatDuration(entry.durationMs) }}</td>
            <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
            <td>
              <v-tooltip
                v-if="entry.stagesCompleted < stagesCounted"
                :text="`Did not complete ${stagesCounted - entry.stagesCompleted} of ${stagesCounted} stages — a notional time is included in this total.`"
                location="top"
              >
                <template #activator="{ props }">
                  <span v-bind="props" class="text-warning">
                    {{ entry.stagesCompleted }}
                    <v-icon size="x-small" icon="mdi-asterisk" />
                  </span>
                </template>
              </v-tooltip>
              <span v-else>{{ entry.stagesCompleted }}</span>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>
