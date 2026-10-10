/**
 * Where the event stands, moved by explicit actions on Setup → Rally only.
 * Running locks what would reinterpret results already timed; Closed locks
 * everything that changes a result, and results stop being provisional.
 */
export enum RallyStatus {
  SETUP = 'SETUP',
  RUNNING = 'RUNNING',
  CLOSED = 'CLOSED',
}
