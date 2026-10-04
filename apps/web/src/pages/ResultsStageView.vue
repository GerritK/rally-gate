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
import { rallyName } from '../api/rally-info';
import TableLegend from '../components/TableLegend.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import {
  formatDuration,
  formatGap,
  outcomeColor,
  TIMING_MARKS,
  type TimingMark,
} from '../format';
import { usePrint } from '../print';

const props = defineProps<{ stageId: string }>();
const route = useRoute();
const router = useRouter();

const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const selectedClassIds = useClassQuery();
const stageClassification = ref<ClassificationEntry[]>([]);
const splitGates = ref<SplitGateInfo[]>([]);
/** Per split gate (same order), each vehicle's split time and rank. While
 * the stage runs, the rank includes cars still on stage; once it closes, a
 * DNF's splits drop out server-side. */
const splitsByGate = ref<Map<string, SplitClassificationEntry>[]>([]);
const nonFinishers = ref<StageOutcomeEntry[]>([]);

async function refreshClassification() {
  if (!props.stageId) return;
  const [classification, outcomes, gates] = await Promise.all([
    fetchStageClassification(props.stageId, selectedClassIds.value),
    fetchNonFinishers(props.stageId, selectedClassIds.value),
    fetchSplitGatesForStage(props.stageId),
  ]);
  const splits = await Promise.all(
    gates.map((g) =>
      fetchSplitClassification(
        props.stageId,
        g.splitIndex,
        selectedClassIds.value,
      ),
    ),
  );
  stageClassification.value = classification;
  nonFinishers.value = outcomes;
  splitGates.value = gates;
  splitsByGate.value = splits.map(
    (entries) => new Map(entries.map((e) => [e.vehicleId, e])),
  );
}

watch(() => props.stageId, refreshClassification);
watch(() => route.query.classes, refreshClassification);

onMounted(async () => {
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
  await refreshClassification();
});

const classLabel = computed(() =>
  classFilterLabel(classes.value, selectedClassIds.value),
);

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

const legendMarks = computed<TimingMark[]>(() =>
  stageClassification.value.some((entry) =>
    splitsByGate.value.some(
      (splits) => splits.get(entry.vehicleId)?.gapMs === 0,
    ),
  )
    ? ['best']
    : [],
);

// Past two split columns the table no longer fits a portrait page.
const { printedAt, print } = usePrint(
  computed(() => splitGates.value.length > 2),
);

function onStageChange(stageId: string) {
  router.push({ path: `/results/stages/${stageId}`, query: route.query });
}
</script>

<template>
  <StagePicker
    class="mb-4 d-print-none"
    :stages="stages"
    :model-value="stageId"
    overall
    @update:model-value="onStageChange"
    @overall="router.push({ path: '/results/overall', query: route.query })"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6 d-print-none">
    <ClassFilter v-model="selectedClassIds" :classes="classes" />
  </div>

  <v-card>
    <v-card-item>
      <v-card-title>
        Stage Classification
        <template v-if="stage"> — {{ stage.id }} · {{ stage.name }}</template>
        <span
          v-if="stage?.status === StageStatus.ACTIVE"
          class="d-none d-print-inline"
        >
          (Provisional)
        </span>
      </v-card-title>
      <v-card-subtitle>
        <span v-if="rallyName" class="d-none d-print-inline"
          >{{ rallyName }} ·
        </span>
        {{ classLabel }}
        <span class="d-none d-print-inline"> · Printed {{ printedAt }}</span>
      </v-card-subtitle>
      <template #append>
        <v-btn
          variant="tonal"
          prepend-icon="mdi-printer"
          class="d-print-none"
          @click="print"
        >
          Print
        </v-btn>
      </template>
    </v-card-item>
    <v-card-text>
      <v-alert
        v-if="stage?.status === StageStatus.ACTIVE"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4 d-print-none"
      >
        Provisional: this stage is still running. Cars still on stage aren't
        listed yet, and DNF/DNS are only set when it closes.
      </v-alert>
      <v-alert
        v-else-if="stage?.status === StageStatus.NOT_STARTED"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4 d-print-none"
      >
        This stage hasn't started yet.
      </v-alert>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Crew</th>
            <th v-for="gate in splitGates" :key="gate.gateId" class="rg-time">
              Split {{ gate.splitIndex }}
            </th>
            <th class="rg-time">Time</th>
            <th class="rg-time">Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in stageClassification"
            :key="entry.vehicleId"
            class="cursor-pointer"
            @click="router.push(`/vehicles/${entry.vehicleId}`)"
          >
            <td>{{ entry.position }}</td>
            <td><StartNumber :number="entry.startNumber" /></td>
            <td><CrewName :crew="entry" /></td>
            <td
              v-for="(splits, i) in splitsByGate"
              :key="splitGates[i].gateId"
              class="rg-timing rg-time text-no-wrap"
            >
              <template v-if="splits.get(entry.vehicleId)">
                <span
                  v-tooltip:top="
                    splits.get(entry.vehicleId)!.gapMs === 0
                      ? ''
                      : `${formatGap(splits.get(entry.vehicleId)!.gapMs)} to the fastest`
                  "
                  :class="{
                    'text-timing-best font-weight-bold':
                      splits.get(entry.vehicleId)!.gapMs === 0,
                  }"
                >
                  {{ formatDuration(splits.get(entry.vehicleId)!.elapsedMs) }}
                </span>
                <span class="rg-time-mark"
                  ><v-icon
                    v-if="splits.get(entry.vehicleId)!.gapMs === 0"
                    size="x-small"
                    :icon="TIMING_MARKS.best.icon"
                    :color="TIMING_MARKS.best.color" /></span
                ><span class="text-medium-emphasis"
                  >({{ splits.get(entry.vehicleId)!.position }})</span
                >
              </template>
              <template v-else>-</template>
            </td>
            <td class="rg-timing rg-time">
              {{ formatDuration(entry.durationMs) }}
            </td>
            <td class="rg-timing rg-time">{{ formatGap(entry.gapMs) }}</td>
          </tr>
          <tr v-if="stageClassification.length === 0">
            <td :colspan="5 + splitGates.length" class="rg-empty">
              Nobody has finished this stage yet.
            </td>
          </tr>
        </tbody>
      </v-table>
      <TableLegend :marks="legendMarks" />

      <v-table
        v-if="nonFinishers.length > 0"
        density="comfortable"
        class="mt-4"
      >
        <thead>
          <tr>
            <th>#</th>
            <th>Crew</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in nonFinishers"
            :key="entry.vehicleId"
            class="cursor-pointer"
            @click="router.push(`/vehicles/${entry.vehicleId}`)"
          >
            <td><StartNumber :number="entry.startNumber" /></td>
            <td><CrewName :crew="entry" /></td>
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
</template>
