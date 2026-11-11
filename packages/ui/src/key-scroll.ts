import type { Directive } from 'vue';

const observers = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * `v-key-scroll` on a `v-table`: while the table is wider than its card, its
 * scrolling wrapper takes focus, so the arrow keys reach the columns a
 * pointer would swipe to. No tab stop on a table that fits.
 */
export const KeyScroll: Directive<HTMLElement> = {
  mounted(el) {
    const wrapper = el.querySelector<HTMLElement>('.v-table__wrapper');
    const table = wrapper?.querySelector('table');
    if (!wrapper || !table) return;
    const update = () => {
      if (wrapper.scrollWidth > wrapper.clientWidth) wrapper.tabIndex = 0;
      else wrapper.removeAttribute('tabindex');
    };
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    observer.observe(table);
    observers.set(el, observer);
  },
  unmounted(el) {
    observers.get(el)?.disconnect();
  },
};
