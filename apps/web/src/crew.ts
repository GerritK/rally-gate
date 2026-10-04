import {
  FLAGS_SHOWN_KEY,
  NAME_FORMAT_KEY,
  NameFormat,
  PODIUM_SHOWN_KEY,
  Shown,
  type Crew,
} from '@rally-gate/shared';
import countries from 'flag-icons/country.json';
import { reactive } from 'vue';
import { fetchSetting } from './api/settings';
import chequered from './assets/flags/chequered.svg';
import pride from './assets/flags/x-pride.svg';
import progress from './assets/flags/x-progress.svg';
import trans from './assets/flags/x-trans.svg';

/** One event per page load (switching events reloads), so load once. */
export const display = reactive({
  nameFormat: NameFormat.FIRST_INITIAL,
  flags: Shown.SCREEN_ONLY,
  podium: Shown.SCREEN_ONLY,
});

export async function loadDisplaySettings(): Promise<void> {
  const [nameFormat, flags, podium] = await Promise.all(
    [NAME_FORMAT_KEY, FLAGS_SHOWN_KEY, PODIUM_SHOWN_KEY].map(fetchSetting),
  );
  const isIn = <T extends string>(e: Record<string, T>, v: string | null) =>
    Object.values(e).includes(v as T) ? (v as T) : undefined;
  display.nameFormat = isIn(NameFormat, nameFormat) ?? display.nameFormat;
  display.flags = isIn(Shown, flags) ?? display.flags;
  display.podium = isIn(Shown, podium) ?? display.podium;
}

/** For a `v-if` plus `:class`: screen only is hidden in print. */
export const printClass = (shown: Shown) =>
  shown === Shown.SCREEN_ONLY ? 'd-print-none' : undefined;

export function personName(first: string | null, last: string | null): string {
  const f = first?.trim() ?? '';
  const l = last?.trim() ?? '';
  if (!f || !l) return f || l;
  // Spread, not [0]: an initial must not split a surrogate pair.
  const initial = (name: string) => `${[...name][0]}.`;
  switch (display.nameFormat) {
    case NameFormat.INITIAL_LAST:
      return `${initial(f)} ${l}`;
    case NameFormat.FULL:
      return `${f} ${l}`;
    default:
      return `${f} ${initial(l)}`;
  }
}

export const driverName = (crew: Crew) =>
  personName(crew.driverFirstName, crew.driverLastName);

export const coDriverName = (crew: Crew) =>
  personName(crew.coDriverFirstName, crew.coDriverLastName) || null;

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

export const FLAG_OPTIONS: { value: string | null; title: string }[] = [
  { value: null, title: 'None (chequered flag)' },
  ...OWN_FLAGS,
  ...countries
    .filter((c) => !NOT_FOR_A_PERSON.has(c.code))
    .map((c) => ({ value: c.code, title: c.name }))
    .sort((a, b) => a.title.localeCompare(b.title)),
];

/** Unknown codes fall back too: a flag-icons update may drop one. */
export function flagUrl(flag: string | null): string {
  return (
    OWN_FLAGS.find((f) => f.value === flag)?.url ??
    countryFlags[flag ?? ''] ??
    chequered
  );
}
