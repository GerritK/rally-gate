import { computed, type ComputedRef, ref } from 'vue';
import { type LiveData } from './live-data';
import type { OnStageCar, Row } from './live-row-display';
import { DEFAULT_MIN_STAGE_DURATION_MS } from '@rally-gate/shared';
import {
  assignEntryToEvent,
  type DetectionEventRecord,
  dismissEvent,
  fetchAwaitingEvents,
  fetchPendingEvents,
  retryPendingEvents,
} from './api/events';
import { type Gate } from './api/gates';
import { driverName } from './crew';
import { t, useConfirm } from '@rally-gate/ui';
import { carriersOf, suggestEntries } from './passing-suggestions';

/** Live timing's unidentified passings: which entry each most likely was,
 *  and assigning, dismissing and retrying them. */
export function usePassings(
  props: { stageId?: string },
  data: LiveData,
  view: {
    dueToStart: ComputedRef<Row[]>;
    onStage: ComputedRef<OnStageCar[]>;
    gateFlow: ComputedRef<{ gate: Gate; label: string }[]>;
  },
) {
  const {
    entries,
    gates,
    gateAssignments,
    splitsByRun,
    pendingDetections,
    awaitingDetections,
    stage,
  } = data;
  const confirm = useConfirm();
  /** Only what a marshal picked by hand; otherwise the suggestion applies. */
  const pickedEntryIds = ref<Record<string, string>>({});
  const retryingPending = ref(false);

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
      dueToStart: view.dueToStart.value.map((row) => row.starter.entryId),
      onStage: view.onStage.value.map(({ row, run }) => ({
        entryId: row.starter.entryId,
        runId: run.id,
        startTime: run.startTime,
      })),
      splitsByRun: splitsByRun.value,
      entries: entries.value,
      minDurationMs:
        stage.value?.minDurationMs ?? DEFAULT_MIN_STAGE_DURATION_MS,
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
        new Date(a.timestampGate).getTime() -
        new Date(b.timestampGate).getTime(),
    );
    return {
      here,
      elsewhere: [...elsewhere].map(([stageId, count]) => ({ stageId, count })),
    };
  });

  /** Its role on this stage, so a marshal sees whether it was a start. */
  function gateRole(gateId: string): string | undefined {
    return view.gateFlow.value.find((node) => node.gate.id === gateId)?.label;
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

  return {
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
  };
}
