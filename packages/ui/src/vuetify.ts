import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import './fonts';
import './utilities.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { rallyGateDark } from './theme';

/**
 * Shared Vuetify setup for every rally-gate web interface (dashboard today,
 * the planned gate config UI later) so they read as one product instead of
 * each app picking its own colors/defaults. Adjust the theme in `theme.ts`,
 * not per-app. No vite-plugin-vuetify auto-import — components/directives
 * are registered in full so this works the same in any Vite app without
 * per-app build config; revisit if bundle size ever becomes a problem.
 */
export function createRallyVuetify() {
  return createVuetify({
    components,
    directives,
    icons: {
      defaultSet: 'mdi',
    },
    theme: {
      defaultTheme: 'rallyGateDark',
      themes: { rallyGateDark },
    },
    defaults: {
      VCard: { rounded: 'lg', flat: true, border: true },
      VBtn: { rounded: 'md', variant: 'flat' },
      VSheet: { rounded: 'lg' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
    },
  });
}
