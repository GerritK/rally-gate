# rally-server

The central service: REST/SSE API, the embedded Aedes MQTT broker gates publish
detections to, the rule engine that turns those into stage runs, an embedded
SNTP server, and mDNS discovery. It also serves the built `apps/web` when one is
present, on the same port as the API.

One database is one event — there is no `Event` table. See
[docs/deployment-modes.md](../../docs/deployment-modes.md).

## Commands

Run from this directory. The repo root must have built `packages/shared` first
(`npm run build:shared`), since this imports its compiled output, not its source.

```bash
npm run start:dev    # watch mode on 57430 (or `npm run dev:server` from the root)
npm test             # jest, all *.spec.ts under src/
npx jest gates.service   # one file, substring match on path
npm run lint         # eslint --fix, includes prettier — run before finishing a change
npm run lint:check   # what CI runs (--fix in CI would repair the tree and report success)
npm run build        # nest build
```

`npm run test:e2e` exists and works but is a single smoke test over `GET /api`,
and **CI does not run it** — CI's test step is `npm test --workspaces`, which is
jest over `src/`. Treat the `*.spec.ts` files under `src/` as the real suite.

## Where the reasoning lives

- [docs/architecture.md](../../docs/architecture.md) — event pipeline, gate
  discovery, clock offset, gate assignment
- [docs/api.md](../../docs/api.md) — endpoint summary
- [docs/event-model.md](../../docs/event-model.md) — `StageRun`/`StageSplit`
  shapes, voiding and re-runs, notional times
- [CLAUDE.md](../../CLAUDE.md) — the traps that have actually bitten here:
  nullable TypeORM columns, driver-specific column types, and why a `@Body()`
  must be a decorated DTO class
