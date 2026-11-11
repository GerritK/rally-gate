<script setup lang="ts">
import { useLoad } from '../load';
import LoadError from '../components/LoadError.vue';
import LiveRunTable from '../components/LiveRunTable.vue';
import LiveStageHeader from '../components/LiveStageHeader.vue';
import OnStageCard from '../components/OnStageCard.vue';
import { buildRows, countStates, type Row } from '../live-rows';
import {
  ApiErrorCode,
  COUNTDOWN_MS_KEY,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_JUMP_START_TOLERANCE_MS,
  DEFAULT_MIN_STAGE_DURATION_MS,
  GateRole,
  isOutOfEvent,
  isScrutineered,
  JUMP_START_PENALTY_TYPE_ID_KEY,
  JUMP_START_TOLERANCE_MS_KEY,
  StageScoring,
  StageStatus,
  StartMode,
  type DidNotStart,
} from '@rally-gate/shared';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { can, session } from '../api/auth';
import {
  assignEntryToEvent,
  dismissEvent,
  fetchAtStart,
  fetchAwaitingEvents,
  fetchPendingEvents,
  retryPendingEvents,
  type DetectionEventRecord,
} from '../api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGates, type Gate } from '../api/gates';
import { serverNow } from '../api/time';
import { fetchSetting } from '../api/settings';
import { fetchPenalties, type Penalty } from '../api/penalties';
import { catchUpDelayMinutes } from '../countdown';
import FormDialog from '../components/FormDialog.vue';
import { closeLiveStream, openLiveStream, upsert } from '../api/live';
import { rallyName } from '../api/rally-info';
import {
  activateStage,
  closeStage,
  delaySlots,
  fetchStages,
  newSlot,
  type Stage,
} from '../api/stages';
import {
  cancelCountdown,
  createStageRun,
  deleteStageRun,
  dismissJumpStart,
  startCountdown,
  fetchSplitsForStage,
  finishStageRunNow,
  fetchStageRuns,
  fetchDns,
  markDns,
  markDnf,
  undoDns,
  undoDnf,
  unvoidStageRun,
  voidStageRun,
  type StageRun,
  type StageSplit,
} from '../api/stage-runs';
import {
  fetchStartOrder,
  freezeStartOrder,
  unfreezeStartOrder,
  type StartOrder,
} from '../api/start-order';
import { fetchEntries, type Entry } from '../api/entries';
import RunCorrectionDialog from '../components/RunCorrectionDialog.vue';
import PenaltyDialog from '../components/PenaltyDialog.vue';
import StagePicker from '../components/StagePicker.vue';
import UpNextCard, { type UpNextRow } from '../components/UpNextCard.vue';
import { driverName } from '../crew';
import {
  formatStageDuration,
  parseStageDuration,
  t,
  useChoice,
  useConfirm,
} from '@rally-gate/ui';
import { carriersOf, suggestEntries } from '../passing-suggestions';
import { printPdf, startListPdf } from '../pdf';
import { formatStamp, gateRoleLabel, entryName } from '../format';

const props = defineProps<{ stageId?: string }>();
const router = useRouter();

let liveSource: EventSource | undefined;

const stages = ref<Stage[]>([]);
const entries = ref<Entry[]>([]);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const startOrder = ref<StartOrder | null>(null);
const stageRuns = ref<StageRun[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const pendingDetections = ref<DetectionEventRecord[]>([]);
const awaitingDetections = ref<DetectionEventRecord[]>([]);
/** Entries seen at a pre-start gate since their last run. */
const atStartIds = ref<string[]>([]);
/** Entries marked DNS on this stage. */
const dnsIds = ref<string[]>([]);
/** Only what a marshal picked by hand; otherwise the suggestion applies. */
const pickedEntryIds = ref<Record<string, string>>({});
const flashingGateIds = ref<Record<string, boolean>>({});
const retryingPending = ref(false);
const activatingStage = ref(false);
const closingStage = ref(false);
const confirm = useConfirm();
const choose = useChoice();
const jumpStartToleranceMs = ref(DEFAULT_JUMP_START_TOLERANCE_MS);
const jumpStartPenaltyTypeId = ref<string | null>(null);
/** Every penalty, to tell whether a jump start still awaits a ruling. */
const penalties = ref<Penalty[]>([]);

const FLASH_DURATION_MS = 600;

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));
const entryById = computed(() => new Map(entries.value.map((v) => [v.id, v])));

// ---- Rows: every entry in start order, with its run --------------------

/** A shakedown is driven as often as a car likes; its fastest run counts. */
const shakedown = computed(() => stage.value?.scoring === StageScoring.NONE);

const rows = computed(() =>
  buildRows({
    order: startOrder.value,
    runs: stageRuns.value,
    entryById: entryById.value,
    dnsIds: dnsIds.value,
    stageStatus: stage.value?.status,
    now: serverNow.value,
    countdownMs: countdownMs.value,
  }),
);

const stateCounts = computed(() => countStates(rows.value));

// ---- On stage: running cars in expected arrival order -------------------

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

const timetable = computed(
  () => stage.value?.startMode === StartMode.SLOT_SCHEDULE,
);

// ---- Unassigned passings, with a suggested entry -----------------------

const entryOptions = computed(() =>
  entries.value.map((v) => ({
    id: v.id,
    title: `#${v.startNumber} ${driverName(v)}`,
  })),
);

function entryOptionsFor(event: DetectionEventRecord) {
  const carriers = carriersOf(entries.value, event);
  return carriers
    ? entryOptions.value.filter((o) => carriers.has(o.id))
    : entryOptions.value;
}

const suggestedEntryIds = computed(() =>
  suggestEntries({
    passings: awaitingDetections.value,
    gates: gateAssignments.value,
    stageId: props.stageId,
    dueToStart: dueToStart.value.map((row) => row.starter.entryId),
    onStage: onStage.value.map(({ row, run }) => ({
      entryId: row.starter.entryId,
      runId: run.id,
      startTime: run.startTime,
    })),
    splitsByRun: splitsByRun.value,
    entries: entries.value,
    minDurationMs: stage.value?.minDurationMs ?? DEFAULT_MIN_STAGE_DURATION_MS,
  }),
);

function entryFor(event: DetectionEventRecord): string | undefined {
  return (
    pickedEntryIds.value[event.eventId] ??
    suggestedEntryIds.value[event.eventId]
  );
}

/**
 * Passings are handled on their own stage's page, where the suggestions know
 * the start order. One at a gate no stage owns any more stays listed here so
 * it can still be dismissed.
 */
const passingsByStage = computed(() => {
  const stageOfGate = new Map(
    gateAssignments.value
      .filter((a) => a.active)
      .map((a) => [a.gateId, a.stageId]),
  );
  const here: DetectionEventRecord[] = [];
  const elsewhere = new Map<string, number>();
  for (const event of awaitingDetections.value) {
    const stageId = stageOfGate.get(event.gateId);
    if (!stageId || stageId === props.stageId) here.push(event);
    else elsewhere.set(stageId, (elsewhere.get(stageId) ?? 0) + 1);
  }
  // Oldest first: passings are assigned in time order, and so is the
  // suggestion.
  here.sort(
    (a, b) =>
      new Date(a.timestampGate).getTime() - new Date(b.timestampGate).getTime(),
  );
  return {
    here,
    elsewhere: [...elsewhere].map(([stageId, count]) => ({ stageId, count })),
  };
});

/** Its role on this stage, so a marshal sees whether it was a start. */
function gateRole(gateId: string): string | undefined {
  return gateFlow.value.find((node) => node.gate.id === gateId)?.label;
}

function gateName(gateId: string): string {
  return gates.value.find((g) => g.id === gateId)?.name ?? gateId;
}

/** The live stream refreshes the list for every marshal; this is just faster
 *  feedback for the one who clicked. */
async function onAssign(event: DetectionEventRecord) {
  const entryId = entryFor(event);
  if (!entryId) return;
  await assignEntryToEvent(event.eventId, entryId);
  delete pickedEntryIds.value[event.eventId];
  awaitingDetections.value = await fetchAwaitingEvents();
}

async function onDismiss(event: DetectionEventRecord) {
  await dismissEvent(event.eventId);
  awaitingDetections.value = await fetchAwaitingEvents();
}

async function onDismissAll(events: DetectionEventRecord[]) {
  const n = events.length;
  if (
    !(await confirm({
      title: t('live.dismissTitle', { n }, n),
      text: t('live.dismissText', { n }, n),
      confirmText: t('live.dismissConfirm', { n }),
      color: 'error',
    }))
  )
    return;
  try {
    for (const event of events) await dismissEvent(event.eventId);
  } finally {
    awaitingDetections.value = await fetchAwaitingEvents();
  }
}

async function onRetryPending() {
  if (retryingPending.value) return;
  retryingPending.value = true;
  try {
    await retryPendingEvents();
    pendingDetections.value = await fetchPendingEvents();
  } finally {
    retryingPending.value = false;
  }
}

// ---- Gates ---------------------------------------------------------------

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

function flashGate(gateId: string) {
  flashingGateIds.value[gateId] = true;
  setTimeout(() => {
    flashingGateIds.value[gateId] = false;
  }, FLASH_DURATION_MS);
}

function upsertGate(gate: Gate) {
  upsert(gates.value, gate, 'id');
  flashGate(gate.id);
}

// ---- Runs and corrections ------------------------------------------------

function upsertStageRun(run: StageRun) {
  if (run.stageId !== props.stageId) return;
  upsert(stageRuns.value, run, 'id', { first: true });
}

function upsertSplit(split: StageSplit) {
  const splits = splitsByRun.value[split.stageRunId] ?? [];
  splitsByRun.value[split.stageRunId] = [
    ...splits.filter((s) => s.id !== split.id),
    split,
  ].sort((a, b) => a.splitIndex - b.splitIndex);
}

const startingEntryId = ref<string | null>(null);
const countdownMs = ref(DEFAULT_COUNTDOWN_MS);

function removeStageRun({ id }: { id: string }) {
  stageRuns.value = stageRuns.value.filter((r) => r.id !== id);
  delete splitsByRun.value[id];
}

/** Queues the car's slot; the server's clock sets it, not this device's. */
async function onCountdown(entryId: string) {
  if (!props.stageId || startingEntryId.value) return;
  startingEntryId.value = entryId;
  try {
    upsertStageRun(await startCountdown({ entryId, stageId: props.stageId }));
  } finally {
    startingEntryId.value = null;
  }
}

/** After the last slot; the server knows the timetable's end. The start
 *  list's slot times follow through the live stream's `stage` event. */
async function onNewSlot(entryId: string) {
  if (!props.stageId || startingEntryId.value) return;
  startingEntryId.value = entryId;
  try {
    upsertStageRun(await newSlot(props.stageId, entryId));
  } finally {
    startingEntryId.value = null;
  }
}

/**
 * Delay, from the card or offered on activating a timetable stage whose
 * first slot has passed: then `activateAfter`, and the dialog also offers
 * activating without one.
 */
/** Typed like every duration here ("2:00"). */
const delayDialog = ref({ open: false, text: '', activateAfter: false });
/** Whole seconds: tenths mean nothing in a timetable. */
const delayMs = computed(() => {
  const ms = parseStageDuration(delayDialog.value.text);
  return ms === null ? null : Math.round(ms / 1000) * 1000 || null;
});

function openDelay() {
  delayDialog.value = { open: true, text: '', activateAfter: false };
}

async function onDelay() {
  if (!props.stageId) return;
  await delaySlots(props.stageId, delayMs.value!);
  // The stage and its slot times come back through the live stream.
  if (delayDialog.value.activateAfter) await onActivateStage(false, true);
}

function activateWithoutDelay() {
  delayDialog.value.open = false;
  void onActivateStage(false, true);
}

async function onCancelCountdown(run: StageRun) {
  if (startingEntryId.value) return;
  startingEntryId.value = run.id;
  try {
    await cancelCountdown(run.id);
    removeStageRun(run);
  } finally {
    startingEntryId.value = null;
  }
}

/** Until it is given or dismissed, with a penalty type set for it. */
function suggestsJumpPenalty(run: StageRun): boolean {
  const typeId = jumpStartPenaltyTypeId.value;
  return (
    !!typeId &&
    !run.jumpStartDismissed &&
    can('penalties') &&
    !penalties.value.some(
      (p) =>
        p.entryId === run.entryId &&
        p.stageId === run.stageId &&
        p.typeId === typeId,
    )
  );
}

function onJumpStartPenalty(run: StageRun) {
  void penaltyDialog.value?.add(run.entryId, run.stageId, {
    [jumpStartPenaltyTypeId.value!]: 1,
  });
}

async function onDismissJumpStart(run: StageRun) {
  upsertStageRun(await dismissJumpStart(run.id));
}

async function loadPenalties() {
  penalties.value = can('penalties') ? await fetchPenalties() : [];
}

const finishingRunId = ref<string | null>(null);

/** The fallback when the finish gate misses a car; no confirm, it'd cost time. */
async function onFinishNow(run: StageRun) {
  if (finishingRunId.value) return;
  finishingRunId.value = run.id;
  try {
    upsertStageRun(await finishStageRunNow(run.id));
  } finally {
    finishingRunId.value = null;
  }
}

/** On the list and allowed to start, but the scrutineers haven't passed
 *  it: shown where the start marshal looks, never a reason to hold it. */
function unscrutineered(entryId: string): boolean {
  const entry = entryById.value.get(entryId);
  return (
    !!entry && !isOutOfEvent(entry.status) && !isScrutineered(entry.status)
  );
}

/** Freezing or activating with such cars on the list asks first, naming
 *  them: a desk that forgot a click is easier to fix before the start.
 *  `verb` is the confirm button's message key. */
async function clearedToStart(verb: string): Promise<boolean> {
  const pending = rows.value.filter(
    (row) => !row.run && unscrutineered(row.starter.entryId),
  );
  if (pending.length === 0) return true;
  const numbers = pending.map((row) => `#${row.starter.startNumber}`);
  return confirm({
    title: t('live.unscrutineeredTitle', { n: pending.length }, pending.length),
    text: t(
      'live.unscrutineeredText',
      { numbers: numbers.join(', '), verb: t(verb) },
      pending.length,
    ),
    confirmText: t(verb),
  });
}

function canStart(row: Row): boolean {
  return (
    stage.value?.status === StageStatus.ACTIVE &&
    (['NEXT', 'WAITING', 'RERUN'].includes(row.state) ||
      (shakedown.value && row.state === 'FINISHED'))
  );
}

/** The server stamps the start, so its clock counts, not this device's. */
async function onStartNow(entryId: string) {
  if (!props.stageId || startingEntryId.value) return;
  startingEntryId.value = entryId;
  try {
    upsertStageRun(await createStageRun({ entryId, stageId: props.stageId }));
  } finally {
    startingEntryId.value = null;
  }
}

const correctionDialog = ref<InstanceType<typeof RunCorrectionDialog> | null>(
  null,
);
const penaltyDialog = ref<InstanceType<typeof PenaltyDialog> | null>(null);

/** Void and delete in one dialog, void first: it keeps the evidence. */
async function onRemoveRun(run: StageRun) {
  const choice = await choose({
    title: t('live.removeRunTitle', {
      entry: entryName(entries.value, run.entryId),
      attempt: run.attempt,
    }),
    text: t('live.removeRunText'),
    confirmText: t('live.voidConfirm'),
    alternativeText: t('live.deleteForGood'),
  });
  if (choice === 'confirm') upsertStageRun(await voidStageRun(run.id));
  if (choice === 'alternative') await deleteRun(run);
}

/** The server's 409 names the attempt to void first; surfaced as-is. */
async function onUnvoidRun(run: StageRun) {
  upsertStageRun(await unvoidStageRun(run.id));
}

/** DNF, DNS and their undo: a marshal on a running stage. */
const canDnfDns = computed(
  () =>
    stage.value?.status === StageStatus.ACTIVE &&
    can('correctRun', stage.value.id),
);

/** Not on a shakedown, nor for a car out of the event: neither is a DNS. */
function canMarkDns(entryId: string): boolean {
  const entry = entryById.value.get(entryId);
  return (
    canDnfDns.value &&
    !shakedown.value &&
    !!entry &&
    !isOutOfEvent(entry.status) &&
    !dnsIds.value.includes(entryId)
  );
}

function startNumberOf(entryId: string): number | undefined {
  return entryById.value.get(entryId)?.startNumber;
}

async function onMarkDnf(run: StageRun) {
  const number = startNumberOf(run.entryId);
  if (
    !(await confirm({
      title: t('live.dnfTitle', { number }),
      text: t('live.dnfText'),
      confirmText: t('live.dnfConfirm', { number }),
    }))
  )
    return;
  upsertStageRun(await markDnf(run.id));
}

async function onUndoDnf(run: StageRun) {
  upsertStageRun(await undoDnf(run.id));
}

function applyDns({ entryId, stageId, dns }: DidNotStart & { dns: boolean }) {
  if (stageId !== props.stageId) return;
  const others = dnsIds.value.filter((id) => id !== entryId);
  dnsIds.value = dns ? [...others, entryId] : others;
}

/** A slot run it had goes through the live stream's `stage-run-deleted`. */
async function onMarkDns(entryId: string) {
  if (!props.stageId) return;
  const number = startNumberOf(entryId);
  if (
    !(await confirm({
      title: t('live.dnsTitle', { number }),
      text: t('live.dnsText'),
      confirmText: t('live.dnsConfirm', { number }),
    }))
  )
    return;
  const row = { entryId, stageId: props.stageId };
  await markDns(row);
  applyDns({ ...row, dns: true });
}

async function onUndoDns(entryId: string) {
  if (!props.stageId) return;
  const row = { entryId, stageId: props.stageId };
  await undoDns(row);
  applyDns({ ...row, dns: false });
}

async function onDeleteRun(run: StageRun) {
  if (
    !(await confirm({
      title: t('live.deleteRunTitle', {
        entry: entryName(entries.value, run.entryId),
        attempt: run.attempt,
      }),
      text: t('live.deleteRunText'),
      confirmText: t('live.deleteRun'),
      color: 'error',
    }))
  )
    return;
  await deleteRun(run);
}

async function deleteRun(run: StageRun) {
  await deleteStageRun(run.id);
  stageRuns.value = stageRuns.value.filter((r) => r.id !== run.id);
  delete splitsByRun.value[run.id];
}

// ---- Stage lifecycle and start list --------------------------------------

const frozenAt = computed(() =>
  startOrder.value?.frozenAt ? formatStamp(startOrder.value.frozenAt) : null,
);

const startListStatus = computed(() =>
  !startOrder.value
    ? ''
    : startOrder.value.frozen
      ? t('live.startListPublished', { at: frozenAt.value })
      : t('live.startListProvisional'),
);

function stageTitle(stageId: string): string {
  const s = stages.value.find((st) => st.id === stageId);
  return s ? `${s.id} · ${s.name}` : stageId;
}

/**
 * Refetches every stage rather than patching just the one — a forced
 * activate can close another stage too (see `docs/architecture.md`).
 */
async function refreshStages() {
  [stages.value, gateAssignments.value] = await Promise.all([
    fetchStages(),
    fetchGateAssignments(),
  ]);
}

async function reloadStage(stageId: string) {
  await refreshStages();
  if (stageId === props.stageId) {
    startOrder.value = await fetchStartOrder(stageId);
  }
}

async function onActivateStage(force = false, delayOffered = false) {
  if (!props.stageId || activatingStage.value) return;
  if (!force && !delayOffered && !(await clearedToStart('live.activate')))
    return;
  // Before activation the first start is the first slot, frozen list or not.
  const firstSlot = stage.value?.firstStartTime;
  const minutes =
    timetable.value && firstSlot && !delayOffered
      ? catchUpDelayMinutes(
          new Date(firstSlot).getTime(),
          serverNow.value,
          countdownMs.value,
        )
      : null;
  if (minutes) {
    delayDialog.value = {
      open: true,
      text: formatStageDuration(minutes * 60_000),
      activateAfter: true,
    };
    return;
  }
  activatingStage.value = true;
  let conflictingStageIds: string[] | undefined;
  try {
    await activateStage(props.stageId, force);
    await refreshStages();
    startOrder.value = await fetchStartOrder(props.stageId);
  } catch (err) {
    conflictingStageIds =
      err instanceof ApiError && err.code === ApiErrorCode.OTHER_STAGE_ACTIVE
        ? (err.params.conflictingStageIds as string[])
        : undefined;
    if (!conflictingStageIds) throw err;
  } finally {
    activatingStage.value = false;
  }
  if (!conflictingStageIds) return;
  if (
    await confirm({
      title: t('live.conflictTitle'),
      text: t(
        'live.conflictText',
        { stages: conflictingStageIds.map(stageTitle).join(', ') },
        conflictingStageIds.length,
      ),
      confirmText: t('live.activateAnyway'),
      color: 'error',
    })
  )
    await onActivateStage(true);
}

async function onCloseStage() {
  if (!props.stageId || closingStage.value) return;
  const unassigned = passingsByStage.value.here.length;
  if (
    !(await confirm({
      title: t('live.closeTitle'),
      text:
        t('live.closeText') +
        (unassigned > 0
          ? `\n\n${t('live.closeUnassigned', { n: unassigned }, unassigned)}`
          : ''),
      confirmText: t('live.closeStage'),
      color: 'error',
    }))
  )
    return;
  closingStage.value = true;
  try {
    await closeStage(props.stageId);
    await refreshStages();
    stageRuns.value = await fetchStageRuns(props.stageId);
  } finally {
    closingStage.value = false;
  }
}

async function onFreeze() {
  if (!props.stageId) return;
  if (!(await clearedToStart('live.freeze'))) return;
  startOrder.value = await freezeStartOrder(props.stageId);
  stages.value = await fetchStages();
}

async function onUnfreeze() {
  if (!props.stageId) return;
  if (
    !(await confirm({
      title: t('live.unfreezeTitle'),
      text: t('live.unfreezeText'),
      confirmText: t('live.unfreeze'),
    }))
  )
    return;
  startOrder.value = await unfreezeStartOrder(props.stageId);
  stages.value = await fetchStages();
}

function printStartList() {
  const order = startOrder.value;
  if (!stage.value || !order) return;
  const { id, name } = stage.value;
  void printPdf(async () => ({
    sections: [
      startListPdf(
        `${t('live.startList')} — ${id} · ${name}`,
        order.frozen ? frozenAt.value : null,
        rows.value,
        order.grouped,
        order.delayMs,
      ),
    ],
    fileName: [rallyName.value, id, t('live.startList')]
      .filter(Boolean)
      .join(' - '),
  }));
}

function onSelectStage(stageId: string) {
  router.push(`/live/${stageId}`);
}

// ---- Loading -------------------------------------------------------------

async function loadStage() {
  if (!props.stageId) {
    startOrder.value = null;
    stageRuns.value = [];
    splitsByRun.value = {};
    atStartIds.value = [];
    dnsIds.value = [];
    return;
  }
  const [order, runs, splits, dns] = await Promise.all([
    fetchStartOrder(props.stageId),
    fetchStageRuns(props.stageId),
    fetchSplitsForStage(props.stageId),
    fetchDns(props.stageId),
    loadAtStart(),
  ]);
  startOrder.value = order;
  stageRuns.value = runs;
  dnsIds.value = dns.map((row) => row.entryId);
  const byRun: Record<string, StageSplit[]> = {};
  for (const split of splits) {
    (byRun[split.stageRunId] ??= []).push(split);
  }
  splitsByRun.value = byRun;
}

watch(() => props.stageId, loadStage);

/** Derived on the server; asked again whenever a pre-start detection, an
 *  assigned passing or a run of this stage may have changed it. */
async function loadAtStart() {
  if (!props.stageId) return;
  const stageId = props.stageId;
  const ids = await fetchAtStart(stageId);
  if (stageId === props.stageId) atStartIds.value = ids;
}

const preStartGateIds = computed(
  () =>
    new Set(
      gateAssignments.value
        .filter(
          (a) =>
            a.stageId === props.stageId && a.role === GateRole.STAGE_PRE_START,
        )
        .map((a) => a.gateId),
    ),
);

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
  // Stages, entries and assignments aren't pushed over SSE, so they're
  // loaded here and refreshed explicitly when an action changes them.
  [stages.value, entries.value, gateAssignments.value] = await Promise.all([
    fetchStages(),
    fetchEntries(),
    fetchGateAssignments(),
  ]);
  if (!props.stageId) {
    const fallback = defaultStage();
    if (fallback) router.replace(`/live/${fallback.id}`);
  }

  // Loaded directly too, not only once the stream opens: a browser allows six
  // connections per host, so with enough dashboard tabs open the stream can
  // sit pending, and the page would stay empty. `onOpen` reloads after a
  // reconnect, so a dropped connection doesn't leave the page quietly stale.
  const loadLive = () =>
    Promise.all([
      fetchGates().then((g) => (gates.value = g)),
      fetchPendingEvents().then((p) => (pendingDetections.value = p)),
      fetchAwaitingEvents().then((a) => (awaitingDetections.value = a)),
      fetchSetting(JUMP_START_TOLERANCE_MS_KEY).then(
        (v) =>
          (jumpStartToleranceMs.value =
            Number(v) || DEFAULT_JUMP_START_TOLERANCE_MS),
      ),
      fetchSetting(COUNTDOWN_MS_KEY).then(
        (v) => (countdownMs.value = Number(v) || DEFAULT_COUNTDOWN_MS),
      ),
      fetchSetting(JUMP_START_PENALTY_TYPE_ID_KEY).then(
        (v) => (jumpStartPenaltyTypeId.value = v || null),
      ),
      loadPenalties(),
      loadStage(),
    ]);
  // Once: Retry runs this again.
  liveSource ??= openLiveStream(
    {
      detection: (event) => {
        flashGate(event.gateId);
        if (preStartGateIds.value.has(event.gateId)) return loadAtStart();
      },
      gate: upsertGate,
      'stage-run': (run) => {
        upsertStageRun(run);
        if (run.stageId === props.stageId) return loadAtStart();
      },
      'stage-run-deleted': (run) => {
        removeStageRun(run);
        if (run.stageId === props.stageId) return loadAtStart();
      },
      'stage-run-split': upsertSplit,
      dns: applyDns,
      // Another screen moved a slot, delayed, froze or activated.
      stage: ({ stageId }) => reloadStage(stageId),
      'pending-detections': ({ pending }) => {
        pendingDetections.value = pending;
      },
      'awaiting-detections': ({ awaiting }) => {
        awaitingDetections.value = awaiting;
        return loadAtStart();
      },
    },
    loadLive,
  );
  await loadLive();
});

onUnmounted(() => {
  if (liveSource) closeLiveStream(liveSource);
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
