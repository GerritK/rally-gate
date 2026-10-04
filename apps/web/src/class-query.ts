import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { EntryClass } from './api/entry-classes';
import type { Entry } from './api/entries';

/**
 * The Results class filter, kept in `?classes=` so it survives switching
 * between Overall and a stage and can be shared as a link.
 */
export function useClassQuery() {
  const route = useRoute();
  const router = useRouter();
  return computed({
    get: () =>
      String(route.query.classes ?? '')
        .split(',')
        .filter(Boolean),
    set: (ids: string[]) =>
      void router.replace({
        query: { ...route.query, classes: ids.join(',') || undefined },
      }),
  });
}

/** Shown even unfiltered, so a ranking always says which one it is. */
export function classFilterLabel(
  classes: EntryClass[],
  classIds: string[],
): string {
  const names = classes
    .filter((c) => classIds.includes(c.id))
    .map((c) => c.name);
  return names.length > 0 ? names.join(' · ') : 'All classes';
}

/** What "Print all" prints: All classes, then each class on its own. A
 * class nobody is in would print an empty page. */
export function rankingClassIds(
  classes: EntryClass[],
  entries: Entry[],
): string[][] {
  return [
    [],
    ...classes
      .filter((c) =>
        entries.some((v) => v.classes.some((vc) => vc.id === c.id)),
      )
      .map((c) => [c.id]),
  ];
}
