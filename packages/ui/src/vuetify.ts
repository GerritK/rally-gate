import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import './fonts';
import './utilities.css';
import { createVuetify } from 'vuetify';
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n';
import { useI18n } from 'vue-i18n';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { KeyScroll } from './key-scroll';
import { rallyGateDark } from './theme';
import type { RallyI18n } from './i18n';

/**
 * Shared Vuetify setup for every rally-gate web interface (dashboard today,
 * the planned gate config UI later) so they read as one product instead of
 * each app picking its own colors/defaults. Adjust the theme in `theme.ts`,
 * not per-app. No vite-plugin-vuetify auto-import — components/directives
 * are registered in full so this works the same in any Vite app without
 * per-app build config; revisit if bundle size ever becomes a problem.
 */
export function createRallyVuetify(i18n: RallyI18n) {
  return createVuetify({
    locale: { adapter: createVueI18nAdapter({ i18n, useI18n }) },
    components,
    directives: { ...directives, KeyScroll },
    icons: {
      defaultSet: 'mdi',
    },
    theme: {
      defaultTheme: 'rallyGateDark',
      themes: { rallyGateDark },
    },
    defaults: {
      VAppBar: { flat: true, border: 'b' },
      VCard: { rounded: 'lg', flat: true, border: true },
      // A real heading, so a screen reader can jump from card to card.
      VCardTitle: { tag: 'h2' },
      VBtn: { rounded: 'md', variant: 'flat' },
      // v-card-actions turns its buttons to text; a dialog's main action is
      // filled like everywhere else, Cancel says `variant="text"` itself.
      VCardActions: { VBtn: { variant: 'flat' } },
      VSheet: { rounded: 'lg' },
      // Every input field alike, picked or typed: Vuetify's own default for
      // the pickers is filled and a size taller than a text field.
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VSelect: { variant: 'outlined', density: 'comfortable' },
      VCombobox: { variant: 'outlined', density: 'comfortable' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable' },
      // The calendar inside the field, where the time fields have their clock.
      VDateInput: {
        variant: 'outlined',
        density: 'comfortable',
        prependIcon: '',
        appendInnerIcon: '$calendar',
      },
    },
  });
}
