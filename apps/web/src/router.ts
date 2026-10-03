import { createRouter, createWebHistory } from 'vue-router';

export const NAV_ITEMS = [
  { to: '/live', label: 'Live Timing', icon: 'mdi-timer-outline' },
  { to: '/start-list', label: 'Start List', icon: 'mdi-format-list-numbered' },
  { to: '/results/overall', label: 'Results', icon: 'mdi-podium' },
  { to: '/vehicles', label: 'Vehicles', icon: 'mdi-car' },
  { to: '/hardware', label: 'Hardware', icon: 'mdi-router-wireless' },
  { to: '/setup', label: 'Setup', icon: 'mdi-cog-outline' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/live' },
    { path: '/live', component: () => import('./pages/LiveView.vue') },
    {
      path: '/start-list/:stageId?',
      component: () => import('./pages/StartListView.vue'),
      props: true,
    },
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
      path: '/setup/classes',
      component: () => import('./pages/SetupClassesView.vue'),
    },
    {
      path: '/setup/start-order',
      component: () => import('./pages/SetupStartOrderView.vue'),
    },
    {
      path: '/setup/scoring',
      component: () => import('./pages/SetupScoringView.vue'),
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
