import { onMounted, reactive } from 'vue';
import { t } from '@rally-gate/ui';

export interface PageLoad {
  state: 'loading' | 'ready' | 'failed';
  /** Why it failed, in the viewer's language. */
  error: string;
  reload: () => Promise<void>;
}

/**
 * A page's first load, so "still loading" and "could not load" never show as
 * the empty state ("No entries yet"). Pair it with `LoadError` above the
 * page and `EmptyRow` in its table. Only the first load is tracked: a later
 * refresh that fails keeps the data on screen and reports through the
 * snackbar like any action.
 */
export function useLoad(load: () => Promise<unknown>): PageLoad {
  const page: PageLoad = reactive({
    state: 'loading',
    error: '',
    async reload() {
      page.state = 'loading';
      try {
        await load();
        page.state = 'ready';
      } catch (err) {
        page.error =
          err instanceof Error ? err.message : t('ui.somethingWentWrong');
        page.state = 'failed';
      }
    },
  });
  onMounted(page.reload);
  return page;
}
