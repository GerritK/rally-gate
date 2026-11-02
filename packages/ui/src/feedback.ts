import { shallowRef } from 'vue';
import { t } from './i18n';

export interface ConfirmOptions {
  title: string;
  text?: string;
  /** Names the action ("Delete class"), never "OK". */
  confirmText: string;
  /** Red for a delete or an abort; orange otherwise. */
  color?: 'error' | 'primary' | 'success';
  /** A second way to do it, as a red text button: the one that keeps less. */
  alternativeText?: string;
}

export type Choice = 'confirm' | 'alternative' | null;

export interface Notice {
  text: string;
  error: boolean;
}

/** Module state: one dialog and one snackbar per app, both in `RallyFeedback`. */
export const pendingConfirm = shallowRef<{
  options: ConfirmOptions;
  resolve: (choice: Choice) => void;
} | null>(null);
export const notice = shallowRef<Notice | null>(null);

function ask(options: ConfirmOptions) {
  return new Promise<Choice>((resolve) => {
    pendingConfirm.value?.resolve(null);
    pendingConfirm.value = { options, resolve };
  });
}

export function useConfirm() {
  return async (options: Omit<ConfirmOptions, 'alternativeText'>) =>
    (await ask(options)) === 'confirm';
}

/** Two variants of one intent in one dialog (`docs/design-system.md` "Confirmations"). */
export function useChoice() {
  return (options: ConfirmOptions & { alternativeText: string }) =>
    ask(options);
}

/** `error` for a failure reported as text, e.g. a command's output. */
export function notify(text: string, error = false) {
  notice.value = { text, error };
}

/** A notice is about the page it was raised on; leaving it, it goes too. */
export function clearNotice() {
  notice.value = null;
}

export function notifyError(err: unknown) {
  notice.value = {
    text: err instanceof Error ? err.message : t('ui.somethingWentWrong'),
    error: true,
  };
}
