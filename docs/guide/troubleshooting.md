# When something goes wrong

First rule on the day: **the rally goes on**. A marshal can always time a car
by hand with **Start now** and **Finish now**, and fix it afterwards with
**Correct**.

## A gate

**It shows offline.**
Check its power, then its Wi-Fi: if your phone sees a Wi-Fi called
`rally-gate-<name>`, the gate found no network and opened its own. Join it
(password `rally-gate` unless you changed it) and connect the gate to the
rally Wi-Fi under **Network**. If the gate is simply far away, the Wi-Fi
doesn't reach: move the router or add an access point. Passings a gate takes
while offline are sent when it reconnects.

**It never appears on Hardware.**
It isn't paired with this server yet. **Hardware → Pair gates**, switch the
gate on, **Accept** it. On a few networks gates can't find the server by
name; then open the gate's settings page and enter the server's address (the
numbers shown under *Setup → Access*) as **rally-server address**.

**Its clock says Imprecise or Out of sync.**
Give it two minutes after switching on. If it stays, the gate isn't reaching
the server's clock: check that it is online, and that the server laptop is
connected by Wi-Fi *or* cable, not both. Don't start a stage on a gate that
is out of sync; times between two gates would be off.

**A light barrier fires all the time, or never.**
Realign the two halves. If it reports when your hand *leaves* the beam instead
of when it enters, switch **Light barrier trigger edge** on the gate's
settings page. Wiring: [decoder-adapters.md](../decoder-adapters.md).

**The gate beeps long-short-long again and again.**
Its sensor doesn't start. Check the wiring (or the RTL-SDR stick) and that
**Decoder** on its settings page matches what is connected.

## A car has no time

Work down this list:

1. **Is the stage activated?** Passings on a stage that isn't running are
   stored but time nothing.
2. **Light barrier?** The passing waits in **On stage** for a marshal to
   **Assign** it.
3. **Transponder?** Open **Hardware → the gate**: its last passings are
   listed with what became of each. An unknown transponder number means it
   isn't entered on the car; fix it under **Entries**.
4. **A finish without a start** times nothing. Enter the missed start by
   hand in the car's row; the finish can be typed there too.
5. If none fits, time by hand and tell the organiser which gate and when.

**"Detections recorded but not timed"** as a banner: the server is retrying
them by itself every 30 seconds. If it stays, something in the setup doesn't
fit; the gate's page shows which passings.

**A wrong time** (two cars swapped, a wrong car assigned): **Correct** the
times on both cars. The History on each car's page shows what was changed and
the value before.

## The dashboard

**A tablet can't open it.**
Is it on the rally Wi-Fi, not the guest network or mobile data? Try the
server's address in numbers instead of `rally-server.local`. On a Windows
server: was the firewall question at the first start answered with yes?

**It opens but shows only start lists and results.**
That device isn't logged in. Scan an invitation, or tap **Log in**.

**The chip at the top says Offline.**
The device lost the server. Check its Wi-Fi, and that the console window on
the server laptop is still open and the laptop didn't go to sleep.

**The server won't start: a port is in use.**
The message names the program holding it. Close that program, or restart the
laptop.

**Windows or macOS refuses to start the package.**
See [Install the server](install.md#on-a-laptop).

**Forgotten organiser password.**
On the server laptop itself you never need it: open the dashboard there and
set a new one under *Setup → Access*. For a server on a Pi, see
[auth.md](../auth.md#the-organiser).

**Spectators can't open the public page.**
A guest Wi-Fi is cut off from the timing network on purpose. Either set the
router up to let just the public page through
([OpenWRT](../openwrt-guest-access.md)), or print the lists.

## Results look wrong

**A crew that retired is ahead of crews that drove everything.**
The notional time penalty is too small: *Setup → Scoring*. About one stage's
duration is a good start.

**A stage's times are missing from the overall.**
The overall counts closed stages only, and only stages set to *Counts toward
the overall*.

**A car is missing from the results entirely.**
A disqualified car is in no ranking; a withdrawn car is listed under the
overall as not classified.

## Still stuck

Note the gate, the car and the time of day, **Download** the event file, and
open an issue at
[github.com/GerritK/rally-gate](https://github.com/GerritK/rally-gate/issues).
