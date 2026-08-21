/**
 * Pair with append-inner-icon="mdi-clock-outline" on a
 * v-text-field[type=time] whose native clock icon is hidden via the CSS in
 * utilities.css — clicking the MDI icon opens the same native picker the
 * hidden icon would have.
 */
export function openTimePicker(event: Event) {
  const field = (event.currentTarget as HTMLElement).closest('.v-input');
  const input = field?.querySelector('input[type="time"]') as
    (HTMLInputElement & { showPicker?: () => void }) | null;
  input?.showPicker?.();
}
