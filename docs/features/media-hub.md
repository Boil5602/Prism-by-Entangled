# Media hub: the sound and the screen stay when a remote desktop leaves

2026-10-05:

## What Windows does

Audio endpoints belong to the sign-in session that owns the console or a connected Remote Desktop client. When a Remote Desktop
connection to the PC is closed without signing out, the session goes on running, PRISM in it, attached to no screen and - in
Windows' rules - to no audio device. `qwinsta` shows the session as **Disc**; the host logs `audio: no default device (Element
not found)`; the browser plays into nothing; a phone listening hears frames at level zero. No audio setting changes this, and a
service in session 0 has no audio either. The thing to program around is the session being left off the console.

## What PRISM does

**A switch in the PRISM menu**, *Remote Desktop Support: On / Off* (named so 2026-10-06,; it was *Keep the sound and the screen when a remote desktop leaves*), its tooltip saying what it does, off by default. Turning it on
registers one scheduled task through a single UAC prompt (`Services/MediaHub.cs`, task "Prism keep the console"): on Windows'
own *remote disconnect* trigger, as SYSTEM, it runs a small PowerShell script carried inline in the task's own definition (never a
file in the person's folder: a file run as SYSTEM that the person's own processes could edit would be a way to become SYSTEM, the
commit's security review) that finds the person's session marked `Disc` and runs Windows' `tscon <id> /dest:console` - the session is back on the PC's own screen within
a second or two, and PRISM's sound and screen with it. Turning it off removes the task through one prompt. The switch reads the
task's existence (`schtasks /Query`), never a setting of its own, so it is always honest.

**At setup** (2026-10-06): offered on the Set up services page's This PC block beside the phone's firewall rule, both under one Windows
prompt (docs/features/updates.md, "Setup: Windows asks once"), so a TV PC never meets a prompt later.

**Where to turn it off** (2026-10-06): the Device page
(PRISM menu, Device...) has a Remote desktop section with the switch's state in words and Turn off / Turn on, the same dialog as the
menu item, which stays.

**The phone says what is wrong.** A phone that hears silence asks the host `GET /audio/device`: `{device, session, keepConsole}`.
With no device and the session disconnected it says a remote desktop left the PC off its screen and, with the switch off, names
the switch; with it on, that the session is on its way back. The host logs the ask.

**The trade-off, said in the dialog before Windows asks:** after a remote desktop leaves, the PC's screen shows the desktop
signed in, not the sign-in screen. Anyone at the PC has it. Turn it on for a PC whose screen is PRISM's. (A remote control that
shares the console session - Parsec, Moonlight, Steam Link - never takes the session away and needs none of this.)

Only *RemoteDisconnect* triggers the task. *Switch user* at the PC (a console disconnect) is left alone: the person asked for it.

## Not built

- PRISM putting the session back by itself: `tscon` needs elevation, and PRISM runs as the person; the one prompt at the switch is
  the whole of what it asks.
- Audio with no session on the console at all (a headless PC). Windows gives none.
