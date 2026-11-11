# Rally Gate guide

For clubs that want to time an RC rally with Rally Gate. You don't need to be
a programmer. You do need someone who can unzip a file, join a Wi-Fi, and, for
the gates, follow a wiring diagram and paste one command into a Raspberry Pi.

> Rally Gate is in **alpha**. Keep a paper backup (a stopwatch and a list) at
> your first events, and finish an event on the version you started it with.

## The idea in one minute

- A **gate** stands at the track and reports "something passed at
  10:42:13.412". It knows nothing about the rally.
- The **server** is a laptop. It knows the stages, the cars and which gate is
  the start or the finish of which stage, and turns passings into times.
- Everyone else uses a **browser**: marshals on a tablet or phone, the
  organiser on the laptop. Nothing to install on those devices.
- All of it runs on your own **Wi-Fi**. No internet is needed.

## What you need

| | |
|---|---|
| A server | a laptop with Windows, macOS (Apple Silicon) or Linux |
| A Wi-Fi router | any; it needs no internet. Keep this network for the server, gates and staff. Spectators and drivers go on a guest network |
| Per timing point | a gate: a Raspberry Pi with a light barrier, a transponder loop, or both |
| For marshals | any tablet or phone with a browser |
| A printer (optional) | for start lists, results and the marshals' invitations |

The smallest rally that works: one laptop, one router, two gates (start and
finish). Even one gate is enough if a stage starts and finishes at the same
spot.

## The way through

1. [Install the server](install.md) and create your event.
2. [Build and connect the gates](gates.md).
3. [Run the event](running-an-event.md): stages, entries, staff, timing,
   results.
4. Give your staff the page [for marshals](marshals.md).

Try all of it at home first, with a car and two gates on the driveway. An
event has a stage type for exactly that ("Not counted").

Stuck? [When something goes wrong](troubleshooting.md). A word on a screen
you don't know? [Glossary](glossary.md).
