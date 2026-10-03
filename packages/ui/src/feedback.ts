import { shallowRef } from 'vue';

export interface ConfirmOptions {
  title: string;
  text?: string;
  /** Names the action ("Delete class"), never "OK". */
  confirmText: string;
  /** Red for a delete or an abort; orange otherwise. */
  color?: 'error' | 'primary' | 'success';
}

export interface Notice {
  text: string;
  error: boolean;
}

/** Module state: one dialog and one snackbar per app, both in `RallyFeedback`. */
export const pendingConfirm = shallowRef<{
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
} | null>(null);
export const notice = shallowRef<Notice | null>(null);

export function useConfirm() {
  return (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      pendingConfirm.value?.resolve(false);
      pendingConfirm.value = { options, resolve };
    });
}

export function notify(text: string) {
  notice.value = { text, error: false };
}

/** A notice is about the page it was raised on; leaving it, it goes too. */
export function clearNotice() {
  notice.value = null;
}

export function notifyError(err: unknown) {
  notice.value = {
    text: err instanceof Error ? err.message : 'Something went wrong',
    error: true,
  };
}
