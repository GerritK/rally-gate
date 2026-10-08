# apps/web

The Vue 3 dashboard. Read `docs/frontend-structure.md` before changing routes or nav, and `docs/design-system.md` before building or restyling a page. Theme and shared components live in `packages/ui` (its own `CLAUDE.md`).

- **No test suite.** The only check is `vue-tsc` in `npm run build` (locally or CI's build step) — a type error surfaces nowhere else.
- **Fully Vuetify**: `v-table`/`v-select`/`v-btn`/`v-chip`, never raw `<table>`/`<select>`/`<button>`; status values are `v-chip`s. `App.vue` is the nav shell, pages are `src/pages/*.vue`.
- Every timing value gets `.rg-timing` (tabular JetBrains Mono, slashed zero).
- **Time corrections are time-only**, no date field: `combineDateAndTime()` (`format.ts`) takes the date from context — the run's own, or today. `VTimePicker` was rejected: no seconds. A `v-text-field[type=time]` gets `append-inner-icon="mdi-clock-outline"` with `openTimePicker` (`@rally-gate/ui`) on `@click:append-inner`.
- **`src/assets/fonts/*.ttf` are not duplicates of the `@fontsource` packages.** `pdf.ts` embeds them because jsPDF can't read WOFF/WOFF2 and no npm package ships the TTFs (licences in `THIRD_PARTY_NOTICES.md`).

## `@rally-gate/shared` under Vite

`shared` ships CommonJS, so it must stay in `optimizeDeps.include` (`vite.config.ts`); otherwise Vite loads the raw CJS as ESM and named imports fail. After adding an export, `SyntaxError: ... does not provide an export named 'X'` means a stale optimizer cache, not a missing export: stop Vite, delete `node_modules/.vite`, restart.

`@rally-gate/ui` must **not** be in that list — see `packages/ui/CLAUDE.md`.
