import { createRouter, createWebHistory } from 'vue-router';

export const NAV_ITEMS = [
  { to: '/live', label: 'Live Timing', icon: 'mdi-timer-outline' },
  { to: '/results/overall', label: 'Results', icon: 'mdi-podium' },
  { to: '/setup', label: 'Setup', icon: 'mdi-cog-outline' },
  { to: '/hardware', label: 'Hardware', icon: 'mdi-router-wireless' },
  { to: '/vehicles', label: 'Vehicles', icon: 'mdi-car' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/live' },
    { path: '/live', component: () => import('./pages/LiveView.vue') },
    {
      path: '/results/overall',
      component: () => import('./pages/ResultsOverallView.vue'),
    },
    {
      path: '/results/stages/:stageId',
      component: () => import('./pages/ResultsStageView.vue'),
      props: true,
    },
    { path: '/setup', component: () => import('./pages/SetupView.vue') },
    {
      path: '/setup/stages',
      component: () => import('./pages/SetupStagesView.vue'),
    },
    {
      path: '/setup/stages/:stageId',
      component: () => import('./pages/SetupStageDetailView.vue'),
      props: true,
    },
    { path: '/hardware', component: () => import('./pages/HardwareView.vue') },
    { path: '/vehicles', component: () => import('./pages/VehiclesView.vue') },
  ],
});
