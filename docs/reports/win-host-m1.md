# Prism for Windows — M1 report (host skeleton)

*win-host-spec §13 M1 exit. App: `targets/win-host/PrismHost` (WinUI 3, .NET 8,
x64, self-contained, unpackaged; Windows App SDK 2.4). Build:
`dotnet build -c Debug -p:Platform=x64` in that folder — the .NET SDK is
pinned by `targets/win-host/global.json`. Run the exe or `dotnet run`.
Written 2026-08-30 from instrumented runs (channel trace + screenshots).*

## What M1 contains

- **Evergreen-only gate.** Startup asks for the machine-wide Evergreen
  WebView2 runtime and exits with a loud error dialog if it's absent; a
  Fixed-Version runtime never satisfies the check because the host never
  points at one (§2/§11 — Fixed lacks PlayReady).
- **The brain.** `packages/core/dist/prism-runtime.js` (built by
  `npm run bundle` in packages/core; referenced from core's dist, never
  copied into the host tree) runs in a headless 1×1 WebView2 loading
  `Assets/brain/brain.html` over a virtual host. One JSON channel:
  core→host commands via `postMessage`/`WebMessageReceived`, host→core calls
  via `PostWebMessageAsJson` `{fn,args}` routed onto the `PrismRuntime` API.
  Unhandled rejections inside core surface as `runtime.error`.
- **Channel schema, one source of truth.** `packages/core/src/win-channel.ts`
  (50 commands, 15 host calls, 15 surface events) generates
  `PrismHost.Core/Channel/Channel.g.cs` (`npm run gen:win-channel`); schema
  tests in core pin it to `runtime.ts`/`drivers.ts`, so a new op without a
  schema row fails CI. The host classifies every op: M1 → execute; known
  non-M1 → logged stub (request-lane stubs answer `resolve(null,
  "unsupported")` so core degrades instead of hanging); off-schema → "CHANNEL
  DRIFT" in the log. The host decides nothing (§23).
- **Driver seam v1** (`SurfaceManager`): create (per-profile user-data folders
  under `%LOCALAPPDATA%\Prism\profiles\<id>`), navigate, inject (now + on
  document created), freeze (`CapturePreviewAsync`; a DRM-black capture is
  discarded in favour of the last good snapshot), reveal (crossfade),
  suspend/resume (renderer closed/recreated, profile untouched), setMuted
  (`IsMuted`), setRect/opacity/z. **Per-surface command chains** preserve seam
  ordering (navigate cannot outrun create's async init — this was the first
  real bug; fixed).
- **Composition-layer skeleton.** Per tile: dark substrate + snapshot image
  above the WebView2; surfaces are created hidden and crossfade in on core's
  `reveal` (§16). Window background and `DefaultBackgroundColor` are the dark
  theme — no white frames observed in any run or screenshot.
- **Storage (§10).** `StoreService` in `PrismHost.Core`: atomic saves,
  migration stub that may never drop keys, corrupt files set aside (never
  erased), no profile-deletion API *by construction* (a reflective test fails
  if one appears). 14 tests green (`dotnet test` in `targets/win-host`),
  covering restart, upgrade simulation (v0 → current with unknown keys kept),
  newer-version rollback load, corrupt-store handling with profiles/snapshots
  untouched.
- **Snapshots persist.** Close runs a freeze pass over live tiles
  (`snapshots/netflix.png` 431 KB, `snapshots/hulu.png` 202 KB in the verified
  run); `store.json` carries the boot cache (tile rects + snapshot paths).

## Exit-demo runs (instrumented, signed-out)

Channel trace of a cold start (host.log):
create → navigate → setMuted → **setRect** → inject ×2 → **reveal**, both
tiles, ~3.2 s from `brain ready` to Hulu's reveal. Demo doc: hero layout,
Netflix hero at 0.62, Hulu satellite.

Restart cycle: graceful close → freeze pass writes both snapshots → relaunch →
**boot shows the last dashboard within ~3 s (screenshot at 3 s shows both
tiles as real pixels; snapshot-vs-live is indistinguishable in a still, which
is the point)** → live pages crossfade in behind. Dark substrate throughout;
no white/blank frame in any capture.

Sign-in persistence: profile folders survive restarts and store activity by
test; **the signed-in Netflix pass needs a human sign-in inside the tile** —
mechanics verified signed-out, the sign-in slot below is to be filled on the
first signed-in run.

- [ ] Netflix signed in inside the tile, app restarted, session held: ____

## EME probe (auto-run 12 s after each tile's first reveal → `diagnostics/eme.log`)

```
first run (2026-08-30, cold CDM):
netflix: PlayReady=SW_SECURE_DECODE(2000) Widevine=SW_SECURE_DECODE
hulu:    PlayReady=rejected               Widevine=SW_SECURE_DECODE

later runs (2026-08-31, warm CDM):
netflix: PlayReady=HW_SECURE_ALL(3000)   Widevine=SW_SECURE_DECODE
hulu:    PlayReady=rejected               Widevine=SW_SECURE_DECODE
```

**Correction (2026-08-31):** the tier is run-dependent — after the CDM
provisioned, the same embedded Netflix tile reports **PlayReady
HW_SECURE_ALL (3000)**. The hardware path appears available in WebView2
after warm-up; the catalog records `hardware` with this caveat, and the §29
Edge-hand-off question moves to "confirm with signed-in playback stats"
rather than "assumed necessary".

Hulu's PlayReady rejection on its signed-out landing page is recorded as-is
(probably page-context CDM policy; re-probe when signed in).

## Result lines

Netflix tile via seam: RENDERS — hero rect, revealed by core, no white frames — robustness: HW_SECURE_ALL(3000) warm / SW_SECURE_DECODE(2000) first cold run
Hulu tile via seam:    RENDERS — satellite rect, revealed by core, no white frames — robustness: PlayReady rejected / Widevine SW_SECURE_DECODE
Restart → snapshot → crossfade: WORKS (~3 s to real pixels; §10 tests green; signed-in pass pending human sign-in)
