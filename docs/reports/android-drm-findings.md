# Android DRM-in-tile: diagnostic findings

*Status: evidence base for amending §13 (DRM & streaming resolution), §29 (delivery forms & phasing) and the hardware lineup. Written 2026-08-27 from the Android shell work of 2026-08-23 → 2026-08-26.*

This report separates **what was measured** from **what was inferred**. Every measured item cites the commit, memory note, or live device query it comes from. Where we did not test something, it says so — several of the questions in the brief were *not* exercised, and pretending otherwise would corrupt the spec amendments this feeds.

---

## 0. Test surfaces and versions

| Surface | Device | OS / build | Web engine | Tested for DRM? |
|---|---|---|---|---|
| Android TV | NVIDIA SHIELD Android TV ×2 (on the home network) | Android 11 (SDK 30), build `RQ1A.210105.003.7825230_4387.0822` | Android System WebView `150.0.7871.184` (`com.google.android.webview`); **no Chrome installed** on the device (`dumpsys package com.android.chrome` returns nothing) | **Yes** — Paramount+ in a web tile (2026-08-25) |
| Android tablet | none physical; emulator AVD `prism-tablet` (pixel_tablet, API 35, `google_apis` x86_64) | Android 15 emulator | emulator WebView | **No** — only a first-light render (2026-08-23). No DRM probe of any kind was run on a tablet surface. |

Widevine on the Shield (live query, 2026-08-27):

```
/vendor/lib/mediadrm/libwvdrmengine.so        2,016,332 bytes
/vendor/lib/mediadrm/libdrmclearkeyplugin.so
/vendor/lib64/mediadrm/android.hardware.drm@1.3-service.widevine
/vendor/lib64/mediadrm/android.hardware.drm@1.3-service.clearkey
[drm.service.enabled]: [true]   [init.svc.drm]: [running]   [init.svc.mediadrm]: [running]
```

So the device ships the vendor Widevine engine and HAL service. The Shield is a Widevine L1 device (its native Netflix tile plays at full quality — commit `3ea7416`, "no ads, full quality"). The CDM is not missing; what follows is about what the CDM will do **for a WebView**.

Services exercised in web tiles, and in what capacity:

| Service | In a web tile we… | DRM playback attempted? |
|---|---|---|
| Paramount+ | signed in, browsed, started playback (Mac desktop identity, DAI manifest fetched) | **Yes — failed, measured** (below) |
| Hulu, Prime Video | signed in, used as ad-marker web tiles (`adapters/hulu.json`, `prime.json`, commit `140926a`) | Not measured for EME errors; no recorded playback of a protected stream |
| Netflix | declared as web-default + native opt-in (commit `72c2a67`), then moved back to a native launch tile (commit `3ea7416`) | **No recorded EME/key-session error.** The move to native was for quality/ads, not from a captured failure. |
| Spotify web, an EME test page (e.g. the Shaka/dash.js EME demos) | — | **Not tested.** |
| YouTube, MP4, HLS | played | n/a (not DRM) |

The brief asked for Netflix-web, Spotify-web and EME-test-page symptoms. We do not have them. The measured case is Paramount+; it is a strong case (the probes below are service-independent), but it is one case.

---

## 1. Symptoms (measured)

All from the Paramount+ tile on Shield `.66`, 2026-08-25, via the per-tile WebView DevTools socket (`adb forward tcp:9366 localabstract:webview_devtools_remote_<pid>`). Recorded in the `webview-drm-wall` memory note and commit `692f4f6` ("DRM in a web tile: negotiate what we can, document what we can't", 2026-08-25 20:52 −04:00).

**Playback:** the player reaches its playback state and then fails with Paramount+'s own on-screen error **"Error Code: 3304"** ("trouble playing this video"). The video region is the player's dark background with the error card — not a black rectangle of a rendering failure, and not a missing-API failure: the page's DRM negotiation ran.

**Network:** the DAI manifest (`pubads.g.doubleclick.net/ondemand/dash/...`) and the DAI session request both returned **200**. The failure is not the network, the manifest, or the ad-stitching layer.

**EME API presence:** `navigator.requestMediaKeySystemAccess` exists and resolves — *after* the shell's shim strips robustness levels (see §3). Without the shim, the player's own configurations (which name `SW_SECURE_*`/`HW_SECURE_*` robustness) are refused and players such as Shaka conclude "no DRM". Evidence: the comment and code in `SurfaceManager.kt` (`DESKTOP_VIEWPORT_JS`):

> *"This WebView's Widevine answers only an unspecified robustness: both the SW_SECURE_\* a desktop player asks for and the HW_SECURE_\* it falls back to are refused, so players (Shaka) conclude 'no DRM'. Retry without levels."*

**Key/output status:** with a `MediaKeys` object obtained, `MediaKeys.getStatusForPolicy({ minHdcpVersion })` returned **`"output-restricted"` at every HDCP level tried, including `"1.0"`**. That is the CDM stating that no secure output path exists for this client, at any protection level — the precise condition under which a Widevine license server will not issue keys for protected content.

**Capability queries:** `navigator.mediaCapabilities.decodingInfo({ ..., keySystemConfiguration: { keySystem: "com.widevine.alpha", video: { robustness: "<any named level>" } } })` returned **`supported: false`** for any named robustness; with robustness `""` it reports supported.

**Non-DRM baseline on the same tile:** `video.canPlayType('avc1.42E01E')` → `"probably"`; a plain MP4 (960 px) and an HLS stream both load and play. YouTube plays (not DRM'd). Sign-in, browsing and ad-supported page chrome all work in the tile.

**Logcat:** no logcat lines were captured for the failure (the probes were DOM-side over DevTools). `MediaDrm`/`WVCdm` logcat output is a gap; see §6.

**Per surface:** everything above is Android TV. There is no tablet data.

---

## 2. Root-cause analysis

### 2a. "Android System WebView does not expose EME/Widevine to embedded apps at all"

**False, on the evidence.** EME is exposed and functional in our WebView once the app grants the protected-media permission:

```kotlin
// SurfaceManager.kt — WebChromeClient
override fun onPermissionRequest(request: PermissionRequest) {
    val media = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }.toTypedArray()
    if (media.isNotEmpty()) request.grant(media) else request.deny()
}
```

Before that grant existed (commit `6ccc5a0`, 2026-08-25 20:19) the WebView refused Widevine silently and sites showed "video unavailable" — that was a real symptom, and it is *ours* to fix, not a platform limit. After the grant, `requestMediaKeySystemAccess` resolves, a `MediaKeys` is created, and `getStatusForPolicy` answers. The API is there; the negotiated capability is the problem.

Unmeasured but noted: we could not compare "same page in Chrome on the same device" because the Shield has no Chrome installed. The comparison the brief asks for is still worth doing on a device that has both (a tablet), because Chrome's Widevine on Android is the same `MediaDrm` path with a secure `SurfaceView` — the comparison would isolate the surface question (2c) cleanly.

### 2b. "Widevine present but only L3, and the services refuse L3 playback on this client type"

**Partly.** The device is L1 (vendor engine + HAL present; native apps play full quality), so "only L3 exists" is wrong. What we observed is that *inside our WebView* the CDM offers **no named robustness at all** — not `HW_SECURE_*` (L1) and not `SW_SECURE_*` (L3) — only the unspecified level, and reports every HDCP policy as `output-restricted`. For a license server that is indistinguishable from a non-secure client: Paramount+ (3304) requires secure output for its streams and refuses.

The consequence the spec already states — "browser tiles cap at 720p (L3)" (§12, §13) — is therefore **optimistic** for Android WebView: it assumes L3 playback is granted, and we have **no positive confirmation** of any DRM service playing at any resolution inside a tile. The shim's own comment says it "helps where L3 IS allowed"; that was a hope, not a measurement. Netflix is the obvious L3-tolerant service to test (it serves 480p/720p to L3 clients) and was not measured.

### 2c. "Secure-surface / protected-buffer requirements conflict with our compositor/snapshot architecture"

**This is the leading explanation, and it is not yet falsified.** The observation that fits every measurement is: a WebView draws into the app's view hierarchy, and the shell relies on being able to *read those pixels* —

```kotlin
// SurfaceManager.kt — §16 freeze()
val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
web.draw(Canvas(bitmap))          // draw-to-bitmap snapshot of the live tile
```

— which is exactly what protected media forbids. The CDM's `output-restricted` at *every* HDCP level, on a device whose HAL is present and whose native apps play L1, is the signature of "no secure output surface for this consumer". Chromium's Android WebView composites video into a texture the embedding app can read; a secure decoder path needs an output the app cannot read (a `SurfaceView` with the secure flag, i.e. the protected-buffer path native players use).

What we did **not** do: put the tile's video on a secure surface and re-run the probe. Concretely untested: the activity window with `FLAG_SECURE`; the player's own fullscreen path (`onShowCustomView`, which gives us the player's `View` — we place it in the tile frame, but did not check whether the WebView creates a `SurfaceView` there); and whether Chromium's WebView build enables its secure-surface ("overlay") video path at all when the app allows it. Until that is tried, "DRM might work but only if we give up snapshots/overlay on those tiles" remains a live possibility rather than a finding. The cost of that trade is real either way: a tile whose pixels cannot be read cannot be snapshot (§16 freeze/crossfade), cannot be region-focused by transform on a copy (§17), and — for the intermission — the §26 veil is an *overlay over* the player, which a secure surface does not block on Android (overlays above a secure surface are allowed; it is *reading* that is blocked). So the trade would cost §16/§18 guarantees for that tile, not §26.

### 2d. TV-specific: the secure-surface overlay block for native apps

This is a separate mechanism from the WebView question and is recorded in the spec's §29 field finding: *"Android TV's protected media path renders DRM video to secure surfaces the app compositor cannot layer over — §26 overlays are structurally blocked there."* Our own observer work is consistent with it: the accessibility observer + `AppOverlay` (draw-over-apps) route was built for native apps (commit `006450a`), `/state.foregroundApp` follows Prime ↔ Prism correctly, and the media-session/observer signals from the Prime and Hulu **native** apps "expose nothing usable through either route" (commit `140926a`) — which is *why* the web tiles became the ad-marker path in the first place. Note what this does and does not say: the block is on layering *over* a native app's protected output. It is not the same as (2c), where the problem is our *reading* the WebView's output. Two different walls; the spec should keep them distinct.

### Summary of causes

| Hypothesis | Verdict | Evidence |
|---|---|---|
| a. EME not exposed to WebView | **No** — exposed once permission granted | `onPermissionRequest` grant (`6ccc5a0`); `requestMediaKeySystemAccess` resolves; `MediaKeys` obtained |
| b. L3-only, services refuse | **Partly** — device is L1, but the WebView negotiates as a non-secure client; L3 playback never positively confirmed | robustness refused at every named level; `getStatusForPolicy` → `output-restricted` (all levels); Paramount+ 3304 |
| c. Secure surface vs snapshot architecture | **Leading, unfalsified** — never tested with a secure surface | `web.draw(Canvas(bitmap))` snapshot path; `output-restricted` with HAL present |
| d. TV native-app overlay block | **Confirmed separately (spec §29 field finding)** — distinct mechanism | observer/overlay work, `140926a` |

---

## 3. What we tried

| Attempt | Where | Result |
|---|---|---|
| Grant `RESOURCE_PROTECTED_MEDIA_ID` in `WebChromeClient.onPermissionRequest` (deny everything else) | `6ccc5a0` | Turns "video unavailable" (silent EME refusal) into a negotiable EME. Necessary; not sufficient. |
| Shim `navigator.requestMediaKeySystemAccess`: retry the site's configs with `SW_*`/`HW_*` robustness stripped to `""` | `DESKTOP_VIEWPORT_JS`, `6ccc5a0` → `692f4f6` | Negotiation succeeds (Shaka-class players stop saying "no DRM"). Key issuance still fails on protected content. |
| Shim `navigator.mediaCapabilities.decodingInfo`: re-query with robustness stripped when `supported:false` | same | Capability gate passes. Same downstream failure. |
| Desktop identity per tile: UA rewritten to `(Windows NT 10.0; Win64; x64)` or `(Macintosh; Intel Mac OS X 10_15_7)` with matching client hints (`Sec-CH-UA-*`); Paramount+ uses Mac | `6ccc5a0`, `140926a` | Required to get past "streaming web players refuse WebView/mobile UAs" (`140926a`). Unrelated to the DRM outcome. |
| Desktop viewport (rewrite the viewport meta to `1/dpr`, re-assert on load/resize) | `140926a`, `shield-viewport` note | Layout fix only. |
| Network blocking off for streaming tiles (EasyList blocked the IMA SDK the players initialise before playing → generic player error) | `6ccc5a0` | Removed a false failure. Unrelated to DRM. |
| Probes over the tile's DevTools socket: `canPlayType`, `getStatusForPolicy` at each `minHdcpVersion`, `decodingInfo` with/without robustness, manifest/session network status | 2026-08-25 | The measurements in §1. |
| `MediaDrm` probing from Kotlin (query `securityLevel`, `hdcpLevel` on the `MediaDrm` object directly) | — | **Not done.** Would state the device's L1/HDCP capability from the app's own process, independent of the WebView. |
| `SurfaceView` / `TextureView` swap; `FLAG_SECURE` on the window; testing the player's fullscreen custom view path | — | **Not done.** (See 2c.) |
| Custom Tabs / TWA / GeckoView / bundled Chromium | — | **Not done.** (See §4.) |
| Comparison in Chrome on the same device | — | Not possible on the Shield (no Chrome); not done on a tablet. |

---

## 4. Remediation options

Effort is engineering time to a working answer; consequence is what Prism gives up. Rejected options are listed because the spec should say *why*.

| Option | What it is | Effort | Consequence | Assessment |
|---|---|---|---|---|
| **A. Secure-surface experiment** | Give the DRM tile's video a secure output: `FLAG_SECURE` on the window and/or a `SurfaceView`-backed video path (fullscreen custom view), re-run the §1 probes | ~1 day on the Shield | If it works: that tile loses §16 snapshots (no `draw()`), region focus by copy, and warm-tile resurrection from real pixels; the veil (an overlay) still works. If it fails: 2c is falsified and the wall is policy/WebView-build, not ours. | **Do this first.** It is the one cheap experiment that changes the verdict either way. |
| **B. `MediaDrm` probe from Kotlin** | Read `MediaDrm(WIDEVINE_UUID).getPropertyString("securityLevel")` and `hdcpLevel` in the shell | ~1 hour | None | Do alongside A; it turns "the device is L1" from public knowledge into a measurement. |
| **C. Netflix-web / EME-test-page measurement** | Run the same probes on Netflix web and an EME demo page; capture `MediaDrm`/`WVCdm` logcat | ~2 hours | None | Fills the evidence gap the brief asked about; tells us whether *any* L3-tolerant service plays in a tile. |
| **D. Custom Tabs / Trusted Web Activity for DRM tiles** | The tile is a Chrome-rendered activity; Chrome supplies the secure path | ~3 days | Chrome must be installed (the Shield has none — Android TV has no Chrome at all; this option is tablet-only). The tile is no longer ours: no injected adapters, no viewport/UA control, no snapshot, no veil, no region focus; it is a foreign fullscreen window with our chrome around it at best. | Reject for TV (impossible), weak for tablet (it is a launch tile with extra steps). |
| **E. Bundle a Chromium fork** | Ship our own Chromium with the WebView surface behaviour we want | months; ~150 MB APK; a security-update treadmill we own | Everything under our control, including the secure path — *if* Widevine's licensing allows a non-Google Chromium build to ship the CDM (it does not: the Widevine CDM for Chromium is distributed to licensees, and Android's is the platform's) | Reject: the CDM is the blocker, not the browser. |
| **F. GeckoView** | Mozilla's embeddable engine, has its own Widevine plumbing via Android `MediaDrm` | weeks to re-plumb the driver seam (drivers.ts `SurfaceDriver`) for a second engine | Same secure-surface question applies (GeckoView also renders into a `SurfaceView`/`TextureView` the app hosts); adapters/veil would need a second injection path; unknown TV-input maturity | Reject unless A fails *and* GeckoView is shown to negotiate L1 in a hosted view — which nobody has measured. |
| **G. No DRM in Android tiles: launch tiles for DRM services, web tiles for everything else** | What the spec already does for TV (§12 route a, §13 path 2): the native app plays fullscreen at full quality; the web tile covers sign-in, the wall, non-DRM, and ad-supported page chrome | 0 (shipped: `mode` web/native per tile, `72c2a67`) | On Android, DRM streaming lives outside the grid; the intermission over the native app depends on the §29 overlay block and the accessibility observer (weak signals so far) | **Accept as the Android baseline** in the spec, explicitly, instead of the current "720p in tiles" wording. |
| **H. Move the streaming build to Windows/Linux** | Already decided (§29 Phase 1a/1b; hardware lineup: The Studio) | — | Android builds are dashboard + web-ad veil + native launch; the intermission-over-streaming product is Windows first, PrismOS second | Consistent with the evidence; this report supports it. |

---

## 5. Verdict

DRM-in-tile on Android is not dead for *policy* reasons — EME and Widevine are exposed to our WebView, the device's CDM is present and L1-capable, and the permission wall was ours to open and we opened it — and it is not dead for *effort* reasons either, because the decisive experiment (a secure output surface for the tile's video, option A) is a day's work and has not been run. What the evidence shows is an **architectural conflict that we have not yet tried to resolve**: the CDM reports `output-restricted` at every HDCP level for a consumer whose pixels are readable, and Prism's Android shell is built on reading those pixels (§16 draw-to-bitmap snapshots, §18 warm tiles from real pixels, §17 region focus). Everything else — the robustness shims, the identity changes, the permission grant — was necessary plumbing that brought us to that wall, not around it. The honest spec position today is therefore: *Android web tiles do not play protected streams; DRM services on Android are launch tiles* (option G), stated as measured on Android TV and untested on tablets. The verdict would revive if option A shows that a secure surface unlocks key issuance — at which point the design question becomes whether a DRM tile may opt out of §16/§18 guarantees, which is a spec decision, not an engineering one — or if a tablet-with-Chrome comparison shows the WebView build simply never offers a secure path, which would make it a platform limit to record and stop revisiting.

---

## 6. Gaps to close before the amendments are final

1. Run option A (secure surface) and B (`MediaDrm` probe) on Shield `.66`; capture `logcat -s MediaDrm WVCdm chromium` during a Paramount+ attempt so the report has the CDM's own words, not only the page's.
2. Measure Netflix web and one EME demo page in a tile (option C) — the brief's missing symptoms.
3. One tablet data point (a real device with Chrome): same page in the tile and in Chrome, same probes.
4. Update §13's "Android WebView runs software Widevine (L3)… 720p" sentence to what was measured, and make §12's "browser tiles cap at 720p" conditional on (1)–(3).
