/** Setting keys, stored via `PUT /api/settings/:key`. Flags and podium are
 * "true" or "false", shown unless "false"; on screen only, since everything
 * printed is a plain PDF without them. */
export const NAME_FORMAT_KEY = 'nameFormat';
export const FLAGS_SHOWN_KEY = 'flagsShown';
export const PODIUM_SHOWN_KEY = 'podiumShown';

export enum NameFormat {
  /** "Max M." — a rally is among friends, first names come first. */
  FIRST_INITIAL = 'FIRST_INITIAL',
  /** "M. Mustermann" */
  INITIAL_LAST = 'INITIAL_LAST',
  /** "Max Mustermann" */
  FULL = 'FULL',
}
