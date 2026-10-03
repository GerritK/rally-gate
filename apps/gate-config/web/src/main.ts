import { createApp } from 'vue';
import { createRallyVuetify, notifyError } from '@rally-gate/ui';
import App from './App.vue';

const app = createApp(App).use(createRallyVuetify());
// See apps/web/src/main.ts.
app.config.errorHandler = (err) => {
  console.error(err);
  notifyError(err);
};
app.mount('#app');
