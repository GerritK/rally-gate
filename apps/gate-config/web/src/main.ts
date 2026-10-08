import { createApp } from 'vue';
import {
  createRallyI18n,
  createRallyVuetify,
  notifyError,
} from '@rally-gate/ui';
import App from './App.vue';
import de from './locales/de.json';
import en from './locales/en.json';

const i18n = createRallyI18n(en, de);
const app = createApp(App).use(i18n).use(createRallyVuetify(i18n));
// See apps/web/src/main.ts.
app.config.errorHandler = (err) => {
  console.error(err);
  notifyError(err);
};
app.mount('#app');
