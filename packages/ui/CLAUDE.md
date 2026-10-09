# packages/ui

The shared Vuetify design system for every rally-gate web UI (`apps/web`, `apps/gate-config`), so they read as one product. How to use the colours, layout, status, confirmation and print patterns is in `docs/design-system.md`.

- `theme.ts` — the dark-first `rallyGateDark` theme. `vuetify.ts` — `createRallyVuetify()`, theme plus component defaults, called once per app. Change the theme and defaults here, never per app.
- `fonts.ts` self-hosts Barlow, Barlow Condensed and JetBrains Mono via `@fontsource`, **never a CDN**: these apps run on closed or absent rally Wi-Fi. They reach Vuetify through the theme's `font-body`/`font-heading` variables, no SASS override. MDI icons are self-hosted too.
- `i18n.ts` — `createRallyI18n(en, de)`, one per app, merging the app's `locales/*.json` over the ui's and Vuetify's. **No text in a template or a message to the user without a key**; `de.json` must have every key of `en.json` (vue-tsc fails otherwise), and `apps/web`'s `i18n-keys.spec.ts` catches a key that exists in neither. Outside a component use `t()` from here, **never at module load**: a constant built then stays in the first language — a label in a constant map is a getter or a key (`STAGE_STATUS_DISPLAY`, `NAV_ITEMS`). Dates and numbers take `currentLocale()`, not `[]`.
- `utilities.css` — `.rg-timing`, and the rule hiding the native `<input type="time">` icon so an MDI one can replace it (`openTimePicker` in `datetime.ts`).
- **No build step.** It ships plain `.ts`/`.vue`/`.css` source (`main` points at `src/index.ts`) and relies on the consuming app's Vite to compile it. That is also why `RallyFeedback.vue` (behind `useConfirm()`/`notify()`/`notifyError()`) works: **keep `@rally-gate/ui` out of any `optimizeDeps.include`**, so Vite serves it as source.
