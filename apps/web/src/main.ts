import { createApp } from 'vue';
import { createRallyVuetify } from '@rally-gate/ui';
import App from './App.vue';
import { router } from './router';

createApp(App).use(createRallyVuetify()).use(router).mount('#app');
