# Spike: Wayland overlay above DRM video (Phase 2 de-risk)

Disposable. Not `targets/linux`. Answers four questions for the §29 Phase 2
claim ("a Wayland compositor overlay is structurally invisible to pages and
composites above even DRM video"):

1. Does Widevine L3 play in this Chromium build? (Shaka DRM demo; Netflix web)
2. Does a second Wayland surface composite ABOVE the playing DRM video at 50%
   opacity, or does anything blank/black?
3. Does DevTools `Page.captureScreenshot` return frames while DRM video plays,
   and does the capture disturb playback?
4. CPU/GPU load and dropped frames during 1080p clear + DRM playback with the
   overlay active.

The stack: **cage** (single-app kiosk) or **labwc** (wlroots session) →
Chromium/Chrome with a Widevine CDM → a **layer-shell** overlay window
(GTK + gtk-layer-shell, RGBA, opacity 0.5) covering a region of the browser.
Measurements come from the page itself over CDP
(`video.getVideoPlaybackQuality()` for dropped frames), plus `top` /
`vcgencmd` for load. Evidence goes to `docs/reports/pi-overlay-validation.md`.

## Files

| File | Purpose |
|---|---|
| `setup-pi.sh` | Raspberry Pi OS (Bookworm, arm64): install labwc/cage, Chromium + `libwidevinecdm0`, GTK layer-shell, Python deps |
| `setup-wsl.sh` | Ubuntu 24.04 under WSLg (x86_64): same stack with Google Chrome (bundled Widevine) — for the compositor-mechanism half only |
| `overlay.py` | The layer-shell overlay: scenery image over a rectangle, 50% opacity, top layer, click-through |
| `cdp.py` | DevTools client: open the demo, start playback, poll `getVideoPlaybackQuality`, take `Page.captureScreenshot` at intervals, log everything |
| `measure.sh` | Samples CPU/GPU/temperature while a run is in progress |
| `run.sh` | Orchestrates one run: compositor → browser → overlay → cdp.py → measure.sh → artifacts under `out/<timestamp>/` |

## Run (Pi)

```
bash setup-pi.sh                        # once; reboots into labwc if it wasn't the session
bash run.sh shaka                        # Shaka Player DRM demo (Widevine, clear + encrypted)
bash run.sh netflix                      # needs a signed-in profile; sign in once with run.sh signin
bash run.sh clear1080                    # 1080p clear (Big Buck Bunny) for the load baseline
```

Artifacts per run: `out/<ts>/playback.jsonl` (quality samples), `out/<ts>/capture-*.png`
(screenshots from CDP — the video region may be black there, that is expected),
`out/<ts>/screen-*.png` (compositor-level screenshots via `grim` — this is what a
human sees, overlay included), `out/<ts>/load.csv`, `out/<ts>/chromium.log`.

## Run (WSLg, mechanism only)

```
bash setup-wsl.sh                        # asks for sudo
bash run.sh shaka --wsl                  # cage nested under WSLg's Wayland
```

WSLg has no hardware video decode and its GPU path is d3d12 translation, so
question 4 is not answerable here; questions 2 and 3 are.
