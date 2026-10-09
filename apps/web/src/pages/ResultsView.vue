<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  fetchStageResults,
  type OverallPlacing,
  type StageResults,
} from '../api/classification';
import { StageStatus } from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
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
import { fetchEntryClasses, type EntryClass } from '../api/entry-classes';
import { fetchEntries, type Entry } from '../api/entries';
import { rallyName } from '../api/rally-info';
import { overallPdf, printPdf, stagePdf } from '../pdf';

/** Without a stage, the overall. */
const props = defineProps<{ stageId?: string }>();
const route = useRoute();
const router = useRouter();

/** One ranking as the card shows it: either the overall or a stage's. */
interface Ranking {
  classIds: string[];
  overall?: OverallPlacing[];
  stage?: StageResults;
}

const stages = ref<Stage[]>([]);
const classes = ref<EntryClass[]>([]);
const entries = ref<Entry[]>([]);
const selectedClassIds = useClassQuery();
const current = ref<Ranking | null>(null);
const printing = ref(false);

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

const heading = computed(() => {
  if (!props.stageId) return t('results.overallTitle');
  const s = stage.value;
  return [
    t('results.stageTitle'),
    s && ` — ${s.id} · ${s.name}`,
    s?.status === StageStatus.ACTIVE && ` (${t('pdf.provisional')})`,
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
  printing.value = true;
  await printPdf(async () => {
    const rankings = await Promise.all(
      (all
        ? rankingClassIds(classes.value, entries.value)
        : [selectedClassIds.value]
      ).map(loadRanking),
    );
    const label = (r: Ranking) => classFilterLabel(classes.value, r.classIds);
    return {
      sections: rankings.map((r) =>
        r.stage
          ? stagePdf(heading.value, label(r), r.stage)
          : overallPdf(
              heading.value,
              label(r),
              r.overall ?? [],
              entries.value,
              r.classIds,
            ),
      ),
      fileName: [
        rallyName.value,
        props.stageId ?? t('results.overall'),
        all ? t('results.allRankings') : label(rankings[0]),
      ]
        .filter(Boolean)
        .join(' - '),
    };
  });
  printing.value = false;
}

async function refresh() {
  current.value = await loadRanking(selectedClassIds.value);
}

watch(() => [props.stageId, route.query.classes], refresh);

onMounted(async () => {
  [, stages.value, classes.value, entries.value] = await Promise.all([
    refresh(),
    fetchStages(),
    fetchEntryClasses(),
    fetchEntries(),
  ]);
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
            v-tooltip:top="$t('results.printAllHint')"
            variant="tonal"
            prepend-icon="mdi-file-document-multiple"
            :loading="printing"
            @click="print(true)"
          >
            {{ $t('results.printAll') }}
          </v-btn>
          <v-btn
            v-tooltip:top="$t('results.printHint')"
            variant="tonal"
            prepend-icon="mdi-printer"
            :loading="printing"
            @click="print(false)"
          >
            {{ $t('results.print') }}
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
        :placings="current.overall ?? []"
        :class-ids="current.classIds"
        :stages="stages"
        :entries="entries"
      />
    </v-card-text>
  </v-card>
</template>
