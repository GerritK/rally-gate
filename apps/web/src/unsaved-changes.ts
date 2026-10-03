import { onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useConfirm } from '@rally-gate/ui';

/**
 * Asks before a page form's changes are thrown away by navigating off it,
 * and has the browser ask on reload or closing the tab. Call `markSaved()`
 * once the form has loaded and after every save.
 */
export function useUnsavedChanges(form: () => unknown) {
  const confirm = useConfirm();
  let saved = JSON.stringify(form());
  const dirty = () => JSON.stringify(form()) !== saved;

  const guard = async () =>
    !dirty() ||
    confirm({
      title: 'Leave without saving?',
      text: 'Your changes on this page are lost.',
      confirmText: 'Leave',
      color: 'error',
    });
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate(guard);

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty()) event.preventDefault();
  };
  onMounted(() => addEventListener('beforeunload', onBeforeUnload));
  onUnmounted(() => removeEventListener('beforeunload', onBeforeUnload));

  return {
    markSaved: () => {
      saved = JSON.stringify(form());
    },
  };
}
