<script setup lang="ts">
import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  fetchStageResults,
  type OverallPlacing,
  type StageResults,
} from '../api/classification';
import { fetchEntryClasses, type EntryClass } from '../api/entry-classes';
import { closeLiveStream, openLiveStream } from '../api/live';
import { fetchStageRuns, type StageRun } from '../api/stage-runs';
import { fetchStages, type Stage } from '../api/stages';
import { fetchStartOrder, type StartOrder } from '../api/start-order';
import { classFilterLabel, useClassQuery } from '../class-query';
import CarName from '../components/CarName.vue';
import ClassFilter from '../components/ClassFilter.vue';
import CrewName from '../components/CrewName.vue';
import OverallRanking from '../components/OverallRanking.vue';
import RunningTime from '../components/RunningTime.vue';
import StagePicker from '../components/StagePicker.vue';
import StageRanking from '../components/StageRanking.vue';
import StartNumber from '../components/StartNumber.vue';
import StatusChip from '../components/StatusChip.vue';
import { formatDuration, runStatusColor } from '../format';

/**
 * What anyone on the Wi-Fi sees without a login (`docs/auth.md` "Who sees
 * what"): start lists with each car's state, results, penalties as a sum.
 * Only public reads and the stream's public events.
 */
const props = defineProps<{ stageId?: string }>();
const route = useRoute();
const router = useRouter();

const stages = ref<Stage[]>([]);
const classes = ref<EntryClass[]>([]);
const selectedClassIds = useClassQuery();
const startOrder = ref<StartOrder | null>(null);
const stageRuns = ref<StageRun[]>([]);
const stageResults = ref<StageResults | null>(null);
const overall = ref<OverallPlacing[] | null>(null);
let liveSource: EventSource;

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

const STATE_DISPLAY = {
  waiting: {
    get label() {
      return t('rowState.waiting');
    },
    color: 'timing-idle',
    icon: 'mdi-clock-outline',
  },
  [StageRunStatus.STARTED]: {
    get label() {
      return t('runState.onStage');
    },
    color: runStatusColor(StageRunStatus.STARTED),
    icon: 'mdi-car-sports',
  },
  [StageRunStatus.FINISHED]: {
    get label() {
      return t('rowState.finished');
    },
    color: runStatusColor(StageRunStatus.FINISHED),
    icon: 'mdi-flag-checkered',
  },
  [StageRunStatus.CANCELLED]: {
    get label() {
      return t('rowState.dnf');
    },
    color: runStatusColor(StageRunStatus.CANCELLED),
    icon: 'mdi-close',
  },
  dns: {
    get label() {
      return t('rowState.dns');
    },
    color: 'warning',
    icon: 'mdi-minus-circle-outline',
  },
};

/** The start list with each car's attempt that counts. */
const rows = computed(() =>
  (startOrder.value?.starters ?? []).map((starter) => {
    const run = stageRuns.value.find(
      (r) => r.entryId === starter.entryId && !r.voided,
    );
    const state =
      run?.status === StageRunStatus.STARTED ||
      run?.status === StageRunStatus.FINISHED ||
      run?.status === StageRunStatus.CANCELLED
        ? run.status
        : stage.value?.status === StageStatus.CLOSED
          ? 'dns'
          : 'waiting';
    return { starter, run, display: STATE_DISPLAY[state] };
  }),
);

async function refresh() {
  stages.value = await fetchStages();
  const stageId = props.stageId;
  if (!stageId) {
    overall.value = await fetchOverallClassification(selectedClassIds.value);
    return;
  }
  [startOrder.value, stageRuns.value, stageResults.value] = await Promise.all([
    fetchStartOrder(stageId),
    fetchStageRuns(stageId),
    fetchStageResults(stageId, selectedClassIds.value),
  ]);
}

watch(() => [props.stageId, route.query.classes], refresh);

onMounted(async () => {
  classes.value = await fetchEntryClasses();
  // Small data: any change refetches the view rather than patching it. The
  // first load is `onOpen`'s.
  liveSource = openLiveStream(
    {
      'stage-run': () => void refresh(),
      'stage-run-split': () => void refresh(),
    },
    () => void refresh(),
  );
});

onUnmounted(() => closeLiveStream(liveSource));

const go = (stageId?: string) =>
  router.push({ path: `/public/${stageId ?? ''}`, query: route.query });
</script>

<template>
  <StagePicker
    class="mb-4"
    :stages="stages"
    :model-value="stageId"
    overall
    @update:model-value="go"
    @overall="go()"
  />
  <div class="d-flex flex-wrap align-center ga-4 mb-6">
    <ClassFilter v-model="selectedClassIds" :classes="classes" />
  </div>

  <template v-if="stageId">
    <v-card v-if="stage && startOrder" class="mb-6">
      <v-card-item>
        <v-card-title>
          {{ $t('live.startList') }} — {{ stage.id }} · {{ stage.name }}
        </v-card-title>
      </v-card-item>
      <v-card-text>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th style="width: 56px">{{ $t('table.pos') }}</th>
              <th style="width: 72px">#</th>
              <th>{{ $t('table.crew') }}</th>
              <th>{{ $t('table.car') }}</th>
              <th>{{ $t('table.status') }}</th>
              <th class="rg-time">{{ $t('table.time') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.starter.entryId">
              <td>{{ row.starter.position }}</td>
              <td><StartNumber :number="row.starter.startNumber" /></td>
              <td><CrewName :crew="row.starter" /></td>
              <td><CarName :car="row.starter" /></td>
              <td><StatusChip :display="row.display" /></td>
              <td class="rg-timing rg-time">
                <RunningTime
                  v-if="row.run?.status === StageRunStatus.STARTED"
                  :start-time="row.run.startTime"
                />
                <template v-else-if="row.run">{{
                  formatDuration(row.run.durationMs)
                }}</template>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
    <v-card v-if="stageResults">
      <v-card-item>
        <v-card-title>{{ $t('results.stageTitle') }}</v-card-title>
        <v-card-subtitle>
          {{ classFilterLabel(classes, selectedClassIds) }}
        </v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <StageRanking :stage="stage" :results="stageResults" public-view />
      </v-card-text>
    </v-card>
  </template>
  <v-card v-else-if="overall">
    <v-card-item>
      <v-card-title>{{ $t('results.overallTitle') }}</v-card-title>
      <v-card-subtitle>
        {{ classFilterLabel(classes, selectedClassIds) }}
      </v-card-subtitle>
    </v-card-item>
    <v-card-text>
      <OverallRanking
        :placings="overall"
        :class-ids="selectedClassIds"
        :stages="stages"
        :entries="[]"
        public-view
      />
    </v-card-text>
  </v-card>
</template>
