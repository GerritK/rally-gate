# Deployment Modes

`rally-server` is meant to run two ways from one codebase:

1. **Standalone / laptop mode** — a rally official double-clicks a packaged
   executable. SQLite (`DB_TYPE` unset or `sqlite`) and the embedded MQTT
   broker mean there's nothing external to install. The browser opens to
   `localhost:PORT` for the UI; a console window staying open is fine (no
   Electron/Tauri wrapper — deliberately kept low-effort). Packaging via
   Node SEA/`pkg` lives under `apps/rally-server/packaging/standalone/`
   (not built yet).
2. **Headless / server mode** — runs as a Docker/systemd service on a
   separate device (Pi, mini PC), set `DB_TYPE=postgres` and point at the
   `deploy/docker-compose.yml` Postgres instance. Managed entirely over the
   network through the same web UI.

Switching modes is a config change (`DB_TYPE`, `DB_HOST`, etc. — see
`apps/rally-server/src/config/database.config.ts`), not a code fork.

The MQTT broker (Aedes) is embedded in-process in both modes — there is no
separate Mosquitto/NATS container to run or configure.

## Future: online/spectator mode

Not built. The idea is a one-way, **push-based** sync from the local
rally-server to a cloud service, so spectators can see live timing on their
own phones without joining the local rally network (which should stay closed
to outsiders). See the `/live/*` and `/results`-style endpoints as the
natural "public-safe" data boundary if this gets built later.
