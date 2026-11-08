# Widevine-audio POC — music services in WebView2 (stage gate, SM-4)

*dashboard-schema §32 "Cross-cutting" asks for an embed-vs-hand-off decision per
music service, decided by a Widevine-audio POC. This is that report. Harness:
`targets/win-poc-music` (WPF, .NET 8, Evergreen WebView2 1.0.3719.77 SDK on
runtime 151.0.4129.107; default `CoreWebView2EnvironmentOptions`, default user
agent — the same runtime configuration as `SurfaceManager.AttachViewAsync` in
the host). Written 2026-09-01 from two unattended runs (16:36 and 16:47 local,
identical results), one self-test run, and one headless-Edge run. The box is
the Phase-1 development machine; memory of earlier POCs: premium **video** DRM
here is software-tier/HDCP-gated in WebView2 — this report is about audio.*

## Result lines

| Service | Conclusion | Basis |
|---|---|---|
| open.spotify.com | **EMBED (capability-verified, playback pending user run)** | Spotify's own client, signed out, negotiated `com.widevine.alpha` in the tile and was granted audio `SW_SECURE_CRYPTO` for AAC/HE-AAC/Opus; it then created MediaKeys and a temporary session without error (§2.1). No license request was made pre-login, so decode is unproven until a human signs in. |
| music.apple.com | **EMBED (capability-verified, playback pending user run)** | MusicKit's capability sniff ran `com.microsoft.playready` in the tile and was granted; both key systems MusicKit can use on Chromium accept audio-only configurations here (Widevine `SW_SECURE_CRYPTO`, PlayReady up to `3000`). Playback requires an Apple ID with a subscription. |
| www.pandora.com | **EMBED (capability-verified, playback pending user run)** | Pandora's web client made **no** EME call while signed out (three `<audio>` elements and Media Session play/pause handlers appeared; nothing encrypted). If its streams are clear, DRM is moot; if Premium uses Widevine audio, the tier is available (§2). Playback requires an account. |

No service reached FAILED-BOTH or HAND-OFF on capability. Nothing in this
report guesses playback: the sign-in runs are the user's (§5).

## 1. Method

- One WebView2 per service, user-data folder `%LOCALAPPDATA%\Prism-poc-music\<service>`
  (persistent; sign-ins survive restarts, §10 never wiped by the harness).
- Injected page observer (`media-logger.js`, `AddScriptToExecuteOnDocumentCreatedAsync`):
  wraps `requestMediaKeySystemAccess`, `createMediaKeys`, `createSession`,
  `generateRequest`, `update`, `setMediaKeys`; listens to `message` /
  `keystatuseschange` on sessions; watches every `<audio>/<video>` (created,
  encrypted, waitingforkey, play, playing, pause, error, ended, a 5-second
  `timeupdate` heartbeat); samples `navigator.mediaSession` (metadata, artwork,
  playbackState) once a second and logs `setActionHandler` registrations.
  Observe-only: nothing is clicked, no argument or result is altered.
- CDP `Media` domain (`playersCreated`, `playerPropertiesChanged`,
  `playerEventsAdded`, `playerErrorsRaised`, `playerMessagesLogged`) plus
  `Log.entryAdded` and `Runtime.consoleAPICalled` (errors/warnings) captured
  per tile. `playerPropertiesChanged` carries `kAudioDecoderName` and
  `kIsAudioDecryptingDemuxerStream` — the ground truth for "DRM audio is being
  decoded" once a human plays something.
- EME matrix (`eme-probe.js`, run through CDP `Runtime.evaluate` with
  `awaitPromise`): 3 key systems × 4 audio content types × 6 (Widevine) or 4
  (PlayReady) robustness strings, audio-only; `persistentState` ×
  `distinctiveIdentifier` variants; `persistent-license`; an audio+video
  reference row in the host's existing probe shape; and
  `mediaCapabilities.decodingInfo` audio-only. Every granted row also calls
  `createMediaKeys()` (this is where the CDM actually loads) and
  `getStatusForPolicy({minHdcpVersion:''})`.
- Self-test (`--selftest`): the same observer on a loopback page running a
  clear-key session (`org.w3.clearkey`, `generateRequest` → `message` →
  `update` → key status `usable`) and a 1-second WAV pipeline. All of it was
  logged, including `cdp.Media.playerPropertiesChanged` with
  `kAudioDecoderName=FFmpegAudioDecoder` and a `playerMessagesLogged` line
  `CDMAvailable:Yes`. An empty log on a real service therefore means "the site
  did nothing", not "the rig is deaf".
- Headless Edge (`--edge-headless`): `msedge --headless=new --disable-gpu
  --user-data-dir=<poc>\edge-headless-profile --dump-dom
  http://127.0.0.1:<port>/probe.html`, the same `eme-probe.js`. The probe page
  POSTs its JSON to the harness's loopback server and an `<img src="/hold">`
  keeps the load event open until it has (`--virtual-time-budget` did not wait
  for the async probe; `--dump-dom` fired at 958 ms with an empty result).
- Two runtime facts that shaped the rig: **EME refuses opaque origins**
  (`NotSupportedError: EME use is not allowed on unique origins.` on a
  `file://` page — `createMediaKeys` fails even though
  `requestMediaKeySystemAccess` was granted), so local pages are served over
  loopback HTTP; and **the first Widevine negotiation costs ~3 s** on a fresh
  profile (Spotify's own call: `ms=3034`; Pandora's tile: 2543 ms) while the
  CDM loads — later calls answer in 0–1 ms.

## 2. EME capability in WebView2 (identical on all three origins and on loopback)

The matrix was byte-identical across `open.spotify.com`, `music.apple.com`,
`www.pandora.com`, and `http://127.0.0.1` (compared row by row). Files:
`%LOCALAPPDATA%\Prism-poc-music\logs\<service>.eme.json`.

### 2.1 `com.widevine.alpha`, audio-only

| Audio contentType | `""` | `SW_SECURE_CRYPTO` | `SW_SECURE_DECODE` | `HW_SECURE_CRYPTO` | `HW_SECURE_DECODE` | `HW_SECURE_ALL` |
|---|---|---|---|---|---|---|
| `audio/mp4; codecs="mp4a.40.2"` | granted, createMediaKeys ok | granted, ok | **NotSupportedError** | NotSupportedError | NotSupportedError | NotSupportedError |
| `audio/webm; codecs="opus"` | granted, ok | granted, ok | NotSupportedError | NotSupportedError | NotSupportedError | NotSupportedError |
| `audio/mp4; codecs="ec-3"` | granted, ok | granted, ok | NotSupportedError | NotSupportedError | NotSupportedError | NotSupportedError |
| `audio/mp4; codecs="flac"` | granted, ok | granted, ok | NotSupportedError | NotSupportedError | NotSupportedError | NotSupportedError |

- Every rejection is the same DOMException: **`NotSupportedError: Unsupported
  keySystem or supportedConfigurations.`** (there is no more specific message
  from the CDM; Chromium's Widevine on desktop caps *audio* robustness at
  `SW_SECURE_CRYPTO` — `SW_SECURE_DECODE` is a video-decode level and hardware
  levels need a hardware-secure CDM, which this runtime does not expose).
- Granted configurations report `persistentState: not-allowed`,
  `distinctiveIdentifier: not-allowed`, `sessionTypes: ["temporary"]`,
  `initDataTypes: ["cenc"]`; `getStatusForPolicy({minHdcpVersion:''})` = `usable`.
- `persistentState` / `distinctiveIdentifier` variants (AAC, robustness `""`):
  `distinctiveIdentifier: "required"` is **rejected** in every combination
  (NotSupportedError, same message); `persistentState: "required"` is granted
  (config comes back `persistentState: "required"`); `sessionTypes:
  ["persistent-license"]` is **rejected**. Consequence: no offline licenses
  and no device-bound identifier — fine for streaming music, and consistent
  with §19/§22 (the CDM will not hand the site a distinctive identifier).
- Reference audio+video: `avc1.640028` at `SW_SECURE_DECODE` granted (the
  host's M1 finding), `HW_SECURE_ALL` rejected.
- `mediaCapabilities.decodingInfo` audio-only: `supported:true, smooth:true,
  powerEfficient:true` for `""` and `SW_SECURE_CRYPTO`; `supported:false` for
  `SW_SECURE_DECODE`.

### 2.2 `com.microsoft.playready` and `com.microsoft.playready.recommendation`, audio-only

| Audio contentType | `""` | `150` | `2000` | `3000` |
|---|---|---|---|---|
| `audio/mp4; codecs="mp4a.40.2"` | granted, createMediaKeys ok | granted, ok | granted, ok | **granted, ok** |
| `audio/mp4; codecs="ec-3"` | granted, ok | granted, ok | granted, ok | granted, ok |
| `audio/webm; codecs="opus"` | NotSupportedError | NotSupportedError | NotSupportedError | NotSupportedError |
| `audio/mp4; codecs="flac"` | NotSupportedError | NotSupportedError | NotSupportedError | NotSupportedError |

- Both PlayReady key-system strings behave identically. `3000` (hardware) is
  granted for audio-only AAC on this box in both runs (the M1 report saw
  PlayReady `3000` only after the CDM warmed; here it was warm from the start).
- PlayReady grants `distinctiveIdentifier: "required"` (config echoes
  `required`), `persistentState: "required"`, and `sessionTypes:
  ["persistent-license"]` — the opposite privacy posture from Widevine. Worth
  knowing for §22: a site choosing PlayReady *can* ask for a device identifier.
- `decodingInfo` audio-only: `supported:true` for `""`, `2000`, `3000`.
- Every PlayReady negotiation logs Chromium's console warning (verbatim):
  `com.microsoft.playready.recommendation: Internal testing is highly
  recommended prior to enabling PlayReady playback on Windows. Failure to do so
  may cause application instability or playback errors. Before generating a
  request, setServerCertificate() must be called with a valid server
  certificate. Otherwise, generateRequest() could fail.` It is advisory; it
  fires for our matrix and for the sites' own probes alike.

### 2.3 Headless Edge (the hand-off comparison)

`HeadlessChrome/152.0.0.0 … Edg/152.0.0.0` on the same loopback probe page,
`%LOCALAPPDATA%\Prism-poc-music\logs\edge-headless.json`:

- **Widevine rows identical to WebView2** — every audio-only grant, rejection,
  `createMediaKeys` result and `decodingInfo` answer matches row for row.
- **PlayReady is entirely absent in headless Edge** (every row
  `NotSupportedError`, `decodingInfo supported:false`). This is a headless /
  `--disable-gpu` artifact — PlayReady rides Edge's Media Foundation renderer,
  which the headless shell does not bring up — not a statement about a real
  Edge window. The real hand-off shape (`--handoff <service>`, an Edge
  `--app=` window on its own profile) has PlayReady; its playback is a
  signed-in, human step (§5).

Net: for **audio-only Widevine the embedded WebView2 tile and Edge are the
same CDM at the same tier**. There is no capability reason to hand music off
to an Edge window on this hardware.

## 3. Per service, signed out

### 3.1 Spotify (`open.spotify.com`)

Page loads (200) to the logged-out home; Media Session action handlers
registered on load: `previoustrack`, `nexttrack`, `play`, `pause`
(`enterpictureinpicture` explicitly unregistered) — §32 Layer 3 has real
targets before anyone signs in. The page's only media element is a `<video>`
(the web player's transport element; region/veil logic must not assume `<audio>`).

Spotify's own EME negotiation, 3 s after load (its ask, then the grant):

- `com.widevine.alpha` → **granted**: audio `mp4a.40.2` / `mp4a.40.5` / `opus`
  at `SW_SECURE_CRYPTO`; video (`avc1.64002a`, `avc1.4d402a`, `avc1.4d401f`,
  `vp9`, `vp8`) at `SW_SECURE_DECODE`. It had asked for FLAC at
  `HW_SECURE_DECODE`/`HW_SECURE_CRYPTO` and video at `HW_SECURE_ALL` in its
  first configurations — those were skipped by the CDM, not fatal. (FLAC at a
  hardware level is how Spotify gates lossless; this box will get lossy tiers.)
- `com.microsoft.playready`, `.hardware`, `.recommendation`,
  `.recommendation.3000` → all **granted**: audio `SW_SECURE_CRYPTO`, video
  `HW_SECURE_ALL`.
- `com.apple.fps.1_0`, `com.spotify.invalid` → `NotSupportedError` (expected;
  the latter is Spotify's own negative control).
- Then `createMediaKeys()` on Widevine → ok, `createSession('temporary')` →
  ok, **no `generateRequest`** (no license traffic until a track is chosen).

Playback: **not verified** — needs the user's Spotify account (on-demand
needs Premium; free accounts shuffle with ads — the §32 audio-intermission
case). Pre-login errors: none from the player; console noise is Tracking
Prevention on gstatic/recaptcha storage and a sandboxed OneTrust iframe —
both cosmetic.

### 3.2 Apple Music (`music.apple.com`)

Redirects `/` → `/us/new` (200). MusicKit registers Media Session handlers
`play`, `pause`, `seekforward`, `seekbackward`, `nexttrack`, `previoustrack`
(after a few register/unregister cycles during boot). One `<video>` element.

MusicKit's capability sniff, 3.2 s after load: `com.microsoft.playready` with
`initDataTypes: ["keyids","cenc"]` and a **video-only** `avc1.42E01E`
capability (no robustness) → **granted** (`robustness: ""`). No Widevine call
of its own, no `createMediaKeys` from the page. With `Edg/` in the UA MusicKit
is expected to pick PlayReady for playback; audio-only PlayReady is granted at
every level here (§2.2), and Widevine is there as the alternative. Console
noise: MusicKit's `eventQueue overflow` warnings (its own telemetry queue) and
a `debugSource` notice — page-internal.

Playback: **not verified** — needs an Apple ID with an Apple Music
subscription (previews exist signed out, but clicking them would be the
harness driving the site; not done).

### 3.3 Pandora (`www.pandora.com`)

Loads (200) to the logged-out landing. Three `<audio>` elements and one
`<video>`; Media Session `play` and `pause` handlers registered (no
next/previous at this stage — Pandora exposes skip, not previous, per its
catalog note). **No EME call by the page** while signed out; the only
`requestMediaKeySystemAccess` traffic on this origin was the harness's own
matrix. One `net::ERR_NAME_NOT_RESOLVED` for `beacon.krxd.net` (an ad-tech
beacon the network blocks — no effect on the player).

Playback: **not verified** — needs the user's Pandora account. If the free
tier serves clear streams, the tile needs no CDM at all; the Widevine audio
tier is available if Premium requests it.

## 4. Findings that bear on §32 and the host

1. **Audio-only Widevine is `SW_SECURE_CRYPTO` in WebView2 and identical in
   Edge.** No music service can be capability-gated out of the embedded tile;
   the only thing an Edge hand-off would buy is nothing. The hand-off clause in
   §32 stays as an escape hatch for a service that *behaves* differently when
   signed in, and the user runs below are what would reveal that.
2. **PlayReady audio-only is granted up to `3000`** and can ask for a
   distinctive identifier; Widevine cannot. Whether a site picks PlayReady is
   the site's choice (MusicKit sniffs for it). Nothing for the host to do, but
   §22's "what leaves the device" answer differs by key system.
3. **Media Session is live before sign-in on all three** (handlers
   registered; metadata `null`, `playbackState: "none"` until something
   plays). Layer 2/3 of §32 have real hooks; the observer in this harness is a
   working draft of the one SM-4 must plumb into the host.
4. **Spotify's and Apple Music's only media element, signed out, is a
   `<video>`.** Whether audio plays through it is for the signed-in log
   (`page.media.playing` carries the tag); anything in the veil engine keyed on
   `<audio>` alone would miss them.
5. **First negotiation latency ~3 s on a fresh profile** while the Widevine
   CDM loads. Prism profiles persist, so this is a first-run cost per App, not
   per boot — but it is long enough that a facet marked "ready" at first paint
   is not yet able to play; the host's 12-second post-reveal EME probe
   (`SurfaceManager.ProbeEmeAsync`) sits safely after it.
6. **Opaque origins cannot use EME.** The brain page runs on a virtual host
   (`brain.prism`, fine); any future in-app page that wants a media element
   with DRM must also be served from a real origin, never `file://` or
   `about:blank`.
7. **Hidden-surface audio is untested here** (§32 makes music facets
   hidden-only). The windowed harness has per-tile Hide/show buttons
   (`Visibility.Collapsed` → `document.visibilityState` "hidden", no pixels);
   `media.timeupdate` heartbeats continuing in the log while hidden is the
   evidence to collect in the user run (§5, step 6).

## 5. What the user must run to finish playback verification

Build once (any shell, .NET 8+ SDK):

```
cd targets\win-poc-music
dotnet build -c Release
```

Run the windowed harness (this is the only mode that shows a window; every
other mode is off-screen or headless and never shows a dialog):

```
bin\Release\net8.0-windows\PrismMusicPoc.exe --run
```

Then, per tile (left Spotify, middle Apple Music, right Pandora; "… hero"
widens one):

1. Sign in inside the tile (Google/Apple sign-in popups open as child windows
   on the same profile). Sessions persist in
   `%LOCALAPPDATA%\Prism-poc-music\<service>` — sign in once.
2. Play any track / station. Let it run ≥ 30 s. Skip a track. Pause, resume.
3. Watch the status strip under the tiles: it shows the last `mediaSession`
   snapshot (title / artist / artwork count / playbackState) and the last
   EME / media event.
4. Press **Run EME probe now** once while a track is playing (re-runs the
   matrix on the signed-in origin; compares against the signed-out matrix).
5. On Spotify free, wait through an ad break (or on any service, note whether
   the Media Session metadata changes to the ad — §32's audio-intermission
   signal is the adapter's job, but the raw evidence lands here).
6. Press **Hide/show <service>** while playing; wait 20 s; press it again.
7. Close the window (logs flush on every line; nothing to save).

Then send or read `%LOCALAPPDATA%\Prism-poc-music\logs\<service>.jsonl`. What
a successful run shows, in order (kinds are the second field of each line):

- `page.rmksa` with the key system the site chose and `ok: true`, then
  `page.createMediaKeys ok`, `page.createSession`, `page.media.encrypted`
  (with `initDataType`), `page.generateRequest ok`, `page.session.message`
  (`license-request`, byte count), `page.session.update ok`, and
  **`page.session.keystatuseschange {"statuses":["usable"]}`** — the license
  round trip. A `"output-restricted"` or `"internal-error"` status here is the
  failure signature; an `"expired"` after a while is a renewal problem.
- `page.setMediaKeys ok`, `page.media.play`, `page.media.playing`, then
  `page.media.timeupdate` every ~5 s with `currentTime` advancing — audio is
  really decoding. If `playing` never follows `waitingforkey`, decode is
  blocked after the license.
- `cdp.Media.playerPropertiesChanged` with `kAudioDecoderName` (expected
  `FFmpegAudioDecoder` or `MediaFoundationAudioDecoder`) and
  `kIsAudioDecryptingDemuxerStream: true` for an encrypted stream;
  `cdp.Media.playerErrorsRaised` is the CDM/pipeline error channel — empty on
  success.
- `page.mediaSession.state` with real `metadata` (title, artist, album,
  artwork URLs) and `playbackState: "playing"` / `"paused"` tracking the
  human's actions — §32 Layer 2 evidence.
- After **Hide/show**: a `harness.visibility {"visible":false}` line followed
  by continuing `page.media.timeupdate` lines (audio survives a hidden
  surface) — or a `page.media.pause` right after it (the site pauses on
  hidden; §32 would then need the facet zero-sized but *visible*).
- The signed-in EME matrix in `<service>.eme.json` (overwritten by step 4;
  copy the signed-out one first if the diff matters).

If a service refuses: `page.media.error` carries `code`/`message`;
`cdp.console` / `cdp.log` carry the site's own error text; and the Edge
hand-off comparison is `PrismMusicPoc.exe --handoff <service>` (an Edge app
window on `%LOCALAPPDATA%\Prism-poc-music\edge-<service>` — a separate
sign-in; no harness logging inside Edge, so the comparison there is
"plays / does not play" by ear plus `edge://media-internals`).

Unattended modes, for the record: `--probe` (what §2/§3 came from),
`--selftest`, `--edge-headless`. All log to `%LOCALAPPDATA%\Prism-poc-music\poc.log`
and exit non-zero on failure.

## 6. Catalog

`prism-adapters/catalog/{spotify,apple-music,pandora}.json` `drm.windows-host`
and `drm.evidence` now point at this report (§2 / §3.x). All three stay at the
tier the sites' own signed-out negotiation showed (Spotify `software`; Apple
Music `software` with PlayReady `3000` available; Pandora `none` observed);
the signed-in run may upgrade the evidence, never the conclusion line's
"pending" — that gets removed only by the user's log.

## Appendix A — surface inventory (`targets/win-host/PrismHost`)

Every path that creates a web surface today, and whether the §26/§27/§30
engine (bootstrap `TileBootstrapJs` at document-created, adapter/cosmetic
injection via core → `InjectAsync`, `IsMuted` wiring, `WebMessageReceived`
forwarding, `NewWindowRequested` handling, overlay/snapshot/substrate
composition) reaches it. For Agent 5's coverage test (win-host-spec §5 /
§12).

| # | Path | Kind | Environment / profile | Engine today |
|---|---|---|---|---|
| 1 | `Surfaces/SurfaceManager.cs` `AttachViewAsync(Tile)` (~L205–297), entered from `CreateAsync` (~L157) and `ResumeAsync` (~L375) | Slot/tile surface | `CoreWebView2Environment.CreateWithOptionsAsync(null, _store.ProfileDir(profile), …)` → `%LOCALAPPDATA%\Prism\profiles\<id>` | **Full.** `AddScriptToExecuteOnDocumentCreatedAsync(TileBootstrapJs)` (L238), `IsMuted` (L228), `WebMessageReceived` → `ForwardWithId` (L240–252), `NewWindowRequested` → `HandleNewWindowAsync` (L270–280), `ContextMenuRequested`, `NavigationCompleted`/`SourceChanged`, `prism-art.local` virtual host (L233), overlay (substrate + snapshot) in `GetOrCreateVisual` (L1670–1689), intermission in `ShowIntermission` (L424+). Adapter + cosmetic payloads arrive later through core → `InjectAsync` (L307–327). |
| 2 | `Surfaces/SurfaceManager.cs` `HandleNewWindowAsync` (~L1200–1252) + `BuildPopupPanel` (L1255–1299) | Popup child view (allowed §30 sign-in/payment window in a scrim sheet) | **Reuses `tile.Env`** — the opener's profile (`popup.EnsureCoreWebView2Async(tile.Env)`, L1235) | **None** beyond a popup-chain backstop (`pc.NewWindowRequested` → `Handled = true`, L1240). No bootstrap script, no `WebMessageReceived`, no `IsMuted`, no `prism-art.local`, no overlay/veil, no adapter/cosmetic injection; not a tile, so core never learns it exists (`_forwardEvent` never called), absent from `LiveTileIds()` (L1655), `VeilStates()` (L1335), `FreezeAllAsync()` (L1659). `_popups` (L1198) is never cleared on `Destroy`/`Suspend`. |
| 3 | `Brain/BrainHost.cs` `StartAsync` (~L45–89) | Headless brain (1×1, opacity 0, z −1000 in `TileCanvas`) | `CreateWithOptionsAsync(null, <root>\brain-profile, …)`; virtual host `brain.prism` → `Assets\brain` (L62–63) | N/A by design (it *is* the engine's brain): only `window.__prismStoreSnapshot` at document-created (L67–68) + `WebMessageReceived` (L70). **No `NewWindowRequested` handler** — a `window.open` from the brain page would open a real window. |
| 4 | `MainWindow.Menu.cs` `OpenPath` (~L1343–1352) | External shell launch (`Process.Start` with `UseShellExecute`) | n/a | n/a — local files/folders only (data folder, logs). No `msedge`, no `--app=`, no URL is ever passed; **the §29 Edge hand-off (`Media.launch`) does not exist in the host yet**, so the kiosk-installer extension check in win-host-spec §5 has nothing to attach to today. |
| 5 | `App.xaml.cs` L37, `MainWindow.Menu.cs` `ShowAboutAsync` L1359 | Not a surface | — | `CoreWebView2Environment.GetAvailableBrowserVersionString(null)` only. |

Paths that look like surfaces but create none (all XAML over the existing tile
views): picker/catalog (`MainWindow.xaml.cs` `ShowCatalog` L361–417, posters
via `PosterService` HTTP into `Image`); viewfinder / Configure an app
(`MainWindow.Menu.cs` `BeginViewfinder` L586–795 — an overlay `Grid` over the
existing tile; core re-rects the same tile via `HostCalls.StartFraming`;
inherits path 1's engine); Control Center (`ToggleControls` L669–744);
layout/scene editors (`MainWindow.Scenes.cs` `_sePreview` L185–196, 299–346 —
rectangles from `PrismRuntime.previewLayout`); Full Screen presenter
(`ToggleScreenFullscreen` L898–916, `ToggleWallFullscreen` Menu.cs L1331–1341
— `AppWindow.SetPresenter` only); About (`ContentDialog`); empty frame §33
(`BuildPlaceholder` L169–203 — `CreateAsync` returns before `AttachViewAsync`).

Injection surface for a test: `TileBootstrapJs` (L1773–1899) and `EmeProbeJs`
(L1901–1918) are `private const string`; `InjectAsync(id, css, js)` (L307) is
public but keyed by tile id, so it silently no-ops for a popup or the brain.
**There is no central "attach engine to view" function** — `AttachViewAsync`
is the de-facto one but private and `Tile`-typed; the popup path and the brain
each hand-wire their own smaller set. `ContainsFullScreenElementChanged` has
zero occurrences in `targets/win-host` (dashboard-schema §26 "presentation
keeping" expects the host to auto-grant it); fullscreen today is only a human
tap forwarded by `RequestPlayerFullscreenAsync` (L1345–1359).

Ledger rows added from this appendix: B-3 (popup views carry no engine), B-4
(no `ContainsFullScreenElementChanged` handler), B-5 (popups outlive their
opener and are invisible to Control Center / freeze), B-6 (no engine attach
seam for the coverage test to call).
