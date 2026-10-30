import { clearNotice } from '@rally-gate/ui';
import { StageStatus } from '@rally-gate/shared';
import { createRouter, createWebHistory } from 'vue-router';
import { fetchSession, session } from './api/auth';
import { fetchStages } from './api/stages';

/** `label` is a message key. */
export const NAV_ITEMS = [
  { to: '/live', label: 'nav.live', icon: 'mdi-timer-outline' },
  { to: '/results/overall', label: 'nav.results', icon: 'mdi-podium' },
  { to: '/entries', label: 'nav.entries', icon: 'mdi-car' },
  { to: '/hardware', label: 'nav.hardware', icon: 'mdi-router-wireless' },
  { to: '/setup', label: 'nav.setup', icon: 'mdi-cog-outline' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/live' },
    // `live`: the page opens the live stream, whose `onopen` loads the rally
    // status, so App.vue doesn't fetch it on navigation as well.
    {
      path: '/live/:stageId?',
      component: () => import('./pages/LiveView.vue'),
      props: true,
      meta: { live: true },
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
      path: '/setup/access',
      component: () => import('./pages/SetupAccessView.vue'),
    },
    {
      path: '/public/:stageId?',
      component: () => import('./pages/PublicView.vue'),
      props: true,
      meta: { live: true },
      // Like Live Timing: no stage picks the running one. Before the page
      // mounts, so it loads once; Overall picked on the page stays Overall.
      beforeEnter: async (to) => {
        if (to.params.stageId) return;
        const active = (await fetchStages().catch(() => [])).find(
          (s) => s.status === StageStatus.ACTIVE,
        );
        if (active) return { path: `/public/${active.id}`, query: to.query };
      },
    },
    { path: '/login', component: () => import('./pages/LoginView.vue') },
    // What an invitation's QR code opens.
    {
      path: '/join/:code',
      component: () => import('./pages/LoginView.vue'),
      props: true,
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
    {
      path: '/hardware',
      component: () => import('./pages/HardwareView.vue'),
      meta: { live: true },
    },
    {
      path: '/hardware/gates/:gateId',
      component: () => import('./pages/GateDetailView.vue'),
      props: true,
      meta: { live: true },
    },
    { path: '/entries', component: () => import('./pages/EntriesView.vue') },
    {
      path: '/entries/check-in',
      component: () => import('./pages/CheckInView.vue'),
    },
    {
      path: '/entries/:entryId',
      component: () => import('./pages/EntryDetailView.vue'),
      props: true,
    },
  ],
});

/** What a browser without a login may open; the rest sends it to the public page. */
export const isPublicPath = (path: string) =>
  ['public', 'login', 'join'].includes(path.split('/')[1]);

// Path only: a filter writing to the query (?classes=) is the same page, and
// a dialog's "Stage added" lands after the navigation it triggered. The
// session is reloaded too, so a device blocked meanwhile falls back at once.
router.beforeEach(async (to, from) => {
  if (to.path === from.path && session.value) return;
  clearNotice();
  // A redirect's session is the one its first hop just loaded.
  if (!to.redirectedFrom || !session.value) {
    await fetchSession().catch(() => undefined);
  }
  if (session.value && !session.value.role && !isPublicPath(to.path)) {
    return { path: '/public', query: to.query };
  }
});
