<script setup lang="ts">
import {
  DEFAULT_MIN_STAGE_DURATION_MS,
  GateRole,
  isOutOfEvent,
  isScrutineered,
  StageRunStatus,
  StageStatus,
  type Starter,
} from '@rally-gate/shared';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import {
  assignEntryToEvent,
  dismissEvent,
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
import { closeLiveStream, openLiveStream, upsert } from '../api/live';
import { rallyName } from '../api/rally-info';
import {
  activateStage,
  closeStage,
  fetchStages,
  type Stage,
} from '../api/stages';
import {
  createStageRun,
  deleteStageRun,
  fetchSplitsForStage,
  finishStageRunNow,
  fetchStageRuns,
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
import ClockTime from '../components/ClockTime.vue';
import GateFlow from '../components/GateFlow.vue';
import RunCorrectionDialog from '../components/RunCorrectionDialog.vue';
import PenaltyDialog from '../components/PenaltyDialog.vue';
import StatusChip from '../components/StatusChip.vue';
import RunningTime from '../components/RunningTime.vue';
import TableLegend from '../components/TableLegend.vue';
import PassingBlock from '../components/PassingBlock.vue';
import StagePicker from '../components/StagePicker.vue';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import { driverName } from '../crew';
import { formatStageDuration, t, useConfirm } from '@rally-gate/ui';
import { carriersOf, suggestEntries } from '../passing-suggestions';
import { printPdf, startListPdf } from '../pdf';
import {
  formatDuration,
  formatGap,
  formatStamp,
  gateRoleLabel,
  runStatusColor,
  entryName,
} from '../format';

const props = defineProps<{ stageId?: string }>();
const router = useRouter();

let liveSource: EventSource;

const stages = ref<Stage[]>([]);
const entries = ref<Entry[]>([]);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const startOrder = ref<StartOrder | null>(null);
const stageRuns = ref<StageRun[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const pendingDetections = ref<DetectionEventRecord[]>([]);
const awaitingDetections = ref<DetectionEventRecord[]>([]);
/** Only what a marshal picked by hand; otherwise the suggestion applies. */
const pickedEntryIds = ref<Record<string, string>>({});
const flashingGateIds = ref<Record<string, boolean>>({});
const retryingPending = ref(false);
const activatingStage = ref(false);
const closingStage = ref(false);
const confirm = useConfirm();
const stagesLoaded = ref(false);

const FLASH_DURATION_MS = 600;

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));
const entryById = computed(() => new Map(entries.value.map((v) => [v.id, v])));

// ---- Rows: every entry in start order, with its run --------------------

type RowState =
  | 'WAITING'
  | 'NEXT'
  | 'ON_STAGE'
  | 'FINISHED'
  | 'DNF'
  | 'DNS'
  | 'RERUN'
  | 'OUT';

interface Row {
  starter: Starter;
  /** The attempt that counts — an entry has at most one non-voided one. */
  run?: StageRun;
  voidedRuns: StageRun[];
  state: RowState;
  /** Set on the first row of a main-class block. */
  classHeader: string | null;
}

/** Labels are getters, so each read is in the current language. */
const ROW_STATE_DISPLAY: Record<
  RowState,
  { label: string; color: string; icon: string }
> = {
  WAITING: {
    get label() {
      return t('rowState.waiting');
    },
    color: 'timing-idle',
    icon: 'mdi-clock-outline',
  },
  NEXT: {
    get label() {
      return t('rowState.next');
    },
    color: 'info',
    icon: 'mdi-arrow-right-bold',
  },
  ON_STAGE: {
    get label() {
      return t('runState.onStage');
    },
    color: runStatusColor(StageRunStatus.STARTED),
    icon: 'mdi-car-sports',
  },
  FINISHED: {
    get label() {
      return t('rowState.finished');
    },
    color: runStatusColor(StageRunStatus.FINISHED),
    icon: 'mdi-flag-checkered',
  },
  DNF: {
    get label() {
      return t('rowState.dnf');
    },
    color: runStatusColor(StageRunStatus.CANCELLED),
    icon: 'mdi-close',
  },
  DNS: {
    get label() {
      return t('rowState.dns');
    },
    color: 'warning',
    icon: 'mdi-minus-circle-outline',
  },
  RERUN: {
    get label() {
      return t('rowState.rerun');
    },
    color: runStatusColor(StageRunStatus.VOIDED),
    icon: 'mdi-cancel',
  },
  OUT: {
    get label() {
      return t('entryStatus.withdrawn');
    },
    color: 'timing-idle',
    icon: 'mdi-account-off',
  },
};

const rows = computed<Row[]>(() => {
  const order = startOrder.value;
  if (!order) return [];
  const closed = stage.value?.status === StageStatus.CLOSED;
  const runsByEntry = new Map<string, StageRun[]>();
  for (const run of stageRuns.value) {
    runsByEntry.set(run.entryId, [
      ...(runsByEntry.get(run.entryId) ?? []),
      run,
    ]);
  }

  const base = order.starters.map((starter): Omit<Row, 'classHeader'> => {
    const runs = runsByEntry.get(starter.entryId) ?? [];
    const run = runs.find((r) => !r.voided);
    const voidedRuns = runs
      .filter((r) => r.voided)
      .sort((a, b) => a.attempt - b.attempt);
    const entry = entryById.value.get(starter.entryId);
    let state: RowState;
    if (run?.status === StageRunStatus.STARTED) state = 'ON_STAGE';
    else if (run?.status === StageRunStatus.FINISHED) state = 'FINISHED';
    else if (run?.status === StageRunStatus.CANCELLED) state = 'DNF';
    else if (entry && isOutOfEvent(entry.status)) state = 'OUT';
    else if (voidedRuns.length > 0 && !closed) state = 'RERUN';
    else state = closed ? 'DNS' : 'WAITING';
    return { starter, run, voidedRuns, state };
  });

  // Next = the first waiting car after the last one that started, so a
  // no-show is skipped rather than holding up everyone behind it.
  if (stage.value?.status === StageStatus.ACTIVE) {
    const lastStarted = base.reduce((last, row, i) => (row.run ? i : last), -1);
    const next = base.findIndex(
      (row, i) => i > lastStarted && row.state === 'WAITING',
    );
    if (next !== -1) base[next].state = 'NEXT';
  }

  return base.map((row, i) => ({
    ...row,
    classHeader:
      order.grouped &&
      (i === 0 ||
        base[i - 1].starter.mainClassName !== row.starter.mainClassName)
        ? (row.starter.mainClassName ?? t('live.noMainClass'))
        : null,
  }));
});

/** Non-zero states only, NEXT counted as waiting. */
const stateCounts = computed(() => {
  const counts = new Map<RowState, number>();
  for (const row of rows.value) {
    const state = row.state === 'NEXT' ? 'WAITING' : row.state;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const order: RowState[] = [
    'ON_STAGE',
    'WAITING',
    'FINISHED',
    'DNF',
    'DNS',
    'RERUN',
    'OUT',
  ];
  return order
    .filter((state) => counts.has(state))
    .map((state) => ({ state, count: counts.get(state)! }));
});

function isOverdue(run?: StageRun): boolean {
  const expected = stage.value?.expectedDurationMs;
  return (
    run?.status === StageRunStatus.STARTED &&
    !!expected &&
    serverNow.value - new Date(run.startTime).getTime() > expected
  );
}

function formatSplits(runId: string): string {
  const splits = splitsByRun.value[runId];
  if (!splits || splits.length === 0) return '-';
  return splits
    .map(
      (s) =>
        `${t('live.splitShort', { n: s.splitIndex })}: ${formatStageDuration(s.elapsedMs)}`,
    )
    .join(', ');
}

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

/**
 * Cars yet to start, from the next one on. Before activation there is no
 * "next" yet, so it's simply the start list's waiting cars.
 */
const dueToStart = computed(() => {
  const nextIndex = rows.value.findIndex((row) => row.state === 'NEXT');
  return rows.value
    .slice(Math.max(nextIndex, 0))
    .filter((row) => row.state === 'NEXT' || row.state === 'WAITING');
});

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
    a.role === GateRole.STAGE_START || a.role === GateRole.STAGE_START_FINISH
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
    ['NEXT', 'WAITING', 'RERUN'].includes(row.state)
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

const anyManual = computed(() =>
  rows.value.some((row) =>
    [row.run, ...row.voidedRuns].some(
      (run) => run && (run.startManual || (run.finishTime && run.finishManual)),
    ),
  ),
);

const correctionDialog = ref<InstanceType<typeof RunCorrectionDialog> | null>(
  null,
);
const penaltyDialog = ref<InstanceType<typeof PenaltyDialog> | null>(null);

async function onVoidRun(run: StageRun) {
  if (
    !(await confirm({
      title: t('live.voidTitle', {
        entry: entryName(entries.value, run.entryId),
        attempt: run.attempt,
      }),
      text: t('live.voidText'),
      confirmText: t('live.voidConfirm'),
      color: 'error',
    }))
  )
    return;
  upsertStageRun(await voidStageRun(run.id));
}

/** The server's 409 names the attempt to void first; surfaced as-is. */
async function onUnvoidRun(run: StageRun) {
  upsertStageRun(await unvoidStageRun(run.id));
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

async function onActivateStage(force = false) {
  if (!props.stageId || activatingStage.value) return;
  if (!force && !(await clearedToStart('live.activate'))) return;
  activatingStage.value = true;
  let conflictingStageIds: string[] | undefined;
  try {
    await activateStage(props.stageId, force);
    await refreshStages();
    startOrder.value = await fetchStartOrder(props.stageId);
  } catch (err) {
    conflictingStageIds =
      err instanceof ApiError && err.status === 409
        ? (err.body as { conflictingStageIds?: string[] } | null)
            ?.conflictingStageIds
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
    return;
  }
  const [order, runs, splits] = await Promise.all([
    fetchStartOrder(props.stageId),
    fetchStageRuns(props.stageId),
    fetchSplitsForStage(props.stageId),
  ]);
  startOrder.value = order;
  stageRuns.value = runs;
  const byRun: Record<string, StageSplit[]> = {};
  for (const split of splits) {
    (byRun[split.stageRunId] ??= []).push(split);
  }
  splitsByRun.value = byRun;
}

watch(() => props.stageId, loadStage);

/** The stage a marshal most likely wants: running, else next up. */
function defaultStage(): Stage | undefined {
  return (
    stages.value.find((s) => s.status === StageStatus.ACTIVE) ??
    stages.value.find((s) => s.status === StageStatus.NOT_STARTED) ??
    stages.value.at(-1)
  );
}

onMounted(async () => {
  // Stages, entries and assignments aren't pushed over SSE, so they're
  // loaded here and refreshed explicitly when an action changes them.
  [stages.value, entries.value, gateAssignments.value] = await Promise.all([
    fetchStages(),
    fetchEntries(),
    fetchGateAssignments(),
  ]);
  stagesLoaded.value = true;
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
      loadStage(),
    ]);
  liveSource = openLiveStream(
    {
      detection: (event) => flashGate(event.gateId),
      gate: upsertGate,
      'stage-run': upsertStageRun,
      'stage-run-split': upsertSplit,
      'pending-detections': ({ pending }) => {
        pendingDetections.value = pending;
      },
      'awaiting-detections': ({ awaiting }) => {
        awaitingDetections.value = awaiting;
      },
    },
    () => void loadLive(),
  );
  void loadLive();
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

  <v-alert
    v-if="stagesLoaded && stages.length === 0"
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

  <v-card v-if="stage" class="mb-4">
    <v-card-item>
      <v-card-title> {{ stage.id }} · {{ stage.name }} </v-card-title>
      <v-card-subtitle>
        {{ startListStatus }}
      </v-card-subtitle>
      <template #append>
        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED && !startOrder?.frozen
            "
            color="primary"
            prepend-icon="mdi-lock"
            @click="onFreeze"
          >
            {{ $t('live.freezeStartList') }}
          </v-btn>
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED && startOrder?.frozen
            "
            variant="text"
            prepend-icon="mdi-lock-open-variant"
            @click="onUnfreeze"
          >
            {{ $t('live.unfreeze') }}
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-printer"
            :disabled="!startOrder"
            @click="printStartList"
          >
            {{ $t('live.printStartList') }}
          </v-btn>
          <v-btn
            v-if="stage.status === StageStatus.NOT_STARTED"
            :loading="activatingStage"
            color="success"
            variant="outlined"
            prepend-icon="mdi-play"
            @click="onActivateStage()"
          >
            {{ $t('live.activateStage') }}
          </v-btn>
          <v-btn
            v-if="stage.status === StageStatus.ACTIVE"
            :loading="closingStage"
            color="error"
            variant="outlined"
            prepend-icon="mdi-flag-checkered"
            @click="onCloseStage"
          >
            {{ $t('live.closeStage') }}
          </v-btn>
        </div>
      </template>
    </v-card-item>

    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-2 mb-3">
        <v-chip
          v-for="{ state, count } in stateCounts"
          :key="state"
          :color="ROW_STATE_DISPLAY[state].color"
          :prepend-icon="ROW_STATE_DISPLAY[state].icon"
          variant="tonal"
        >
          {{ count }} {{ ROW_STATE_DISPLAY[state].label }}
        </v-chip>
      </div>
      <GateFlow :nodes="gateFlow" :flashing="flashingGateIds" />
      <v-alert
        v-if="startOrder && !startOrder.frozen"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-4"
      >
        <i18n-t keypath="live.liveStartList" scope="global">
          <template #freeze>
            <strong>{{ $t('live.freezeWhenPosted') }}</strong>
          </template>
          <template #link>
            <router-link to="/setup/start-order" class="rg-link"
              >{{ $t('nav.setup') }} → {{ $t('startOrder.title') }}</router-link
            >
          </template>
        </i18n-t>
      </v-alert>
    </v-card-text>
  </v-card>

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
    <div>
      <v-card class="h-100">
        <v-card-item>
          <v-card-title>
            {{
              stage.status === StageStatus.ACTIVE
                ? $t('live.upNext')
                : $t('live.firstToStart')
            }}
          </v-card-title>
        </v-card-item>
        <v-card-text v-if="dueToStart.length > 0">
          <div class="d-flex align-center ga-4">
            <div class="rg-next-number">
              <StartNumber :number="dueToStart[0].starter.startNumber" />
            </div>
            <CrewName :crew="dueToStart[0].starter" class="rg-next-driver" />
            <v-chip
              v-if="unscrutineered(dueToStart[0].starter.entryId)"
              color="warning"
              prepend-icon="mdi-clipboard-alert-outline"
            >
              {{ $t('live.notScrutineered') }}
            </v-chip>
            <ClassChip
              v-if="dueToStart[0].starter.mainClassName"
              :name="dueToStart[0].starter.mainClassName"
              main
              class="ms-auto"
            />
          </div>
          <v-btn
            v-if="stage.status === StageStatus.ACTIVE"
            color="primary"
            size="large"
            block
            prepend-icon="mdi-play"
            class="mt-4"
            :loading="startingEntryId === dueToStart[0].starter.entryId"
            @click="onStartNow(dueToStart[0].starter.entryId)"
          >
            {{ $t('live.startNow') }}
          </v-btn>
          <template v-if="dueToStart.length > 1">
            <v-divider class="mt-4 mb-2" />
            <div class="text-overline text-medium-emphasis">
              {{ $t('live.then') }}
            </div>
            <div class="rg-then-grid">
              <div
                v-for="row in dueToStart.slice(1, 3)"
                :key="row.starter.entryId"
                class="d-flex align-center ga-3"
              >
                <span class="rg-then-number">
                  <StartNumber :number="row.starter.startNumber" />
                </span>
                <CrewName :crew="row.starter" class="rg-then-driver" />
                <ClassChip
                  v-if="row.starter.mainClassName"
                  :name="row.starter.mainClassName"
                  main
                  class="ms-auto"
                />
              </div>
            </div>
          </template>
        </v-card-text>
        <v-card-text v-else class="rg-empty">
          {{ $t('live.allStarted') }}
        </v-card-text>
      </v-card>
    </div>
    <!-- Shown before activation too, so activating doesn't reflow the page. -->
    <div>
      <v-card class="h-100">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2">
            {{ $t('runState.onStage') }}
            <v-chip
              size="small"
              :color="runStatusColor(StageRunStatus.STARTED)"
            >
              {{ onStage.length }}
            </v-chip>
          </v-card-title>
          <v-card-subtitle>{{ $t('live.expectedOrder') }}</v-card-subtitle>
        </v-card-item>
        <!-- Every unidentified passing, a start included: a car that crossed
             the start line is on stage, and Up next stays still while the
             start marshal aims at Start now. -->
        <v-card-text v-if="passingsByStage.here.length > 0" class="pb-0">
          <PassingBlock
            v-for="[event, ...queued] in [passingsByStage.here]"
            :key="event.eventId"
            :passing="event"
            :queued="queued"
            :role="gateRole(event.gateId)"
            :gate-name="gateName(event.gateId)"
            :entry-id="entryFor(event)"
            :entry-options="entryOptionsFor(event)"
            @pick="(id) => (pickedEntryIds[event.eventId] = id)"
            @assign="onAssign(event)"
            @dismiss="onDismiss(event)"
            @dismiss-all="onDismissAll([event, ...queued])"
          />
        </v-card-text>
        <v-table density="comfortable">
          <tbody>
            <tr v-for="car in onStage" :key="car.run.id">
              <td style="width: 72px">
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
                <template v-else>{{
                  formatDuration(car.run.durationMs)
                }}</template>
              </td>
              <td style="width: 120px">
                <v-chip
                  v-if="isOverdue(car.run)"
                  size="small"
                  color="warning"
                  prepend-icon="mdi-timer-alert-outline"
                >
                  {{ $t('live.overdue') }}
                </v-chip>
              </td>
              <td class="text-right" style="width: 1%">
                <v-btn
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-flag-checkered"
                  :loading="finishingRunId === car.run.id"
                  @click="onFinishNow(car.run)"
                >
                  {{ $t('live.finishNow') }}
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text v-if="onStage.length === 0" class="rg-empty">
          {{
            stage.status === StageStatus.ACTIVE
              ? $t('live.noneOnStage')
              : $t('live.notActiveYet')
          }}
        </v-card-text>
      </v-card>
    </div>
  </div>

  <v-card v-if="stage && startOrder" class="mb-4">
    <v-table density="comfortable" class="rg-marshal-table">
      <thead>
        <tr>
          <th style="width: 56px">{{ $t('table.pos') }}</th>
          <th style="width: 72px">#</th>
          <th>{{ $t('table.crew') }}</th>
          <th v-if="!startOrder.grouped">{{ $t('classes.class') }}</th>
          <th>{{ $t('table.status') }}</th>
          <th class="rg-time">
            {{ $t('gateRole.start') }}<span class="rg-time-mark" />
          </th>
          <th class="rg-time">{{ $t('live.splits') }}</th>
          <th class="rg-time">
            {{ $t('gateRole.finish') }}<span class="rg-time-mark" />
          </th>
          <th class="rg-time">{{ $t('table.time') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.starter.entryId">
          <tr v-if="row.classHeader" class="rg-class-row">
            <td colspan="10">{{ row.classHeader }}</td>
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
                v-if="isOverdue(row.run)"
                size="small"
                color="warning"
                prepend-icon="mdi-timer-alert-outline"
                class="ml-1"
              >
                {{ $t('live.overdue') }}
              </v-chip>
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
                v-if="row.run && row.run.attempt > 1"
                class="text-caption text-medium-emphasis ml-1"
              >
                {{ $t('live.attempt', { n: row.run.attempt }) }}
              </span>
            </td>
            <td class="rg-time">
              <ClockTime
                v-if="row.run"
                :time="row.run.startTime"
                :manual="row.run.startManual"
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
              <RunningTime
                v-if="row.run?.status === StageRunStatus.STARTED"
                :start-time="row.run.startTime"
              />
              <template v-else-if="row.run">{{
                formatDuration(row.run.durationMs)
              }}</template>
            </td>
            <td class="text-no-wrap text-right">
              <v-btn
                v-if="row.run"
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="correctionDialog?.correct(row.run)"
              >
                {{ $t('live.correct') }}
              </v-btn>
              <v-btn
                v-else-if="canStart(row)"
                size="small"
                variant="text"
                prepend-icon="mdi-play"
                :loading="startingEntryId === row.starter.entryId"
                @click="onStartNow(row.starter.entryId)"
              >
                {{ $t('live.startNow') }}
              </v-btn>
              <v-menu
                v-if="!row.run && stage.status !== StageStatus.NOT_STARTED"
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
                    prepend-icon="mdi-timer-edit-outline"
                    :title="$t('live.enterTime')"
                    @click="correctionDialog?.enter(row.starter.entryId)"
                  />
                  <v-list-item
                    prepend-icon="mdi-flag-variant-outline"
                    :title="$t('penalties.add')"
                    @click="penaltyDialog?.add(row.starter.entryId, stage.id)"
                  />
                </v-list>
              </v-menu>
              <v-menu v-if="row.run">
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
                    prepend-icon="mdi-flag-variant-outline"
                    :title="$t('penalties.add')"
                    @click="penaltyDialog?.add(row.run!.entryId, stage.id)"
                  />
                  <v-list-item
                    prepend-icon="mdi-cancel"
                    :title="$t('live.voidAttempt')"
                    @click="onVoidRun(row.run!)"
                  />
                  <v-list-item
                    prepend-icon="mdi-delete"
                    :title="$t('live.deleteRun')"
                    base-color="error"
                    @click="onDeleteRun(row.run!)"
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
                size="small"
                variant="text"
                prepend-icon="mdi-restore"
                @click="onUnvoidRun(voided)"
              >
                {{ $t('live.restore') }}
              </v-btn>
              <v-menu>
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
                    @click="onDeleteRun(voided)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
        </template>
        <tr v-if="rows.length === 0">
          <td colspan="10" class="rg-empty">
            {{ $t('live.noEntries') }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <div class="px-4 pb-3">
      <TableLegend :marks="anyManual ? ['manual'] : []" />
    </div>
  </v-card>

  <RunCorrectionDialog
    v-if="props.stageId"
    ref="correctionDialog"
    :stage-id="props.stageId"
    :entries="entries"
    @saved="upsertStageRun"
  />
  <PenaltyDialog ref="penaltyDialog" :stages="stages" :entries="entries" />
</template>

<style scoped>
.rg-class-row td {
  font-family: 'Barlow Condensed', sans-serif;
  font-weight: 600;
  font-size: 1.05rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* Up next beside On stage; stacked below Vuetify's md breakpoint. */
.rg-stage-flow {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 16px;
}
@media (max-width: 959px) {
  .rg-stage-flow {
    grid-template-columns: 1fr;
  }
}

/* Readable from a tablet at arm's length or more. */
.rg-next-number {
  font-size: 3.5rem;
}

.rg-then-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.rg-then-number {
  font-size: 2rem;
}
.rg-then-driver {
  font-size: 1.1rem;
}

.rg-next-driver {
  font-size: 1.75rem;
}

/* The next car is a marshal's main cue, so it gets more than the chip. */
.rg-next-row td {
  background: rgba(var(--v-theme-info), 0.12);
}
.rg-next-row td:first-child {
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-info));
}

.rg-voided-row td {
  opacity: 0.6;
}
</style>
