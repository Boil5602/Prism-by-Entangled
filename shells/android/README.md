# Prism Android shell

Build-order step 2: the thin hands (spec §23). Core runs in a hidden WebView
(`CoreRuntime`); every tile is a WebView positioned by rects that core solves
and sends over the JSON bridge (`SurfaceManager`). Kotlin decides nothing.

## Build & run

1. At the repo root: `npm install && npm run android:assets`
   (bundles prism-core → `app/src/main/assets/prism-runtime.js`; the file is
   generated and gitignored)
2. Open `shells/android` in Android Studio (it will provision the Gradle
   wrapper), or run `gradle wrapper --gradle-version 8.9` with a local Gradle.
3. Run the `app` configuration on a tablet (minSdk 26). The dashboard it
   renders is `app/src/main/assets/dashboard.json` — edit and rebuild to
   change it. (Fetched/hot-reloaded dashboards arrive with the remote API.)

**Status:** verified rendering on the API 35 `pixel_tablet` emulator
(2560×1600): hero solve correct, all three tiles live, per-tile profile
isolation active, zero core errors in logcat. Real-tablet deploy pending.

## What works in this milestone

- Hero layout solved by core (identical rects to the editor — same solver)
- One isolated storage profile per tile where the device WebView supports
  multi-profile (§10); never wiped by the shell
- Audio focus (§3): play in one exclusive tile pauses/mutes the others
- Live resize/rotation re-solve; dark substrate everywhere (§16 groundwork)
- BT remote / d-pad key events forwarded into core's input map (§7)

## Not yet (tracked in the spec)

Kiosk device-owner mode, private listening (§14), intermission/veil
(§26/§27), region focus (§17), VPN (§21), launch tiles (§12), snapshot
persistence to disk (deferred by user until post-build).

## Bridge protocol

See `packages/core/src/runtime.ts` — the shell injects `PrismBridge`
(`dispatch(json)`, `storeGet(key)`) and calls `PrismRuntime.*`. The command
vocabulary is the driver seam of `packages/core/src/drivers.ts`.
