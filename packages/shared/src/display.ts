/** Setting keys, stored via `PUT /api/settings/:key`. */
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

/** Screen only is for black-and-white printers, which lose flags and
 * trophies. */
export enum Shown {
  ALWAYS = 'ALWAYS',
  SCREEN_ONLY = 'SCREEN_ONLY',
  NEVER = 'NEVER',
}
