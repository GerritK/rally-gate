import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watchEffect,
  type Ref,
} from 'vue';
import { serverOffsetMs } from './api/time';

/**
 * Results move while a stage runs, so a printout says when it was taken, by
 * the server clock like every other time a marshal reads. `landscape` turns
 * the page for a table too wide for portrait: `@page` can't be scoped to a
 * class, so the rule lives in a style element only while this page is shown.
 */
export function usePrint(landscape?: Ref<boolean>) {
  const printedAt = ref('');
  const style = document.createElement('style');

  function stamp() {
    printedAt.value = new Date(
      Date.now() + serverOffsetMs.value,
    ).toLocaleString([], {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  watchEffect(() => {
    style.textContent = landscape?.value ? '@page { size: landscape; }' : '';
  });
  // Ctrl+P skips the button.
  onMounted(() => {
    document.head.append(style);
    window.addEventListener('beforeprint', stamp);
  });
  onUnmounted(() => {
    style.remove();
    window.removeEventListener('beforeprint', stamp);
  });

  async function print() {
    stamp();
    await nextTick();
    window.print();
  }

  return { printedAt, print };
}
