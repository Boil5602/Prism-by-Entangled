# Pi overlay validation (Phase 2 de-risk) — PENDING

*Status: **pending — no conclusions exist.** Written 2026-08-27. No Raspberry Pi 5 or other ARM hardware was available, and Phase 2 (§29, the PrismOS privacy box) is contingent on Phase 1 shipping, so the spike was stood down before any measurement. Everything below is the question set and a prepared procedure; nothing in this file is evidence.*

The scaffolding (compositor + browser + overlay + harness scripts) is parked at `docs/reports/pi-overlay-spike/` so the procedure can be run without re-deriving it when hardware or priority arrives.

---

## The claim under test

§29 Phase 2: the PrismOS box runs the *full* original §26/§27 design — a Wayland compositor overlay that is structurally invisible to pages and composites above everything the browser draws, including DRM video; system audio capture; no vendor telemetry. The Windows/extension path (Phase 1a/1b) was already measured; the Pi path has not been.

## Questions (unanswered)

| # | Question | What would answer it | Status |
|---|---|---|---|
| Q1 | Does Widevine L3 play in the Pi's Chromium build (Pi OS `chromium` + `libwidevinecdm0`, the ChromeOS arm64 CDM repackaged)? Shaka Player DRM demo (Widevine-encrypted asset); bitmovin.com/demos/drm; Netflix web sign-in + playback | `requestMediaKeySystemAccess` per robustness level, `getStatusForPolicy` per HDCP level, `video.mediaKeys` present, `currentTime` advancing, no `MediaError` — from the harness's `eme` and `quality` records | **Pending hardware** (ARM CDM is the specific unknown; x86 Chrome tells us nothing about it) |
| Q2 | Does a second Wayland surface (layer-shell, TOP layer, 50 % opacity) composite **above** the playing DRM video — visible scenery over moving video — or does anything blank/black? | Compositor-level screenshots (`grim`) with the overlay over the video region, with a moving marker in the overlay to prove it is live; visual check for black/blanked regions | **Pending** — could be run under WSLg on x86 (mechanism is not ARM-specific), not run |
| Q3 | Does DevTools `Page.captureScreenshot` return frames while DRM video plays, and does the *call* disturb playback? (The video region being black in the capture is expected and fine.) | Harness `capture` records: capture latency, bytes, `currentTime` before/after, dropped-frame count before/after, any error | **Pending** — same as Q2 |
| Q4 | CPU/GPU load and dropped frames during 1080p clear + DRM playback with the overlay active | `load.csv` (CPU total, browser CPU, memory, `vcgencmd` v3d clock/throttle/temp) and `getVideoPlaybackQuality` dropped/total | **Pending hardware** (WSLg has no hardware decode and a translated GPU path; numbers there are meaningless for the Pi) |

## Verdict

None. The Pi's full-design claim is neither confirmed nor refuted. The only defensible statement today is the one §29 already makes as a design intent, and the spec should not cite this report as support until Q1–Q4 have data.

---

## Appendix A — procedure on a Raspberry Pi 5 (Pi OS Bookworm, arm64)

Everything lives in `docs/reports/pi-overlay-spike/`.

```bash
cd docs/reports/pi-overlay-spike
bash setup-pi.sh          # labwc, cage, chromium, libwidevinecdm0, gtk-layer-shell, python deps; prints CDM path + Chromium version
# make sure the session is Wayland (raspi-config > Advanced > Wayland > labwc), then:
bash run.sh shaka         # Q1 (Widevine demo), Q2, Q3, Q4 — 60 s, overlay over the lower-right quarter
bash run.sh clear1080     # Q4 baseline: 1080p clear HLS, same overlay
bash run.sh signin        # one-time Netflix sign-in into the spike profile, then:
bash run.sh netflix       # Q1 for Netflix web
bash run.sh bitmovin      # Q1 alternative demo
```

Artifacts per run under `out/<timestamp>/`: `playback.jsonl` (per-second `getVideoPlaybackQuality`, EME robustness/HDCP probe, capture records), `capture-NNN.png` (DevTools captures), `screen-final.png` (compositor screenshot via `grim` — what a human sees, overlay included), `load.csv`, `chromium.log`, `run.log`. `run.sh` prints a summary (frames total/dropped, `currentTime` advance per sample, each capture's latency and effect on `currentTime`/dropped frames, the EME probe).

Notes recorded while preparing (not measurements):
- Pi OS Bookworm's default session is labwc (wlroots); `cage` is the kiosk alternative. Both honor `wlr-layer-shell`, which the overlay uses (GTK + `gtk-layer-shell`, TOP layer, RGBA visual, empty input region → click-through).
- If `http://127.0.0.1:9222/json` never answers, that Chromium build ignores `--remote-debugging-port`; switch the harness to `--remote-debugging-pipe` (see `shells/daemon/src/cdp-pipe.ts`).
- The Shaka demo needs `video.play()` from the harness; that synthetic call is part of the test rig, not the product.

## Appendix B — procedure under WSLg on this PC (mechanism only: Q2, Q3)

Ubuntu 24.04 under WSL2 with WSLg (`WAYLAND_DISPLAY=wayland-0` was confirmed present). Two steps need a human because they require `sudo` and a download:

```
# 1. packages (sudo prompts for the WSL user's password)
wsl -d Ubuntu -- bash -c "sudo apt-get update && sudo apt-get install -y cage labwc wlr-randr grim python3-gi gir1.2-gtk-3.0 gir1.2-gtklayershell-0.1 python3-websocket python3-requests mesa-utils libgl1-mesa-dri fonts-dejavu-core curl"

# 2. a browser with a Widevine CDM on x86 Linux: Google Chrome stable
#    (~110 MB .deb from dl.google.com; Ubuntu's chromium is a snap and does not run here)
wsl -d Ubuntu -- bash -c "cd /tmp && curl -fsSL -o chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt-get install -y ./chrome.deb && google-chrome --version"
```

Then, from the repo in WSL:

```bash
cd docs/reports/pi-overlay-spike
bash run.sh shaka --wsl        # cage nested under WSLg's Wayland; overlay on the nested socket
bash run.sh clear1080 --wsl
```

What this can and cannot say: Q2 and Q3 are properties of a wlroots compositor layering a layer-shell surface over a Chromium window — architecture, not ARM — so a WSLg result transfers. Q1 does not transfer (x86 Chrome's CDM is not the Pi's arm64 CDM), and Q4 does not (no hardware decode, translated GPU). Record any WSLg result in this file under a clearly labelled "x86/WSLg" heading, never as a Pi result.
