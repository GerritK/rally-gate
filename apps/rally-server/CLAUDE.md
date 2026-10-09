# rally-server

NestJS API, embedded MQTT broker (Aedes), SNTP server, mDNS advertisement and the rule engine. The cross-project rules (event-driven bus, timing correctness, at-least-once detections) are in the root `CLAUDE.md`.

## Commands (run from this directory)

```bash
npm run lint                 # eslint --fix incl. prettier — run before finishing any server change
npm run lint:check           # what CI runs (--fix in CI would repair the tree and report success)
npm test                     # jest, all *.spec.ts under src/
npx jest gates.service       # one test file (substring match on path)
npm run build                # nest build
```

`no-unsafe-assignment` errors usually come from a raw `JSON.parse(...)` or a `{...} as any` jest mock: cast (`JSON.parse(x) as Foo`, `as unknown as Service`) rather than disabling the rule.

**The standalone package runs this server as one rolldown bundle**, so a `__dirname`-relative path (outside `main.ts`) or a computed `require()` works in dev and breaks only in the package. CI's `standalone.yml` smoke test catches it, and it runs on tags, not on every push.

## HTTP

**Every route is under `/api`** (`setGlobalPrefix` in `main.ts`): this process also serves the built `apps/web` on the same port, and `/entries` is both a resource and a page. Any other GET that isn't a real file returns `index.html` for vue-router deep links. That fallback is registered *before* `listen()` — Nest installs its own catch-all 404 while initialising, so middleware added afterwards never runs. Static serving is skipped when `apps/web/dist` is absent (the normal dev loop).

**`@Body()` types are erased at runtime.** The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) only validates a **decorated DTO class**; an interface, entity or mapped type (`Partial<X>`) compiles to `Object` and the endpoint silently validates nothing. Every mutating endpoint binds a class from its module's `dto.ts`.

Fields the DTOs leave out on purpose, because only the server may set them:
- `Stage.status` — moved by `activate`/`close` only, in step with `GateAssignment.active`
- `Stage.startOrder` — the frozen start list; only freezing writes it
- `GateAssignment.active` — activation is per stage, with the cross-stage conflict check
- `Entry.id` — `update` merges with `Object.assign`; an id would retarget the save
- `Gate.lastHeartbeatAt`/`capabilities` — gate-reported; writable, an offline gate would read online
- `RallyInfo.id` — singleton
- `StageRun.startManual`/`finishManual` — evidence of a hand-set time

`src/config/dto-contracts.spec.ts` pins this list with the real pipe config — add a case there for each new server-owned field. Since unknown properties are a 400, **a DTO change is a breaking API change**: `apps/web` and `scripts/seed-demo-data.js` change in the same commit.

A missing stage is a 404 via `StagesService.findOneOrFail`; don't hand-roll the check again.

**Every refusal is coded**: `throw new ConflictException(apiError(ApiErrorCode.X, 'English message', params))` (`src/common/api-error.ts`). The dashboard shows `errors.<code>` from its locales, never the English message — a new code needs its text in `apps/web`'s `en.json`/`de.json` (`i18n-keys.spec.ts` checks).

## TypeORM entities

- **Clearing a column means `null`, never `undefined`.** `save()` skips `undefined` properties and writes `null` as SQL NULL. Type nullable columns as `T | null`.
- **Every `T | null` column needs an explicit `type:`.** Without one, reflect-metadata collapses any written union — `string | null` included — to `Object`, and the entity fails at startup. Only a bare `foo?: string` is exempt.
- **That `type:` must be valid in both drivers.** `'datetime'` is sqlite-only, `'timestamp'` Postgres-only. For timestamps use the `Date` constructor: `{ type: Date, nullable: true }`. Patterns: `stage-run.entity.ts`, `entry.entity.ts`.

A Postgres-invalid type hides: `DataSource.initialize()` connects before it builds metadata, so it can only fail with Postgres reachable — never in the SQLite dev loop, and in Docker as a crash-loop. Guards: `src/config/entity-column-types.spec.ts` (checks both drivers, no database) and CI's `headless-stack` job. **After changing a column type, also run `docker compose -f deploy/docker-compose.yml up` if you have Docker.**

`synchronize: true` on both drivers — no migrations.

## Event handlers and the rule engine

**`@OnEvent` handlers swallow exceptions** (`suppressErrors: true` by default): a throw inside one is a log line and nothing else. That is why `EventsService` stores the raw detection *before* running the rules, `applyRulesForRecord` catches and leaves `processed: false`, and a 30 s sweep (`reprocessPending`) retries oldest first with the `clockCorrectionMs` stored on the record. An unknown gate or unregistered transponder is not a failure and is marked processed, so the pending list holds real problems only.

**The rule engine is deliberately simple and hardcoded**, no DSL: `EventsService.applyRules` branches on `GateRole`. One active `StageRun` per entry and stage; duplicate starts, out-of-order finishes and repeated splits are logged and ignored (`stage-runs.service.ts`), which is what makes at-least-once delivery safe.
