# apps/gate-config

The on-gate config service and its page (port 57439, captive-portal redirect on 80). Design: `docs/gate-config-ui.md` — read its "Wi-Fi goes through a wrapper" section before touching anything that shells out to `nmcli`.

- **Every OS call lives in `src/system.ts`** (systemd, chrony, journalctl, nmcli) and reports failure instead of throwing. Off a Pi the service still runs and every status row reads as unavailable. Changes there are only verifiable on real hardware.
- Dev: point `GATE_CONFIG_FILE` and `CHRONY_SOURCE_DIR` at a scratch directory so nothing needs `/etc`. Run with `npm run dev:gate-config` and `npm run dev:gate-config-web` from the root.
- **`FIELDS` in `src/config-file.ts` is the security boundary.** The file becomes the gate-agent's environment and the service has no authentication, so an arbitrary key would allow `NODE_OPTIONS`/`LD_PRELOAD`. Never widen it to "whatever the form posted". The page derives its input rules from these specs (`/api/fields`) rather than restating them. **No text on the server:** a field's label, hint and message live in `web/src/locales/*.json` under `fields.<NAME>` (a spec test fails if one is missing), and every refusal goes out as a code (`FieldError`, `WifiError` in `api-types.ts`) the page words.
- Tests: jest (`npm test -w apps/gate-config`), for the pure modules only (`config-file.ts`, `network.ts`).
