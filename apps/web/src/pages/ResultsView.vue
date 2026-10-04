<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  fetchStageResults,
  type OverallClassificationEntry,
  type StageResults,
} from '../api/classification';
import { StageStatus } from '@rally-gate/shared';
import {
  classFilterLabel,
  rankingClassIds,
  useClassQuery,
} from '../class-query';
import ClassFilter from '../components/ClassFilter.vue';
import StagePicker from '../components/StagePicker.vue';
import OverallRanking from '../components/OverallRanking.vue';
import StageRanking from '../components/StageRanking.vue';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { rallyName } from '../api/rally-info';
import { notifyError } from '@rally-gate/ui';
import { openPdf, overallPdf, stagePdf } from '../pdf';

/** Without a stage, the overall. */
const props = defineProps<{ stageId?: string }>();
const route = useRoute();
const router = useRouter();

/** One ranking as the card shows it: either the overall or a stage's. */
interface Ranking {
  classIds: string[];
  overall?: OverallClassificationEntry[];
  stage?: StageResults;
}

const stages = ref<Stage[]>([]);
const classes = ref<VehicleClass[]>([]);
const vehicles = ref<Vehicle[]>([]);
const selectedClassIds = useClassQuery();
const current = ref<Ranking | null>(null);
const printing = ref(false);

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

const heading = computed(() => {
  if (!props.stageId) return 'Overall Classification';
  const s = stage.value;
  return [
    'Stage Classification',
    s && ` — ${s.id} · ${s.name}`,
    s?.status === StageStatus.ACTIVE && ' (Provisional)',
  ]
    .filter(Boolean)
    .join('');
});

async function loadRanking(classIds: string[]): Promise<Ranking> {
  return props.stageId
    ? { classIds, stage: await fetchStageResults(props.stageId, classIds) }
    : { classIds, overall: await fetchOverallClassification(classIds) };
}

/** The ranking shown, or "Print all": All classes, then each class. */
async function print(all: boolean) {
  // Opened by the click itself: one opened after an await is a popup.
  const tab = window.open('', '_blank');
  printing.value = true;
  try {
    const rankings = await Promise.all(
      (all
        ? rankingClassIds(classes.value, vehicles.value)
        : [selectedClassIds.value]
      ).map(loadRanking),
    );
    const label = (r: Ranking) => classFilterLabel(classes.value, r.classIds);
    await openPdf(
      rankings.map((r) =>
        r.stage
          ? stagePdf(heading.value, label(r), r.stage)
          : overallPdf(
              heading.value,
              label(r),
              r.overall ?? [],
              vehicles.value,
              r.classIds,
            ),
      ),
      [
        rallyName.value,
        props.stageId ?? 'Overall',
        all ? 'All rankings' : label(rankings[0]),
      ]
        .filter(Boolean)
        .join(' - '),
      tab,
    );
  } catch (err) {
    tab?.close();
    notifyError(err);
  } finally {
    printing.value = false;
  }
}

async function refresh() {
  current.value = await loadRanking(selectedClassIds.value);
}

watch(() => [props.stageId, route.query.classes], refresh);

onMounted(async () => {
  await refresh();
  stages.value = await fetchStages();
  classes.value = await fetchVehicleClasses();
  vehicles.value = await fetchVehicles();
});

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

  <v-card v-if="current">
    <v-card-item>
      <v-card-title>{{ heading }}</v-card-title>
      <v-card-subtitle>
        {{ classFilterLabel(classes, current.classIds) }}
      </v-card-subtitle>
      <template #append>
        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn
            v-if="classes.length > 0"
            v-tooltip:top="
              'A PDF: All classes, then each class on its own sheets'
            "
            variant="tonal"
            prepend-icon="mdi-file-document-multiple"
            :loading="printing"
            @click="print(true)"
          >
            Print all
          </v-btn>
          <v-btn
            v-tooltip:top="'A PDF of this ranking, to print or share'"
            variant="tonal"
            prepend-icon="mdi-printer"
            :loading="printing"
            @click="print(false)"
          >
            Print
          </v-btn>
        </div>
      </template>
    </v-card-item>
    <v-card-text>
      <StageRanking
        v-if="current.stage"
        :stage="stage"
        :results="current.stage"
      />
      <OverallRanking
        v-else
        :entries="current.overall ?? []"
        :class-ids="current.classIds"
        :stages="stages"
        :vehicles="vehicles"
      />
    </v-card-text>
  </v-card>
</template>
