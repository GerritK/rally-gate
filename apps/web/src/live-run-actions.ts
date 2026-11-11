import { computed, ref, type Ref } from 'vue';
import { type LiveData } from './live-data';
import { isOutOfEvent, StageStatus } from '@rally-gate/shared';
import { can } from './api/auth';
import { newSlot } from './api/stages';
import {
  cancelCountdown,
  createStageRun,
  deleteStageRun,
  dismissJumpStart,
  finishStageRunNow,
  markDnf,
  markDns,
  type StageRun,
  startCountdown,
  undoDnf,
  undoDns,
  unvoidStageRun,
  voidStageRun,
} from './api/stage-runs';
import { t, useChoice, useConfirm } from '@rally-gate/ui';
import { entryName } from './format';

/** Live timing's actions on a run: start, finish, DNF, DNS, void, delete
 *  and the jump-start ruling. Each asks the server and applies its answer;
 *  every other screen gets the same through the live stream. */
export function useRunActions(
  props: { stageId?: string },
  data: LiveData,
  dialogs: {
    penaltyDialog: Ref<{
      add: (
        entryId: string,
        stageId: string,
        counts?: Record<string, number>,
      ) => unknown;
    } | null>;
  },
) {
  const {
    entries,
    stageRuns,
    splitsByRun,
    dnsIds,
    jumpStartPenaltyTypeId,
    penalties,
    stage,
    entryById,
    shakedown,
    upsertStageRun,
    removeStageRun,
    applyDns,
  } = data;
  const confirm = useConfirm();
  const choose = useChoice();
  const startingEntryId = ref<string | null>(null);

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
    void dialogs.penaltyDialog.value?.add(run.entryId, run.stageId, {
      [jumpStartPenaltyTypeId.value!]: 1,
    });
  }

  async function onDismissJumpStart(run: StageRun) {
    upsertStageRun(await dismissJumpStart(run.id));
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

  return {
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
  };
}
