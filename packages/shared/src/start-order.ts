/** Setting keys, stored via `PUT /api/settings/:key`. */
export const START_ORDER_GROUPING_KEY = 'startOrderGrouping';
export const START_ORDER_KEY_KEY = 'startOrderKey';
export const START_ORDER_DIRECTION_KEY = 'startOrderDirection';

export enum StartOrderGrouping {
  MAIN_CLASS = 'MAIN_CLASS',
  NONE = 'NONE',
}

export enum StartOrderKey {
  START_NUMBER = 'START_NUMBER',
  OVERALL_TIME = 'OVERALL_TIME',
  LAST_STAGE_TIME = 'LAST_STAGE_TIME',
}

export enum StartOrderDirection {
  FASTEST_FIRST = 'FASTEST_FIRST',
  SLOWEST_FIRST = 'SLOWEST_FIRST',
}

export interface StartOrderEntry {
  position: number;
  vehicleId: string;
  startNumber: number;
  driverName: string;
  coDriverName?: string;
  mainClassName: string | null;
}

export interface StartOrder {
  stageId: string;
  /**
   * Snapshotted by hand (publishing it) or else on the stage's first
   * activation; computed live until then.
   */
  frozen: boolean;
  /** ISO 8601, the "as of" on a posted list. */
  frozenAt: string | null;
  /** Entries come in main-class blocks, so a page can show one per class. */
  grouped: boolean;
  entries: StartOrderEntry[];
}
