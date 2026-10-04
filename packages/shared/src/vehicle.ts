/**
 * An entry's way through the event: registered, then checked in at the desk,
 * then passed by the scrutineers, or out of it. Only out of the event has a
 * hard effect (no start list, no run, see `isOutOfEvent`); a car not yet
 * scrutineered still starts, and Live Timing says so.
 */
export enum VehicleStatus {
  REGISTERED = 'REGISTERED',
  CHECKED_IN = 'CHECKED_IN',
  SCRUTINEERED = 'SCRUTINEERED',
  WITHDRAWN = 'WITHDRAWN',
  DISQUALIFIED = 'DISQUALIFIED',
}

/** Withdrawn or disqualified: off the start list, and a passing at a gate
 *  starts no run. Disqualified also leaves the results. */
export const isOutOfEvent = (status: VehicleStatus) =>
  status === VehicleStatus.WITHDRAWN || status === VehicleStatus.DISQUALIFIED;

/** Cleared by the scrutineers. Anything before is allowed to start but shown,
 *  so a car the desk forgot doesn't go out unnoticed. */
export const isScrutineered = (status: VehicleStatus) =>
  status === VehicleStatus.SCRUTINEERED;

/**
 * Who is in the car and the car they look like (`body`), carried by every
 * listing so any page can show the crew as the Display settings ask. A flag is a `flag-icons` code (`de`, `gb-eng`)
 * or one of our own (`x-pride` …); `null` shows the neutral default.
 */
export interface Crew {
  driverFirstName: string;
  driverLastName: string | null;
  driverFlag: string | null;
  coDriverFirstName: string | null;
  coDriverLastName: string | null;
  coDriverFlag: string | null;
  body: string | null;
}
