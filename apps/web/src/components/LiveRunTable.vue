<script setup lang="ts">
import { StageRunStatus, StageStatus } from '@rally-gate/shared';
import { formatStageDuration, t } from '@rally-gate/ui';
import { computed } from 'vue';
import { can } from '../api/auth';
import type { StageRun, StageSplit } from '../api/stage-runs';
import type { Stage } from '../api/stages';
import type { StartOrder } from '../api/start-order';
import { serverNow } from '../api/time';
import { formatDuration } from '../format';
import { isOverdue, ROW_STATE_DISPLAY, type Row } from '../live-rows';
import ClassChip from './ClassChip.vue';
import ClockTime from './ClockTime.vue';
import CrewName from './CrewName.vue';
import JumpStartChip from './JumpStartChip.vue';
import RunningTime from './RunningTime.vue';
import StartNumber from './StartNumber.vue';
import StatusChip from './StatusChip.vue';
import TableLegend from './TableLegend.vue';

/** Live timing's table: every entry in start order with its run, voided
 *  attempts under it, and the row's one direct action plus its menu. */
const props = defineProps<{
  stage: Stage;
  startOrder: StartOrder;
  rows: Row[];
  shakedown: boolean;
  splitsByRun: Record<string, StageSplit[]>;
  jumpStartToleranceMs: number;
  /** What a waiting row's button does, as in Up next; none without it. */
  startAction: 'countdown' | 'newSlot' | 'startNow' | null;
  startingEntryId: string | null;
  canDnfDns: boolean;
  suggestsJumpPenalty: (run: StageRun) => boolean;
  unscrutineered: (entryId: string) => boolean;
  canStart: (row: Row) => boolean;
  canMarkDns: (entryId: string) => boolean;
}>();
const emit = defineEmits<{
  jumpPenalty: [run: StageRun];
  dismissJumpStart: [run: StageRun];
  correct: [run: StageRun];
  countdown: [entryId: string];
  startNow: [entryId: string];
  enterTime: [entryId: string];
  addPenalty: [entryId: string];
  markDns: [entryId: string];
  undoDns: [entryId: string];
  markDnf: [run: StageRun];
  undoDnf: [run: StageRun];
  removeRun: [run: StageRun];
  unvoidRun: [run: StageRun];
  deleteRun: [run: StageRun];
}>();

function formatSplits(runId: string): string {
  const splits = props.splitsByRun[runId];
  if (!splits || splits.length === 0) return '-';
  return splits
    .map(
      (s) =>
        `${t('live.splitShort', { n: s.splitIndex })}: ${formatStageDuration(s.elapsedMs)}`,
    )
    .join(', ');
}

const anyManual = computed(() =>
  props.rows.some((row) =>
    [row.run, ...row.voidedRuns].some(
      (run) => run && (run.startManual || (run.finishTime && run.finishManual)),
    ),
  ),
);
</script>

<template>
  <v-card>
    <v-table v-key-scroll density="comfortable">
      <thead>
        <tr>
          <th width="56">{{ $t('table.pos') }}</th>
          <th width="72">#</th>
          <th>{{ $t('table.crew') }}</th>
          <th v-if="!startOrder.grouped">{{ $t('classes.class') }}</th>
          <th>{{ $t('table.status') }}</th>
          <th v-if="shakedown">{{ $t('table.runs') }}</th>
          <th class="rg-time">
            {{ $t('gateRole.start') }}<span class="rg-time-mark" />
          </th>
          <th class="rg-time">{{ $t('live.splits') }}</th>
          <th class="rg-time">
            {{ $t('gateRole.finish') }}<span class="rg-time-mark" />
          </th>
          <th class="rg-time">{{ $t('table.time') }}</th>
          <th class="rg-actions">
            <span class="d-sr-only">{{ $t('table.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.starter.entryId">
          <tr v-if="row.classHeader" class="rg-class-row">
            <td :colspan="shakedown ? 11 : 10">
              {{ row.classHeader }}
            </td>
          </tr>
          <tr :class="{ 'rg-next-row': row.state === 'NEXT' }">
            <td class="rg-timing">{{ row.starter.position }}</td>
            <td>
              <StartNumber :number="row.starter.startNumber" />
            </td>
            <td><CrewName :crew="row.starter" /></td>
            <td v-if="!startOrder.grouped">
              <ClassChip
                v-if="row.starter.mainClassName"
                :name="row.starter.mainClassName"
                main
              />
            </td>
            <td class="text-no-wrap">
              <StatusChip :display="ROW_STATE_DISPLAY[row.state]" />
              <v-chip
                v-if="isOverdue(stage, row.run, serverNow)"
                size="small"
                color="warning"
                prepend-icon="mdi-timer-alert-outline"
                class="ml-1"
              >
                {{ $t('live.overdue') }}
              </v-chip>
              <JumpStartChip
                v-if="row.run"
                :run="row.run"
                :tolerance-ms="jumpStartToleranceMs"
                :suggest="suggestsJumpPenalty(row.run)"
                @penalty="emit('jumpPenalty', row.run)"
                @dismiss="emit('dismissJumpStart', row.run)"
              />
              <v-chip
                v-if="!row.run && unscrutineered(row.starter.entryId)"
                size="small"
                variant="outlined"
                color="warning"
                prepend-icon="mdi-clipboard-alert-outline"
                class="ml-1"
              >
                {{ $t('live.notScrutineered') }}
              </v-chip>
              <span
                v-if="row.run && row.run.attempt > 1 && !shakedown"
                class="text-caption text-medium-emphasis ml-1"
              >
                {{ $t('live.attempt', { n: row.run.attempt }) }}
              </span>
            </td>
            <td v-if="shakedown" class="rg-timing">{{ row.runCount }}</td>
            <!-- On a slot stage the slot is the start time; before activation
                 the posted one. -->
            <td
              class="rg-time text-no-wrap"
              :class="{ 'font-weight-bold': row.starter.slotMoved }"
            >
              <v-icon
                v-if="row.starter.slotMoved"
                icon="mdi-calendar-arrow-right"
                size="x-small"
                class="mr-1"
                v-tooltip:top="$t('timetable.slotMoved')"
              />
              <ClockTime
                v-if="row.run"
                :time="row.run.startTime"
                :manual="row.run.startManual"
              />
              <ClockTime
                v-else-if="row.starter.slotTime"
                :time="row.starter.slotTime"
              />
            </td>
            <td class="rg-timing rg-time text-no-wrap">
              {{ row.run ? formatSplits(row.run.id) : '' }}
            </td>
            <td class="rg-time">
              <ClockTime
                v-if="row.run?.finishTime"
                :time="row.run.finishTime"
                :manual="row.run.finishManual"
              />
            </td>
            <td class="rg-timing rg-time">
              <template
                v-if="row.state === 'QUEUED' || row.state === 'SLOTTED'"
              />
              <RunningTime
                v-else-if="row.run?.status === StageRunStatus.STARTED"
                :start-time="row.run.startTime"
              />
              <template v-else-if="row.run">{{
                formatDuration(row.run.durationMs)
              }}</template>
            </td>
            <td class="text-no-wrap text-right rg-actions">
              <v-btn
                v-if="row.run && can('correctRun', stage.id)"
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                class="rg-row-action"
                @click="emit('correct', row.run)"
              >
                <span class="rg-row-action-label">{{
                  $t('live.correct')
                }}</span>
              </v-btn>
              <v-btn
                v-if="
                  (!row.run || row.state === 'FINISHED') &&
                  canStart(row) &&
                  startAction
                "
                size="small"
                variant="text"
                :prepend-icon="
                  startAction === 'countdown'
                    ? 'mdi-timer-play-outline'
                    : 'mdi-play'
                "
                :loading="startingEntryId === row.starter.entryId"
                class="rg-row-action"
                @click="
                  startAction === 'countdown'
                    ? emit('countdown', row.starter.entryId)
                    : emit('startNow', row.starter.entryId)
                "
              >
                <span class="rg-row-action-label">{{
                  startAction === 'countdown'
                    ? $t('countdown.start')
                    : $t('live.startNow')
                }}</span>
              </v-btn>
              <v-menu
                v-if="
                  !row.run &&
                  stage.status !== StageStatus.NOT_STARTED &&
                  (can('timeRun', stage.id) ||
                    can('penalties') ||
                    canMarkDns(row.starter.entryId) ||
                    (row.state === 'DNS' && canDnfDns))
                "
              >
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
                    v-if="can('timeRun', stage.id)"
                    prepend-icon="mdi-timer-edit-outline"
                    :title="$t('live.enterTime')"
                    @click="emit('enterTime', row.starter.entryId)"
                  />
                  <v-list-item
                    v-if="can('penalties')"
                    prepend-icon="mdi-flag-variant-outline"
                    :title="$t('penalties.add')"
                    @click="emit('addPenalty', row.starter.entryId)"
                  />
                  <v-list-item
                    v-if="canMarkDns(row.starter.entryId)"
                    prepend-icon="mdi-minus-circle-outline"
                    :title="$t('live.markDns')"
                    @click="emit('markDns', row.starter.entryId)"
                  />
                  <v-list-item
                    v-if="row.state === 'DNS' && canDnfDns"
                    prepend-icon="mdi-undo"
                    :title="$t('live.undoDns')"
                    @click="emit('undoDns', row.starter.entryId)"
                  />
                </v-list>
              </v-menu>
              <v-menu
                v-if="
                  row.run &&
                  (can('penalties') ||
                    can('voidRun') ||
                    (canDnfDns && ['ON_STAGE', 'DNF'].includes(row.state)))
                "
              >
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
                    v-if="can('penalties')"
                    prepend-icon="mdi-flag-variant-outline"
                    :title="$t('penalties.add')"
                    @click="emit('addPenalty', row.run!.entryId)"
                  />
                  <v-list-item
                    v-if="canDnfDns && row.state === 'ON_STAGE'"
                    prepend-icon="mdi-close"
                    :title="$t('live.markDnf')"
                    @click="emit('markDnf', row.run!)"
                  />
                  <v-list-item
                    v-if="canDnfDns && row.state === 'DNF'"
                    prepend-icon="mdi-undo"
                    :title="$t('live.undoDnf')"
                    @click="emit('undoDnf', row.run!)"
                  />
                  <v-list-item
                    v-if="can('voidRun')"
                    prepend-icon="mdi-cancel"
                    :title="$t('live.removeRun')"
                    base-color="error"
                    @click="emit('removeRun', row.run!)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr
            v-for="voided in row.voidedRuns"
            :key="voided.id"
            class="rg-voided-row"
          >
            <td colspan="3"></td>
            <td v-if="!startOrder.grouped"></td>
            <td class="text-no-wrap">
              <v-chip size="small" variant="outlined" prepend-icon="mdi-cancel">
                {{ $t('live.voided') }}
              </v-chip>
              <span class="text-caption ml-1">{{
                $t('live.attempt', { n: voided.attempt })
              }}</span>
            </td>
            <td v-if="shakedown"></td>
            <td class="rg-time">
              <ClockTime
                :time="voided.startTime"
                :manual="voided.startManual"
              />
            </td>
            <td class="rg-timing rg-time">{{ formatSplits(voided.id) }}</td>
            <td class="rg-time">
              <ClockTime
                v-if="voided.finishTime"
                :time="voided.finishTime"
                :manual="voided.finishManual"
              />
            </td>
            <td class="rg-timing rg-time">
              {{ formatDuration(voided.durationMs) }}
            </td>
            <td class="text-no-wrap text-right">
              <v-btn
                v-if="can('voidRun')"
                size="small"
                variant="text"
                prepend-icon="mdi-restore"
                @click="emit('unvoidRun', voided)"
              >
                {{ $t('live.restore') }}
              </v-btn>
              <v-menu v-if="can('voidRun')">
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
                    prepend-icon="mdi-delete"
                    :title="$t('live.deleteRun')"
                    base-color="error"
                    @click="emit('deleteRun', voided)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
        </template>
        <tr v-if="rows.length === 0">
          <td :colspan="shakedown ? 11 : 10" class="rg-empty">
            {{ $t('live.noEntries') }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <div class="px-4 pb-3">
      <TableLegend :marks="anyManual ? ['manual'] : []" />
    </div>
  </v-card>
</template>

<style scoped>
/* On a phone the row's action is its icon alone, so the crew's name fits
   beside it; the label stays for a screen reader. Up next carries the same
   action spelled out. */
@media (max-width: 599px) {
  .rg-row-action {
    min-width: 0;
    padding-inline: 10px;
  }
  .rg-row-action :deep(.v-btn__prepend) {
    margin-inline: 0;
  }
  .rg-row-action-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
.rg-class-row td {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 600;
  font-size: 1.05rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* The next car is a marshal's main cue, so it gets more than the chip. */
/* An image, so it also tints the opaque .rg-actions cell. */
.rg-next-row td {
  background-image: linear-gradient(
    rgba(var(--v-theme-info), 0.12),
    rgba(var(--v-theme-info), 0.12)
  );
}
.rg-next-row td:first-child {
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-info));
}

.rg-voided-row td {
  opacity: 0.6;
}
</style>
