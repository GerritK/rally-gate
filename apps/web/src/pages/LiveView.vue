<script setup lang="ts">
import { useLoad } from '../load';
import LoadError from '../components/LoadError.vue';
import LiveRunTable from '../components/LiveRunTable.vue';
import LiveStageHeader from '../components/LiveStageHeader.vue';
import OnStageCard from '../components/OnStageCard.vue';
import type { Row } from '../live-row-display';
import { buildRows, countStates } from '../live-rows';
import { GateRole, StageStatus, StartMode } from '@rally-gate/shared';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { can, session } from '../api/auth';
import { type GateAssignment } from '../api/gate-assignments';
import { serverNow } from '../api/time';
import FormDialog from '../components/FormDialog.vue';
import type { Stage } from '../api/stages';
import RunCorrectionDialog from '../components/RunCorrectionDialog.vue';
import PenaltyDialog from '../components/PenaltyDialog.vue';
import StagePicker from '../components/StagePicker.vue';
import UpNextCard, { type UpNextRow } from '../components/UpNextCard.vue';
import { formatStageDuration, t } from '@rally-gate/ui';
import { gateRoleLabel } from '../format';
import { useLiveData } from '../live-data';
import { usePassings } from '../live-passings';
import { useRunActions } from '../live-run-actions';
import { useStageLifecycle } from '../live-stage-lifecycle';

const props = defineProps<{ stageId?: string }>();
const router = useRouter();

const data = useLiveData(props);
const {
  stages,
  entries,
  gates,
  gateAssignments,
  startOrder,
  stageRuns,
  splitsByRun,
  pendingDetections,
  atStartIds,
  dnsIds,
  flashingGateIds,
  jumpStartToleranceMs,
  countdownMs,
  stage,
  entryById,
  shakedown,
  timetable,
  unscrutineered,
  stageTitle,
  upsertStageRun,
  loadPenalties,
} = data;

// ---- What the cards draw, derived from the data -------------------------

const rows = computed(() =>
  buildRows({
    order: startOrder.value,
    runs: stageRuns.value,
    entryById: entryById.value,
    dnsIds: dnsIds.value,
    stageStatus: stage.value?.status,
    now: serverNow.value,
    countdownMs: countdownMs.value,
    noMainClass: t('live.noMainClass'),
  }),
);

const stateCounts = computed(() => countStates(rows.value));

/** The stage's split points, from its gate plan. */
const splitIndices = computed(() =>
  [
    ...new Set(
      gateAssignments.value
        .filter(
          (a) => a.stageId === props.stageId && a.role === GateRole.STAGE_SPLIT,
        )
        .map((a) => a.splitIndex ?? 0),
    ),
  ].sort((a, b) => a - b),
);

/** Fastest time to each split among the attempts that count. */
const bestSplitMs = computed(() => {
  const best = new Map<number, number>();
  for (const run of stageRuns.value) {
    if (run.voided) continue;
    for (const split of splitsByRun.value[run.id] ?? []) {
      best.set(
        split.splitIndex,
        Math.min(best.get(split.splitIndex) ?? Infinity, split.elapsedMs),
      );
    }
  }
  return best;
});

/**
 * Furthest along first, then the earlier start: the order cars should reach
 * the next gate, so the finish marshal reads who comes next from the top. A
 * missed split detection puts a car too far back; it's a guide, not a fact.
 */
const onStage = computed(() =>
  rows.value
    .filter((row) => row.state === 'ON_STAGE')
    .map((row) => {
      const run = row.run!;
      const splits = splitsByRun.value[run.id] ?? [];
      const last = splits.at(-1);
      return {
        row,
        run,
        passed: new Set(splits.map((s) => s.splitIndex)),
        last,
        gapMs: last
          ? last.elapsedMs - (bestSplitMs.value.get(last.splitIndex) ?? 0)
          : undefined,
      };
    })
    .sort(
      (a, b) =>
        b.passed.size - a.passed.size ||
        new Date(a.run.startTime).getTime() -
          new Date(b.run.startTime).getTime(),
    ),
);

/** Cars yet to start, in start order; on a shakedown every car off stage,
 *  fewest runs first. */
const dueToStart = computed(() =>
  shakedown.value
    ? rows.value
        .filter((row) =>
          ['NEXT', 'WAITING', 'FINISHED', 'RERUN'].includes(row.state),
        )
        .sort((a, b) => a.runCount - b.runCount)
    : rows.value.filter(
        (row) => row.state === 'NEXT' || row.state === 'WAITING',
      ),
);

/** Counting down first, by slot, then the cars still to start. */
const upNext = computed<UpNextRow[]>(() => {
  const queued = rows.value
    .filter((row) => row.state === 'QUEUED' || row.state === 'SLOTTED')
    .sort((a, b) => a.run!.startTime.localeCompare(b.run!.startTime));
  return [...queued, ...dueToStart.value].map((row) => ({
    starter: row.starter,
    slot:
      row.state === 'QUEUED' || row.state === 'SLOTTED' ? row.run : undefined,
    atStart: atStartIds.value.includes(row.starter.entryId),
    unscrutineered: !row.run && unscrutineered(row.starter.entryId),
  }));
});

const upNextAction = computed(() => {
  if (
    stage.value?.status !== StageStatus.ACTIVE ||
    !can('timeRun', stage.value.id)
  )
    return null;
  if (stage.value.startMode === StartMode.SLOT_MANUAL) return 'countdown';
  if (stage.value.startMode === StartMode.SLOT_SCHEDULE) return 'newSlot';
  return 'startNow';
});

/**
 * The stage's gates in the order a car meets them — start, splits by index,
 * finish — so "split 2 is offline" reads off its place on the line. All
 * assigned gates, active or not, so a marshal can check them before
 * activating.
 */
const gateFlow = computed(() => {
  const rank = (a: GateAssignment) =>
    a.role === GateRole.STAGE_PRE_START
      ? -2
      : a.role === GateRole.STAGE_START ||
          a.role === GateRole.STAGE_START_FINISH
        ? -1
        : a.role === GateRole.STAGE_FINISH
          ? Number.MAX_SAFE_INTEGER
          : a.role === GateRole.STAGE_SPLIT
            ? (a.splitIndex ?? 0)
            : Number.MAX_SAFE_INTEGER - 1;
  return gateAssignments.value
    .filter((a) => a.stageId === props.stageId)
    .sort((a, b) => rank(a) - rank(b))
    .flatMap((a) => {
      const gate = gates.value.find((g) => g.id === a.gateId);
      if (!gate) return [];
      return [{ gate, label: gateRoleLabel(a) }];
    });
});

const correctionDialog = ref<InstanceType<typeof RunCorrectionDialog> | null>(
  null,
);
const penaltyDialog = ref<InstanceType<typeof PenaltyDialog> | null>(null);

const passings = usePassings(props, data, { dueToStart, onStage, gateFlow });
const {
  pickedEntryIds,
  retryingPending,
  passingsByStage,
  entryOptionsFor,
  entryFor,
  gateRole,
  gateName,
  onAssign,
  onDismiss,
  onDismissAll,
  onRetryPending,
} = passings;

const lifecycle = useStageLifecycle(props, data, {
  rows,
  unassignedHere: () => passingsByStage.value.here.length,
});
const {
  delayDialog,
  delayMs,
  activatingStage,
  closingStage,
  startListStatus,
  openDelay,
  onDelay,
  activateWithoutDelay,
  onActivateStage,
  onCloseStage,
  onFreeze,
  onUnfreeze,
  printStartList,
} = lifecycle;

const actions = useRunActions(props, data, { penaltyDialog });
const {
  startingEntryId,
  finishingRunId,
  canDnfDns,
  onCountdown,
  onNewSlot,
  onCancelCountdown,
  suggestsJumpPenalty,
  onJumpStartPenalty,
  onDismissJumpStart,
  onFinishNow,
  onStartNow,
  onRemoveRun,
  onUnvoidRun,
  canMarkDns,
  onMarkDnf,
  onUndoDnf,
  onMarkDns,
  onUndoDns,
  onDeleteRun,
} = actions;

function canStart(row: Row): boolean {
  return (
    stage.value?.status === StageStatus.ACTIVE &&
    (['NEXT', 'WAITING', 'RERUN'].includes(row.state) ||
      (shakedown.value && row.state === 'FINISHED'))
  );
}

function onSelectStage(stageId: string) {
  router.push(`/live/${stageId}`);
}

/**
 * The stage a marshal most likely wants: running, else next up. A stage
 * marshal's own stages only, while it has any.
 */
function defaultStage(): Stage | undefined {
  const own = stages.value.filter((s) =>
    session.value?.stageIds.includes(s.id),
  );
  const pool = own.length > 0 ? own : stages.value;
  return (
    pool.find((s) => s.status === StageStatus.ACTIVE) ??
    pool.find((s) => s.status === StageStatus.NOT_STARTED) ??
    pool.at(-1)
  );
}

const load = useLoad(async () => {
  await data.loadPlan();
  if (!props.stageId) {
    const fallback = defaultStage();
    if (fallback) router.replace(`/live/${fallback.id}`);
  }
  await data.connect();
});
</script>

<template>
  <v-alert
    v-if="pendingDetections.length > 0"
    type="error"
    variant="tonal"
    class="mb-4"
    icon="mdi-alert-circle-outline"
  >
    <div class="d-flex flex-wrap align-center ga-4">
      <div>
        <strong>
          {{
            $t(
              'live.pendingTitle',
              { n: pendingDetections.length },
              pendingDetections.length,
            )
          }}
        </strong>
        {{ $t('live.pendingText') }}
        <div class="text-caption mt-1">
          {{
            $t('live.gatesAffected', {
              gates: [...new Set(pendingDetections.map((d) => d.gateId))].join(
                ', ',
              ),
            })
          }}
        </div>
      </div>
      <v-spacer />
      <v-btn
        v-if="can('retryPending')"
        :loading="retryingPending"
        variant="outlined"
        prepend-icon="mdi-refresh"
        @click="onRetryPending"
      >
        {{ $t('live.retryNow') }}
      </v-btn>
    </div>
  </v-alert>

  <StagePicker
    class="mb-4"
    :stages="stages"
    :model-value="props.stageId"
    @update:model-value="onSelectStage"
  />

  <LoadError :load="load" />
  <v-card v-if="load.state === 'loading' && !stage">
    <v-card-text class="rg-empty">{{ $t('common.loading') }}</v-card-text>
  </v-card>

  <v-alert
    v-if="load.state === 'ready' && stages.length === 0"
    type="info"
    variant="tonal"
    density="comfortable"
  >
    <i18n-t keypath="live.noStages" scope="global">
      <template #link>
        <router-link to="/setup/stages" class="rg-link"
          >{{ $t('nav.setup') }} → {{ $t('stages.title') }}</router-link
        >
      </template>
    </i18n-t>
  </v-alert>

  <LiveStageHeader
    v-if="stage"
    class="mb-4"
    :stage="stage"
    :start-order="startOrder"
    :start-list-status="startListStatus"
    :state-counts="stateCounts"
    :gate-flow="gateFlow"
    :flashing-gate-ids="flashingGateIds"
    :activating="activatingStage"
    :closing="closingStage"
    @freeze="onFreeze"
    @unfreeze="onUnfreeze"
    @print-start-list="printStartList"
    @activate="onActivateStage()"
    @close="onCloseStage"
  />

  <v-alert
    v-if="passingsByStage.elsewhere.length > 0"
    type="warning"
    variant="tonal"
    density="compact"
    class="mb-4"
  >
    <div v-for="{ stageId, count } in passingsByStage.elsewhere" :key="stageId">
      <i18n-t keypath="live.unassignedOn" :plural="count" scope="global">
        <template #num>{{ count }}</template>
        <template #stage>
          <router-link :to="`/live/${stageId}`" class="rg-link">{{
            stageTitle(stageId)
          }}</router-link>
        </template>
      </i18n-t>
    </div>
  </v-alert>

  <div
    v-if="stage && stage.status !== StageStatus.CLOSED"
    class="rg-stage-flow mb-4"
  >
    <UpNextCard
      :title="
        stage.status === StageStatus.ACTIVE
          ? $t('live.upNext')
          : $t('live.firstToStart')
      "
      :rows="upNext"
      :action="upNextAction"
      :can-cancel="!timetable && can('timeRun', stage.id)"
      :can-delay="timetable && can('timeRun', stage.id)"
      :countdown-ms="countdownMs"
      :lights="stage.startMode !== StartMode.GATE"
      :delay-ms="startOrder?.delayMs"
      :busy-id="startingEntryId"
      :can-dns="canDnfDns && !shakedown"
      @start-now="onStartNow"
      @countdown="onCountdown"
      @cancel="onCancelCountdown"
      @new-slot="onNewSlot"
      @delay="openDelay"
      @dns="onMarkDns"
    />
    <!-- Shown before activation too, so activating doesn't reflow the page. -->
    <div>
      <OnStageCard
        class="h-100"
        :stage="stage"
        :cars="onStage"
        :passings="passingsByStage.here"
        :split-indices="splitIndices"
        :jump-start-tolerance-ms="jumpStartToleranceMs"
        :finishing-run-id="finishingRunId"
        :can-dnf-dns="canDnfDns"
        :gate-role="gateRole"
        :gate-name="gateName"
        :entry-for="entryFor"
        :entry-options-for="entryOptionsFor"
        :suggests-jump-penalty="suggestsJumpPenalty"
        @pick="(eventId, entryId) => (pickedEntryIds[eventId] = entryId)"
        @assign="onAssign"
        @dismiss="onDismiss"
        @dismiss-all="onDismissAll"
        @finish-now="onFinishNow"
        @mark-dnf="onMarkDnf"
        @jump-penalty="onJumpStartPenalty"
        @dismiss-jump-start="onDismissJumpStart"
      />
    </div>
  </div>

  <LiveRunTable
    v-if="stage && startOrder"
    class="mb-4"
    :stage="stage"
    :start-order="startOrder"
    :rows="rows"
    :shakedown="shakedown"
    :splits-by-run="splitsByRun"
    :jump-start-tolerance-ms="jumpStartToleranceMs"
    :start-action="upNextAction"
    :starting-entry-id="startingEntryId"
    :can-dnf-dns="canDnfDns"
    :suggests-jump-penalty="suggestsJumpPenalty"
    :unscrutineered="unscrutineered"
    :can-start="canStart"
    :can-mark-dns="canMarkDns"
    @jump-penalty="onJumpStartPenalty"
    @dismiss-jump-start="onDismissJumpStart"
    @correct="(run) => correctionDialog?.correct(run)"
    @countdown="onCountdown"
    @start-now="onStartNow"
    @enter-time="(entryId) => correctionDialog?.enter(entryId)"
    @add-penalty="(entryId) => penaltyDialog?.add(entryId, stage!.id)"
    @mark-dns="onMarkDns"
    @undo-dns="onUndoDns"
    @mark-dnf="onMarkDnf"
    @undo-dnf="onUndoDnf"
    @remove-run="onRemoveRun"
    @unvoid-run="onUnvoidRun"
    @delete-run="onDeleteRun"
  />

  <RunCorrectionDialog
    v-if="props.stageId"
    ref="correctionDialog"
    :stage-id="props.stageId"
    :entries="entries"
    @saved="upsertStageRun"
  />
  <PenaltyDialog
    ref="penaltyDialog"
    :stages="stages"
    :entries="entries"
    @saved="loadPenalties"
  />
  <FormDialog
    v-model="delayDialog.open"
    :title="
      delayDialog.activateAfter
        ? $t('timetable.slotsPassedTitle')
        : $t('timetable.delayTitle')
    "
    :form="delayDialog.text"
    :save="onDelay"
    :saved="
      $t('timetable.delayed', {
        time: delayMs ? formatStageDuration(delayMs) : '',
      })
    "
    :save-text="
      delayDialog.activateAfter
        ? $t('timetable.delayAndActivate')
        : $t('timetable.delay')
    "
  >
    <p>
      {{
        delayDialog.activateAfter
          ? $t('timetable.slotsPassedText')
          : $t('timetable.delayText')
      }}
    </p>
    <v-text-field
      v-model="delayDialog.text"
      :label="$t('timetable.delayBy')"
      :placeholder="formatStageDuration(120_000)"
      class="rg-timing"
      autofocus
      :rules="[() => delayMs !== null || $t('timetable.delayRule')]"
    />
    <v-btn
      v-if="delayDialog.activateAfter"
      variant="text"
      class="align-self-start"
      @click="activateWithoutDelay"
    >
      {{ $t('timetable.activateWithoutDelay') }}
    </v-btn>
  </FormDialog>
</template>

<style scoped>
/* Up next beside On stage; stacked below Vuetify's md breakpoint. */
.rg-stage-flow {
  display: grid;
  /* minmax(0, …): a plain 1fr grows with its content, and the cards jumped. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 16px;
}
@media (max-width: 959px) {
  .rg-stage-flow {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
