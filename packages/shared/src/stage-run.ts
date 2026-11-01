export enum StageRunStatus {
  STARTED = 'STARTED',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
  /**
   * A slot on a closed stage with neither a start passing nor a finish:
   * nobody drove it, so it reads as DNS, not DNF. A car the start gate
   * missed that also never finished reads the same.
   */
  DID_NOT_START = 'DID_NOT_START',
  /**
   * Struck out by a marshal — typically a red flag — so it counts for
   * nothing and frees the entry to run the stage again. The row is kept
   * rather than deleted: it's the evidence a disputed result rests on.
   */
  VOIDED = 'VOIDED',
}
