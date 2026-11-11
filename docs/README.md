# Documentation

Two kinds of documents live here, for two kinds of readers.

## Running a rally

For organisers and marshals. Plain language, no programming knowledge needed.
Start with the [guide](guide/README.md):

| | |
|---|---|
| [Install the server](guide/install.md) | the laptop (or Pi) that runs the rally |
| [Gates](guide/gates.md) | build one, install it, connect it, what its beeps mean |
| [Running an event](guide/running-an-event.md) | the organiser's day, from setup to results |
| [For marshals](guide/marshals.md) | one page to hand to staff: Live timing in practice |
| [When something goes wrong](guide/troubleshooting.md) | a gate offline, a car without a time, a forgotten password |
| [Glossary](guide/glossary.md) | every term the screens use |

For whoever looks after the router:
[the public page on a guest Wi-Fi (OpenWRT)](openwrt-guest-access.md).

## Developing Rally Gate

Design notes: what was decided and why. Dense on purpose, written for someone
changing the code. Commands and the codebase's standing rules are in the root
[CLAUDE.md](../CLAUDE.md).

| | |
|---|---|
| [architecture.md](architecture.md) | gate discovery, clock offset, server discovery, gate assignment |
| [event-model.md](event-model.md) | detections, stage runs, splits, DNF/DNS, notional times, penalties, start order and slots |
| [api.md](api.md) | REST endpoints and the live stream |
| [auth.md](auth.md) | roles, invitations, organiser login, gate keys and pairing |
| [deployment-modes.md](deployment-modes.md) | standalone and headless, event files, time sync |
| [decoder-adapters.md](decoder-adapters.md) | light barrier, transponder loop, buzzer, wiring, gate clock policy |
| [gate-config-ui.md](gate-config-ui.md) | the settings page on a gate, Wi-Fi and hotspot |
| [esp32-gate.md](esp32-gate.md) | the ESP32 NFC gate: hardware, firmware, flashing |
| [frontend-structure.md](frontend-structure.md) | the dashboard's routes and the decisions behind them |
| [design-system.md](design-system.md) | colour, type, layout, status, confirmation and print rules |
| [development-roadmap.md](development-roadmap.md) | standing rules, what is built, what is next, what waits |

Older thinking, kept for context only: [ideas/](../ideas/).
