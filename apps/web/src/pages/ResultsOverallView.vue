<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  type OverallClassificationEntry,
} from '../api/classification';
import { classFilterLabel, useClassQuery } from '../class-query';
import ClassFilter from '../components/ClassFilter.vue';
import StagePicker from '../components/StagePicker.vue';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import { formatDuration, formatGap } from '../format';

const route = useRoute();
const router = useRouter();
const overallClassification = ref<OverallClassificationEntry[]>([]);
const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const selectedClassIds = useClassQuery();

/** Stages counted toward the overall — every closed stage that anyone
 * finished. A crew below this has notional time inside its total. */
const stagesCounted = computed(() =>
  Math.max(0, ...overallClassification.value.map((e) => e.stagesCompleted)),
);

// Every entry carries the same counted stages, in stage order.
const countedStages = computed(() =>
  (overallClassification.value[0]?.stageTimes ?? []).map(({ stageId }) => ({
    id: stageId,
    name: stages.value.find((s) => s.id === stageId)?.name,
  })),
);

const classLabel = computed(() =>
  classFilterLabel(classes.value, selectedClassIds.value),
);

function goToStage(stageId: string) {
  router.push({ path: `/results/stages/${stageId}`, query: route.query });
}

async function refresh() {
  overallClassification.value = await fetchOverallClassification(
    selectedClassIds.value,
  );
}

watch(() => route.query.classes, refresh);

onMounted(async () => {
  await refresh();
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
});
</script>

<template>
  <StagePicker
    class="mb-4"
    :stages="stages"
    overall
    @update:model-value="goToStage"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <ClassFilter v-model="selectedClassIds" :classes="classes" />
  </div>

  <v-card>
    <v-card-title> Overall Classification </v-card-title>
    <v-card-subtitle>{{ classLabel }}</v-card-subtitle>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th
              v-for="stage in countedStages"
              :key="stage.id"
              :title="stage.name"
            >
              {{ stage.id }}
            </th>
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
            <td
              v-for="time in entry.stageTimes"
              :key="time.stageId"
              class="rg-timing text-no-wrap"
            >
              <v-tooltip
                v-if="time.notional"
                text="Notional time: stage not completed, charged the slowest time plus a penalty."
                location="top"
              >
                <template #activator="{ props }">
                  <span v-bind="props" class="text-warning">
                    {{ formatDuration(time.durationMs) }}
                    <v-icon size="x-small" icon="mdi-asterisk" />
                  </span>
                </template>
              </v-tooltip>
              <template v-else>{{ formatDuration(time.durationMs) }}</template>
            </td>
            <td class="rg-timing font-weight-bold">
              {{ formatDuration(entry.durationMs) }}
            </td>
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
