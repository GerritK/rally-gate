<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { StageResults } from '../api/classification';
import { StageStatus } from '@rally-gate/shared';
import type { Stage } from '../api/stages';
import TableLegend from './TableLegend.vue';
import CrewName from './CrewName.vue';
import ResultsPodium from './ResultsPodium.vue';
import StartNumber from './StartNumber.vue';
import {
  formatDuration,
  formatGap,
  outcomeColor,
  TIMING_MARKS,
  type TimingMark,
} from '../format';

const props = defineProps<{
  stage: Stage | undefined;
  results: StageResults;
}>();

const router = useRouter();

const legendMarks = computed<TimingMark[]>(() =>
  props.results.classification.some((placing) =>
    props.results.splitsByGate.some(
      (splits) => splits.get(placing.entryId)?.gapMs === 0,
    ),
  )
    ? ['best']
    : [],
);
</script>

<template>
  <div>
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
    <ResultsPodium :placings="results.classification" />
    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Pos</th>
          <th>#</th>
          <th>Crew</th>
          <th
            v-for="gate in results.splitGates"
            :key="gate.gateId"
            class="rg-time"
          >
            Split {{ gate.splitIndex }}
          </th>
          <th class="rg-time">Time</th>
          <th class="rg-time">Gap</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="placing in results.classification"
          :key="placing.entryId"
          class="cursor-pointer"
          @click="router.push(`/entries/${placing.entryId}`)"
        >
          <td>{{ placing.position }}</td>
          <td><StartNumber :number="placing.startNumber" /></td>
          <td><CrewName :crew="placing" /></td>
          <td
            v-for="(splits, i) in results.splitsByGate"
            :key="results.splitGates[i].gateId"
            class="rg-timing rg-time text-no-wrap"
          >
            <template v-if="splits.get(placing.entryId)">
              <span
                v-tooltip:top="
                  splits.get(placing.entryId)!.gapMs === 0
                    ? ''
                    : `${formatGap(splits.get(placing.entryId)!.gapMs)} to the fastest`
                "
                :class="{
                  'text-timing-best font-weight-bold':
                    splits.get(placing.entryId)!.gapMs === 0,
                }"
              >
                {{ formatDuration(splits.get(placing.entryId)!.elapsedMs) }}
              </span>
              <span class="rg-time-mark"
                ><v-icon
                  v-if="splits.get(placing.entryId)!.gapMs === 0"
                  size="x-small"
                  :icon="TIMING_MARKS.best.icon"
                  :color="TIMING_MARKS.best.color" /></span
              ><span class="text-medium-emphasis"
                >({{ splits.get(placing.entryId)!.position }})</span
              >
            </template>
            <template v-else>-</template>
          </td>
          <td class="rg-timing rg-time">
            {{ formatDuration(placing.durationMs) }}
          </td>
          <td class="rg-timing rg-time">{{ formatGap(placing.gapMs) }}</td>
        </tr>
        <tr v-if="results.classification.length === 0">
          <td :colspan="5 + results.splitGates.length" class="rg-empty">
            Nobody has finished this stage yet.
          </td>
        </tr>
      </tbody>
      <tfoot v-if="legendMarks.length > 0">
        <tr>
          <td :colspan="5 + results.splitGates.length">
            <TableLegend :marks="legendMarks" />
          </td>
        </tr>
      </tfoot>
    </v-table>

    <v-table
      v-if="results.nonFinishers.length > 0"
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
          v-for="row in results.nonFinishers"
          :key="row.entryId"
          class="cursor-pointer"
          @click="router.push(`/entries/${row.entryId}`)"
        >
          <td><StartNumber :number="row.startNumber" /></td>
          <td><CrewName :crew="row" /></td>
          <td>
            <v-chip size="small" :color="outcomeColor(row.outcome)">
              {{ row.outcome }}
            </v-chip>
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>
