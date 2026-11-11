# Gates

A gate is a small box at the track that notices a car passing and tells the
server when. That is all it does: whether it is the start of stage 1 or the
finish of stage 3 is decided on the dashboard, so the same gate can stand
somewhere else on the next stage without being touched.

## Which kind

| Kind | Knows which car? | Good for |
|---|---|---|
| **Light barrier** | No. A marshal confirms the car on Live timing, which suggests the next one in start order | the simplest and cheapest gate; exact times |
| **Transponder loop** (RC3/RC4 transponders in the cars) | Yes | no marshal needed at the gate |
| **Both at one gate** | Yes, with the light barrier's exact time | the best of both; not yet tried on real hardware |
| **NFC gate** (ESP32) | Yes, the driver taps a sticker | check-in points; runs, but still being built |

Parts for a Raspberry Pi gate:

- a Raspberry Pi with Raspberry Pi OS Lite on its SD card, and power (for a
  light barrier a Zero 2 W is enough);
- a **light barrier**: Omron E3Z-T61 (emitter and receiver) and a 12 V supply
  for it, **or** a **loop** with an RTL-SDR stick;
- optional: a buzzer, so the gate beeps on every passing and tells you its
  state; a DS3231 clock module, so the gate keeps the time through a power cut.

How to wire the light barrier and the buzzer:
[decoder-adapters.md](../decoder-adapters.md#wiring-an-e3z-t61-npn-through-beam).
Read the warning there about clone sensors before connecting one: a wrong
sensor can destroy the Pi's input.

## Installing a Raspberry Pi gate

Once per gate, at home, with the Pi on a network that has internet. Log in to
the Pi (SSH) and paste:

```bash
curl -fsSL https://github.com/GerritK/rally-gate/releases/latest/download/install-gate-pi.sh | bash
```

It asks:

- **Gate name**: capital letters, digits and `_`. Start it with your club's
  short name, like `CLUB_START_1`, so two clubs' gates never clash.
- **Rename this Pi?** Say yes. The Pi is then reachable under that name in
  small letters with hyphens: `club-start-1.local`.
- **Server address** and **port**: press Enter. Gates find the server by
  themselves.
- **Wi-Fi password**: for the gate's own emergency Wi-Fi (below). The default
  `rally-gate` is fine; write it on the box.
- **Is a DS3231 clock module fitted?**

Nothing about your rally is asked, and nothing has to be changed per event.
Running the same command again later updates the gate and keeps its settings.

## The gate's settings page

Every gate has its own page: `http://<gate-name>.local:57439`, for example
`http://club-start-1.local:57439`. It shows the gate's **Status**, its
**Network** (join a Wi-Fi) and its **Settings**, where **Decoder** selects
what the gate senses with: light barrier, transponder loop, or both.

On the rally Wi-Fi the page is read-only unless the organiser opens it from
the dashboard: **Hardware → the gate → its address link**. That keeps
bystanders from changing a gate. Two exceptions: a gate just switched on that
hasn't found the server yet (for 3 minutes at most), and the gate's own
emergency Wi-Fi, where the page is always open.

## Getting a gate onto the rally Wi-Fi

A gate that finds no Wi-Fi it knows opens its **own emergency Wi-Fi** after
about a minute: `rally-gate-<name>`, password `rally-gate` (or what you chose).

1. Join that Wi-Fi with a phone. The settings page opens by itself.
2. Under **Network**, pick the rally Wi-Fi, type its password, **Join**.
3. The emergency Wi-Fi disappears; the gate is on the rally network.

The gate remembers the network. At the next event with the same router it
just connects.

## Pairing: telling the server a gate is yours

The server only accepts gates the organiser has approved, once per gate and
server laptop.

1. On the dashboard: **Hardware → Pair gates**. Pairing is open for 10
   minutes. (On a server that has no gate yet, it is open already.)
2. Switch the gate on. It appears in the list, waiting.
3. **Accept** it.

Paired gates are remembered across events: in a new event they are listed
under **Known on this computer**, and **Add** puts one into the event.

## Is it working?

On **Hardware**, each gate shows:

- **Online / Offline**: Offline means the server hasn't heard from it for 30
  seconds.
- **Clock**: *In sync* is what you want. Stage times compare the clocks of two
  gates, so this matters. *Imprecise* or *Out of sync* right after switching
  on usually settles within a minute or two.
- **Last read**: drive a car through, and the passing shows here with the car
  it matched. Do this with every gate and every transponder before the rally.

### What the beeps mean (gates with a buzzer)

| Sound | Meaning |
|---|---|
| one short beep | a passing was detected |
| one long | switched on |
| short, short, long | **ready**: server found, sensor running, clock in sync |
| long, long | lost the server (after 15 seconds) |
| long, long, long | clock not in sync (after a minute) |
| long, short | no Wi-Fi found, emergency Wi-Fi opened |
| long, short, long (repeating) | the sensor doesn't start: check wiring and the Decoder setting |
| short, long | shutting down |

No *ready* sound after switching on means one of the three is missing: the
server, the sensor, or the clock.

## Setting up at the track

- Put a light barrier's two halves opposite each other across the track, low
  enough that the car body breaks the beam, and fix them so wind or a bumped
  stake doesn't misalign them.
- Check each gate is *Online* and *In sync* from the start line before the
  first car; Wi-Fi range at the far end of a stage is the usual problem.
- **Switch gates off properly** at the end: **Hardware → Shut down all
  gates**, then unplug. Pulling the plug on a running Pi can damage its SD
  card.

## The ESP32 NFC gate

A small board (Seeed XIAO ESP32-S3 with a PN532 reader) that reads NFC
stickers, for example one on each driver's transmitter. No installer: plug it
in by USB-C and flash it from Chrome or Edge at
[gerritk.github.io/rally-gate](https://gerritk.github.io/rally-gate/). It then
opens the Wi-Fi `rally-gate-…` (password `rally-gate`) to set the rally
network, and is paired like any gate.

Today a tap counts as a passing, so it can time a start or finish. A tap as a
*check-in* is not built yet. Parts and wiring: [esp32-gate.md](../esp32-gate.md).
