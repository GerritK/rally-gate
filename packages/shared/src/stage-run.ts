export enum StageRunStatus {
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
  /**
   * DNF: a marshal marked the run retired, or the stage closed with it
   * still open. Stored (`StageRun.retired`), never derived from the stage.
   * A DNS is not a run at all: it is a `DidNotStart` row.
   */
  CANCELLED = 'CANCELLED',
  /**
   * Struck out by a marshal — typically a red flag — so it counts for
   * nothing and frees the entry to run the stage again. The row is kept
   * rather than deleted: it's the evidence a disputed result rests on.
   */
  VOIDED = 'VOIDED',
}

/**
 * DNS on one stage (`GET /api/stage-runs/dns`): marked by a marshal, or
 * written by closing the stage for every car without a counting run.
 */
export interface DidNotStart {
  entryId: string;
  stageId: string;
}
