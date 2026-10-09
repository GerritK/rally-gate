import { createApp } from 'vue';
import { createRallyVuetify, notifyError } from '@rally-gate/ui';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';

const app = createApp(App).use(i18n).use(createRallyVuetify(i18n)).use(router);
// Vue routes a rejected promise from an event handler or lifecycle hook here,
// so a failed action surfaces without a try/catch around every call.
app.config.errorHandler = (err) => {
  console.error(err);
  notifyError(err);
};
app.mount('#app');
