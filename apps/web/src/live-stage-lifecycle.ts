import { computed, type ComputedRef, ref } from 'vue';
import { type LiveData } from './live-data';
import type { Row } from './live-row-display';
import { ApiErrorCode } from '@rally-gate/shared';
import { ApiError } from './api/client';
import { serverNow } from './api/time';
import { catchUpDelayMinutes } from './countdown';
import { rallyName } from './api/rally-info';
import {
  activateStage,
  closeStage,
  delaySlots,
  fetchStages,
} from './api/stages';
import { fetchStageRuns } from './api/stage-runs';
import {
  fetchStartOrder,
  freezeStartOrder,
  unfreezeStartOrder,
} from './api/start-order';
import {
  formatStageDuration,
  parseStageDuration,
  t,
  useConfirm,
} from '@rally-gate/ui';
import { printPdf, startListPdf } from './pdf';
import { formatStamp } from './format';

/** Live timing's stage card: freeze and unfreeze the start list, activate,
 *  delay and close the stage, print the list. */
export function useStageLifecycle(
  props: { stageId?: string },
  data: LiveData,
  view: {
    rows: ComputedRef<Row[]>;
    /** Unidentified passings of this stage, lost when it closes. */
    unassignedHere: () => number;
  },
) {
  const {
    stages,
    startOrder,
    stageRuns,
    countdownMs,
    stage,
    timetable,
    unscrutineered,
    stageTitle,
    refreshStages,
  } = data;
  const confirm = useConfirm();
  const activatingStage = ref(false);
  const closingStage = ref(false);

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

  /** Freezing or activating with such cars on the list asks first, naming
   *  them: a desk that forgot a click is easier to fix before the start.
   *  `verb` is the confirm button's message key. */
  async function clearedToStart(verb: string): Promise<boolean> {
    const pending = view.rows.value.filter(
      (row) => !row.run && unscrutineered(row.starter.entryId),
    );
    if (pending.length === 0) return true;
    const numbers = pending.map((row) => `#${row.starter.startNumber}`);
    return confirm({
      title: t(
        'live.unscrutineeredTitle',
        { n: pending.length },
        pending.length,
      ),
      text: t(
        'live.unscrutineeredText',
        { numbers: numbers.join(', '), verb: t(verb) },
        pending.length,
      ),
      confirmText: t(verb),
    });
  }

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
    const unassigned = view.unassignedHere();
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
          view.rows.value,
          order.grouped,
          order.delayMs,
        ),
      ],
      fileName: [rallyName.value, id, t('live.startList')]
        .filter(Boolean)
        .join(' - '),
    }));
  }

  return {
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
  };
}
