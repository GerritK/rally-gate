import { computed, onUnmounted, ref, watch } from 'vue';
import {
  COUNTDOWN_MS_KEY,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_JUMP_START_TOLERANCE_MS,
  type DidNotStart,
  GateRole,
  isOutOfEvent,
  isScrutineered,
  JUMP_START_PENALTY_TYPE_ID_KEY,
  JUMP_START_TOLERANCE_MS_KEY,
  StageScoring,
  StartMode,
} from '@rally-gate/shared';
import { can } from './api/auth';
import {
  type DetectionEventRecord,
  fetchAtStart,
  fetchAwaitingEvents,
  fetchPendingEvents,
} from './api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from './api/gate-assignments';
import { fetchGates, type Gate } from './api/gates';
import { fetchSetting } from './api/settings';
import { fetchPenalties, type Penalty } from './api/penalties';
import { closeLiveStream, openLiveStream, upsert } from './api/live';
import { fetchStages, type Stage } from './api/stages';
import {
  fetchDns,
  fetchSplitsForStage,
  fetchStageRuns,
  type StageRun,
  type StageSplit,
} from './api/stage-runs';
import { fetchStartOrder, type StartOrder } from './api/start-order';
import { type Entry, fetchEntries } from './api/entries';

/** Live timing's state: what the server holds for the open stage, kept
 *  current by the live stream. The page's cards and its actions
 *  (`live-run-actions`, `live-stage-lifecycle`, `live-passings`) work on it. */
export type LiveData = ReturnType<typeof useLiveData>;

const FLASH_DURATION_MS = 600;

export function useLiveData(props: { stageId?: string }) {
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
  const flashingGateIds = ref<Record<string, boolean>>({});
  const jumpStartToleranceMs = ref(DEFAULT_JUMP_START_TOLERANCE_MS);
  const jumpStartPenaltyTypeId = ref<string | null>(null);
  /** Every penalty, to tell whether a jump start still awaits a ruling. */
  const penalties = ref<Penalty[]>([]);
  const countdownMs = ref(DEFAULT_COUNTDOWN_MS);

  const stage = computed(() =>
    stages.value.find((s) => s.id === props.stageId),
  );
  const entryById = computed(
    () => new Map(entries.value.map((v) => [v.id, v])),
  );

  /** A shakedown is driven as often as a car likes; its fastest run counts. */
  const shakedown = computed(() => stage.value?.scoring === StageScoring.NONE);

  const timetable = computed(
    () => stage.value?.startMode === StartMode.SLOT_SCHEDULE,
  );

  /** On the list and allowed to start, but the scrutineers haven't passed
   *  it: shown where the start marshal looks, never a reason to hold it. */
  function unscrutineered(entryId: string): boolean {
    const entry = entryById.value.get(entryId);
    return (
      !!entry && !isOutOfEvent(entry.status) && !isScrutineered(entry.status)
    );
  }

  function stageTitle(stageId: string): string {
    const s = stages.value.find((st) => st.id === stageId);
    return s ? `${s.id} · ${s.name}` : stageId;
  }

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

  function removeStageRun({ id }: { id: string }) {
    stageRuns.value = stageRuns.value.filter((r) => r.id !== id);
    delete splitsByRun.value[id];
  }

  function applyDns({ entryId, stageId, dns }: DidNotStart & { dns: boolean }) {
    if (stageId !== props.stageId) return;
    const others = dnsIds.value.filter((id) => id !== entryId);
    dnsIds.value = dns ? [...others, entryId] : others;
  }

  async function loadPenalties() {
    penalties.value = can('penalties') ? await fetchPenalties() : [];
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
              a.stageId === props.stageId &&
              a.role === GateRole.STAGE_PRE_START,
          )
          .map((a) => a.gateId),
      ),
  );

  /** Stages, entries and assignments aren't pushed over SSE, so they're
   *  loaded here and refreshed explicitly when an action changes them. */
  async function loadPlan() {
    [stages.value, entries.value, gateAssignments.value] = await Promise.all([
      fetchStages(),
      fetchEntries(),
      fetchGateAssignments(),
    ]);
  }

  /** Opens the live stream (once: Retry calls this again) and loads what it
   *  keeps current. */
  async function connect() {
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
  }

  onUnmounted(() => {
    if (liveSource) closeLiveStream(liveSource);
  });

  return {
    stages,
    entries,
    gates,
    gateAssignments,
    startOrder,
    stageRuns,
    splitsByRun,
    pendingDetections,
    awaitingDetections,
    atStartIds,
    dnsIds,
    flashingGateIds,
    jumpStartToleranceMs,
    jumpStartPenaltyTypeId,
    penalties,
    countdownMs,
    stage,
    entryById,
    shakedown,
    timetable,
    unscrutineered,
    stageTitle,
    flashGate,
    upsertGate,
    upsertStageRun,
    upsertSplit,
    removeStageRun,
    applyDns,
    loadPenalties,
    refreshStages,
    reloadStage,
    loadStage,
    loadAtStart,
    preStartGateIds,
    loadPlan,
    connect,
  };
}
