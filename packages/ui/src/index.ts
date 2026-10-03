export { createRallyVuetify } from './vuetify';
export { rallyGateDark } from './theme';
export { openTimePicker } from './datetime';
export { default as logoUrl } from './logo.svg';
export {
  formatClockTime,
  formatRelativeTime,
  formatStageDuration,
  parseStageDuration,
} from './format';

export const REPO_URL = 'https://github.com/GerritK/rally-gate';
export const SUPPORT_URL = 'https://paypal.me/GerritKaul';
export {
  useConfirm,
  notify,
  notifyError,
  clearNotice,
  type ConfirmOptions,
} from './feedback';
export { default as RallyFeedback } from './RallyFeedback.vue';
