# Prism kiosk for Windows ("The Studio")

A used mini PC + this USB stick = a Prism frame that boots straight into the
dashboard. No OOBE, no login screen, no desktop, no Microsoft account. Windows
is the plumbing that gives Edge hardware PlayReady - 1080p-4K streaming
*inside* tiles - and the intermission veil on top of it. It stays invisible.

This is the PrismOS daemon (spec §23) with Edge drivers, packaged.

## Make the stick (on any Windows PC)

1. Download a Windows 11 ISO from Microsoft (any consumer media that contains
   the "Windows 11 Pro" image - the standard multi-edition ISO does).
2. Plug in a USB stick (8 GB+). It will be erased.
3. From this folder, in an elevated PowerShell:

   ```powershell
   .\make-media.ps1 -Iso "$HOME\Downloads\Win11_24H2_English_x64.iso" -Usb E:
   ```

   Options: `-TimeZone "Pacific Standard Time"` (default: this PC's),
   `-NodeVersion 22.12.0`, `-StageOnly` (build the payload into `.\stage` without a USB).

The script builds the daemon into one file, downloads and checksum-verifies
the Node runtime, stamps `autounattend.xml`, formats the stick FAT32 (splitting
`install.wim` for the 4 GB limit) and lays the payload under
`sources\$OEM$\$1\Prism`, which Windows Setup copies to `C:\Prism`.

## Install the frame

Boot the target from the stick (UEFI). **It wipes disk 0 without asking.**
~15 minutes later, after two reboots, the dashboard is on screen. No keyboard
or mouse is needed at any point.

What happened, in order:

| Stage | File | What it does |
|---|---|---|
| Setup | `autounattend.xml` | bypasses TPM/RAM/CPU checks for old hardware, GPT layout, installs Pro, skips every OOBE screen, creates local user `prism` (blank password, console-only), auto-logon forever, schedules first boot |
| First boot | `oem/Prism/first-boot.ps1` | unpacks Node, applies policies, sets the Prism launcher as this user's shell (per-user `Winlogon\Shell` - explorer never runs), power plan never sleeps, firewall for `:8471`, reboots |
| Policies | `oem/Prism/policies.ps1` | Windows: no consumer promos, lock-screen ads, notifications, Copilot, widgets, web search, OneDrive, Game Bar; telemetry at the Pro minimum; Windows Update installs but **never reboots on its own** (active hours 06:00-02:00, quality updates only, feature updates deferred a year). Edge: no first-run, sign-in, sync, sidebar, shopping, rewards, recommendations, password manager, sleeping tabs; hardware DRM left on |
| Every boot | `oem/Prism/prism-shell.cmd` → `prism-shell.ps1` | the shell process: waits for a network, starts the daemon on the primary display, restarts it on exit with backoff, logs to `C:\Prism\logs` |

The dashboard file is `C:\Prism\dashboard.json` (seeded once from the shared
default; yours after that). The remote API is `http://<frame-ip>:8471`; the
pairing URL is in the newest `C:\Prism\logs\daemon-*.log` and on the wall via
the daemon's QR flow, as on every Prism.

## Maintenance

- **Get a desktop** (this session only): `Ctrl+Alt+Del` → Task Manager →
  *Run new task* → `explorer.exe`. The next boot is kiosk again. There is
  deliberately no keyboard chord in the launcher - a keyboard plugged into the
  frame must not be able to leave the dashboard.
- **Update the daemon**: replace `C:\Prism\shells\daemon\dist\prism-daemon.mjs`
  (and the `assets` folder) and reboot; the launcher picks it up. Spec §28
  update checks are the daemon's own, unparameterized.
- **Re-apply policies / redo first boot**: run the scripts from a maintenance
  PowerShell; both are idempotent.
- **Remote**: RDP is off. Use the phone remote (§6) or plug in a keyboard.

## Honest limits (tracked)

- **Window chrome**: tiles are Edge windows; their title bars are still
  visible - hiding them is daemon work (the Linux compositor does it on
  PrismOS). Next on the list for this build.
- **HDMI-CEC**: Windows has no CEC. TV-remote control of the frame needs a
  Pulse-Eight USB-CEC adapter (~$40) - not wired up yet.
- **Private listening capture** needs `ffmpeg` on the PATH; not bundled yet.
- **Windows Home** cannot defer updates or honor active hours by policy; the
  recipe targets **Pro** (what used office mini PCs ship with).
- **Activation**: the generic key only selects the edition; activation comes
  from the machine's firmware (OEM) key. A PC without one shows the
  activation watermark - cosmetic on a wall, but real.
- The `prism` user is a local Administrator (the daemon manages firewall and
  power). A least-privilege split is a follow-up.
