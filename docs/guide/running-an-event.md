# Running an event

The organiser's path through the dashboard, in the order you need it. The
menu on the left has five entries: **Live timing**, **Results**, **Entries**,
**Hardware** and **Setup**.

Do steps 1 to 4 in the days before. Everything can still be changed on the
day.

## 1. The rally and its stages

**Setup** holds everything about the event.

- **Rally details**: name, date, location.
- **Classes** (optional): *main classes* split the field (4WD, 2WD);
  *categories* cut across them (Rookie, Stock). Results can be shown and
  printed for any combination.
- **Stages**: add each stage, then open it and add its **Gate assignments**:
  which gate is its **Start**, its **Finish**, a **Split** in between. One
  gate can be start and finish in one (**Start/finish**) if the stage ends
  where it begins. A gate may be planned on several stages.

Two choices per stage:

| Choice | Options |
|---|---|
| How it counts | **Counts toward the overall** (a normal stage) · **Qualifying** (ranked on its own; can set the start order of the first stage) · **Not counted** (shakedown or trial: as many runs as a car likes, the fastest is ranked) |
| How cars start | **Start gate** (the time runs from the car passing the start gate) · **Countdown** (a marshal starts a countdown per car; the time runs from zero) · **Timetable** (every car has a start time: first start plus an interval) |

Start simple: *Counts toward the overall* and *Start gate*.

- **Start**: how start lists are ordered (by start number, by time so far,
  grouped by class), and the countdown settings.
- **Scoring**: the **notional time penalty** and the penalty catalogue. A crew
  that doesn't finish a stage is charged the slowest time on it plus this
  penalty, so that retiring never beats driving. Rule of thumb: about one
  stage's duration.
- **Display**: how crew names and flags are shown.

## 2. Entries

**Entries → Add entry**: start number, driver and co-driver, car, classes, and
the car's **transponder** number if you use transponder gates. A car can have
several (a spare car, a replacement).

On the day, **Check-in** takes each car through two steps: **Check in** at
the desk and **Passed** at scrutineering. A small event does both in one
click (**Check in and pass**). A car that isn't checked in can still start;
the dashboard just points it out. A car that leaves the event for good is
**Withdrawn**.

## 3. Gates

See [Gates](gates.md). Before the first stage, on **Hardware**: every gate
*Online*, every clock *In sync*, and every car driven through a gate once so
you know its transponder is read.

## 4. Staff access

Marshals don't get accounts. They get a printed sheet with a QR code.

**Setup → Access → Add invitation**: a label ("Start SS2"), a role, and for a
stage marshal the stages. **Print** gives one sheet per invitation. Scanning
the code logs that device in; several devices can use one sheet.

| Role | May do |
|---|---|
| **Organiser** | everything |
| **Timing** | every stage: corrections, penalties, passings, activate and close |
| **Stage marshal** | their own stages only: passings, manual start and finish, corrections |
| **Check-in** | entries and transponders |

A lost sheet or a device that shouldn't be in any more: **Block** it on the
same page.

**Keep participants off this Wi-Fi.** The timing network is for the server,
the gates and staff. Anyone on it without a login sees the public page with
start lists and results, but someone with bad intent and the Wi-Fi password
could do more. Put spectators and drivers on the router's guest network
([how, on OpenWRT](../openwrt-guest-access.md)), or post printouts.

## 5. A trial run

A stage set to **Not counted** can be activated before the rally is started.
Use one to test the whole chain with real cars: gates, transponders, marshals'
tablets. Its times never reach the results.

## 6. Start the rally

**Setup → Start rally**. A check lists what looks unfinished (a gate offline,
a car without a transponder, a stage without a finish gate). Only two things
stop it: no entries, or no stage that counts. The rest are warnings; you
decide.

From now on a few things that would change the meaning of times already taken
are locked, such as renaming classes or the start-order rules. Late entries,
transponder swaps and corrections stay possible.

## 7. Each stage, on Live timing

Pick the stage at the top of **Live timing**.

1. **Freeze start list** when you post or announce it, and **Print start
   list**. Until frozen, the list still follows corrections on earlier stages;
   after that it stays as posted.
2. **Activate stage** when it begins. Its gates now time for this stage.
3. Cars run. Up next, On stage and every time appear by themselves. What
   marshals do meanwhile is on the page [for marshals](marshals.md).
4. **Close stage** when the last car is through. Any car still on stage
   becomes **DNF**, any car that never started **DNS**. Closing is final: a
   closed stage can't be activated again, though its times can still be
   corrected.

Several stages can run at the same time, as long as they don't share a gate.

## 8. Results

**Results** shows the **Overall** and each stage, filtered by class if you
like. **Print** opens a PDF for the notice board; **Print all** makes one PDF
with every class's ranking.

- The overall counts **closed** stages only, so it moves when a stage closes.
- Printouts say **Provisional** until the rally is closed.
- Penalties are added on a car's page or from Live timing and count toward
  the overall, never toward a stage time.

## 9. Close the rally

**Setup → Close rally** when protests are settled. Results are then final and
locked. **Reopen rally** (in the ⋮ menu) undoes that if a protest comes late.

Then:

- **Download** the event (Setup, on the event card): that file is your
  archive.
- **Hardware → Shut down all gates**, and only then unplug them.
