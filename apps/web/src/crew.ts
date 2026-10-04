import {
  FLAGS_SHOWN_KEY,
  NAME_FORMAT_KEY,
  NameFormat,
  PODIUM_SHOWN_KEY,
  type Crew,
} from '@rally-gate/shared';
import countries from 'flag-icons/country.json';
import { inject, reactive, type InjectionKey } from 'vue';
import { fetchSetting } from './api/settings';
import chequered from './assets/flags/chequered.svg';
import pride from './assets/flags/x-pride.svg';
import progress from './assets/flags/x-progress.svg';
import trans from './assets/flags/x-trans.svg';

/** One event per page load (switching events reloads), so load once. */
export const display = reactive({
  nameFormat: NameFormat.FIRST_INITIAL,
  flags: true,
  podium: true,
});

/** What a crew name is drawn with: the event's settings, unless a page
 * provides others. Setup → Display provides its unsaved form, so its
 * example shows a change before it is saved. */
export const DISPLAY: InjectionKey<typeof display> = Symbol('display');
export const useDisplay = () => inject(DISPLAY, display);

export async function loadDisplaySettings(): Promise<void> {
  const [nameFormat, flags, podium] = await Promise.all(
    [NAME_FORMAT_KEY, FLAGS_SHOWN_KEY, PODIUM_SHOWN_KEY].map(fetchSetting),
  );
  const isIn = <T extends string>(e: Record<string, T>, v: string | null) =>
    Object.values(e).includes(v as T) ? (v as T) : undefined;
  display.nameFormat = isIn(NameFormat, nameFormat) ?? display.nameFormat;
  display.flags = flags !== 'false';
  display.podium = podium !== 'false';
}

export function personName(
  first: string | null,
  last: string | null,
  format = display.nameFormat,
): string {
  const f = first?.trim() ?? '';
  const l = last?.trim() ?? '';
  if (!f || !l) return f || l;
  // Spread, not [0]: an initial must not split a surrogate pair.
  const initial = (name: string) => `${[...name][0]}.`;
  switch (format) {
    case NameFormat.INITIAL_LAST:
      return `${initial(f)} ${l}`;
    case NameFormat.FULL:
      return `${f} ${l}`;
    default:
      return `${f} ${initial(l)}`;
  }
}

export const driverName = (crew: Crew, format?: NameFormat) =>
  personName(crew.driverFirstName, crew.driverLastName, format);

export const coDriverName = (crew: Crew, format?: NameFormat) =>
  personName(crew.coDriverFirstName, crew.coDriverLastName, format) || null;

const countryFlags = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('@flag-icons/flags/4x3/*.svg', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url]),
);

const OWN_FLAGS = [
  { value: 'x-pride', title: 'Pride', url: pride },
  { value: 'x-progress', title: 'Progress Pride', url: progress },
  { value: 'x-trans', title: 'Transgender Pride', url: trans },
];

/** Organisations and flag-icons' "unknown" — not flags a person flies. */
const NOT_FOR_A_PERSON = new Set([
  'arab',
  'asean',
  'cefta',
  'eac',
  'pc',
  'un',
  'xx',
]);

// No "None" item: one with a null value would count as selected on an empty
// field, its title sitting in the input so typing appends to it.
export const FLAG_OPTIONS: { value: string; title: string }[] = [
  ...OWN_FLAGS,
  ...countries
    .filter((c) => !NOT_FOR_A_PERSON.has(c.code))
    .map((c) => ({ value: c.code, title: c.name }))
    .sort((a, b) => a.title.localeCompare(b.title)),
];

/** The flag's name as the picker lists it; null when none is chosen. */
export function flagName(flag: string | null): string | null {
  return flag
    ? (FLAG_OPTIONS.find((f) => f.value === flag)?.title ?? flag)
    : null;
}

/** Unknown codes fall back too: a flag-icons update may drop one. */
export function flagUrl(flag: string | null): string {
  return (
    OWN_FLAGS.find((f) => f.value === flag)?.url ??
    countryFlags[flag ?? ''] ??
    chequered
  );
}
