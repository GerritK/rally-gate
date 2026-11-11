<script setup lang="ts">
import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import { formatStageDuration } from '@rally-gate/ui';
import { can } from '../api/auth';
import type { DetectionEventRecord } from '../api/events';
import type { StageRun } from '../api/stage-runs';
import type { Stage } from '../api/stages';
import { serverNow } from '../api/time';
import { formatDuration, formatGap, runStatusColor } from '../format';
import { isOverdue, type OnStageCar } from '../live-rows';
import CrewName from './CrewName.vue';
import JumpStartChip from './JumpStartChip.vue';
import PassingBlock from './PassingBlock.vue';
import RunningTime from './RunningTime.vue';
import StartNumber from './StartNumber.vue';

/** Live timing's On stage card: the running cars in the order they should
 *  reach the next gate, above them the passings waiting for a marshal. */
defineProps<{
  stage: Stage;
  cars: OnStageCar[];
  /** Unidentified passings of this stage, oldest first. */
  passings: DetectionEventRecord[];
  splitIndices: number[];
  jumpStartToleranceMs: number;
  finishingRunId: string | null;
  canDnfDns: boolean;
  gateRole: (gateId: string) => string | undefined;
  gateName: (gateId: string) => string;
  /** Picked by hand, else suggested. */
  entryFor: (event: DetectionEventRecord) => string | undefined;
  entryOptionsFor: (
    event: DetectionEventRecord,
  ) => { id: string; title: string }[];
  suggestsJumpPenalty: (run: StageRun) => boolean;
}>();
const emit = defineEmits<{
  pick: [eventId: string, entryId: string];
  assign: [event: DetectionEventRecord];
  dismiss: [event: DetectionEventRecord];
  dismissAll: [events: DetectionEventRecord[]];
  finishNow: [run: StageRun];
  markDnf: [run: StageRun];
  jumpPenalty: [run: StageRun];
  dismissJumpStart: [run: StageRun];
}>();
</script>

<template>
  <v-card>
    <v-card-item>
      <v-card-title class="d-flex align-center ga-2">
        {{ $t('runState.onStage') }}
        <v-chip size="small" :color="runStatusColor(StageRunStatus.STARTED)">
          {{ cars.length }}
        </v-chip>
      </v-card-title>
      <v-card-subtitle>{{ $t('live.expectedOrder') }}</v-card-subtitle>
    </v-card-item>
    <!-- Every unidentified passing, a start included: a car that crossed
             the start line is on stage, and Up next stays still while the
             start marshal aims at Start now. -->
    <v-card-text v-if="passings.length > 0" class="pb-0">
      <PassingBlock
        v-for="[event, ...queued] in [passings]"
        :key="event.eventId"
        :passing="event"
        :queued="queued"
        :role="gateRole(event.gateId)"
        :gate-name="gateName(event.gateId)"
        :entry-id="entryFor(event)"
        :entry-options="entryOptionsFor(event)"
        :readonly="!can('assignPassing', stage.id)"
        @pick="(id) => emit('pick', event.eventId, id)"
        @assign="emit('assign', event)"
        @dismiss="emit('dismiss', event)"
        @dismiss-all="emit('dismissAll', [event, ...queued])"
      />
    </v-card-text>
    <v-table v-key-scroll density="comfortable">
      <tbody>
        <tr v-for="car in cars" :key="car.run.id">
          <td width="72">
            <StartNumber :number="car.row.starter.startNumber" />
          </td>
          <td><CrewName :crew="car.row.starter" /></td>
          <td v-if="splitIndices.length > 0" class="text-no-wrap">
            <v-icon
              v-for="index in splitIndices"
              :key="index"
              :icon="
                car.passed.has(index) ? 'mdi-circle' : 'mdi-circle-outline'
              "
              :color="car.passed.has(index) ? 'success' : undefined"
              v-tooltip:top="$t('gateRole.split', { n: index })"
              size="x-small"
              class="mr-1"
            />
            <v-icon
              icon="mdi-flag-checkered"
              size="x-small"
              v-tooltip:top="$t('gateRole.finish')"
              class="text-medium-emphasis"
            />
          </td>
          <td class="rg-timing rg-time text-no-wrap">
            <template v-if="car.last">
              {{ $t('live.splitShort', { n: car.last.splitIndex }) }}
              {{ formatStageDuration(car.last.elapsedMs) }}
              <span class="text-medium-emphasis">
                {{ car.gapMs ? formatGap(car.gapMs) : $t('live.best') }}
              </span>
            </template>
          </td>
          <td class="rg-timing text-right text-h6">
            <RunningTime
              v-if="car.run.status === StageRunStatus.STARTED"
              :start-time="car.run.startTime"
            />
            <template v-else>{{ formatDuration(car.run.durationMs) }}</template>
          </td>
          <td width="120" class="text-no-wrap">
            <JumpStartChip
              :run="car.run"
              :tolerance-ms="jumpStartToleranceMs"
              :suggest="suggestsJumpPenalty(car.run)"
              @penalty="emit('jumpPenalty', car.run)"
              @dismiss="emit('dismissJumpStart', car.run)"
            />
            <v-chip
              v-if="isOverdue(stage, car.run, serverNow)"
              size="small"
              color="warning"
              prepend-icon="mdi-timer-alert-outline"
            >
              {{ $t('live.overdue') }}
            </v-chip>
          </td>
          <td class="text-right rg-actions" width="1%">
            <v-btn
              v-if="can('timeRun', stage.id)"
              size="small"
              variant="tonal"
              prepend-icon="mdi-flag-checkered"
              :loading="finishingRunId === car.run.id"
              @click="emit('finishNow', car.run)"
            >
              {{ $t('live.finishNow') }}
            </v-btn>
            <v-menu v-if="canDnfDns">
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  size="small"
                  variant="text"
                  icon="mdi-dots-vertical"
                  :aria-label="$t('common.moreActions')"
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-close"
                  :title="$t('live.markDnf')"
                  @click="emit('markDnf', car.run)"
                />
              </v-list>
            </v-menu>
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-card-text v-if="cars.length === 0" class="rg-empty">
      {{
        stage.status === StageStatus.ACTIVE
          ? $t('live.noneOnStage')
          : $t('live.notActiveYet')
      }}
    </v-card-text>
  </v-card>
</template>
