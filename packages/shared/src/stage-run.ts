export enum StageRunStatus {
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
  /**
   * Struck out by a marshal — typically a red flag — so it counts for
   * nothing and frees the entry to run the stage again. The row is kept
   * rather than deleted: it's the evidence a disputed result rests on.
   */
  VOIDED = 'VOIDED',
}
