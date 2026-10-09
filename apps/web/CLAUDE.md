# apps/web

The Vue 3 dashboard. Read `docs/frontend-structure.md` before changing routes or nav, and `docs/design-system.md` before building or restyling a page. Theme and shared components live in `packages/ui` (its own `CLAUDE.md`).

- **Type errors surface only in `vue-tsc`**, i.e. `npm run build` (locally or CI's build step).
- **Tests run on `node --test`** (`npm test -w apps/web`), on Node's own type stripping — no Vite, no DOM. So logic worth a test goes in a plain `.ts` module with structural types and no imports from `api/*` (which need Vite's `import.meta.env`), like `passing-suggestions.ts`. Specs are typechecked by `tsconfig.node.json` and excluded from `tsconfig.app.json`; relative imports in them carry the `.ts` extension.
- **Repeated UI is a component already**: `StatusChip` (any `*_DISPLAY` map), `ClockTime` (a start/finish with its hand-set mark), `GateOnlineChip`, `GateVersion`, `FlagPicker`, `TransponderList`. One app-wide clock: `serverNow` (`api/time.ts`), never a page's own timer. Print through `printPdf`, which opens the tab before anything is awaited.
- **The PDFs mirror the pages, by hand.** `pdf.ts` builds the overall, stage results and start list from the same data but with its own columns, so nothing a page gains reaches the printout by itself. Whenever a results or start-list page changes what it shows, settle with the user whether and how the PDF follows, and change both in one commit.
- **Fully Vuetify**: `v-table`/`v-select`/`v-btn`/`v-chip`, never raw `<table>`/`<select>`/`<button>`; status values are `v-chip`s. `App.vue` is the nav shell, pages are `src/pages/*.vue`.
- **Every text is a message key** in `src/locales/en.json` and `de.json` (rules in `packages/ui/CLAUDE.md`). Text with markup inside is `<i18n-t>` with slots, never `v-html`.
- Every timing value gets `.rg-timing` (tabular JetBrains Mono, slashed zero).
- **Time corrections are time-only**, no date field: `combineDateAndTime()` (`format.ts`) takes the date from context — the run's own, or today. `VTimePicker` was rejected: no seconds. A `v-text-field[type=time]` gets `append-inner-icon="mdi-clock-outline"` with `openTimePicker` (`@rally-gate/ui`) on `@click:append-inner`.
- **`src/assets/fonts/*.ttf` are not duplicates of the `@fontsource` packages.** `pdf.ts` embeds them because jsPDF can't read WOFF/WOFF2 and no npm package ships the TTFs (licences in `THIRD_PARTY_NOTICES.md`).

## `@rally-gate/shared` under Vite

`shared` ships CommonJS, so it must stay in `optimizeDeps.include` (`vite.config.ts`); otherwise Vite loads the raw CJS as ESM and named imports fail. After adding an export, `SyntaxError: ... does not provide an export named 'X'` means a stale optimizer cache, not a missing export: stop Vite, delete `node_modules/.vite`, restart.

`@rally-gate/ui` must **not** be in that list — see `packages/ui/CLAUDE.md`.
