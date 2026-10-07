# Prism — Windows Hardware Baselines (Phase 1)

Two products, two baselines. Criteria over models: listings churn, these requirements don't.

---

## Baseline 1 — The Extension (runs on the computer you already own)

Chromium (Chrome/Edge/Brave) + Firefox. Installed PWAs are covered on Chromium — a PWA window is a browser window, and content scripts run in it (verified against the Hulu PWA). Firefox on Windows has no installed-PWA story; PWA users should be on a Chromium browser.

**Minimum (everything works: veils, popups, pill, ledger, up to 1080p video):**
- Windows 10 22H2 or Windows 11, x64
- Any dual-core CPU from the last decade; 4GB RAM (8GB if you keep many tabs)
- Browser current-stable: Edge, Chrome, or Firefox
- No GPU requirement — veil/overlay compositing is ordinary page rendering

**The 4K-DRM checklist (per machine, not per product — every link required, miss one and services silently serve ≤1080p):**
1. **Edge specifically.** Hardware PlayReady is Edge-only. Chrome and Firefox use software Widevine (L3) on Windows → capped at 720p (Netflix) / 1080p (some services) no matter the hardware.
2. Intel 7th-gen (Kaby Lake) or newer / equivalent AMD with hardware HEVC decode + SL3000 support; 11th-gen+ or N100 adds AV1 decode (some services now prefer it)
3. HEVC Video Extensions installed (Microsoft Store, ~$1 or free "from Device Manufacturer" variant)
4. HDCP 2.2 end-to-end: GPU output → cable → monitor/TV input
5. The service's 4K plan tier

**Practical note:** the extension itself never requires the 4K checklist — it's only what determines the resolution under the veil.

## Baseline 2 — The Prism Box (dedicated Windows machine behind a TV)

Runs the extension in Edge kiosk + the compositor companion (topmost overlay, WASAPI per-app mute); later the full dashboard daemon. Flat form factors preferred.

**Memory, measured (Prism for Windows host, 2026-10-03, perf.log on the development wall):** with every service in the one shared
browser profile and idle pages parked, the whole of Prism - the host and each service's pages - idles at about 1.8 GB with nothing
playing and about 2.6 GB with one window playing; three windows playing and every reader awake reached about 4 GB. Windows itself
wants 3 to 4 GB. So **8 GB works** for a one-window wall and **16 GB is comfortable** for multiview and many services; 32 GB buys
nothing Prism uses. (Before the shared profile the same wall needed 5.5 to 9 GB, which is where the older figures below came from.)

**Minimum (1080p box):**
- Any 7th-gen+ Intel / Zen+ AMD mini PC, 8GB RAM, 128GB SSD
- Windows 10 22H2 / Windows 11
- HDMI out at 4K60 if the TV is 4K (UI at panel-native even when streams are 1080p)
- Reference class: used Dell Wyse 5070 thin client (Gemini Lake, fanless, ~$40–70 used) — 4K decode capable, modest for heavy multi-tile use; fine as a single-purpose frame

**Recommended (the flagship 4K box):**
- **Fanless N100 slab** (MeLE Quieter class): silent, ~1cm thick, VESA/velcro behind the TV, 6–15W, USB-C powered, 16GB / 256GB
- or **used 1-liter business mini** (OptiPlex Micro / ThinkCentre Tiny / EliteDesk Mini, 8th-gen+ i5, 16GB, ~$100–180 used): more headroom for many tiles, quiet fan, VESA brackets widely available
- Full 4K-DRM checklist from Baseline 1 applies (these classes pass items 2 and 4 stock)

**Box-specific requirements & notes:**
- **Audio:** HDMI audio to the TV/soundbar by default; compositor's WASAPI session mute works per app regardless of sink
- **No native HDMI-CEC on PCs.** TV-remote control of the box needs a USB-CEC adapter (Pulse-Eight class, ~$40–60) — optional; the 8BitDo Micro / phone remote path needs nothing
- **Input:** 8BitDo Micro (keyboard mode) and/or phone remote; BT built into all recommended classes
- **Power behavior:** BIOS "restore AC power" ON (survives outages), Windows fast startup OFF, sleep disabled in kiosk profile (display sleep handled by schedule)
- **The Prism Box Optimizer (software component, not a doc).** First-run tooling that configures the box for one job — running Prism — by disabling telemetry and trimming background load. Rules, same posture as §19/§22/§30:
  - **Manifest-driven and fully disclosed:** every change is a named entry (what, why, resource/privacy effect) shown *before* applying — telemetry/diagnostic data to minimum, advertising ID off, tips/suggestions/widgets off, Copilot/web-search integrations off, consumer app preinstalls removed, background apps disabled, unneeded scheduled tasks and services (Xbox, maps, fax, etc.) off, search indexing scoped down, startup items cleared, update deferral windows, power profile for always-on duty.
  - **Reversible by construction:** the optimizer records prior state and offers per-item and full restore. No registry mystery — the manifest ships in the repo, community-reviewable like filter lists.
  - **Honest ceilings, stated in the UI:** Windows Home/Pro telemetry floors at "Required," not zero — this box is *privacy-leaning*, the Pi remains the zero-telemetry story. Defender and security updates stay ON by default; disabling security is opt-in only, with the tradeoff stated, never silently bundled.
  - **Measured, not vibes:** the optimizer reports before/after (RAM free at idle, background process count, idle CPU) so the benefit is a number the user saw on their own machine.
  - Runs standalone on any Windows machine (extension-only users benefit too), but is positioned as step one of box setup.

## What stays out of scope here

Pi/Linux baselines wait on the parked validation spike; Android is parked per the DRM findings; sealed devices (sticks, TVs, consoles) are orchestration targets, not builds. 4K DRM exists only on certified sealed stacks — for general-purpose hardware that means Windows+Edge, which is why both baselines are Windows.
