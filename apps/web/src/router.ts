import { clearNotice } from '@rally-gate/ui';
import { createRouter, createWebHistory } from 'vue-router';

export const NAV_ITEMS = [
  { to: '/live', label: 'Live Timing', icon: 'mdi-timer-outline' },
  { to: '/results/overall', label: 'Results', icon: 'mdi-podium' },
  { to: '/vehicles', label: 'Vehicles', icon: 'mdi-car' },
  { to: '/hardware', label: 'Hardware', icon: 'mdi-router-wireless' },
  { to: '/setup', label: 'Setup', icon: 'mdi-cog-outline' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/live' },
    {
      path: '/live/:stageId?',
      component: () => import('./pages/LiveView.vue'),
      props: true,
    },
    {
      path: '/results/overall',
      component: () => import('./pages/ResultsView.vue'),
    },
    {
      path: '/results/stages/:stageId',
      component: () => import('./pages/ResultsView.vue'),
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
      path: '/setup/display',
      component: () => import('./pages/SetupDisplayView.vue'),
    },
    {
      path: '/setup/stages/:stageId',
      component: () => import('./pages/SetupStageDetailView.vue'),
      props: true,
    },
    { path: '/hardware', component: () => import('./pages/HardwareView.vue') },
    {
      path: '/hardware/gates/:gateId',
      component: () => import('./pages/GateDetailView.vue'),
      props: true,
    },
    { path: '/vehicles', component: () => import('./pages/VehiclesView.vue') },
    {
      path: '/vehicles/:vehicleId',
      component: () => import('./pages/VehicleDetailView.vue'),
      props: true,
    },
  ],
});

// Path only: a filter writing to the query (?classes=) is the same page, and
// a dialog's "Stage added" lands after the navigation it triggered.
router.beforeEach((to, from) => {
  if (to.path !== from.path) clearNotice();
});
