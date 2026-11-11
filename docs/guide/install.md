# Install the server

The server is the computer that runs the rally. A laptop is the usual choice
and the one Rally Gate is built for first.

## On a laptop

1. Download the package for your system from
   [Releases](https://github.com/GerritK/rally-gate/releases) and unzip it.
   Nothing else has to be installed.
2. Open the unzipped folder and double-click **Rally Gate**
   (`Rally Gate.exe` on Windows, `Rally Gate.command` on macOS,
   `rally-gate.sh` on Linux). On Windows, unzip first: started from inside the
   zip it fails.
3. A small console window opens, and your browser opens the dashboard.
   **Closing the console window stops the server**, so leave it open for the
   whole event.

The first start asks a few things once:

- **Windows firewall:** allow it. Without that, gates and tablets can't reach
  the laptop.
- **"Unknown publisher" warnings:** the package isn't signed yet. On Windows
  choose *More info → Run anyway*. On macOS right-click the file and choose
  *Open*; on newer macOS versions allow it under *System Settings → Privacy &
  Security → Open Anyway*.

## Choosing an event

Every start begins on **Choose an event**:

- **New event**: give it a name and a date, then *Create and open*.
- **Continue with …**: the event you had open last.
- The list below shows every event on this computer, each with *Open*,
  *Download* and *Delete*. **Import** adds an event file from somewhere else.

One event is one file. *Download* gives you that file: your backup, and the
way to move an event to another laptop. Download it at the end of the day.

You can switch events later under **Setup**, but not while a stage is running.

## Opening the dashboard on other devices

Every device on the rally Wi-Fi opens
`http://rally-server.local:57430` in its browser.

- The browser **on the server laptop is always the organiser**. No password.
- Any other device sees only the public page (start lists and results) until
  it logs in. Marshals log in by scanning a printed QR code; see
  [Running an event](running-an-event.md#4-staff-access).
- To be organiser on a second device, set an **organiser password** on the
  laptop under *Setup → Access* and log in with it.

Some older Android phones can't open names ending in `.local`. *Setup →
Access* shows the laptop's address as numbers (like `192.168.1.20`) to use
instead.

## On a Raspberry Pi instead

Possible, but the laptop gets the attention first. On a fresh Raspberry Pi OS
Lite, logged in over SSH:

```bash
curl -fsSL https://github.com/GerritK/rally-gate/releases/latest/download/install-server-pi.sh | bash
```

The dashboard is then at `http://rally-server.local:57430`. The installer
shows a QR code to set the organiser password, since a Pi has no screen to be
"this computer". A Pi keeps one event; creating and switching events works on
a laptop only.

## Updating

Download the new package and use it instead of the old folder. Your events
are not in that folder (they are in `Documents/Rally Gate`), so they stay.
While Rally Gate is in alpha a new version may not open an older event: finish
a rally on the version you started it with.
