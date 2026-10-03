<script setup lang="ts">
import {
  GateRole,
  StageRunStatus,
  StageStatus,
  VehicleStatus,
  type StartOrderEntry,
} from '@rally-gate/shared';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import {
  assignVehicleToEvent,
  dismissEvent,
  fetchAwaitingEvents,
  fetchPendingEvents,
  fetchRecentEvents,
  retryPendingEvents,
  type DetectionEventRecord,
} from '../api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGates, type Gate } from '../api/gates';
import { serverOffsetMs } from '../api/time';
import { closeLiveStream, openLiveStream } from '../api/live';
import { rallyName } from '../api/rally-info';
import {
  activateStage,
  closeStage,
  fetchStages,
  type Stage,
} from '../api/stages';
import {
  correctStageRun,
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
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import FormDialog from '../components/FormDialog.vue';
import ManualMark from '../components/ManualMark.vue';
import PassingBlock from '../components/PassingBlock.vue';
import StagePicker from '../components/StagePicker.vue';
import {
  formatClockTime,
  formatStageDuration,
  openTimePicker,
  useConfirm,
} from '@rally-gate/ui';
import {
  combineDateAndTime,
  formatDuration,
  formatGap,
  gateStatusColor,
  gateRoleLabel,
  gateStatusIcon,
  isOnline,
  isReady,
  runStatusColor,
  required,
  toLocalTimeValue,
  vehicleName,
} from '../format';

const props = defineProps<{ stageId?: string }>();
const router = useRouter();

// Server time: run start times come from gate clocks synced to it.
const now = ref(Date.now() + serverOffsetMs.value);
let nowTimer: ReturnType<typeof setInterval>;
let liveSource: EventSource;

const stages = ref<Stage[]>([]);
const vehicles = ref<Vehicle[]>([]);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const startOrder = ref<StartOrder | null>(null);
const stageRuns = ref<StageRun[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const detections = ref<DetectionEventRecord[]>([]);
const pendingDetections = ref<DetectionEventRecord[]>([]);
const awaitingDetections = ref<DetectionEventRecord[]>([]);
/** Only what a marshal picked by hand; otherwise the suggestion applies. */
const pickedVehicleIds = ref<Record<string, string>>({});
const flashingGateIds = ref<Record<string, boolean>>({});
const retryingPending = ref(false);
const activatingStage = ref(false);
const closingStage = ref(false);
const confirm = useConfirm();
const stagesLoaded = ref(false);

const FLASH_DURATION_MS = 600;
const OUT_OF_EVENT = [VehicleStatus.WITHDRAWN, VehicleStatus.DISQUALIFIED];

const stage = computed(() => stages.value.find((s) => s.id === props.stageId));
const vehicleById = computed(
  () => new Map(vehicles.value.map((v) => [v.id, v])),
);

// ---- Rows: every vehicle in start order, with its run --------------------

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
  entry: StartOrderEntry;
  /** The attempt that counts — a vehicle has at most one non-voided one. */
  run?: StageRun;
  voidedRuns: StageRun[];
  state: RowState;
  /** Set on the first row of a main-class block. */
  classHeader: string | null;
}

const ROW_STATE_DISPLAY: Record<
  RowState,
  { label: string; color: string; icon: string }
> = {
  WAITING: {
    label: 'Waiting',
    color: 'timing-idle',
    icon: 'mdi-clock-outline',
  },
  NEXT: { label: 'Next', color: 'info', icon: 'mdi-arrow-right-bold' },
  ON_STAGE: {
    label: 'On stage',
    color: runStatusColor('STARTED'),
    icon: 'mdi-car-sports',
  },
  FINISHED: {
    label: 'Finished',
    color: runStatusColor('FINISHED'),
    icon: 'mdi-flag-checkered',
  },
  DNF: { label: 'DNF', color: runStatusColor('CANCELLED'), icon: 'mdi-close' },
  DNS: { label: 'DNS', color: 'warning', icon: 'mdi-minus-circle-outline' },
  RERUN: {
    label: 'Voided — re-run',
    color: runStatusColor('VOIDED'),
    icon: 'mdi-cancel',
  },
  OUT: { label: 'Withdrawn', color: 'timing-idle', icon: 'mdi-account-off' },
};

const rows = computed<Row[]>(() => {
  const order = startOrder.value;
  if (!order) return [];
  const closed = stage.value?.status === StageStatus.CLOSED;
  const runsByVehicle = new Map<string, StageRun[]>();
  for (const run of stageRuns.value) {
    runsByVehicle.set(run.vehicleId, [
      ...(runsByVehicle.get(run.vehicleId) ?? []),
      run,
    ]);
  }

  const base = order.entries.map((entry): Omit<Row, 'classHeader'> => {
    const runs = runsByVehicle.get(entry.vehicleId) ?? [];
    const run = runs.find((r) => !r.voided);
    const voidedRuns = runs
      .filter((r) => r.voided)
      .sort((a, b) => a.attempt - b.attempt);
    const vehicle = vehicleById.value.get(entry.vehicleId);
    let state: RowState;
    if (run?.status === StageRunStatus.STARTED) state = 'ON_STAGE';
    else if (run?.status === StageRunStatus.FINISHED) state = 'FINISHED';
    else if (run?.status === StageRunStatus.CANCELLED) state = 'DNF';
    else if (vehicle && OUT_OF_EVENT.includes(vehicle.status)) state = 'OUT';
    else if (voidedRuns.length > 0 && !closed) state = 'RERUN';
    else state = closed ? 'DNS' : 'WAITING';
    return { entry, run, voidedRuns, state };
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
      (i === 0 || base[i - 1].entry.mainClassName !== row.entry.mainClassName)
        ? (row.entry.mainClassName ?? 'No main class')
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

function runDurationDisplay(run: StageRun): string {
  if (run.status === StageRunStatus.STARTED) {
    // Clamped: `now` ticks once a second, so a run started since the last
    // tick would otherwise read as negative.
    return formatStageDuration(
      Math.max(0, now.value - new Date(run.startTime).getTime()),
    );
  }
  return formatDuration(run.durationMs);
}

function isOverdue(run?: StageRun): boolean {
  const expected = stage.value?.expectedDurationMs;
  return (
    run?.status === StageRunStatus.STARTED &&
    !!expected &&
    now.value - new Date(run.startTime).getTime() > expected
  );
}

function formatSplits(runId: string): string {
  const splits = splitsByRun.value[runId];
  if (!splits || splits.length === 0) return '-';
  return splits
    .map((s) => `S${s.splitIndex}: ${formatStageDuration(s.elapsedMs)}`)
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

// ---- Unassigned passings, with a suggested vehicle -----------------------

const vehicleOptions = computed(() =>
  vehicles.value.map((v) => ({
    id: v.id,
    title: `#${v.startNumber} ${v.driverName}`,
  })),
);

/**
 * A suggestion only pre-selects, it never assigns: a wrong assignment is a
 * wrong time nobody notices in the results. Passings are matched in time
 * order — at a start gate to the cars due to start in start order, at a split
 * or finish to the cars on stage in expected arrival order — each car
 * suggested once. Passings at another stage's gates get no suggestion; this
 * page only knows its stage.
 */
const suggestedVehicleIds = computed(() => {
  const suggestions: Record<string, string> = {};
  const taken = new Set<string>();
  const running = onStage.value.map((car) => car.row);
  const byTime = [...awaitingDetections.value].sort(
    (a, b) =>
      new Date(a.timestampGate).getTime() - new Date(b.timestampGate).getTime(),
  );
  for (const event of byTime) {
    const assignment = gateAssignments.value.find(
      (a) => a.active && a.gateId === event.gateId,
    );
    if (!assignment || assignment.stageId !== props.stageId) continue;
    const candidates =
      assignment.role === GateRole.STAGE_START
        ? dueToStart.value
        : assignment.role === GateRole.STAGE_SPLIT ||
            assignment.role === GateRole.STAGE_FINISH
          ? running
          : [];
    const pick = candidates.find(
      (row) =>
        !taken.has(row.entry.vehicleId) &&
        (assignment.role !== GateRole.STAGE_SPLIT ||
          !splitsByRun.value[row.run?.id ?? '']?.some(
            (s) => s.splitIndex === assignment.splitIndex,
          )),
    );
    if (pick) {
      suggestions[event.eventId] = pick.entry.vehicleId;
      taken.add(pick.entry.vehicleId);
    }
  }
  return suggestions;
});

function vehicleFor(event: DetectionEventRecord): string | undefined {
  return (
    pickedVehicleIds.value[event.eventId] ??
    suggestedVehicleIds.value[event.eventId]
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
  const isStart = (gateId: string) =>
    gateAssignments.value.some(
      (a) =>
        a.active &&
        a.gateId === gateId &&
        a.stageId === props.stageId &&
        a.role === GateRole.STAGE_START,
    );
  return {
    // Shown where the car is: a start in Up next, the rest in On stage.
    starts: here.filter((event) => isStart(event.gateId)),
    onCourse: here.filter((event) => !isStart(event.gateId)),
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
  const vehicleId = vehicleFor(event);
  if (!vehicleId) return;
  await assignVehicleToEvent(event.eventId, vehicleId);
  delete pickedVehicleIds.value[event.eventId];
  awaitingDetections.value = await fetchAwaitingEvents();
}

async function onDismiss(event: DetectionEventRecord) {
  await dismissEvent(event.eventId);
  awaitingDetections.value = await fetchAwaitingEvents();
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
    a.role === GateRole.STAGE_START
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

function gateStatusText(gate: Gate): string {
  if (!isOnline(gate, now.value)) return 'Offline';
  return isReady(gate, now.value) ? 'Ready' : 'Clock not synced';
}

const stageDetections = computed(() => {
  const gateIds = new Set(
    gateAssignments.value
      .filter((a) => a.active && a.stageId === props.stageId)
      .map((a) => a.gateId),
  );
  return detections.value.filter((event) => gateIds.has(event.gateId));
});

function flashGate(gateId: string) {
  flashingGateIds.value[gateId] = true;
  setTimeout(() => {
    flashingGateIds.value[gateId] = false;
  }, FLASH_DURATION_MS);
}

function upsertGate(gate: Gate) {
  const idx = gates.value.findIndex((g) => g.id === gate.id);
  if (idx === -1) gates.value.push(gate);
  else gates.value[idx] = gate;
  flashGate(gate.id);
}

// ---- Runs and corrections ------------------------------------------------

function upsertStageRun(run: StageRun) {
  if (run.stageId !== props.stageId) return;
  const idx = stageRuns.value.findIndex((r) => r.id === run.id);
  if (idx === -1) stageRuns.value.unshift(run);
  else stageRuns.value[idx] = run;
}

function upsertSplit(split: StageSplit) {
  const splits = splitsByRun.value[split.stageRunId] ?? [];
  splitsByRun.value[split.stageRunId] = [
    ...splits.filter((s) => s.id !== split.id),
    split,
  ].sort((a, b) => a.splitIndex - b.splitIndex);
}

const startingVehicleId = ref<string | null>(null);

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

function canStart(row: Row): boolean {
  return (
    stage.value?.status === StageStatus.ACTIVE &&
    ['NEXT', 'WAITING', 'RERUN'].includes(row.state)
  );
}

/** The server stamps the start, so its clock counts, not this device's. */
async function onStartNow(vehicleId: string) {
  if (!props.stageId || startingVehicleId.value) return;
  startingVehicleId.value = vehicleId;
  try {
    upsertStageRun(await createStageRun({ vehicleId, stageId: props.stageId }));
  } finally {
    startingVehicleId.value = null;
  }
}

const correctDialogOpen = ref(false);
const correcting = ref<StageRun | null>(null);
const correction = ref({ start: '', finish: '' });

function openCorrect(run: StageRun) {
  correcting.value = run;
  correction.value = {
    start: toLocalTimeValue(run.startTime),
    finish: toLocalTimeValue(run.finishTime),
  };
  correctDialogOpen.value = true;
}

/**
 * Sends only the times that changed: the fields hold whole seconds, so
 * resending an untouched time would drop its milliseconds and mark a gate's
 * time as hand-set.
 */
async function onSaveCorrection() {
  const run = correcting.value;
  if (!run) return;
  const { start } = correction.value;
  const finish = correction.value.finish || '';
  const patch: { startTime?: string; finishTime?: string | null } = {};
  if (start !== toLocalTimeValue(run.startTime)) {
    patch.startTime = combineDateAndTime(run.startTime, start);
  }
  if (finish !== toLocalTimeValue(run.finishTime)) {
    patch.finishTime = finish
      ? combineDateAndTime(run.finishTime ?? run.startTime, finish)
      : null;
  }
  if (Object.keys(patch).length === 0) return;
  upsertStageRun(await correctStageRun(run.id, patch));
}

async function onVoidRun(run: StageRun) {
  if (
    !(await confirm({
      title: `Void ${vehicleName(vehicles.value, run.vehicleId)}'s attempt ${run.attempt}?`,
      text:
        'It stays on record but stops counting, and the car can run this stage again — ' +
        'the start gate will time the new attempt automatically.',
      confirmText: 'Void attempt',
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
      title: `Delete ${vehicleName(vehicles.value, run.vehicleId)}'s attempt ${run.attempt}?`,
      text: 'Unlike voiding, this leaves no record. Use it for a run that never happened.',
      confirmText: 'Delete attempt',
      color: 'error',
    }))
  )
    return;
  await deleteStageRun(run.id);
  stageRuns.value = stageRuns.value.filter((r) => r.id !== run.id);
  delete splitsByRun.value[run.id];
}

// ---- Stage lifecycle and start list --------------------------------------

/** With the day: a list is often posted the evening before. */
const frozenAt = computed(() =>
  startOrder.value?.frozenAt
    ? new Date(startOrder.value.frozenAt).toLocaleString([], {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null,
);

const startListStatus = computed(() =>
  !startOrder.value
    ? ''
    : startOrder.value.frozen
      ? `Start list published ${frozenAt.value}`
      : 'Start list provisional',
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
  stages.value = await fetchStages();
  gateAssignments.value = await fetchGateAssignments();
}

async function onActivateStage(force = false) {
  if (!props.stageId || activatingStage.value) return;
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
  const plural = conflictingStageIds.length > 1;
  if (
    await confirm({
      title: 'Gates already active elsewhere',
      text:
        `This stage shares gates with the currently active ${plural ? 'stages' : 'stage'}: ` +
        `${conflictingStageIds.map(stageTitle).join(', ')}. Activating anyway will close ` +
        `${plural ? 'those stages' : 'that stage'} — any of its cars still on course will be marked DNF.`,
      confirmText: 'Activate anyway',
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
      title: 'Close this stage?',
      text:
        'Its gates stop timing, cars still on stage become DNF and cars that never started DNS. Closing cannot be undone.' +
        (unassigned > 0
          ? `\n\n${unassigned} unassigned passing${unassigned === 1 ? '' : 's'} will be discarded: a car may be missing a time. Assign ${unassigned === 1 ? 'it' : 'them'} first.`
          : ''),
      confirmText: 'Close stage',
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
  startOrder.value = await freezeStartOrder(props.stageId);
  stages.value = await fetchStages();
}

async function onUnfreeze() {
  if (!props.stageId) return;
  if (
    !(await confirm({
      title: 'Unfreeze this start list?',
      text: 'It is computed live again, so a posted copy may stop matching it.',
      confirmText: 'Unfreeze',
    }))
  )
    return;
  startOrder.value = await unfreezeStartOrder(props.stageId);
  stages.value = await fetchStages();
}

function print() {
  window.print();
}

function onSelectStage(stageId: string) {
  router.push(`/live/${stageId}`);
}

// ---- Loading -------------------------------------------------------------

async function loadStage() {
  correctDialogOpen.value = false;
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
  // Stages, vehicles and assignments aren't pushed over SSE, so they're
  // loaded here and refreshed explicitly when an action changes them.
  [stages.value, vehicles.value, gateAssignments.value] = await Promise.all([
    fetchStages(),
    fetchVehicles(),
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
      fetchRecentEvents().then((d) => (detections.value = d)),
      fetchGates().then((g) => (gates.value = g)),
      fetchPendingEvents().then((p) => (pendingDetections.value = p)),
      fetchAwaitingEvents().then((a) => (awaitingDetections.value = a)),
      loadStage(),
    ]);
  liveSource = openLiveStream(
    {
      detection: (event) => {
        detections.value.unshift(event);
        flashGate(event.gateId);
      },
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

  nowTimer = setInterval(() => {
    now.value = Date.now() + serverOffsetMs.value;
  }, 1000);
});

onUnmounted(() => {
  if (liveSource) closeLiveStream(liveSource);
  clearInterval(nowTimer);
});
</script>

<template>
  <v-alert
    v-if="pendingDetections.length > 0"
    type="error"
    variant="tonal"
    class="mb-4 d-print-none"
    icon="mdi-alert-circle-outline"
  >
    <div class="d-flex flex-wrap align-center ga-4">
      <div>
        <strong>
          {{ pendingDetections.length }} detection{{
            pendingDetections.length === 1 ? '' : 's'
          }}
          recorded but not timed.
        </strong>
        These passings are stored, but the run they belong to was not updated —
        so a start or finish is missing from the results. The server keeps
        retrying; if the count doesn't clear, fix the run by hand below.
        <div class="text-caption mt-1">
          Gates affected:
          {{ [...new Set(pendingDetections.map((d) => d.gateId))].join(', ') }}
        </div>
      </div>
      <v-spacer />
      <v-btn
        :loading="retryingPending"
        variant="outlined"
        prepend-icon="mdi-refresh"
        @click="onRetryPending"
      >
        Retry now
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
    No stages yet — create them under
    <router-link to="/setup/stages">Setup → Stages</router-link>.
  </v-alert>

  <v-card v-if="stage" class="mb-4">
    <v-card-item>
      <v-card-title>
        <span class="d-none d-print-inline">Start list — </span>{{ stage.id }} ·
        {{ stage.name }}
      </v-card-title>
      <v-card-subtitle>
        <!-- The app bar names the rally on screen; a print has no app bar. -->
        <span v-if="rallyName" class="d-none d-print-inline"
          >{{ rallyName }} ·
        </span>
        {{ startListStatus }}
      </v-card-subtitle>
      <template #append>
        <div class="d-flex flex-wrap justify-end ga-2 d-print-none">
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED && !startOrder?.frozen
            "
            color="primary"
            prepend-icon="mdi-lock"
            @click="onFreeze"
          >
            Freeze start list
          </v-btn>
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED && startOrder?.frozen
            "
            variant="text"
            prepend-icon="mdi-lock-open-variant"
            @click="onUnfreeze"
          >
            Unfreeze
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-printer"
            :disabled="!startOrder"
            @click="print"
          >
            Print start list
          </v-btn>
          <v-btn
            v-if="stage.status === StageStatus.NOT_STARTED"
            :loading="activatingStage"
            color="success"
            variant="outlined"
            prepend-icon="mdi-play"
            @click="onActivateStage()"
          >
            Activate stage
          </v-btn>
          <v-btn
            v-if="stage.status === StageStatus.ACTIVE"
            :loading="closingStage"
            color="error"
            variant="outlined"
            prepend-icon="mdi-flag-checkered"
            @click="onCloseStage"
          >
            Close stage
          </v-btn>
        </div>
      </template>
    </v-card-item>

    <v-card-text class="d-print-none">
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
      <template v-if="gateFlow.length > 0">
        <div class="rg-gate-scroll">
          <div class="rg-gate-flow" :style="{ '--gates': gateFlow.length }">
            <div
              v-for="node in gateFlow"
              :key="node.gate.id"
              class="rg-gate-node"
              :title="`${node.gate.name}: ${gateStatusText(node.gate)}`"
            >
              <span
                class="rg-gate-icon"
                :class="{ 'gate-flash': flashingGateIds[node.gate.id] }"
              >
                <v-icon
                  :icon="gateStatusIcon(node.gate, now)"
                  :color="gateStatusColor(node.gate, now)"
                />
              </span>
              <div class="text-caption font-weight-bold">{{ node.label }}</div>
              <div class="text-caption text-medium-emphasis rg-gate-name">
                {{ node.gate.name }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="text-medium-emphasis">
        No gates assigned to this stage yet.
      </div>
      <v-alert
        v-if="startOrder && !startOrder.frozen"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-4"
      >
        The start list is computed live, so a time correction on an earlier
        stage can still move it.
        <strong>Freeze it when you post or announce it</strong> — activating the
        stage freezes it otherwise. Order rules are under
        <router-link to="/setup/start-order">Setup → Start order</router-link>.
      </v-alert>
    </v-card-text>
  </v-card>

  <v-alert
    v-if="passingsByStage.elsewhere.length > 0"
    type="warning"
    variant="tonal"
    density="compact"
    class="mb-4 d-print-none"
  >
    <div
      v-for="{ stageId, count } in passingsByStage.elsewhere"
      :key="stageId"
      class="d-flex align-center flex-wrap ga-2"
    >
      {{ count }} unassigned passing{{ count === 1 ? '' : 's' }} on
      {{ stageTitle(stageId) }}
      <v-spacer />
      <v-btn
        :to="`/live/${stageId}`"
        size="small"
        variant="tonal"
        append-icon="mdi-arrow-right"
      >
        Open {{ stageId }}
      </v-btn>
    </div>
  </v-alert>

  <div
    v-if="stage && stage.status !== StageStatus.CLOSED"
    class="rg-stage-flow mb-4 d-print-none"
  >
    <div>
      <v-card class="h-100">
        <v-card-item>
          <v-card-title>
            {{
              stage.status === StageStatus.ACTIVE ? 'Up next' : 'First to start'
            }}
          </v-card-title>
        </v-card-item>
        <v-card-text
          v-if="passingsByStage.starts.length > 0"
          class="d-flex flex-column ga-2 pb-0"
        >
          <PassingBlock
            v-for="event in passingsByStage.starts"
            :key="event.eventId"
            :passing="event"
            :role="gateRole(event.gateId)"
            :gate-name="gateName(event.gateId)"
            :vehicle-id="vehicleFor(event)"
            :vehicle-options="vehicleOptions"
            @pick="(id) => (pickedVehicleIds[event.eventId] = id)"
            @assign="onAssign(event)"
            @dismiss="onDismiss(event)"
          />
        </v-card-text>
        <v-card-text v-if="dueToStart.length > 0">
          <div class="d-flex align-center ga-4">
            <div class="rg-timing rg-next-number">
              #{{ dueToStart[0].entry.startNumber }}
            </div>
            <div>
              <div class="rg-next-driver">
                {{ dueToStart[0].entry.driverName }}
              </div>
              <div class="text-medium-emphasis">
                {{ dueToStart[0].entry.mainClassName }}
              </div>
            </div>
          </div>
          <v-btn
            v-if="stage.status === StageStatus.ACTIVE"
            color="primary"
            size="large"
            block
            prepend-icon="mdi-play"
            class="mt-4"
            :loading="startingVehicleId === dueToStart[0].entry.vehicleId"
            @click="onStartNow(dueToStart[0].entry.vehicleId)"
          >
            Start now
          </v-btn>
          <template v-if="dueToStart.length > 1">
            <v-divider class="mt-4 mb-2" />
            <div class="text-overline text-medium-emphasis">Then</div>
            <div class="rg-then-grid">
              <div
                v-for="row in dueToStart.slice(1, 3)"
                :key="row.entry.vehicleId"
                class="d-flex align-center ga-3"
              >
                <span class="rg-timing rg-then-number">
                  #{{ row.entry.startNumber }}
                </span>
                <div>
                  <div class="rg-then-driver">{{ row.entry.driverName }}</div>
                  <div class="text-medium-emphasis">
                    {{ row.entry.mainClassName }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-card-text v-else class="text-medium-emphasis">
          Everyone has started.
        </v-card-text>
      </v-card>
    </div>
    <!-- Shown before activation too, so activating doesn't reflow the page. -->
    <div>
      <v-card class="h-100">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2">
            On stage
            <v-chip size="small" :color="runStatusColor('STARTED')">
              {{ onStage.length }}
            </v-chip>
          </v-card-title>
          <v-card-subtitle>Expected order at the next gate</v-card-subtitle>
        </v-card-item>
        <v-card-text
          v-if="passingsByStage.onCourse.length > 0"
          class="d-flex flex-column ga-2 pb-0"
        >
          <PassingBlock
            v-for="event in passingsByStage.onCourse"
            :key="event.eventId"
            :passing="event"
            :role="gateRole(event.gateId)"
            :gate-name="gateName(event.gateId)"
            :vehicle-id="vehicleFor(event)"
            :vehicle-options="vehicleOptions"
            @pick="(id) => (pickedVehicleIds[event.eventId] = id)"
            @assign="onAssign(event)"
            @dismiss="onDismiss(event)"
          />
        </v-card-text>
        <v-table density="comfortable">
          <tbody>
            <tr v-for="car in onStage" :key="car.run.id">
              <td class="rg-timing font-weight-bold" style="width: 72px">
                #{{ car.row.entry.startNumber }}
              </td>
              <td class="text-no-wrap">{{ car.row.entry.driverName }}</td>
              <td v-if="splitIndices.length > 0" class="text-no-wrap">
                <v-icon
                  v-for="index in splitIndices"
                  :key="index"
                  :icon="
                    car.passed.has(index) ? 'mdi-circle' : 'mdi-circle-outline'
                  "
                  :color="car.passed.has(index) ? 'success' : undefined"
                  :title="`Split ${index}`"
                  size="x-small"
                  class="mr-1"
                />
                <v-icon
                  icon="mdi-flag-checkered"
                  size="x-small"
                  title="Finish"
                  class="text-medium-emphasis"
                />
              </td>
              <td class="rg-timing text-no-wrap">
                <template v-if="car.last">
                  S{{ car.last.splitIndex }}
                  {{ formatStageDuration(car.last.elapsedMs) }}
                  <span class="text-medium-emphasis">
                    {{ car.gapMs ? formatGap(car.gapMs) : 'best' }}
                  </span>
                </template>
              </td>
              <td class="rg-timing text-right text-h6">
                {{ runDurationDisplay(car.run) }}
              </td>
              <td style="width: 120px">
                <v-chip
                  v-if="isOverdue(car.run)"
                  size="small"
                  color="warning"
                  prepend-icon="mdi-timer-alert-outline"
                >
                  Overdue
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
                  Finish now
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>
        <v-card-text v-if="onStage.length === 0" class="text-medium-emphasis">
          {{
            stage.status === StageStatus.ACTIVE
              ? 'No car on stage.'
              : 'Stage not active yet — cars appear here once they start.'
          }}
        </v-card-text>
      </v-card>
    </div>
  </div>

  <v-card v-if="stage && startOrder" class="mb-4">
    <v-table density="comfortable" class="rg-marshal-table">
      <thead>
        <tr>
          <th style="width: 56px">Pos</th>
          <th style="width: 72px">#</th>
          <th>Driver</th>
          <th class="d-none d-print-table-cell">Co-driver</th>
          <th v-if="!startOrder.grouped">Class</th>
          <th class="d-print-none">Status</th>
          <th class="d-print-none">Start</th>
          <th class="d-print-none">Splits</th>
          <th class="d-print-none">Finish</th>
          <th class="d-print-none">Time</th>
          <th class="d-print-none"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.entry.vehicleId">
          <tr v-if="row.classHeader" class="rg-class-row">
            <td colspan="11">{{ row.classHeader }}</td>
          </tr>
          <tr :class="{ 'rg-next-row': row.state === 'NEXT' }">
            <td class="rg-timing">{{ row.entry.position }}</td>
            <td class="rg-timing font-weight-bold">
              {{ row.entry.startNumber }}
            </td>
            <td class="text-no-wrap">{{ row.entry.driverName }}</td>
            <td class="d-none d-print-table-cell">
              {{ row.entry.coDriverName }}
            </td>
            <td v-if="!startOrder.grouped">{{ row.entry.mainClassName }}</td>
            <td class="d-print-none text-no-wrap">
              <v-chip
                size="small"
                :color="ROW_STATE_DISPLAY[row.state].color"
                :prepend-icon="ROW_STATE_DISPLAY[row.state].icon"
              >
                {{ ROW_STATE_DISPLAY[row.state].label }}
              </v-chip>
              <v-chip
                v-if="isOverdue(row.run)"
                size="small"
                color="warning"
                prepend-icon="mdi-timer-alert-outline"
                class="ml-1"
              >
                Overdue
              </v-chip>
              <span
                v-if="row.run && row.run.attempt > 1"
                class="text-caption text-medium-emphasis ml-1"
              >
                attempt {{ row.run.attempt }}
              </span>
            </td>
            <td class="d-print-none">
              <span v-if="row.run" class="rg-timing text-no-wrap">
                {{ formatClockTime(row.run.startTime) }}
                <ManualMark v-if="row.run.startManual" />
              </span>
            </td>
            <td class="d-print-none rg-timing text-no-wrap">
              {{ row.run ? formatSplits(row.run.id) : '' }}
            </td>
            <td class="d-print-none">
              <span v-if="row.run?.finishTime" class="rg-timing text-no-wrap">
                {{ formatClockTime(row.run.finishTime) }}
                <ManualMark v-if="row.run.finishManual" />
              </span>
            </td>
            <td class="d-print-none rg-timing">
              {{ row.run ? runDurationDisplay(row.run) : '' }}
            </td>
            <td class="d-print-none text-no-wrap text-right">
              <v-btn
                v-if="row.run"
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openCorrect(row.run)"
              >
                Correct
              </v-btn>
              <v-btn
                v-else-if="canStart(row)"
                size="small"
                variant="text"
                prepend-icon="mdi-play"
                :loading="startingVehicleId === row.entry.vehicleId"
                @click="onStartNow(row.entry.vehicleId)"
              >
                Start now
              </v-btn>
              <v-menu v-if="row.run">
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    size="small"
                    variant="text"
                    icon="mdi-dots-vertical"
                    aria-label="More actions"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-cancel"
                    title="Void attempt (red flag)"
                    @click="onVoidRun(row.run!)"
                  />
                  <v-list-item
                    prepend-icon="mdi-delete"
                    title="Delete attempt"
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
            class="rg-voided-row d-print-none"
          >
            <td colspan="3"></td>
            <td v-if="!startOrder.grouped"></td>
            <td class="text-no-wrap">
              <v-chip size="small" variant="outlined" prepend-icon="mdi-cancel">
                Voided
              </v-chip>
              <span class="text-caption ml-1"
                >attempt {{ voided.attempt }}</span
              >
            </td>
            <td class="rg-timing text-no-wrap">
              {{ formatClockTime(voided.startTime) }}
              <ManualMark v-if="voided.startManual" />
            </td>
            <td class="rg-timing">{{ formatSplits(voided.id) }}</td>
            <td class="rg-timing">
              {{ voided.finishTime ? formatClockTime(voided.finishTime) : '' }}
              <ManualMark v-if="voided.finishTime && voided.finishManual" />
            </td>
            <td class="rg-timing">{{ formatDuration(voided.durationMs) }}</td>
            <td class="text-no-wrap text-right">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-restore"
                @click="onUnvoidRun(voided)"
              >
                Restore
              </v-btn>
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    size="small"
                    variant="text"
                    icon="mdi-dots-vertical"
                    aria-label="More actions"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete"
                    title="Delete attempt"
                    base-color="error"
                    @click="onDeleteRun(voided)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
        </template>
      </tbody>
    </v-table>
  </v-card>

  <v-expansion-panels v-if="stage" class="d-print-none">
    <v-expansion-panel>
      <v-expansion-panel-title>
        Raw detections ({{ stageDetections.length }})
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Gate</th>
              <th>Transponder</th>
              <th>Vehicle</th>
              <th>Gate Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in stageDetections" :key="event.eventId">
              <td>{{ gateName(event.gateId) }}</td>
              <td>{{ event.transponderId ?? '-' }}</td>
              <td>
                {{
                  event.vehicleId
                    ? vehicleName(vehicles, event.vehicleId)
                    : 'unknown'
                }}
              </td>
              <td class="rg-timing">
                {{ formatClockTime(event.timestampGate) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>

  <FormDialog
    v-model="correctDialogOpen"
    :title="
      correcting
        ? `Correct ${vehicleName(vehicles, correcting.vehicleId)}, attempt ${correcting.attempt}`
        : ''
    "
    :form="correction"
    :save="onSaveCorrection"
    saved="Times corrected"
  >
    <p class="text-body-2 text-medium-emphasis">
      Time of day, to the second. A corrected time is marked as hand-set.
    </p>
    <v-text-field
      v-model="correction.start"
      type="time"
      step="1"
      label="Start"
      class="rg-timing"
      append-inner-icon="mdi-clock-outline"
      :rules="[required]"
      @click:append-inner="openTimePicker"
    />
    <v-text-field
      v-model="correction.finish"
      type="time"
      step="1"
      label="Finish"
      class="rg-timing"
      hint="Empty while the car is still on stage"
      persistent-hint
      clearable
      append-inner-icon="mdi-clock-outline"
      @click:append-inner="openTimePicker"
    />
  </FormDialog>
</template>

<style scoped>
/*
 * Gates as nodes on one track, like the stage itself. Every node gets the
 * same width, so the track runs from the first icon's centre to the last
 * one's: half a node in from each side. Too many for the width scrolls
 * sideways rather than squeezing gates out.
 */
.rg-gate-scroll {
  overflow-x: auto;
  /* Scrolling clips vertically too; room for the passing pulse. */
  padding: 10px 0 4px;
}
.rg-gate-flow {
  position: relative;
  display: flex;
  min-width: calc(var(--gates) * 80px);
}
.rg-gate-flow::before {
  content: '';
  position: absolute;
  top: 15px;
  left: calc(50% / var(--gates));
  right: calc(50% / var(--gates));
  height: 2px;
  background: rgb(var(--v-border-color));
}
.rg-gate-node {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 4px;
}
/* A round node that cuts the track behind it; the passing pulse rings it. */
.rg-gate-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
}
.rg-gate-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gate-flash {
  animation: gate-flash-pulse 0.6s ease-out;
}

@keyframes gate-flash-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.7);
  }
  100% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-primary), 0);
  }
}

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
/* Its own display would override Vuetify's d-print-none. */
@media print {
  .rg-stage-flow {
    display: none;
  }
}

/* Readable from a tablet at arm's length or more. */
.rg-next-number {
  font-size: 3.5rem;
  font-weight: 700;
  line-height: 1;
}

.rg-then-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.rg-then-number {
  font-size: 2rem;
  font-weight: 700;
  line-height: 1;
}
.rg-then-driver {
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.2;
}

.rg-next-driver {
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.2;
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

@media print {
  .rg-next-row td {
    background: none;
    box-shadow: none !important;
  }
  .rg-class-row {
    break-after: avoid;
  }
}
</style>
