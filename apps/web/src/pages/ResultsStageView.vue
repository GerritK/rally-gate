<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
import { StageStatus } from '@rally-gate/shared';
import { classFilterLabel, useClassQuery } from '../class-query';
import ClassFilter from '../components/ClassFilter.vue';
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
const route = useRoute();
const router = useRouter();

const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const selectedClassIds = useClassQuery();
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
watch(
  () => route.query.classes,
  async () => {
    if (!props.stageId) return;
    await refreshStageClassification();
    await refreshSplitClassification();
  },
);

onMounted(async () => {
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
  await loadStage();
});

const classLabel = computed(() =>
  classFilterLabel(classes.value, selectedClassIds.value),
);

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

function onStageChange(stageId: string) {
  router.push({ path: `/results/stages/${stageId}`, query: route.query });
}
</script>

<template>
  <StagePicker
    class="mb-4"
    :stages="stages"
    :model-value="stageId"
    overall
    @update:model-value="onStageChange"
    @overall="router.push({ path: '/results/overall', query: route.query })"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <ClassFilter v-model="selectedClassIds" :classes="classes" />
  </div>

  <v-card class="mb-6">
    <v-card-title>
      Stage Classification
      <template v-if="stage"> — {{ stage.id }} · {{ stage.name }}</template>
    </v-card-title>
    <v-card-subtitle>{{ classLabel }}</v-card-subtitle>
    <v-card-text>
      <v-alert
        v-if="stage?.status === StageStatus.ACTIVE"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        Provisional: this stage is still running. Cars still on stage aren't
        listed yet, and DNF/DNS are only set when it closes.
      </v-alert>
      <v-alert
        v-else-if="stage?.status === StageStatus.NOT_STARTED"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        This stage hasn't started yet.
      </v-alert>
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
    <v-card-subtitle>{{ classLabel }}</v-card-subtitle>
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
