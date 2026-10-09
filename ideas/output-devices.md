# Output devices: screens and announcements

> **Thoughts, not a plan.** Nothing here is decided or scheduled; any of it may
> change. Recorded so a later design starts from what was already considered.

## The need

A tablet on the wall of the service park shows the start list instead of a
printout. When the next stage's list is frozen it should show that one, while
a stage runs live timing, afterwards the results — without anyone walking over
to click. Same for monitors, Pis with a screen and plain browser windows. Later
the same devices, or speakers, could announce finishers.

## Devices are dumb, like gates

- A device is a browser on `http://rally-server.local:57430/screen` (name
  tentative): a tablet in a kiosk browser, a Pi with Chromium in kiosk mode, a
  window on a laptop. No app, nothing to install.
- It registers itself on first open (an id kept in the browser) and sends a
  heartbeat, so it appears on the server the way a gate does. Name and
  configuration are set on the server, never on the device — the zero-config
  rule for gates applies.
- "Identify" on the server makes it show its name full-screen, to tell three
  wall tablets apart.
- What to show arrives over the existing `/live` stream as a new event type,
  not a stream of its own (`docs/api.md`).

## Screens and speakers are one device type

One "output device" with capabilities `screen` and/or `audio` (like
`Gate.capabilities`), because the common case is one tablet doing both and it
should be configured in one place. Its configuration stays two separate parts,
because the outputs behave differently:

- **Screen** shows a *state*. After a reconnect it shows the current one.
- **Audio** speaks *events*. After a reconnect it drops what it missed: a late
  finish announcement is wrong, not just old.

## What a screen shows

- **Per-device priority list** of fixed conditions, first match wins, e.g.
  stage active → live timing of that stage; next stage's start list frozen →
  that start list; otherwise → overall results. A fixed set of conditions to
  order and tick, not expressions (same reason as no rule-engine DSL). Sensible
  default so a new screen works untouched. Optionally pinned to one stage.
- **Manual override with an expiry**, back to automatic afterwards, so a
  forgotten override doesn't leave noon's results on the wall in the evening.
- **Groups** were considered and left out: a screen with its own list is
  enough for now, and groups can come later without changing the devices.
- Re-evaluated event-driven (stage activated/closed, start list frozen) on the
  server, which pushes the result; screens compute nothing.

## Views are their own catalog

Screen views are separate from the marshal pages: read-only (no auth yet, so
a wall tablet must offer nobody "Finish now"), large type for distance,
portrait and landscape, and paging or rotation through classes for long lists
since nobody scrolls a wall. A fixed catalog — view ids in `packages/shared`,
parameters (stage, class) validated as DTOs, components apart from
`src/pages`. Rules belong in `design-system.md` alongside print.

Ideas: last finisher (number, name, time, position, big), live timing for
screens, start list, results, top 10 overall, official time (the server's
clock, useful once time controls exist), next starter (a countdown needs
planned start times — Rally controls in the roadmap), gate status for the
timing tent, text announcements as an overlay ("drivers' briefing 14:00").

## Staleness is the main risk

A stale result on a wall is worse than a blank one, because people believe it.
Screens show plainly when they lost the connection and since when, reconnect
on their own, and reload after the server restarts (switching events) or its
version changes. Keep the screen awake with the Wake Lock API. Switching the
device itself on/off is out of scope: we control the page, not the tablet.

## Announcements

A second consumer of the same events on the bus: announcement logic produces
text, an adapter per device kind delivers it (shaped like `DecoderAdapter`).

- **A screen speaks** via the browser's speech synthesis. Simplest; voices vary
  by device and are unreliable on a Pi. Browsers block audio without a user
  gesture, so a screen needs one "enable sound" tap at setup or it stays mute
  without anyone noticing.
- **Server-side TTS, offline** (e.g. Piper) producing an audio file. Same
  voice everywhere, no internet, and the prerequisite for every networked
  speaker, since those all work as "play this URL".
- **Networked speakers** as further adapters: Sonos and DLNA/UPnP can be
  driven locally once set up; Google Cast works technically (mDNS
  `_googlecast._tcp`, then "play this URL" on port 8009, the speaker fetching
  from rally-server), but the devices expect internet, are set up through
  Google's app with an account, and must be re-set-up for the rally network
  — offline behaviour unverified and probably device dependent. Alexa is
  cloud-only, so no. ESPHome possible. Like OpenStint: only once someone has
  the device and it has worked offline.
- Likely first step: a screen with sound, cabled or Bluetooth into a speaker
  or the organiser's PA. No foreign ecosystem, works offline.

## Where it lives in the dashboard

Hardware gets sub-routes rather than tab state, so they link and survive a
reload: `/hardware/gates` (today's page), `/hardware/outputs` (list with
capability chips; a device page shows only the sections it supports). Not
"Display": Setup → Display already means name format and flags.

## Rough order, if it happens

1. Hardware sub-routes, gates moved over unchanged.
2. Output devices: registration, heartbeat, identify, manual view, two or three
   views.
3. Per-device priority list.
4. More views as asked for.
5. Audio.
