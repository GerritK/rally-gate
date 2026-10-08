<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  fastestByStage,
  notClassified as unranked,
  type OverallPlacing,
} from '../api/classification';
import { StageStatus, type OverallStageTime } from '@rally-gate/shared';
import type { Stage } from '../api/stages';
import type { Entry } from '../api/entries';
import TableLegend from './TableLegend.vue';
import CarName from './CarName.vue';
import CrewName from './CrewName.vue';
import ResultsPodium from './ResultsPodium.vue';
import StartNumber from './StartNumber.vue';
import {
  formatDuration,
  formatGap,
  TIMING_MARKS,
  type TimingMark,
  ENTRY_STATUS_DISPLAY,
} from '../format';

const props = defineProps<{
  /** The overall as fetched for `classIds`. */
  placings: OverallPlacing[];
  classIds: string[];
  stages: Stage[];
  entries: Entry[];
}>();

const route = useRoute();
const router = useRouter();

/** Stages counted toward the overall — every closed stage that anyone
 * finished. A crew below this has notional time inside its total. */
const stagesCounted = computed(() =>
  Math.max(0, ...props.placings.map((e) => e.stagesCompleted)),
);

// Every placing carries the same counted stages, in stage order.
const countedStages = computed(() =>
  (props.placings[0]?.stageTimes ?? []).map(({ stageId }) => ({
    id: stageId,
    name: props.stages.find((s) => s.id === stageId)?.name,
  })),
);

const bestByStage = computed(() => fastestByStage(props.placings));

const legendMarks = computed<TimingMark[]>(() => {
  const times = props.placings.flatMap((e) => e.stageTimes);
  return [
    ...(times.some((t) => !t.notional) ? (['best'] as const) : []),
    ...(times.some((t) => t.notional) ? (['notional'] as const) : []),
  ];
});

function stageGapMs(time: OverallStageTime): number {
  return time.durationMs - (bestByStage.value.get(time.stageId) ?? 0);
}

const notClassified = computed(() =>
  unranked(props.placings, props.entries, props.classIds),
);

/** Not in the overall at all until they close (only closed stages count). */
const runningStages = computed(() =>
  props.stages.filter((s) => s.status === StageStatus.ACTIVE),
);
</script>

<template>
  <div>
    <v-alert
      v-if="runningStages.length > 0"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ runningStages.map((s) => `${s.id} · ${s.name}`).join(', ') }}
      {{ runningStages.length === 1 ? 'is' : 'are' }} still running and not
      counted yet. The standings change when
      {{ runningStages.length === 1 ? 'it closes' : 'they close' }}.
    </v-alert>
    <ResultsPodium :placings="placings" />
    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Pos</th>
          <th>#</th>
          <th>Crew</th>
          <th>Car</th>
          <th v-for="stage in countedStages" :key="stage.id" class="rg-time">
            <router-link
              :to="{
                path: `/results/stages/${stage.id}`,
                query: route.query,
              }"
              class="rg-link"
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
        <tr
          v-for="placing in placings"
          :key="placing.entryId"
          class="cursor-pointer"
          @click="router.push(`/entries/${placing.entryId}`)"
        >
          <td>{{ placing.position }}</td>
          <td><StartNumber :number="placing.startNumber" /></td>
          <td><CrewName :crew="placing" /></td>
          <td><CarName :car="placing" /></td>
          <td
            v-for="time in placing.stageTimes"
            :key="time.stageId"
            class="rg-timing rg-time text-no-wrap"
          >
            <span
              v-if="time.notional"
              v-tooltip:top="`${formatGap(stageGapMs(time))} to the fastest`"
              class="text-medium-emphasis"
            >
              {{ formatDuration(time.durationMs)
              }}<span class="rg-time-mark"
                ><v-icon size="x-small" :icon="TIMING_MARKS.notional.icon"
              /></span>
            </span>
            <span
              v-else-if="stageGapMs(time) === 0"
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
              {{ formatDuration(time.durationMs) }}<span class="rg-time-mark" />
            </span>
          </td>
          <td class="rg-timing rg-time font-weight-bold">
            {{ formatDuration(placing.durationMs) }}
          </td>
          <td class="rg-timing rg-time">{{ formatGap(placing.gapMs) }}</td>
          <td>
            <span
              v-if="placing.stagesCompleted < stagesCounted"
              class="text-medium-emphasis"
            >
              {{ placing.stagesCompleted }}
              <v-icon size="x-small" :icon="TIMING_MARKS.notional.icon" />
            </span>
            <span v-else>{{ placing.stagesCompleted }}</span>
          </td>
        </tr>
        <tr v-if="placings.length === 0">
          <td :colspan="7 + countedStages.length" class="rg-empty">
            No crew has completed a closed stage yet.
          </td>
        </tr>
      </tbody>
      <tfoot v-if="legendMarks.length > 0">
        <tr>
          <td :colspan="7 + countedStages.length">
            <TableLegend :marks="legendMarks" />
          </td>
        </tr>
      </tfoot>
    </v-table>

    <template v-if="notClassified.length > 0">
      <div class="text-subtitle-2 mt-6 mb-1">Not classified</div>
      <div class="text-caption text-medium-emphasis mb-2">
        No completed stage that counts yet, withdrawn or disqualified.
      </div>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>#</th>
            <th>Crew</th>
            <th>Car</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in notClassified"
            :key="entry.id"
            class="cursor-pointer"
            @click="router.push(`/entries/${entry.id}`)"
          >
            <td><StartNumber :number="entry.startNumber" /></td>
            <td><CrewName :crew="entry" /></td>
            <td><CarName :car="entry" /></td>
            <td>
              <v-chip
                size="small"
                :color="ENTRY_STATUS_DISPLAY[entry.status].color"
                :prepend-icon="ENTRY_STATUS_DISPLAY[entry.status].icon"
              >
                {{ ENTRY_STATUS_DISPLAY[entry.status].label }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </div>
</template>
