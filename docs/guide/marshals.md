# For marshals

One page for everyone who works with Rally Gate on the day. Nothing to
install: you need a phone or tablet on the rally Wi-Fi.

## Getting in

Scan the QR code on the sheet the organiser gave you. Camera won't scan? Open
`http://rally-server.local:57430`, tap **Log in** and type the code from the
sheet. You stay logged in for the whole event.

What you may change depends on your role (Timing, Stage marshal, Check-in).
You can look at everything.

The clock at the top is the **server's clock**, the one all gates follow. Read
times off it, not off your watch.

## Live timing

Pick your stage at the top. The page is laid out like the stage itself:

- **The gate line**: start, splits, finish, each with its state. A red gate is
  offline; tell the organiser.
- **Up next**: the next car to start, big enough to read from a step away.
- **On stage**: every car between start and finish, with a running time.
- **The start list** below: every car in start order with its times.

With transponder gates you mostly watch. Times appear by themselves.

### A light barrier can't tell cars apart

A passing at a light barrier shows up in **On stage** as an unidentified
passing, with a car already suggested (the next one in start order, or the
car longest on stage).

- Right car? **Assign**.
- Wrong car? Pick the right one, then **Assign**.
- No car at all (a person, a dog, a branch)? **Dismiss this passing**.

Assign a car's start before its finish. Nothing is ever assigned without you:
a wrong guess would be a wrong time nobody notices.

### A gate missed a car

- **Start now** in Up next, at the moment the car leaves.
- **Finish now** in the car's row, at the moment it crosses the line.

These times are marked with a hand icon as hand-timed. Press first, think
later: a slip is fixed with **Correct**.

### Fixing things

Each car's row has its actions directly or under **⋮**:

| You want to | Use |
|---|---|
| change a start or finish time | **Correct**. You can type a time of day (`1403`, `14.03.27`) or the stage time off a stopwatch |
| mark a car that broke down on the stage | **DNF** |
| mark a car that didn't show up | **DNS** |
| let a car drive the stage again (red flag, blocked track) | **Remove attempt… → Void**. The old run is kept as evidence but no longer counts; the car simply starts again |
| give a penalty | the penalty action in the car's row, or on the car's page |

DNF and DNS can be undone until the stage is closed. Every hand-made change
is recorded with the device that made it, on the car's page under History.

A car that is out for the whole rally is **Withdrawn** at the check-in desk,
not marked DNF.

### Stages with a countdown

The **Up next** card becomes the start card: start lights, seconds, and a
tone. **Fullscreen** makes it fill a tablet at the start line. Tap **Enable
sound** once after opening the page, or the browser stays silent.

- **Countdown** starts the countdown for a car; **Cancel countdown** takes it
  back before the car has left.
- On a **timetable** stage every car has its start time already. **New slot**
  moves a car that isn't ready to the end; **Delay** moves everyone still
  waiting back by a time you type.

The car's time runs from zero on the lights, whether it leaves at once or
stalls. A car that leaves too early is marked as a **jump start**; you confirm
the penalty or dismiss it.

## Check-in

**Entries → Check-in** has two stations, **Desk** and **Scrutineering**. Pick
yours; the device remembers it. Find the car, and the next step is the big
button: **Check in** at the desk (add or fix the transponder number right
there), **Passed** at scrutineering.

## If the page says Offline

The chip at the top shows **Live**, **Connecting** or **Offline**. Offline
means your device lost the Wi-Fi or the server; times on screen may be old.
Check your Wi-Fi first. Gates keep timing meanwhile and nothing is lost.
