# apps/web

The dashboard `rally-server` serves: live timing, results, setup, hardware and
vehicles, as a `vue-router` multi-page app behind a Vuetify nav drawer.

Route and navigation structure, plus the reasoning behind it, is in
[docs/frontend-structure.md](../../docs/frontend-structure.md). The theme and
shared components come from `packages/ui`, not from here.

```bash
npm run dev      # Vite on 57440, talking to the API on 57430
npm run build    # vue-tsc + vite build
```

No test suite. `vue-tsc` during `npm run build` is the only thing that
typechecks this app, so a frontend type error surfaces there or in CI and
nowhere else.

`@rally-gate/shared` ships CommonJS and must stay listed in `optimizeDeps.include`
in `vite.config.ts` — without it Vite loads the raw CJS file as native ESM and
named imports silently fail. See the `packages/shared` note in
[CLAUDE.md](../../CLAUDE.md).
