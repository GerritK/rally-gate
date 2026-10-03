<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  fetchNonFinishers,
  fetchSplitClassification,
  fetchSplitGatesForStage,
  fetchStageClassification,
  type ClassificationEntry,
  type SplitClassificationEntry,
  type SplitGateInfo,
  type StageOutcomeEntry,
} from '../api/classification';
import ClassPicker from '../components/ClassPicker.vue';
import StagePicker from '../components/StagePicker.vue';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import {
  formatDuration,
  formatGap,
  outcomeColor,
  runStatusColor,
} from '../format';

const props = defineProps<{ stageId: string }>();
const router = useRouter();

const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const selectedClassIds = ref<string[]>([]);
const stageClassification = ref<ClassificationEntry[]>([]);
const splitGates = ref<SplitGateInfo[]>([]);
const selectedSplitIndex = ref<number | null>(null);
const splitClassification = ref<SplitClassificationEntry[]>([]);
const nonFinishers = ref<StageOutcomeEntry[]>([]);

const splitGateOptions = computed(() =>
  splitGates.value.map((g) => ({
    value: g.splitIndex,
    title: `Split ${g.splitIndex} (${g.name})`,
  })),
);

async function refreshSplitClassification() {
  if (props.stageId && selectedSplitIndex.value !== null) {
    splitClassification.value = await fetchSplitClassification(
      props.stageId,
      selectedSplitIndex.value,
      selectedClassIds.value,
    );
  } else {
    splitClassification.value = [];
  }
}

async function refreshStageClassification() {
  stageClassification.value = await fetchStageClassification(
    props.stageId,
    selectedClassIds.value,
  );
  nonFinishers.value = await fetchNonFinishers(
    props.stageId,
    selectedClassIds.value,
  );
}

async function loadStage() {
  if (!props.stageId) return;
  await refreshStageClassification();
  splitGates.value = await fetchSplitGatesForStage(props.stageId);
  selectedSplitIndex.value =
    splitGates.value.length > 0 ? splitGates.value[0].splitIndex! : null;
  await refreshSplitClassification();
}

watch(() => props.stageId, loadStage);
watch(selectedSplitIndex, refreshSplitClassification);
watch(selectedClassIds, async () => {
  if (!props.stageId) return;
  await refreshStageClassification();
  await refreshSplitClassification();
});

onMounted(async () => {
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
  await loadStage();
});

function onStageChange(stageId: string) {
  router.push(`/results/stages/${stageId}`);
}
</script>

<template>
  <StagePicker
    class="mb-2"
    :stages="stages"
    :model-value="stageId"
    @update:model-value="onStageChange"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <ClassPicker v-model="selectedClassIds" :classes="classes" />
    <v-btn variant="text" prepend-icon="mdi-podium" to="/results/overall">
      Overall Classification
    </v-btn>
  </div>

  <v-card class="mb-6">
    <v-card-title>Stage Classification</v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th>Time</th>
            <th>Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in stageClassification" :key="entry.vehicleId">
            <td>{{ entry.position }}</td>
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td class="rg-timing">{{ formatDuration(entry.durationMs) }}</td>
            <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
          </tr>
        </tbody>
      </v-table>

      <v-table
        v-if="nonFinishers.length > 0"
        density="comfortable"
        class="mt-4"
      >
        <thead>
          <tr>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in nonFinishers" :key="entry.vehicleId">
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td>
              <v-chip size="small" :color="outcomeColor(entry.outcome)">
                {{ entry.outcome }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title>Split Classification</v-card-title>
    <v-card-text>
      <v-select
        v-if="splitGates.length > 0"
        v-model="selectedSplitIndex"
        :items="splitGateOptions"
        item-title="title"
        item-value="value"
        label="Split"
        density="comfortable"
        hide-details
        style="max-width: 320px"
        class="mb-4"
      />
      <v-alert v-else type="info" variant="tonal" class="mb-4">
        No split gates configured for this stage.
      </v-alert>
      <v-table v-if="splitGates.length > 0" density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th>Time</th>
            <th>Gap</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in splitClassification" :key="entry.vehicleId">
            <td>{{ entry.position }}</td>
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td class="rg-timing">{{ formatDuration(entry.elapsedMs) }}</td>
            <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
            <td>
              <v-chip
                size="small"
                :color="runStatusColor(entry.stageRunStatus)"
              >
                {{ entry.stageRunStatus }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>
