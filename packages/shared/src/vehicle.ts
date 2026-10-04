export enum VehicleStatus {
  REGISTERED = 'REGISTERED',
  CHECKED_IN = 'CHECKED_IN',
  SCRUTINEERED = 'SCRUTINEERED',
  WITHDRAWN = 'WITHDRAWN',
  DISQUALIFIED = 'DISQUALIFIED',
}

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
