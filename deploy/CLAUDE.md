# deploy

`install-server-pi.sh` and `install-gate-pi.sh` are one-shot `curl | bash` installers for real Raspberry Pis, run off master — never from this working directory. They hardcode assumptions about the codebase that **no build or test checks**; update them by hand whenever the corresponding thing changes:

- **`install-server-pi.sh`** assumes `docker-compose.yml` exists and `docker compose up -d --build` works; prints port 57430.
- **`docker-compose.yml`** runs rally-server on `network_mode: host` so its mDNS advertisement reaches the LAN (a bridged container can't multicast). It therefore publishes no ports and reaches Postgres over `127.0.0.1`, and Postgres is published on `127.0.0.1:5432` — **that address prefix is the entire protection**. Don't "tidy" it into `5432:5432`, and don't move rally-server back to bridge networking without re-checking discovery.
- **`install-gate-pi.sh`** assumes:
  - workspace names `@rally-gate/shared`/`gate-agent`/`gate-config` (must match their `package.json`; `npm ci` installs only those, so a new workspace the gate depends on goes on that line), Node 22.x, and build output at `apps/gate-agent/dist/main.js`;
  - env vars `GATE_ID`/`MQTT_HOST`/`MQTT_PORT` as read by `apps/gate-agent/src/config.ts` (default port 57431).
- It defaults `MQTT_HOST` to `rally-server.local`, the name `DiscoveryService` advertises, so it asks for no address. That needs `avahi-daemon`/`libnss-mdns` on the gate (installed explicitly) and a server not in a bridged container — Docker Desktop's "host" network is a VM, so there a gate still needs a typed IP. An explicit `MQTT_HOST` always wins.
- It configures chrony with a file in `/etc/chrony/conf.d/`, relying on Debian's `chrony.conf` including that directory and keeping `makestep 1 3` — the gate clock policy in `docs/decoder-adapters.md`, so don't consolidate it into a full `chrony.conf`. It comments out Debian's `pool`/DHCP sources, so rally-server's SNTP on 57432/udp is a gate's only time source.
- **Never close a gate gap with a new install prompt** — see "Zero-config gates" in `docs/development-roadmap.md`.

Timing sync is the one thing here with no automated check at all: `npm test` can't see it and CI can't boot a second host.
