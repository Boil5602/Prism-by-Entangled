# Prism for Windows — Host Shell Specification v0.1

*The Phase-1 flagship: a native Windows app hosting web tiles in WebView2, running prism-core, rendering the §26 veil at the compositor level. Confirmed by POCs 1–2 (Netflix + Hulu embedded, simultaneous DRM playback, host overlay over protected video, page-invisible mute).*

This document specifies only what is Windows-specific. All behavior lives in `docs/dashboard-schema.md` (§1–§30) and is referenced, not restated.

---

## 1. Scope & non-goals

**In scope (v1):** dashboard rendering from schema (§1–§9), hero layouts (§8), tile lifecycle (§16/§18), region focus (§17), intermission + veils + popups (§26/§27/§30), audio focus + private listening (§3/§14), remotes + phone pairing (§6/§11), schedules/night/alarm (§4/§24), living previews (§25), updates (§28), kiosk profile, Optimizer hook.
**Non-goals (v1):** VPN (§21) — interface stubbed; Photos (concept doc); TV launch tiles beyond the Edge-window hand-off; Linux/Android anything.

## 2. Process architecture

```
PrismHost.exe (WinUI 3, .NET 8, x64/ARM64)
├─ Core runtime: prism-core (TypeScript) hosted in a headless WebView2
│  "brain" instance — core decides everything; host executes via the seam
├─ Tile surfaces: one WebView2 control per live tile (Evergreen runtime;
│  never Fixed — it lacks PlayReady), each bound to its own user-data folder
├─ Composition layer: host-owned Win2D/Composition visuals ABOVE all tiles
│  (veils, seams, pill, intermission card, snapshots during transitions)
├─ Services: audio (WASAPI loopback + per-control IsMuted), display
│  (brightness/power/HDCP status), input (raw keyboard/HID + BT pairing UI),
│  remote API (local HTTP/WS server), updater, watchdog IPC
└─ PrismWatchdog.exe (tiny): restarts the host on crash/hang; kiosk-only
```

Core ↔ host messaging: one JSON channel (`PostWebMessageAsJson` / `WebMessageReceived`) carrying seam commands and events. No host logic decides layout, audio policy, lifecycle, or veil state — ever. The conformance kit (§23) tests this boundary.

## 3. Driver seam → WebView2 mapping

| Seam op | Implementation | Notes |
|---|---|---|
| `Surface.create(profile)` | new `WebView2` with `CoreWebView2Environment` per user-data folder | folder path = `%LOCALAPPDATA%\Prism\profiles\<profileId>`; never deleted except by explicit user action (§10) |
| `setRect/opacity/z` | control bounds via layout host; z via visual tree order | animations rendered by composition layer, not per-frame control resize (§16 motion) |
| `navigate(url)` | `CoreWebView2.Navigate` | readiness = `NavigationCompleted` + first paint (`DOMContentLoaded` + injected `frame.ready()` / paint-settle timer) |
| `inject(css,js)` | `AddScriptToExecuteOnDocumentCreatedAsync` (JS) + injected style tag | adapters delivered from the adapter store; re-inject on SPA navigation via `SourceChanged` |
| `snapshot()` | `CapturePreviewAsync` → bitmap | DRM regions return black: composition layer treats last-good snapshot as opaque during transitions (§16) |
| `setMuted` | `CoreWebView2.IsMuted` | page-invisible (verified) — this is the §26 mute path |
| `captureAudio` | WASAPI loopback of the process audio session | feeds §14 mix → WebRTC + HTTP stream outputs |
| `Display.brightness/power` | Windows brightness API / monitor power via `SendMessage` + DDC/CI where available | HDCP status surfaced in settings (4K checklist) |
| `Input.events` | Win32 raw input; BT HID pairing via Windows.Devices.Bluetooth UI | §11 multi-remote; §7 input map in core |
| `Media.launch` | Edge installed-app window positioned over the hero rect | the kiosk hybrid for any service that serves software-tier only in WebView2 |
| `Store` | profiles + snapshots + settings under `%LOCALAPPDATA%\Prism` | migrations never wipe (§10, §28) |
| `Net.vpn` | stub interface | v2 |
| `Surface.create(kind)` | `kind` = `slot` \| `floating` \| `hidden`; every kind attaches through ONE seam, `SurfaceManager.AttachEngineAsync` (the only `new WebView2` in the host) | the §5 coverage invariant as code: bootstrap, events to core, inject path, composition overlay, popup doctrine, page-invisible mute, fullscreen auto-grant - a new surface kind cannot skip them; `scripts/verify-surface-coverage.mjs --no-known-gaps` asserts it |
| hidden presence (§32 music facets) | the container keeps its rect and parks LEFT of the canvas (x = −(w+64)), never `Collapsed`, never 0×0; core lays a hidden page out at its window-reveal size (three quarters of the wall), so the service renders its desktop player - Spotify's sidebar, and with it Your Library, is gone below about a thousand pixels of width (B-173) | measured 2026-09-01 (`targets/win-poc-music --hidden-test`): `Collapsed`/0×0 flips the page to `visibilityState: hidden` and Chromium pauses muted-element media there; off-canvas the page stays "visible" and every variant (muted element, control-muted, audible) keeps advancing at 1.0× |
| `surface.setPresence(id, hidden\|panel\|hero, rect, ms)` | move + resize + §16 fade of the SAME control; the renderer is never recreated | §32 reveal/collapse: audio uninterrupted; core picks the rect (panel = the float place, hero = the largest slot) and z 35 (slots 0 < floating 30 < revealed 35 < takeover 40 < popups 950 < pill) |
| `surface.createVisualization(id, style, source, artwork)` + `setVisualizationFeed(id, json)` | `VisualizationHost` (no web view) → `IVisualizationRenderer` chosen by `VisualizationStyles` (Agent 3 registers Prism Beams / Spectrum / Ribbon / Bloom; `BarsRenderer` is the host's fallback); 30 Hz tick while the feed is active, 10 Hz + fewer bands under reduced motion; idles dark | the FFT never crosses the seam: `IVisualizationAudioSource.Bands(n)` is `Services/Audio/WasapiLoopbackFft` (NAudio loopback of the render device, 2048-pt Hann FFT, log bands 40 Hz–16 kHz, attack/decay + slow AGC, capture only while a visualization is active). Process-scoped loopback is the planned upgrade (ledger B-33) |
| popup child surfaces (§30) | a `Tile` of kind `popup` (`<opener>#popup-N`) in the opener's profile, attached through `AttachEngineAsync`, hosted in the sheet over the wall | inherits the opener's `IsMuted` (§3), closes with the opener on destroy/suspend, excluded from boot cache/snapshots, reported to core as `popup {open}` events; a popup's `window.open` is a §30 backstop (no chains) |
| `ContainsFullScreenElementChanged` | auto-granted on every surface (WebView2 fills the surface's rect with the fullscreen element); the host posts `fullscreen-element {contains}` | §26 presentation keeping reads the state from core; promotion to the window is core's decision |
| `ui.route(route, source, id?)` | `MainWindow.UiRouteRequested` (the rail / editors subscribe); until a router subscribes the pill names the route | §6a deep links from the phone (`POST /items/{id}/action`, `/ui/route`), a held remote key (`*_LONG` → `context-sheet`), or core; the host's own UI reports routes it opens via `ReportUiRoute` → `uiRoute` so the flight recorder shows one shape |
| remote API listener | `Services/RemoteServer` (TcpListener HTTP/1.1 on 8471, LAN + loopback) → `PrismRuntime.http` → `http.response` | bytes only: core routes and authenticates (§6 tokens); boot mints a pairing URL `onlyIfUnpaired`; `/remote` is a placeholder page until the PWA lands; `/audio/stream` answers 501 until §14 capture is served |
| Edge hand-off verification (§5) | `Services/HandoffCheck.Verify` + `kiosk/Install-PrismKiosk.ps1` step 3 | the host has no hand-off today (B-24) → `HandoffNotPresent`, reported not warned; when `Media.launch` lands the check reads the hand-off profile's `Preferences` for the veil extension and the host warns on `ProfileMissing` / `ExtensionMissing` |

## 4. Tile lifecycle on WebView2

- `live`: control exists, page loaded. `warm`: control disposed, snapshot shown by composition layer, user-data folder intact. `cold`: snapshot only, no folder warm-up.
- `maxLiveTiles` from device profile: N100/8GB → 4; 16GB → 7; measured RAM headroom can lower it dynamically (core decides; host reports memory pressure events).
- Serialized refresh (§18): host enforces one hidden-loading control at a time; core schedules.
- DRM tiles: never demoted while audible; snapshot for a DRM tile is the last non-black capture or a generated poster (service glyph) — never a black rectangle on the wall.

## 4b. Mini player (B-221, 2026-09-16)

A fourth corner button on the stage opens the **mini player**: a second window of the host, always on top of other windows, no border or title bar, about 320 by 180 at the display's scale, remembered where it was last dragged (host prefs). It draws the stage's current visual live - a mirror `VisualizationHost` on the same style, source and audio bands, fed every feed the stage gets and rebuilt on a restyle - inside a bevelled frame (lit top-left edge, shadowed bottom-right, a sheen, the scene tilted a few degrees) so it reads as a small 3D tile. Its transport (previous, play/pause, next, mute, back, the song) appears only while the pointer is over it and goes through the same core calls the stage uses; drag anywhere moves it; Esc or a double-click brings the full player back. The music keeps playing from the main window's hidden pages - it is a window of the same host - and sign-in, settings and scenes stay in the full player.

## 5. Composition layer (the veil, the pill, the transitions)

**Coverage invariant (normative): the §26/§27/§30 engine runs in every web surface this app creates — no exceptions.** Concretely:
- **Slot facets**: full engine — intermission veil, gallery/partial veils, popup interception, pill (pill renders once app-level, not per-facet).
- **Floating facets**: same engine; veils render within the floating surface's bounds, above it in the composition order like everywhere else.
- **Hidden facets** (audio-only, e.g. a music service): no visual surface, so intermission becomes **audio intermission** — on the adapter's ad-break signal, the shell mutes the facet (page-invisible `IsMuted`) and may play ambient audio (§26) until the end signal; same mute-fast/cover-slow/uncover-fast asymmetry (§26, 2026-09-15: the mute lands on the first sign, the soundscape after the window), same no-synthetic-interaction rule.
- **App setup mode** (full-screen familiar browsing): engine active — popup Control Center especially matters here, since setup is where users browse most freely.
- **Picker live previews** (§31): engine active in the temporary preview profile.
- **Launched Edge windows** (the 4K hand-off, §29): outside WebView2, so covered by the **extension installed in Edge** — the kiosk installer installs/verifies the extension in the Edge profile used for hand-offs, and the host surfaces a warning if a hand-off window lacks it. A hand-off must never silently mean "ads came back."

Conformance addition (§12): a coverage test enumerates every surface-creation path in the host and asserts engine injection + composition hookup on each; a new surface type that skips the engine fails the kit.

- Sits above every tile in the visual tree; hit-testing passes through except on its own controls (intermission card, pill, peek target).
- Renders: §16 crossfades (snapshot ↔ live), hero reflow animations (220ms ease), §26 intermission scenery + card (minimal mode, pause-after-break, chime, peek), §27 partial/gallery veils computed from injected element rects, §30 pill + Control Center panel.
- Element-rect tracking for veils: injected observer posts rects on layout change; host maps CSS px → control px → screen px (DPI-aware, per-monitor v2).
- Reduced-motion honored system-wide (Windows setting) → dissolves.

**Host UI contrast (2026-09-16).** Every word the host draws on its own dark surfaces (menus, sheets, the
player control, pills) is read from a room, not a desk. Rules: (1) an informational row is never made inert by
rendering it in a control's *disabled* state - that state's grey on the menu surface (#12131A) is unreadable
("dark gray on dark gray"); a label gets its own template or a plain TextBlock. (2) Text on host surfaces reads at
4.5:1 or better: light ink #E8ECF2 for information, amber #F2B14C for the one thing to notice, #8A93A2 only for a
genuinely secondary line under a primary one, never for a row's only text. (3) A verb that cannot act right now MAY
be disabled - it is a control, its grey means "not now" - and the reason goes in its tooltip. (4) Where the eye
should land, put a picture there (artwork above a find), not only a brighter word.

## 6. Audio

- Per-tile mute via `IsMuted` (page-invisible). Audio focus (§3) in core; host applies.
- Private listening (§14): WASAPI loopback capture of the host's own session → Opus encode → WebRTC (foreground/Android) + chunked HTTP/LL-HLS endpoint (background/iOS), served by the local remote API server. `avOffset` measured per transport.
- Ambient audio (§26) and chime: host-played local assets, ducked/ordered per spec.

## 7. Input & remotes

- BT HID remotes pair through a host UI wrapping Windows' pairing flow (no Settings app exposure in kiosk); all remotes concurrent; input map in core.
- Phone remote: QR at first boot → local HTTPS/WS API with per-phone tokens (§6). Off-network relay opt-in.
- No HDMI-CEC on PCs: optional Pulse-Eight USB-CEC adapter driver maps to `CEC_*` keys (v1.1).

## 8. Kiosk profile

- Installer option "Dedicated Prism box": creates auto-login local user `prism`, sets its shell to `PrismHost.exe` (custom shell key; Assigned Access where edition supports), disables sleep/fast-startup, enables BIOS-restore reminder, installs watchdog as a scheduled task at logon.
- Boot experience: black substrate → persisted snapshots of last dashboard within ~2s → tiles revive behind crossfades (§16). Never a Windows desktop flash.
- Escape hatch: a documented key chord + phone-remote action to exit to desktop (settings-gated).
- Optimizer (baselines doc) offered as step one; manifest-driven, reversible.

## 9. Updates

- §28: signed MSIX or MSI with self-update checking a static, unparameterized manifest; applied in the night window; rollback on failed launch (watchdog detects boot loop → previous version). Profiles/snapshots untouched across updates.
- Adapters/filter lists/imagery packs update independently on their own cadence.

## 10. Privacy & telemetry

- §19 compat reports only (opt-in, per-incident, whitelisted, inspectable). §22 inventory applies: the host writes nothing off-device except user-initiated reports, updates checks, and relay traffic the user enabled.
- Ledger, popup ledger, snapshots, settings: local only.

## 11. Packaging & requirements

- Targets: Windows 10 22H2+ / Windows 11, x64 (ARM64 build after v1).
- Requires: WebView2 Evergreen runtime (bootstrap-installed if absent), .NET 8 runtime (self-contained build to avoid dependency), HEVC Video Extension recommended (4K checklist).
- Hardware baselines: `docs/windows-hardware-baselines.md`.

## 12. Conformance & testing

- Passes the §23 conformance kit: solver rects identical to reference, §16 no-white-frame timings, audio exclusivity, storage persistence across restart and update, §19 report schema.
- Windows-specific tests: DRM tile playback tier recorded per service (Netflix/Hulu/YouTube) with overlay active; mute page-invisibility assertion; capture-does-not-disrupt-playback; kiosk boot-to-dashboard time; watchdog recovery; DPI/multi-monitor rect mapping.

## 13. Milestones

- **M1 — Skeleton:** host + core brain + one tile via seam; snapshot/crossfade; profiles persist. *Demo: Netflix tile survives restart.*
- **M2 — Dashboard:** solver-driven N tiles, hero drag/resize, lifecycle, refresh engine, schedules. *Demo: kitchen dashboard from the editor JSON.*
- **M3 — Intermission:** veil/card/pill/popups on the composition layer; adapters via injection; page-invisible mute; ledger. *Demo: Hulu ad break → Bierstadt, pass-through skip, pause-after-break.*
- **M4 — Remotes & listening:** BT pairing UI, phone QR pairing, private listening both transports.
- **M5 — Kiosk & updates:** installer profile, watchdog, self-update, Optimizer hook. *Demo: cold boot to dashboard, unattended for a week.*
- **M6 — Conformance & polish:** kit passes; night/alarm; living previews; region focus; store-ready.
