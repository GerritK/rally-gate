<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  type OverallClassificationEntry,
} from '../api/classification';
import type { OverallStageTime } from '@rally-gate/shared';
import { classFilterLabel, useClassQuery } from '../class-query';
import ClassFilter from '../components/ClassFilter.vue';
import StagePicker from '../components/StagePicker.vue';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { StageStatus } from '@rally-gate/shared';
import { rallyName } from '../api/rally-info';
import TableLegend from '../components/TableLegend.vue';
import {
  formatDuration,
  formatGap,
  TIMING_MARKS,
  type TimingMark,
  VEHICLE_STATUS_DISPLAY,
} from '../format';
import { usePrint } from '../print';

const route = useRoute();
const router = useRouter();
const overallClassification = ref<OverallClassificationEntry[]>([]);
const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const vehicles = ref<Vehicle[]>([]);
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

/** Fastest real time per counted stage, within this ranking. A notional is
 * slower than every real time by construction, so it never is one. */
const bestByStage = computed(() => {
  const best = new Map<string, number>();
  for (const entry of overallClassification.value) {
    for (const t of entry.stageTimes) {
      if (!t.notional && t.durationMs < (best.get(t.stageId) ?? Infinity)) {
        best.set(t.stageId, t.durationMs);
      }
    }
  }
  return best;
});

const legendMarks = computed<TimingMark[]>(() => {
  const times = overallClassification.value.flatMap((e) => e.stageTimes);
  return [
    ...(times.some((t) => !t.notional) ? (['best'] as const) : []),
    ...(times.some((t) => t.notional) ? (['notional'] as const) : []),
  ];
});

function stageGapMs(time: OverallStageTime): number {
  return time.durationMs - (bestByStage.value.get(time.stageId) ?? 0);
}

// No completed closed stage yet. Listed without a total: one made of
// notionals alone is what event-model.md "Notional times" rules out.
const notClassified = computed(() => {
  const ranked = new Set(overallClassification.value.map((e) => e.vehicleId));
  return vehicles.value
    .filter(
      (v) =>
        !ranked.has(v.id) &&
        selectedClassIds.value.every((id) =>
          v.classes.some((c) => c.id === id),
        ),
    )
    .sort((a, b) => a.startNumber - b.startNumber);
});

/** Not in the overall at all until they close (only closed stages count). */
const runningStages = computed(() =>
  stages.value.filter((s) => s.status === StageStatus.ACTIVE),
);

const classLabel = computed(() =>
  classFilterLabel(classes.value, selectedClassIds.value),
);

// Past three stage columns the table no longer fits a portrait page.
const { printedAt, print } = usePrint(
  computed(() => countedStages.value.length > 3),
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
  vehicles.value = await fetchVehicles();
});
</script>

<template>
  <StagePicker
    class="mb-4 d-print-none"
    :stages="stages"
    overall
    @update:model-value="goToStage"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6 d-print-none">
    <ClassFilter v-model="selectedClassIds" :classes="classes" />
  </div>

  <v-card>
    <v-card-item>
      <v-card-title>Overall Classification</v-card-title>
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
        v-if="runningStages.length > 0"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-4 d-print-none"
      >
        {{ runningStages.map((s) => `${s.id} · ${s.name}`).join(', ') }}
        {{ runningStages.length === 1 ? 'is' : 'are' }} still running and not
        counted yet. The standings change when
        {{ runningStages.length === 1 ? 'it closes' : 'they close' }}.
      </v-alert>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Pos</th>
            <th>#</th>
            <th>Driver</th>
            <th>Co-Driver</th>
            <th v-for="stage in countedStages" :key="stage.id" class="rg-time">
              <router-link
                :to="{
                  path: `/results/stages/${stage.id}`,
                  query: route.query,
                }"
                class="rg-stage-link"
              >
                {{ stage.id }} </router-link
              ><span class="rg-time-mark" />
            </th>
            <th class="rg-time">Total Time</th>
            <th class="rg-time">Gap</th>
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
              class="rg-timing rg-time text-no-wrap"
            >
              <span
                v-if="time.notional"
                v-tooltip:top="
                  `Notional time, ${formatGap(stageGapMs(time))} to the fastest: stage not completed, charged the slowest time plus a penalty.`
                "
                class="text-medium-emphasis"
              >
                {{ formatDuration(time.durationMs)
                }}<span class="rg-time-mark"
                  ><v-icon size="x-small" :icon="TIMING_MARKS.notional.icon"
                /></span>
              </span>
              <span
                v-else-if="stageGapMs(time) === 0"
                v-tooltip:top="'Fastest on this stage'"
                class="text-timing-best font-weight-bold"
              >
                {{ formatDuration(time.durationMs)
                }}<span class="rg-time-mark"
                  ><v-icon size="x-small" :icon="TIMING_MARKS.best.icon"
                /></span>
              </span>
              <span
                v-else
                v-tooltip:top="`${formatGap(stageGapMs(time))} to the fastest`"
              >
                {{ formatDuration(time.durationMs)
                }}<span class="rg-time-mark" />
              </span>
            </td>
            <td class="rg-timing rg-time font-weight-bold">
              {{ formatDuration(entry.durationMs) }}
            </td>
            <td class="rg-timing rg-time">{{ formatGap(entry.gapMs) }}</td>
            <td>
              <v-tooltip
                v-if="entry.stagesCompleted < stagesCounted"
                :text="`Did not complete ${stagesCounted - entry.stagesCompleted} of ${stagesCounted} stages — a notional time is included in this total.`"
                location="top"
              >
                <template #activator="{ props }">
                  <span v-bind="props" class="text-medium-emphasis">
                    {{ entry.stagesCompleted }}
                    <v-icon size="x-small" :icon="TIMING_MARKS.notional.icon" />
                  </span>
                </template>
              </v-tooltip>
              <span v-else>{{ entry.stagesCompleted }}</span>
            </td>
          </tr>
          <tr v-if="overallClassification.length === 0">
            <td colspan="7" class="rg-empty">
              No crew has completed a closed stage yet.
            </td>
          </tr>
        </tbody>
      </v-table>
      <TableLegend :marks="legendMarks" />

      <template v-if="notClassified.length > 0">
        <div class="text-subtitle-2 mt-6 mb-1">Not classified</div>
        <div class="text-caption text-medium-emphasis mb-2">
          No completed stage that counts yet.
        </div>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>#</th>
              <th>Driver</th>
              <th>Co-Driver</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="vehicle in notClassified" :key="vehicle.id">
              <td>{{ vehicle.startNumber }}</td>
              <td>{{ vehicle.driverName }}</td>
              <td>{{ vehicle.coDriverName ?? '-' }}</td>
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
          </tbody>
        </v-table>
      </template>
    </v-card-text>
  </v-card>
</template>

<style scoped>
/* A header, not a body link: same look until hovered. */
.rg-stage-link {
  color: inherit;
  text-decoration: none;
}
.rg-stage-link:hover {
  text-decoration: underline;
}
</style>
