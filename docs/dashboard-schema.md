# Frame Dashboard Schema v0.1 (draft)

One JSON document describes everything a device renders. The Android shell and the Pi daemon both consume it unchanged. Devices fetch it from the backend (or local file for self-hosters) and hot-reload on change.

---

## 1. Top-level document

```json
{
  "schema": "frame.dashboard/v0.1",
  "id": "kitchen-main",
  "name": "Kitchen",
  "grid": { "cols": 3, "rows": 2, "gap": 8 },
  "theme": { "background": "#0e0e10", "radius": 12, "mode": "auto" },
  "audio": { "policy": "exclusive", "defaultSink": "system" },
  "schedule": [ ... ],
  "tiles": [ ... ]
}
```

| Field | Type | Notes |
|---|---|---|
| `schema` | string | Version pin. Shells reject majors they don't know. |
| `id` | string | Stable identifier; used by the remote API (`PUT /dashboards/kitchen-main`). |
| `grid` | object | `cols` × `rows` defines the layout lattice. Tiles claim cells via `area`. 1–7 tiles supported in v0.1. |
| `theme` | object | `mode`: `light` \| `dark` \| `auto` (auto follows schedule). |
| `audio` | object | Global default policy. Per-tile overrides below. |
| `schedule` | array | Time-based behaviors (dim, sleep, layout swap). |
| `tiles` | array | The panes. |

## 2. Tile object

```json
{
  "id": "yt",
  "area": "1 / 1 / 3 / 3",
  "url": "https://www.youtube.com",
  "zoom": 1.0,
  "viewport": "auto",
  "refresh": null,
  "state": "normal",
  "audio": "exclusive",
  "touch": "full",
  "adapter": "youtube",
  "persist": true
}
```

| Field | Values | Notes |
|---|---|---|
| `area` | CSS grid-area string (`rowStart / colStart / rowEnd / colEnd`) | Same syntax both platforms; trivially mapped to Compose grid or wlr layout. |
| `zoom` | float | Page zoom. Default 1.0. |
| `viewport` | `auto` \| `desktop` \| `mobile` | UA + viewport override for sites that need a specific layout. |
| `refresh` | seconds or `null` | Auto-reload interval. Use for dashboards/news; never for media tiles. |
| `state` | `normal` \| `theater` \| `fullscreen` | `theater`: tile expands to full width/height available, others shrink (media tiles keep playing per audio policy). `fullscreen`: takeover; back gesture / remote `back` returns to grid. |
| `audio` | `exclusive` \| `mix` \| `mute` | `exclusive` (default): gaining playback mutes all other non-`mix` tiles. `mix`: opt-in simultaneous channel. `mute`: never audible. |
| `touch` | `full` \| `scroll` \| `none` | `scroll` = read-only pane (no accidental clicks); `none` for pure display tiles. |
| `adapter` | string or `null` | Key into the adapter repo (below). `null` = raw page. `"generic-video"` available as fallback. |
| `persist` | bool | Keep WebView/browser alive when another tile is fullscreen. Default true for media, false otherwise. |
| `kind` | `slot` (default) \| `floating` | Pre-scene-model (superseded: floating/hidden are scene-level in `docs/scene-model-spec.md` §5). A floating tile is not solver input; it hovers above the wall at `float`. `frame` is the pre-rename spelling of `slot` (SM-6): readers accept it forever, nothing writes it. |
| `float` | `{x, y, w, h, face, hidden}` | Pre-scene-model (superseded by scene `floating`/`hidden`). Fractions of the wall (0–1); `hidden` keeps the tile alive and audible off the wall. |
| `placeholder` | bool | Pre-scene-model (superseded by unassigned scene slots, scene-model §5). An empty slot: a shape and a place, no page, no session. |

## 3. Audio focus rules (normative)

1. At most one `exclusive` tile audible at a time. Play event (or in-page unmute of a playing player) in an exclusive tile ⇒ MUTE all other exclusive tiles — they keep playing silently (the wall keeps moving; only the audio migrates), duck nothing, pause nothing. (Amended 2026-08-31: the earlier pause/mute reading was a functionality loss.) *Amended 2026-09-17 for music sources:* a **music source** (a hidden music facet, §32) that loses the audio is **paused** through its own player as well as muted — "We shouldn't mute and continue streaming services that aren't actively playing. They should be paused." A silent music player spends skips and ad breaks for no one and walks a Prism-ordered play (§32 layer 5) forward behind the person's back. Video and every other exclusive tile keep the mute-only rule: a muted live stream keeps moving.
2. `mix` tiles are unaffected by exclusive transitions and by each other.
3. UI must show a per-tile mute toggle and a global mute.
5. Boot is silent: every tile starts muted regardless of policy; the first human play (or in-page unmute) lifts exactly the tile it happened in. (Added 2026-08-31.)
4. Android: implemented via per-WebView `setAudioMuted` equivalent + JS `pause()` injection through the adapter. Linux: PipeWire per-client mute keyed by window.

## 4. Schedule entries

```json
{ "at": "22:30", "action": "dim", "value": 0.2 },
{ "at": "23:00", "action": "sleep" },
{ "at": "06:30", "action": "wake" },
{ "at": "17:00", "action": "layout", "value": "dinner-mode" },
{ "on": "motion", "action": "wake" }
```

Actions: `dim` (0–1 brightness), `sleep`, `wake`, `layout` (switch dashboard by id), `mute`. Triggers: `at` (24h local), `on`: `motion` (camera/PIR where available).

## 5. Adapters (separate repo, data not code)

An adapter is a directory fetched independently of shell releases:

```
adapters/youtube/
  adapter.json      # match rules + capabilities
  inject.css        # cosmetic cleanup (banners, sidebars, sticky headers)
  inject.js         # behavior (dismiss dialogs, theater mode, big controls)
```

`adapter.json`:

```json
{
  "match": ["youtube.com", "m.youtube.com"],
  "capabilities": ["theater", "fullscreen-video", "media-keys"],
  "injectAt": "document-end",
  "version": "2026.08.1"
}
```

Shell contract: inject CSS then JS at `injectAt`; re-inject on SPA navigation; expose `frame.mediaCommand(cmd)` (`play|pause|next|prev`) that adapters implement so remote/media keys work per-site. Adapters may fail silently — core grid/audio/touch never depends on them.

Content blocking is a shell feature, not an adapter: network-level filtering from community lists, per-tile toggle (`"blocking": false` to disable on a tile).

**Filter categories & source transparency (normative).** Blocking is organized as named categories, each bound to an attributed upstream list. The UI must show, for every category: the list's name, maintainer, upstream URL, license, last-sync date, and entry count — no anonymous or merged-and-unattributed filtering, ever.

| Category | Default | Source (attributed in UI) |
|---|---|---|
| `ads` | on | EasyList (community, GPL/CC dual-licensed) |
| `trackers` | on | EasyPrivacy (community) |
| `scam-disinfo` | off | StevenBlack `fakenews` hosts list (community, MIT) — known hoax/scam/disinfo domains |

Rules: users can disable any category, add their own list URLs, and inspect exactly which category (and therefore whose judgment) blocked a given request — the blocked-request log names the list. Anthropic-of-the-project stance: the shell never ships an unlabeled "truth filter"; every filtering decision is traceable to a named, inspectable source the user chose to enable.

**Credibility labeling (adapter, not blocking).** For contested-but-legal news sources, the shell labels rather than censors: an optional `news-credibility` adapter badges links/tiles with the source outlet's reliability rating. v0.1 data source: Wikipedia's Perennial Sources list (CC BY-SA, community-adjudicated, methodology public), chosen for transparency over coverage; the badge links to the rating's rationale. Alternative datasets (e.g., Iffy Index/MBFC) may be offered as clearly labeled options where licensing allows. Labeling is off by default, per-tile, and never hides content — informing the reader is the feature; deciding for them is not.

## 6. Remote API (device-local HTTP, also proxied via backend)

```
GET  /state                      → current dashboard id, per-tile audio/play state
PUT  /layout/{dashboardId}       → switch dashboard
POST /tiles/{id}/command         → {"cmd": "play|pause|next|prev|reload|fullscreen|normal|mute|unmute"}
POST /display                    → {"brightness": 0.5} | {"power": "sleep|wake"}
POST /navigate                   → {"tile": "browse", "url": "https://..."}
```

Auth: single bearer token minted at pairing (QR on first boot). This API is what the phone-as-remote web page and any physical remote mapping drive. 8BitDo/media keys map to the same commands locally.

**Phone pairing (canonical UX):**

1. Frame displays a QR (first boot, and anytime via edit mode → "Add phone" or remote command) encoding `https://<frame-host>/remote?token=<bearer>`. Tokens are per-phone: each QR render mints a fresh token so devices can be individually named and revoked.
2. Phone scans with its native camera; the remote page opens in the browser, stores the token, and prompts "Add to Home Screen" (installable PWA — feels like an app, is just web).
3. Remote page ⇄ frame over LAN: WebSocket for live state (now playing, current dashboard, tile states), HTTP commands for control and layout switching. Multiple phones concurrently; all tokens listed and revocable in edit mode.
4. Off-network fallback: the same page relays through the hosted backend (opt-in, hosted-sync users) so remote control works away from home. Self-hosters can expose their own relay or stay LAN-only.

Web Bluetooth is deliberately not used for phones: Safari/WebKit does not implement it, so it can never serve iPhone users. Bluetooth remains the transport for physical HID remotes only (Section 11); phones ride WiFi.

## 7. Input mapping

```json
"inputs": {
  "MEDIA_PLAY_PAUSE": { "tile": "focusedMedia", "cmd": "play-pause" },
  "KEY_1": { "action": "layout", "value": "kitchen-main" },
  "KEY_2": { "action": "layout", "value": "dinner-mode" },
  "ARROW_RIGHT": { "tile": "photos", "cmd": "next" }
}
```

`focusedMedia` = last tile that produced audio. Ships with a default map matching the 8BitDo Micro keyboard mode; fully user-overridable.

---

## Example 1: Kitchen (music + calendar + YouTube)

3×2 grid. YouTube dominant left 2×2, calendar and radio stacked right.

```json
{
  "schema": "frame.dashboard/v0.1",
  "id": "kitchen-main",
  "name": "Kitchen",
  "grid": { "cols": 3, "rows": 2, "gap": 8 },
  "theme": { "background": "#0e0e10", "radius": 12, "mode": "auto" },
  "audio": { "policy": "exclusive" },
  "tiles": [
    {
      "id": "yt",
      "area": "1 / 1 / 3 / 3",
      "url": "https://www.youtube.com",
      "adapter": "youtube",
      "audio": "exclusive",
      "touch": "full",
      "persist": true
    },
    {
      "id": "calendar",
      "area": "1 / 3 / 2 / 4",
      "url": "https://app.yourdomain.com/calendar?view=agenda",
      "adapter": null,
      "audio": "mute",
      "touch": "scroll",
      "refresh": 300
    },
    {
      "id": "radio",
      "area": "2 / 3 / 3 / 4",
      "url": "https://app.yourdomain.com/tiles/radio",
      "adapter": null,
      "audio": "exclusive",
      "touch": "full",
      "persist": true
    }
  ],
  "schedule": [
    { "at": "22:00", "action": "dim", "value": 0.25 },
    { "at": "23:00", "action": "sleep" },
    { "on": "motion", "action": "wake" }
  ]
}
```

Behavior: playing radio pauses YouTube and vice versa (both exclusive). Calendar can never make noise or steal a tap mid-scroll.

## Example 2: Family command center (5 tiles)

4×2 grid: calendar hero, photos, weather, notes/chores, news ticker.

```json
{
  "schema": "frame.dashboard/v0.1",
  "id": "family-center",
  "name": "Family Command Center",
  "grid": { "cols": 4, "rows": 2, "gap": 8 },
  "theme": { "mode": "auto" },
  "audio": { "policy": "exclusive" },
  "tiles": [
    {
      "id": "calendar",
      "area": "1 / 1 / 3 / 3",
      "url": "https://app.yourdomain.com/calendar?view=week&family=all",
      "touch": "full",
      "audio": "mute"
    },
    {
      "id": "photos",
      "area": "1 / 3 / 2 / 5",
      "url": "https://app.yourdomain.com/tiles/photos?album=shared",
      "touch": "none",
      "audio": "mute",
      "adapter": null
    },
    {
      "id": "weather",
      "area": "2 / 3 / 3 / 4",
      "url": "https://app.yourdomain.com/tiles/weather",
      "touch": "scroll",
      "audio": "mute",
      "refresh": 900
    },
    {
      "id": "chores",
      "area": "2 / 4 / 3 / 5",
      "url": "https://app.yourdomain.com/tiles/notes?list=chores",
      "touch": "full",
      "audio": "mute"
    }
  ],
  "inputs": {
    "KEY_1": { "action": "layout", "value": "family-center" },
    "KEY_2": { "action": "layout", "value": "kitchen-main" },
    "ARROW_RIGHT": { "tile": "photos", "cmd": "next" },
    "ARROW_LEFT": { "tile": "photos", "cmd": "prev" }
  }
}
```

---

## 8. Hero layout mode

Alternative to the fixed lattice. One anchor tile; satellites reflow around it. Resizing the hero re-solves the whole layout while trying to honor each tile's preferred aspect ratio.

Solver input is the wall's tiles only: `kind: "floating"` tiles (§32) are excluded from every mode (hero, grid, solo) and never occupy a slot — adding or removing one never reflows the wall. A floating tile named as hero is ignored and the first wall tile anchors.

```json
{
  "layout": {
    "mode": "hero",
    "hero": "yt",
    "heroSize": 0.62,
    "satellites": "auto",
    "gap": 8
  }
}
```

| Field | Notes |
|---|---|
| `mode` | `grid` (Section 1 lattice) or `hero`. |
| `hero` | Tile id of the anchor. Tap-hold or remote command can promote any tile to hero. |
| `heroSize` | Fraction of the long axis the hero occupies (0.3–0.85). Drag the hero's edge to change it; shell persists the new value. |
| `satellites` | `auto` (solver places them) or an ordered array of tile ids for stable ordering. |

### Aspect hints

Each tile may declare what shape it looks best at:

```json
{ "id": "yt", "aspectHint": "16:9", "aspectWeight": 1.0 }
{ "id": "calendar", "aspectHint": "3:4", "aspectWeight": 0.6 }
{ "id": "ticker", "aspectHint": "8:1", "aspectWeight": 0.9 }
```

- `aspectHint`: ideal w:h. Adapters ship a default (video sites → 16:9, agenda → 3:4, photos → source-driven), user can override per tile.
- `aspectWeight`: how much the solver should fight for that ratio (0 = fully flexible, 1 = rigid). 

### Solver (normative, deliberately simple)

1. Place hero at `heroSize` on the long axis, sized to its own aspect hint as closely as the remaining axis allows.
2. Partition leftover space into strips (right/bottom of hero depending on device orientation).
3. Assign satellites to strips minimizing `aspectWeight × |log(actual/hint)|`, summed across tiles. Each strip may subdivide into a uniform column grid (v2, 2026-08-31): the column count is chosen by the same cost, so e.g. four 16:9 satellites beside the hero solve to 2×2 rather than four letterboxed bars. The last row stretches to fill its width; cost ties prefer fewer columns.
4. Ties broken by `satellites` order, then tile array order.
5. Solver output is deterministic for identical inputs — both platforms must produce the same rects (share the solver as a small library: one TypeScript reference implementation, ported/bound on Android).

Resizing the hero re-runs steps 1–4 live at drag time (throttled), commits on release.

### Fullscreen and promotion

- Any tile → fullscreen (existing `state` field); back returns to the solved layout unchanged.
- `POST /tiles/{id}/command {"cmd": "hero"}` promotes a tile to anchor; previous hero becomes a satellite. Same available via tap-hold menu.

### One-tap refresh

Tile chrome (thin overlay on hover/tap) exposes: refresh-now, auto-refresh toggle cycling `off → 5m → 15m → 60m` (writes the `refresh` field), mute, fullscreen, promote-to-hero. Chrome hidden by default; `touch: "none"` tiles show it only via remote/edit mode.

## 9. Dashboard carousel

Devices hold an ordered set of dashboards and swipe (or remote-key) between them.

```json
{
  "carousel": {
    "order": ["kitchen-main", "family-center", "dinner-mode"],
    "wrap": true,
    "gesture": "edge-swipe",
    "transition": "slide"
  }
}
```

- Delivered as a small device-level document alongside the dashboards (`GET /carousel`).
- `edge-swipe` (from screen edge) avoids colliding with in-tile scrolling; full-surface swipe available for `touch: "none"`-heavy layouts.
- Remote API: `POST /carousel/next`, `/carousel/prev`, plus the existing `PUT /layout/{id}` for direct jumps. Input map keys (`KEY_1`…) still bind to specific dashboards.
- Media tiles with `persist: true` keep playing across carousel moves; audio policy continues to apply globally, not per-dashboard.

## 10. Session isolation

Every tile gets its own isolated storage profile (cookies, localStorage, IndexedDB) by default. Two tiles can hold two different logged-in accounts of the same site.

```json
{ "id": "cal-holly", "url": "https://app.yourdomain.com/calendar", "profile": "holly" }
{ "id": "cal-mark",  "url": "https://app.yourdomain.com/calendar", "profile": "mark" }
{ "id": "yt", "url": "https://www.youtube.com" }
```

- `profile` omitted ⇒ implicit profile named after the tile id (fully isolated).
- Same `profile` string across tiles ⇒ deliberately shared session (e.g., your calendar tile and a notes tile under one family login).
- Profiles are device-local and survive layout edits and carousel membership; deleted only when no tile references them (with confirmation).
- Android: WebView multi-profile API. Linux: one `--user-data-dir` per profile. The editor UI surfaces this as a simple "Account" dropdown per tile, not as cookie-jar jargon.

**Storage persistence guarantee (normative):** the shell must never clear or reset a profile's storage (cookies, localStorage, IndexedDB, CDM/DRM state) as a side effect of anything — app updates, schema migrations, layout edits, carousel changes, adapter updates, crashes, or reboots. Sessions on streaming and account sites are refreshed on use and persist indefinitely if left untouched; the only things allowed to destroy a profile are the user explicitly deleting it (with confirmation) or the site itself ending the session. Shell updates that change storage formats must migrate, never wipe.

## 11. Bluetooth remotes (multi-device, zero-fuss)

Any number of BT HID devices (8BitDo, media buttons, mini keyboards, air mice) can be paired simultaneously. They all emit standard key events, so no per-device drivers or apps are ever involved.

**Pairing flow (shell-owned, settings never exposed):**

1. Edit mode → "Add remote" → shell enters BT scan.
2. Devices in pairing mode appear as a list; tap to pair. Just-Works pairing only (no PIN entry) — every remote in this class supports it.
3. Shell marks the device trusted for auto-reconnect and names it (editable): "Kitchen remote", "Couch remote".

**Runtime rules:**

- All paired remotes are live at once and share the global input map (Section 7) by default. Two people with two remotes both work, last event wins.
- Optional per-device overrides: `"inputs": { "device:kitchen-remote": { "KEY_1": ... } }` — e.g., the kitchen remote's buttons target the radio tile while the couch remote targets YouTube. Never required.
- Auto-reconnect on wake/boot; a paired remote's first keypress also wakes the display (`on: "input"` implicit wake trigger).
- Battery level surfaced in edit mode where the device reports it (HID battery service).

**Platform notes:** Android tracks trusted HID devices natively; the shell only needs a companion-device pairing UI. Linux: daemon drives BlueZ (pair/trust/connect) and reads evdev; identical UX. Phones are *not* BT remotes — they use the HTTP remote API over WiFi (Section 6), which is richer and needs no pairing beyond the QR token.

## 12. TV build (HDMI target)

Same software, third hardware path: any TV becomes the frame. Two routes, with route (a) now primary.

**a) Android TV box (primary — Shield for 4K certification, onn-class for $20–30).** The shell APK runs as the dashboard *and* as a native-app launcher:

- **Intent launching:** a tile can launch any installed app (Netflix, Disney+, etc.) fullscreen via Android intents — instantly, at the device's full certified quality (Shield: 4K/Dolby Vision). Deep links into specific titles/rows work the same way. Tile schema: `{"launch": {"package": "com.netflix.ninja", "deepLink": "..."}}` — a `launch` tile renders as a poster/button, not a WebView.
- **Return:** Back/exit from the launched app lands on the shell (the launching activity) — reliable everywhere. For Home-button-to-dashboard, the shell registers as the device launcher; well-supported on Shield, may need a settings step or remap on newer Google TV devices. Docs promise Back-returns, treat Home-returns as a setup nicety.
- **Not possible:** native apps cannot render *inside* a tile — Android does not allow embedding another app's UI. Grid = web tiles; native apps = fullscreen excursions.
- CEC is native on these boxes (TV power follows the box; TV remote controls the shell).
- Requirement: shell UI fully d-pad navigable (needed for this route regardless).

**b) Pi/mini-PC → HDMI (no-Google route).** The Linux daemon unchanged, minus touch. Input = BT remotes (Section 11), phone remote API, and **HDMI-CEC** via libcec: TV remote's arrows/OK/back arrive as ordinary input-map events; `display.power` maps to CEC standby/wake so schedules can sleep the TV. CEC is reliable for power and "make me the active source"; it cannot launch TV apps. For premium video at full quality on this route, a `launch` tile targets a streaming stick on another input via its network API (e.g., Roku ECP `launch/{appId}` deep links), and one CEC Active Source call returns to the frame. Vendor-dependent "return the TV to previous input" behavior is explicitly not relied upon.

**Shared implications (both routes):**

- `device.profile: "tv"`: disables touch chrome, enlarges hit/focus targets, 10-foot font scaling (`theme.scale`), carousel via remote keys, overscan-safe margins (`theme.safeArea`).
- Input map gains CEC named keys (`CEC_UP`, `CEC_SELECT`, `CEC_BACK`…), same semantics as BT keys.
- Edit operations happen in the web editor or phone remote, never on-device — which the architecture already assumes.
- DRM ceiling difference: route (a) plays premium video at native app quality; route (b) browser tiles cap at 720p (Section 13) with stick deep links as the full-quality path.

## 13. DRM & streaming resolution

Reality check: premium streaming resolution is gated by DRM policy, not by our software. Chromium-class browsers (including Android WebView) run software Widevine (L3), and Netflix caps L3/browser playback at 720p regardless of the account plan or device horsepower. YouTube, Twitch, radio, and non-DRM video are unaffected — full resolution everywhere.

Paths to 1080p+ for DRM services, in order of recommendation:

1. **Kitchen/desk frames: accept 720p.** At 14" viewed from a few feet, 720p vs 1080p is nearly invisible. Document it, don't fight it.
2. **TV build: launch, don't play.** On the Android TV route, a `launch` tile opens the native Netflix/Disney+ app fullscreen via intent at full certified quality; Back returns to the dashboard. On the Pi route, the same tile deep-links a streaming stick on another input (Roku ECP etc.) with CEC handling the return. Best quality, zero DRM maintenance, and fully within the web-only stance — the apps run on their device, our shell just orchestrates.
3. **Community adapter territory (not core):** profile-forcing scripts for Chrome's Netflix player exist that unlock 1080p streams Netflix already serves. Same posture as anti-adblock countermeasures — ToS-gray, cat-and-mouse, welcome in the community adapter repo at users' own discretion, never shipped in the shell or promised in marketing.
4. **Windows mini-PC variant (niche):** Edge on Windows uses hardware PlayReady and gets 1080p (4K on supported hardware). A documented "Windows kiosk" recipe can exist for videophiles; not a supported first-class target.

Widevine availability itself: automatic on Android; on the Pi image, Chromium's Widevine component is preinstalled in our build so DRM sites work out of the box at their policy-capped resolution.

## 14. Private listening (audio → phone)

Roku-style: the frame's audio streams live to the phone remote, playing through whatever headphones the phone is using. Toggle lives in the phone remote UI ("Listen on this phone"); frame speakers mute (or duck, user choice) while active.

**Transport (dual, negotiated per platform):**
- **WebRTC** (Opus, low-latency, ~100–250ms): the default where background playback is reliable (Android Chrome PWA; any foreground session). Signaled over the remote WebSocket (§6).
- **HTTP stream** (chunked Opus/AAC or low-latency HLS served by the frame, ~1–2.5s): the background-proof path — plain `<audio>` playback is ordinary media to the OS and continues when the web app is backgrounded, exactly as web radio does. The remote selects it automatically on iOS (or on any platform when backgrounding is detected/expected), registering media-session metadata so lock-screen controls work. The user experience target is explicit: **minimize the remote, use other apps, keep listening.**
- `avOffset` (below) is transport-aware — auto-measured per active transport, so video tiles delay ~150ms under WebRTC or ~2s under HTTP streaming and lip-sync holds either way. Interactive commands (pause/skip) act immediately on the frame; the audible effect follows at stream latency, shown honestly in the remote UI.
- Peer-drop grace: if a listener's stream stops unexpectedly (OS suspension, network), frame speakers stay muted for a grace period with a "listening paused on your phone" hint, resuming speakers only on explicit action or grace expiry — never blaring mid-movie.

Multiple simultaneous listeners are allowed on either transport (two phones, two headphones — movie night without waking the baby).

**What every listener hears (normative, and what ships today).** Private
listening carries **one stream: the frame's own output**. The capture is a
single system-output monitor (below), so every listener hears the same mix —
in practice whatever slot owns audio under §3 — and moving the sound with
audio-follows-tap (§5 of the concept-scenes charter) moves it for the room and
for every phone at once. Two phones means two people hearing *the same thing*
privately; it does not mean two people hearing *different slots*. The §14 chips
on the wall render exactly this: one chip per listening phone, all naming the
audio owner.

**NOT YET — per-listener sources (ledger B-25).** "One game to the room,
another to your earbuds" is a real and wanted feature, and it is **not built**.
It needs, in order: per-surface audio capture instead of the system monitor
(on Windows `ActivateAudioInterfaceAsync` +
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, which is B-25's open upgrade
path; on Pi, per-node PipeWire capture), a `source` field on `ListenerInfo`, a
way for the remote to choose a slot, and an amendment to this section covering
what the room hears while three phones are each on something else. Until all of
that lands, any UI, mockup or caption showing two listeners on two different
slots is describing a future, and the wall will not agree with it.

**Capture per platform:**

- **Pi/Linux:** PipeWire monitor source captures full system output — every tile, everything, always works. The strongest implementation.
- **Android shells (tablet + TV box):** the shell captures its own playback (our WebViews are our audio session), so all web tiles stream fine. **Limitation:** audio from *launched* native apps (Section 12 `launch` tiles — Netflix etc.) cannot be captured; DRM apps opt out of Android playback capture. Private listening on the TV build covers dashboard/web audio only; native-app excursions fall back to the TV's own solutions.

**Sync:** streaming adds ~100–250ms. For music/radio, irrelevant. For video tiles, the shell applies a matching delay to the tile's video (`avOffset`, auto-measured at session start, user-nudgeable) so lip-sync holds — same trick Roku uses.

**Honest platform caveats (documented, not hidden):** iOS Safari/PWA keeps WebRTC audio alive with the screen on and generally through short locks, but iOS may suspend a backgrounded PWA on longer locks; the remote page requests a wake lock while listening and the docs say "keep the remote open while listening" for iPhone. Android Chrome PWAs sustain background audio reliably.

```json
POST /audio/listen   → {"enable": true, "mode": "mute-speakers" | "duck" | "both"}
```

## 15. Layout sharing & the gallery

Dashboards are just schema documents, so they're inherently shareable — and since everyone arranges the same handful of sites, other people's layouts are directly useful. Sharing is a first-class flow, with privacy handled at export.

**Export sanitization (normative).** A shared layout is never a raw dump. On export the shell/editor must:

- Strip all `profile` fields and any session/token references — accounts never travel with layouts.
- Replace personal URLs with **slot placeholders**: a tile pointing at `app.yourdomain.com/calendar?family=...` exports as `{"slot": "calendar"}`; custom URLs export as `{"slot": "custom", "suggestedUrl": "<domain only, query stripped>"}` with a confirmation step showing exactly what will be shared.
- Keep the transferable substance: layout mode, heroSize, areas, aspect hints/weights, audio policy, adapters, schedules, input maps.

**Import = fill the slots.** Opening a shared layout prompts per slot: "This layout has a Calendar tile — connect yours." Known slot types auto-fill from the user's existing tiles; custom slots ask for a URL. One shared "Kitchen Command" layout thus works for every household despite everyone's accounts being different.

**Distribution:** a layout is a small JSON blob — shareable as a link (`entangled.world/l/<id>`; prism.entangled.world is the Veil extension's storage, not the website - decision 2026-09-26), a QR on someone's actual frame ("scan my kitchen"), or a file in the repo. The gallery is the browsable index: screenshots (rendered by the reference solver, so previews are pixel-accurate), device profile, tile list, remix count. Importing then re-sharing preserves an attribution chain ("remixed from…"). Gallery submissions are licensed CC0 by default — layouts are arrangements, not works, and frictionless remixing is the point.

**Moderation floor:** gallery listings are reviewed for URL safety (no malware/abuse domains — checked against the same attributed filter lists in §5) but never for taste; direct link/QR sharing is unmoderated peer-to-peer.

## 16. Rendering & transitions (no white frames — normative)

A frame is furniture; it must never flash. The shell guarantees that no unstyled/white/blank frame is ever presented, under any refresh, navigation, layout change, or crash. Rules:

**Snapshot double-buffering.** Every visible tile can be frozen as a bitmap snapshot at any moment. All refreshes and navigations follow: (1) snapshot current tile and display it, (2) load the new page hidden behind it, (3) crossfade snapshot → live page only when the page is *ready*. Auto-`refresh` intervals, adapter-triggered reloads, and URL changes all use this path. There is no visible "loading" state in normal operation — at most a subtle activity tick in tile chrome.

**Readiness**, not just `load`: load event fired AND first contentful paint observed AND a short paint-settle window (default 300ms) with no layout thrash. Adapters may signal readiness explicitly (`frame.ready()`) for SPAs that paint late; a hard timeout (default 10s) crossfades regardless. If a load *fails*, the snapshot stays up with a quiet retry — a stale calendar beats a white error page on the wall.

**Dark substrate everywhere.** Every WebView/window background is initialized to `theme.background` before first paint, so even a missed edge case flashes dark, not white.

**Layout motion.** Hero resize and solver reflows animate tile rects (180ms ease, live during drag); carousel transitions slide live surfaces when memory allows, snapshots otherwise; dashboard switches crossfade whole-screen snapshots. Fullscreen enter/exit scales the tile from its grid rect (the pixels move, they don't cut). All motion respects reduced-motion preference by switching to simple dissolves.

**Warm cache.** `persist: true` tiles are never reloaded for layout changes — they're retextured. Carousel-adjacent dashboards may pre-warm their tiles when memory allows (device-profile setting); otherwise their last snapshots are retained so the first frame of any transition is always real content.

**Platform notes.** Android: per-tile bitmap snapshot (draw-to-bitmap), WebView background color set pre-attach, crossfade in the shell's compositor. Linux: DevTools `Page.captureScreenshot` + `Page.loadEventFired`/paint events; the daemon keeps the old window mapped until readiness, then fades via Wayland compositor opacity. Same contract, same timings, both platforms.

## 17. Region focus (tile = a piece of a page)

A tile may display a *region* of a page rather than the whole page — "just the top-news section," "just the scoreboard."

```json
{ "id": "news", "url": "https://example-news.com", "focus": { "selector": "#top-stories", "pad": 12, "fit": "width" } }
```

- `selector`: CSS selector for the element to frame. Adapters ship stable selectors for popular sites (selector drift is adapter-repo territory, same as all DOM coupling). Editor UX: a pick-an-element mode — tap the region on the live page, shell records the selector.
- `region` (alternative to `selector`, wins when both are present): `{ "x", "y", "w", "h" }` — a rectangle of the page in document CSS px, measured in the layout viewport given by `viewport` (below). This is what §31 step 3's drag-select / the host **viewfinder** writes: the frame pops out to the whole window, unframed, at its natural layout (the page re-lays out at the window's width like a maximized browser); a page-zoom slider re-lays it out at window ÷ zoom (out = wider and smaller, in = narrower and bigger, breakpoints firing live); the human centers a glowing box shaped like the frame over what it should show, sizing it with the wheel; the box becomes `region`, default `fit: "contain"`.
- `viewport`: `{ "w", "h" }` — the CSS layout viewport `region` was measured in. The shell lays the page out at exactly this size (through its layout-viewport primitive, any size, wider than the frame included) and scales it to fit the frame before framing, so the frame shows precisely what was picked — no dependence on the frame's own width, no reflow surprise. Absent ⇒ the frame's rect (regions written by other tools).
- The shell frames the element by scroll+scale transform (GPU), not by hiding the rest of the DOM — pages behave normally underneath.
- **Refresh continuity:** region focus composes with §16 double-buffering. The hidden buffer loads, the shell re-locates the selector *in the hidden buffer*, applies the identical framing transform, and only then crossfades. The visible result is old headlines dissolving into new headlines in place — never a reload, zoom-out, re-zoom sequence. If the selector is missing in the new load, the stale snapshot stays with a quiet retry (§16 failure rule); repeated misses surface an "adapter needs update" note in edit mode only.
- Element moved/resized between loads: the crossfade absorbs small shifts; if the region's aspect changed beyond tolerance, the tile re-solves its framing after the fade, animated.

## 18. Resource budget (the §16/§17 guarantees, per build)

The costs that matter: each live web surface is a Chromium-class renderer (~100–300MB; video-heavy sites 300–500MB); a 1080p snapshot is ~8MB of RAM (4K ~33MB); crossfades and focus transforms are GPU compositing (negligible CPU). Disk per tile profile: 50–200MB cache. The design rules that keep every build inside its envelope:

**Tile lifecycle.** `live` (renderer running) → `warm` (renderer suspended/killed, snapshot shown, session intact on disk) → `cold` (snapshot only). The device profile sets `maxLiveTiles`; beyond it, least-recently-interacted non-`persist` tiles demote to warm. A warm tile looks identical on the wall (it's showing real pixels) and revives via the §16 crossfade on interaction or its next refresh. Audio/`persist` tiles are never demoted.

**Serialized refresh.** At most one hidden buffer loads at a time, ever — refresh intervals are staggered by the scheduler so double-buffer memory spikes never stack. Peak overhead is one extra renderer, not N.

**Snapshot persistence.** Last snapshots are written to disk (JPEG, ~200–500KB each); boot shows the full dashboard in real pixels within ~2s while renderers start behind the fade. Total snapshot disk for many dashboards: tens of MB — irrelevant.

**Per-build verdicts:**

| Build | RAM | maxLiveTiles default | Verdict |
|---|---|---|---|
| Tablet (8GB) | 8GB | 5–6 | Comfortable; 7 with light tiles |
| Pi 5 (8GB) | 8GB | 4–5 (1 video) | Comfortable within stated comfort zone |
| x86 mini PC (16GB) | 16GB | 7 | No constraints; the headroom build |
| onn-class TV box | **2GB** | **2–3** | Works *because of* the lifecycle: dashboard renders fully via warm snapshots, 2–3 tiles live (the hero + audio), rest revive on demand. Without §18, this build wouldn't exist. |
| Shield | 3GB | 3–4 | Same pattern, more slack |

CPU is not the binding constraint anywhere — even the Pi's weak spot is video decode (§ hardware sheet), not compositing. Storage: 32GB SD / base tablet storage holds all profiles+caches with room to spare.

## 19. Telemetry (opt-in, content-blind — normative)

Default is **off**, forever — no dark patterns, no pre-checked boxes, no nagging, and declining changes nothing. The design constraint: telemetry may describe *the software's behavior*, never *the person's life*.

**What may be sent (exhaustive, schema-pinned):**

- Shell version, platform (tablet/pi/tv/windows), device profile class, display class (bucketed: <12″/12–16″/tv), RAM bucket
- Feature usage as booleans/counts: hero vs grid, tile count bucket (1–3/4–5/6–7), carousel used, private listening used, BT remote paired (count only), region-focus used
- Health: crash signatures (stack frames from Prism code only — app paths, URLs, and page content scrubbed before write), tile-revive latency buckets, refresh-failure *counts*
- Adapter health: adapter name + failed/succeeded counts. This names sites in aggregate (e.g., "youtube adapter"), so it is a **separate, individually-listed toggle** under the main opt-in.

**What may never be sent — the blind spots are structural, not policy:**
URLs, page titles, selectors' matched content, layout documents, tile names, profile names, account identifiers, IP-derived location (ingest drops IPs pre-storage), timestamps finer than day, and any free-text field. The telemetry client has no code path that can read tile content or URLs; the payload schema is a closed allowlist, and anything not in the schema is rejected at ingest.

**No identity:** no device ID, no install ID, no cookies. Payloads are unlinkable across days by construction; we accept imprecise device counts as the cost of unlinkability. (If dedup ever becomes necessary, the ceiling is a random token rotated every 24h, and that change requires a new consent.)

**Radical legibility:** the opt-in screen shows the *actual next payload*, pretty-printed, before consent — not a description, the bytes. A "View what Prism sent" screen shows every payload ever transmitted from this device (kept locally). The ingest server is open source in the repo; aggregate dashboards are public, so users see exactly what the data becomes. Self-hosted/PrismOS builds ship with the telemetry endpoint empty — opting in requires choosing a destination, which may be the user's own.

**Consent lifecycle:** asked once at setup, one screen, "No thanks" equally prominent; revocable anytime; revocation stops transmission immediately (nothing server-side to delete — there is no per-user data to find).

## 19. Compatibility reports (opt-in, per-incident, inspectable)

There is no ambient telemetry in Prism — nothing phones home, ever. The one exception is user-initiated: when a *compatibility failure* occurs (adapter selector missing after N retries, tile render failure, DRM/Widevine init failure, readiness timeout on a known domain), the shell may offer — once, quietly, in edit mode, never as an interruption — "This tile is broken. Send an anonymous compatibility report so the community can fix it?"

**Payload (normative whitelist — anything not listed cannot be sent):**

```json
{
  "kind": "adapter-selector-missing",
  "domain": "example-news.com",
  "adapter": "example-news@2026.08.1",
  "shell": "prism-android@0.4.2",
  "engine": "webview@126",
  "device": "tablet-16x10",
  "failCount": 3,
  "firstFailed": "2026-08-21"
}
```

Explicitly never included: full URLs (paths and query strings carry personal data — domain only), page content, screenshots, cookies or storage, account identifiers, tile names, dashboard layouts, IP-derived location (server discards addresses on receipt), and any device or user identifier — reports carry no ID at all, so they cannot be correlated with each other. Timestamps are date-granular.

**Consent mechanics:** the exact JSON is displayed before sending — not a summary, the payload itself, short enough to read. Send is per-incident; there is no "always send" toggle, because standing consent drifts from informed consent. Declining suppresses the offer for that domain+adapter version.

**Destination is public.** Reports land in a public compatibility dataset (repo/dashboard) that feeds adapter maintenance — the same place users would file issues by hand. Anyone can audit the entire corpus of everything ever collected, which is the strongest possible proof of the policy. Self-hosters can point the endpoint at their own tracker or disable the feature at build time.

**Why this design:** a compatibility failure is a fact about software (site X broke adapter Y on engine Z), not about a person. Restricting reporting to that class of fact, whitelisting the schema, and publishing the corpus means the feature cannot quietly grow into analytics — expanding it would require amending this section in public.

## 20. Layout compatibility validation (gallery + import)

A shared layout makes two implicit promises — "this arrangement solves well on your screen" and "these tiles/focus regions actually work" — and both are checkable automatically, because the solver is deterministic (§8) and adapter health is measured (§19).

**Geometry check (fit scores).** At gallery submission, CI runs the reference solver against every device profile (tablet 16:10, TV 16:9, portrait, 4:3, plus common resolutions) and records a fit score per profile: the normalized sum of aspect costs (weight·|log(actual/hint)|) plus flags for degenerate results (sliver tiles below minimum readable size, unsolvable strip assignments). The gallery displays this as per-device badges — "Excellent on TV · Good on tablet · Poor in portrait" — computed, not author-claimed. Import shows the layout *pre-solved at your actual resolution* before applying, so what you approve is what you get.

**Behavior check (does it still work?).** Every domain, adapter reference, and `focus` selector in a submitted layout is cross-referenced against:
- the adapter repo (does the adapter exist? current version?), and
- the §19 compatibility dataset (is that adapter/selector currently healthy on which engine versions?).

Gallery listings carry health per dependency: green (recently verified), amber (reports of breakage on some engines), red (currently failing — adapter needs update). At import, the check re-runs against *your* shell+engine version specifically: "The news-focus tile in this layout is currently broken on WebView 126 — import anyway, skip that tile, or substitute the plain page?" Focus selectors get one extra guard: layouts using `focus` on domains with no adapter-maintained selector are marked "fragile — custom selector" so importers know breakage lands on them, not the adapter repo.

**Drift handling.** Health is re-evaluated continuously as §19 reports arrive; gallery badges update without author action, and a layout whose dependencies all go red is demoted in browse (never deleted — one adapter fix un-demotes it). Remixes inherit fresh checks, not the parent's badges.

**Honest limits, stated in the gallery UI:** validation proves geometry and dependency health, not that a site renders pleasantly at a given tile size — screenshots and remix counts remain the human signal for that. Sites also vary by region/login state in ways no central check can see.

## Open questions for v0.2

1. Adapter sandboxing/signing before community submissions open.

## 21. VPN support (device-level)

Frames can route all traffic through a user-supplied VPN. This is device-level, not per-tile — every renderer, adapter fetch, and update check goes through the tunnel, which is the only honest version of the feature (per-tile split tunneling invites leak bugs and is out of scope for v1).

- **Protocol:** WireGuard. Users paste/import a standard `.conf` or scan it as a QR in device settings — compatible with commercial providers (Mullvad, Proton, IVPN export WireGuard configs) and self-hosted endpoints alike. No provider partnerships, no bundled VPN, no recommendations beyond "any WireGuard endpoint you trust."
- **Android shells:** always-on VPN with lockdown (block connections outside the tunnel) configured via device-owner policy — the kiosk model makes this *stronger* than a normal phone, since nothing else on the device can bypass it.
- **PrismOS/Linux:** kernel WireGuard, configured from device settings/remote UI; kill-switch via firewall rules (traffic only via wg0 when enabled).
- **Honest notes in settings UI:** a VPN changes your apparent location (streaming geo-blocks may object); the LAN remote API and private listening continue to work (local traffic exempted from lockdown by explicit rule, shown to the user); the VPN provider sees what any ISP would — choose one you trust.

## 22. Data minimization (the subpoena test)

Design rule: legal process can only compel what exists, so the architecture minimizes what exists. The complete inventory of what Entangled holds, published on the site as such — "here is everything a court order could yield":

- **Prism:** nothing. No accounts, no server-side state; compatibility reports are anonymous by schema (§19) and already public. There is no Prism user database.
- **Merge (deliberate, stated tradeoff):** the sync server holds calendar data in plaintext to serve multi-tenant sync and calendar integrations. This is the one meaningful data store in the stack, and the privacy page says so plainly rather than implying otherwise. Minimization around it: deleted items purged on a short published schedule, no access-pattern logging, license records are key+email only (alias emails welcome; no names, no addresses, no history beyond key validity). The sync protocol is designed so client-side E2E is reachable in a future major version if demand justifies the feature cost.
- **Storage pool:** ciphertext only — no order can yield a photo. What exists is billing metadata (member identity, bytes stored, payments), already visible in the co-op's open books.
- **Payments:** processed by Stripe, which holds what payment processors hold, under its own policies; Entangled retains only the license linkage above.
- **Global hygiene:** IPs discarded at ingestion on every service (generalizing §19), no analytics or third-party trackers on any Entangled property, operational logs retained days not months.

Posture, stated on the site: Entangled complies with valid legal process and has architected so there is almost nothing to produce. No promise of resistance — only the published, complete inventory above, kept current.

## 23. Unified architecture (one brain, thin hands)

Everything in §1–§22 is behavior, and behavior lives in **one shared core** so it is written, tested, and fixed once. Platforms contribute only what is physically platform-bound.

**`prism-core` (TypeScript, runs everywhere JS runs):**
- Schema types + validation (§1–§10), the solver (§8 — already the reference implementation), audio-focus state machine (§3), schedule engine (§4), adapter runtime contract (§5), remote API server/client + pairing (§6), input mapping incl. per-device (§7, §11), carousel (§9), tile lifecycle + refresh serialization (§16, §18), region-focus framing logic (§17), compat-report schema (§19), layout share/import + validation (§15, §20).

**The driver seam (the only porting surface).** Each shell implements one small interface; nothing above it is reimplemented:

```
Surface:  create/destroy · setRect/opacity/z · navigate · inject(css,js) ·
          snapshot() · setMuted · captureAudio? · profile binding
Display:  brightness · power · (CEC where present)
Input:    key/pointer events in · BT pair/scan UI hooks
Media:    launch(package/deepLink)? (TV builds)
Net:      VPN configure/status (WireGuard)
Store:    profile storage guarantees (§10) · snapshot persistence
```

**How core runs per platform:**
- **Web editor & remote PWA:** core imported directly; the editor is the reference renderer.
- **Android shell:** Kotlin/Compose implements the driver seam over WebViews; core runs in an embedded JS runtime as the orchestrator. Kotlin decides nothing about layout, audio policy, or lifecycle — it executes.
- **PrismOS (Linux):** Node/Bun daemon runs core directly; drivers speak Wayland compositor, Chromium DevTools protocol, PipeWire, BlueZ. PrismOS the "OS" is just this daemon plus an image build — not a separate architecture.
- **Windows recipe:** the same daemon with Edge-DevTools and Windows-audio drivers — which is why Build 5 is feasible as a community recipe at all.

**Protocol as the second unifier.** Every component — shells, phone remote, editor, future clients — speaks the one documented remote API (§6). The shells' UI, the PWA, and the editor are all clients of the same state model; there is no privileged internal channel to drift.

**Conformance kit.** A test suite drives any shell via the remote API and golden-tests the observable contracts: solver rects identical to reference, no-white-frame timings (§16), audio exclusivity, storage persistence across restart (§10), report schema (§19). A shell that passes is a Prism; this is how community ports (new platforms, forks) self-verify without permission.

**Repo shape:** monorepo `prism` (packages: core, editor, remote-ui, conformance; shells: android, linux+image, windows-recipe) · separate community repos: `prism-adapters`, `prism-layouts` (gallery), `prism-parts` (sourcing). Merge remains its own product/codebase, sharing only the design tokens and any tile URL contracts.

**Build order restated:** core is already partially real (the editor's solver). Next: extract core as a package → Android driver seam → first dashboard on a real tablet.

## 24. Night mode, alarm clock, low power

Extends the schedule system (§4) into a full day/night lifecycle. A frame in a kitchen or bedroom should behave like a considerate appliance: dark and silent at night, awake before you are, and gentle on its own hardware in between.

**Night mode** (`action: "night"`), between scheduled start/end or on demand:
- Dims to a configured floor and shifts the theme warm/dark (tiles get the dark-mode adapter treatment where available); optionally screen fully off (`"display": "off"`) with instant wake on motion, input, or alarm.
- Optional clock face while dimmed: large clock + next alarm, rendered by the shell (not a web tile), at minimal brightness. Pixel-shifted a few px per minute to protect OLED/long-life panels.

**Low-power state** (automatic during night/sleep, configurable):
- All tiles demote to `warm` (§18): renderers suspended or killed, snapshots retained, sessions intact. Refresh scheduler pauses; animations stop; adapter timers idle.
- Linux: CPU governor → `powersave`, compositor at minimum frame rate; Android: shell releases wakelocks and defers to Doze, alarms excepted. Fans (mini PCs) spin down with the load.
- Wake reverses it with the §16 contract: last snapshots appear instantly, renderers revive behind crossfades. Net effect: cooler electronics, lower draw overnight, longer hardware life — an always-on frame that isn't always-burning.

**Alarm clock** (`action: "alarm"` in schedules, plus one-off alarms via remote/phone/tile):
- Fires **locally and offline-proof**: alarm scheduling and the alarm sound live on device (bundled tones or a user file) — network, backend, and even WiFi can be down and the alarm still fires. A streaming source (radio tile) may be *layered on top* and falls back to the local tone in silence-failure (if no audio is actually playing within 10s, the tone sounds).
- Wake sequence: screen ramps from black through the dim floor to full over a configurable sunrise period (default 10 min, can be 0), tiles revive, then sound at ramping volume. Snooze/dismiss via touch, any mapped remote key, or the phone remote; TV builds get a full-screen d-pad-navigable alarm surface.
- Reliability rules: alarms pre-empt low-power (the shell holds an exact-alarm wakeup with the OS), survive reboots (rescheduled at boot from local store), and are never silently skipped — a missed-alarm condition (e.g., device was powered off) is surfaced on screen at next boot.

Schedule vocabulary added: `night`, `alarm`, `lowpower` (explicit), with `on: "alarm-dismissed"` available as a trigger (e.g., dismissing the morning alarm switches to the morning dashboard and starts the radio tile).

## 25. Living previews (video peek cycle)

Multiple video tiles where only some are playing: the playing tiles run live; the rest display stills that *advance*, as though the video were being watched. Configured per tile:

```json
{ "id": "cam2", "preview": { "mode": "peek", "interval": 30 } }
```

**Mechanics.** Non-playing video tiles sit `warm` (§18) showing their last snapshot. On the peek cadence, the shell revives **one** warm peek tile at a time — muted, hidden behind its own snapshot — lets it reach readiness (§16), captures a fresh frame, and demotes it again. Peeks ride the same serialized single-buffer rule as refreshes, so peak cost is always exactly one extra renderer for a few seconds, round-robin across peek tiles. Five video tiles ≈ each still advancing on roughly its interval, staggered, with two playing tiles untouched.

**"As though watching":**
- *Live streams:* each peek captures the live edge — the still is simply now.
- *VOD:* the tile keeps a **virtual playhead** — last position plus wall-clock elapsed (bounded by duration). A peek seeks there before capturing, so the still shows where the video *would be* if you'd kept watching. Promoting the tile to audible resumes from the virtual playhead, so tapping in feels like unmuting, not restarting. Per-tile toggle (`"playhead": "advance" | "hold"`) for content where holding position is wanted.

**Budgets (device profile):** concurrently *playing* video tiles are capped by decode budget — mini PC 3+, tablet 2, Pi 1–2, 2GB TV boxes 1 — and peek intervals floor at 30s (60s on 2GB boxes). Peeks are muted always and never trigger the audio-focus machinery. Sites that refuse background/seek behavior degrade gracefully: the peek captures whatever renders, and the adapter repo owns per-site peek recipes (e.g., YouTube's seek quirks) like all DOM coupling.

Two playing + three advancing stills on a tablet is thus in-budget by construction: 2 decoding renderers + 1 transient peek, never more.

## 26. Intermission (ad-break overlay)

During in-stream video ad breaks, a tile can fade to an **intermission surface** — full-bleed high-res imagery (nature, deep-space, or the user's own photos) — and fade back when content resumes. The ad plays untouched underneath (nothing is blocked, skipped, or injected into the stream; audio is muted by default, user-configurable); the frame simply chooses what the wall shows. Per tile:

```json
{ "id": "yt", "intermission": { "enabled": true, "source": "pack:cosmos", "audio": "mute" } }
```

**Division of labor (consistent with §5/§13 posture):**
- **Detection is adapter data.** Knowing that a given site is in an ad break is DOM coupling — adapters signal `frame.adBreak(true|false)` per their site's markers, and this lives in the community adapter repo where cat-and-mouse belongs. Core never ships site-specific ad detection.
- **The overlay is a core shell mechanism.** Generic, site-agnostic: crossfaded via the §16 compositor, instant, no white frames, restores exactly on the end signal (with a safety timeout so a missed end-signal can never trap a tile behind scenery).

**Imagery:**
- Bundled offline packs from public-domain/openly-licensed sources — NASA image libraries (public domain) and similarly licensed collections — attributed per image in settings, fetched never (no tracking, works offline).
- `source` may also point at the user's own photos tile/album — family photos during commercials is the flagship configuration — or a community pack from the repo.
- Slow Ken Burns drift on stills (respects reduced-motion), a subtle "intermission" glyph so viewers know content will return, and an optional countdown when the adapter can read remaining ad time.

**Detection safety model (normative).** Detection is *passive observation only* — a MutationObserver reading the player's own state markers (ad-mode classes on the player element, ad-badge/skip UI appearing, media-element telltales like a duration collapse from 42:00 to 0:15). Adapters never click, never intercept network requests, never touch player state — reading the DOM cannot break playback, so the worst possible failure is a wrong overlay, never a broken show. And wrong-overlay risk is governed by asymmetric bias, because the two errors are not equal (an ad showing through is free; covering one second of content is the real failure):

- **Mute fast:** a tile whose breaks mute goes silent on the *first* concurrent signal, before any window; if the signal drops inside the window the mute lifts at once and nothing was covered. *Decision (2026-09-15):* the two errors are not equal here either, but the other way round from the cover — a wrong mute is a one-second dip in a song, while every second the mute waits is a second of ad in the room (two to three, measured, with the page-side sustain and this window in series). So the mute leaves the debounce; the scenery and the soundscape keep it. Adapters report the first sighting and the first drop, and keep no sustain of their own.
- **Cover slow:** the overlay (and the soundscape) engage only on multiple concurrent signals sustained for a debounce window (~1s).
- **Uncover fast:** any single end-signal — or any *doubt*, including signal disagreement or the observer losing its footing after a site change — drops the overlay immediately. The §26 safety timeout backstops a missed end entirely.
- **Seamless return:** the shell snapshots the tile at ad-start (§16 machinery), and the fade-back lands on live content already playing — the show was never paused, sped, or seeked, so nothing is missed except the ad itself, by the viewer's own eyes only. Muting follows the same asymmetry: restore audio on uncover before the fade completes.
- When a site redesign breaks the markers, signals simply stop firing and ads display normally until the adapter repo ships updated markers — degradation is always "no feature," never "broken video."

**Peek-through (every veil, the agency guarantee).** Every veiled surface — intermission scenery, gallery-veil slots, partial veils — carries a quiet peek affordance: **hold-to-peek** (touch/mouse) or a small "show ad" tap target. Peeking reveals the underlying content while held (tap variant: until tapped again or the break ends); releasing restores the veil. Audio stays as configured during a peek unless the user separately unmutes. Same principle as the popup ledger's deliberate-open: nothing is ever unreachable — the veil is a choice being continuously made, and it doubles as the user's own misfire check.

**Minimal mode (card minimize).** The intermission card can collapse to a corner chip — countdown + tiny controls — so the artwork breathes full-bleed. One tap toggles; the choice persists per site. Minimal is the card's *mode*, not a different feature: all controls (pause-after-break, chime, peek) remain reachable from the chip.

**Ambient audio (opt-in).** Instead of silence during breaks: quiet bundled soundscapes (rain, soft piano — offline packs, same posture and licensing discipline as imagery). Plays only while a veil is active; fades out at resume (before the chime when both are enabled); modest fixed ceiling volume; per-site persistence. Never on by default — silence remains the default state.

**Time-reclaimed ledger.** A Control Center stat, local-only (§19/§22 — never transmitted): cumulative time veiled, shown as three windows — **this week · this month · all time** (week starts Monday; month is calendar month). Counting rules: video ad breaks add their *measured* duration; display/banner veils add a flat **30-second estimate per veiled slot, counted once per page visit** (labeled in the UI as an estimate); popup interceptions add nothing (blocked code isn't reclaimed time). A reset control clears all windows; no streaks, no goals, no gamification — it's a receipt, not a scoreboard.

**Deferred human instruction (pause-after-break, resume chime).** The intermission card offers a **"Pause after break"** checkbox: when checked, the shell pauses the player at the moment content resumes — go make tea, the show waits. This is *not* synthetic interaction: the checkbox is the human input, executed at the boundary the human named. The distinction is normative — deferred execution of an explicit, present-tense human instruction is permitted; autonomous action on the shell's own initiative remains prohibited. Its natural sibling: an opt-in **resume chime** — a soft local tone (bundled, offline, volume-respecting) as the break ends, covering "nearby but not watching" the way pause-after-break covers "walked away." Chime fires ~2s before content resumes when the countdown is readable, at resume otherwise; never fires when pause-after-break is checked and honored (the pause is the notification). Both settings persist per tile/site.

**Presentation keeping (standing human instruction).** Sites drop player fullscreen/theater at ad boundaries or video end. Per-facet-in-scene settings (set when adding the facet, editable in the scene builder):
- `keepPresentation: true` — if the player's fullscreen/theater state drops and the drop **correlates with an ad-break or ended signal** (site-initiated), the shell re-invokes the player's own fullscreen/theater control to restore the state the human established. If the drop follows **user input** (Esc, back, a click), it's the human's intent — never fought, and keeping resumes only after the human re-enters the state.
- `onEnd: none | restart | restart-fullscreen` — at the player's `ended` event, optionally replay (and restore presentation), for ambient/loop use.

Doctrine: these are standing instructions — explicit, per-facet, visible in the scene builder — in the same class as pause-after-break: the human named the state and the boundary; the shell executes. The synthetic-interaction ban is unchanged where it matters: shell/adapters still never touch ad lifecycle controls (skip/dismiss/close) autonomously, never fabricate engagement, and presentation keeping may never fire during an ad in a way that alters the ad (restoration happens at the boundary the site created). Adapters expose named presentation actions (`enterFullscreen`, `enterTheater`, `play`) invocable only under a standing instruction; WebView2 hosts auto-grant element-fullscreen requests (`ContainsFullScreenElementChanged`) so restoration renders edge-to-edge.

**Pass-through skip (human-in-the-loop, normative).** When the adapter observes a skip affordance become available in the underlying player, the intermission surface shows a real control — a "Skip" chip on the scenery, plus a mapped remote key (default: select/✓) and a phone-remote button. When the human activates it, the shell forwards that genuine interaction to the player's actual skip control. The human chose the moment; the shell only made the button reachable through the veil.

**Synthetic interaction is prohibited.** The shell and adapters never click, dismiss, skip, mute-in-page, or otherwise simulate user input autonomously — not on ad start, not when a skip becomes available, not on any timer. This is a hard rule, enforced in adapter review: an adapter that synthesizes interaction is rejected regardless of intent. Rationale: autonomous clicks manufacture false engagement signals (breaking the honest posture that the ad plays untouched and only attention is redirected) and create a mechanical fingerprint (zero-latency, first-frame skips) that observation alone can never produce. Intermission's entire safety and legal position rests on *observe, never interact* — the only interactions that ever reach a page are ones a human actually performed.

**Honest notes (documented):** platforms change ad markup constantly — when detection lapses, ads simply display normally (graceful degradation, no breakage); Premium subscriptions remain the sanctioned ad-free route and sign-in works per tile (§10); marketing never promises "ad-free," only "your wall shows what you choose."

## 27. Gallery veil (display-ad slots become art)

The Intermission idea applied to page ads: ad slots display nature, cosmos, art, or family photos instead. Unlike video (§26), display ads scroll with content and carry the tracker load, so the mechanism is in-page and it *composes with blocking* rather than replacing it.

**Default mode — `block+art`:** blocking (§5) already stops ad/tracker requests at the network layer, which is the privacy win but leaves collapsed slots and broken layouts. The veil fills them: element-hiding selectors from the attributed filter lists (EasyList's cosmetic rules — same named-source transparency as §5) locate the slots, and the shell replaces each with locally-served imagery sized to the slot. Result: full tracker protection *and* pages that look composed instead of gap-toothed. Purely additive to the existing blocker.

**Fallback mode — `veil-only` (per tile, off by default):** for sites that hard-wall on blocking, ads load normally (requests fire, trackers run — stated in the toggle, not hidden: this mode trades privacy for access) and the slots are visually replaced in-page. Same imagery, same look; honesty about what's different underneath.

**Imagery:** the same offline packs and sources as §26 (`pack:cosmos`, `pack:nature`, public-domain art packs, or the user's own photos album), served from the shell (never fetched from the web at render time — no new network surface). Small slots get textures/details; large slots get full images; a subtle glyph marks veiled slots so users know what they're looking at.

**Safety model inherited from §26:** selector application is read-only-plus-replace on matched elements only; a selector that matches nothing does nothing; site redesigns degrade to ordinary blocking (empty slots) or ordinary ads (veil-only), never to broken pages. Layout-affecting replacement respects the slot's existing box — no reflow beyond what blocking already causes.

**Partial veil (in-player overlay ads).** Banners and cards that sites layer *over* playing video are handled element-scoped: the adapter identifies the overlay element, and the veil covers **that rect only** — art patch sized to the element, tracked through player resizes and fullscreen via the same read-only observation as §26 — while the video continues untouched beneath. Where the site's own overlay is dismissible, plain cosmetic hiding (element-hide rule) is preferred over patching; hiding a banner never touches the stream. Dismissal is never clicked autonomously (§26 synthetic-interaction prohibition applies to veils identically); if a human wants the site's own close button, pass-through applies.

**Honest limits:** in-page replacement is page-visible in principle (like all cosmetic filtering — this is the normal, decade-tested adblock posture, not §26's compositor invisibility); anti-adblock nag sites are handled by `veil-only` or per-tile blocking off. Marketing language mirrors §26: never "ad-free browsing," always "your wall shows what you choose."

## 28. Updates & identity

**Updates (no accounts, no tracking, no fear).**
- **Delivery:** signed releases. Android shell: self-update via device-owner APK install (silent, scheduled in the §24 night window) with GitHub/F-Droid as manual channels; PrismOS: A/B image updates with automatic rollback on failed boot; the Windows recipe updates the daemon the same way; adapters/filter lists/imagery packs update independently and more often (§5).
- **Privacy of the check itself:** the updater fetches a static, unparameterized manifest from the CDN — no device ID, no version query string (version comparison happens locally), IPs discarded (§22). An update check reveals nothing but "someone checked."
- **Continuity guarantees:** §10 storage persistence holds across every update (migrate, never wipe); §16 applies to the update moment — the frame comes back to its last snapshots, not a boot screen; a failed update is a rollback, never a bricked wall.
- **Channels:** `stable` (default) and `beta` (opt-in, edit mode). Release notes rendered on-frame after update, dismissible, never blocking.

**Identity (Prism needs none; Entangled ID is optional; SSO is transparent).**
- **Prism requires no account, ever.** Pairing, layouts, remotes, updates — all local or anonymous. This is load-bearing (§22) and does not change.
- **Entangled ID** exists only for things that genuinely need identity: Merge licenses, Photos/pool membership, the off-network relay, gallery submissions. First-class method: **email + passkey** — no password, no third party, alias emails welcome. This is the default the UI leads with.
- **Third-party SSO** (Sign in with Apple / Google) is offered for convenience, gated by a plain-language transparency card shown *before* the button works, e.g.: "If you sign in with Google, Google learns: that this email uses Entangled, and the date/time of each sign-in. Google does not learn what you do inside Merge or Photos — but each session refresh is visible to them. Sign in with Apple can hide your email from us via relay. Passkey sign-in tells no third party anything." The card is specific per provider, kept current, and linked from the §22 inventory.
- SSO is never required, never the default, and unlinking (converting an SSO account to passkey) is a supported one-click path — no identity lock-in, consistent with every other exit hatch in this document.

## 29. Delivery forms & phasing (2026 pivot)

Field finding: Android TV's protected media path renders DRM video to secure surfaces the app compositor cannot layer over — §26 overlays are structurally blocked there. Android TV is deprioritized as an intermission platform. Revised delivery:

**Phase 1a — Browser extension (Windows + Mac + Linux, same codebase).** WebExtensions build of the §26/§27 engine: in-page DOM overlay over the video element, observe-only detection, pass-through skip, veils. Works over hardware-DRM playback in Edge/Chrome because DRM prevents *capture*, not in-page occlusion. Chrome/Edge/Firefox from one codebase; Safari requires a separate Safari Web Extension build — deferred, Mac users run Chromium/Firefox. Posture change, documented: in-page overlay is page-visible in principle (standard cosmetic-filtering territory), and muting is in-page (page-visible) — the §26 "structurally invisible" claim applies only to compositor platforms (Phase 2).

**Phase 1b — Windows compositor companion ("master compositor").** A native app rendering scenery in a topmost, click-through, per-pixel-alpha DirectComposition window — above any app, including protected video (Windows permits occlusion of protected surfaces; it forbids capturing them). Hybrid roles:
- *With browsers:* the extension supplies detection + geometry over native messaging; the companion supplies rendering above even hardware-DRM video, plus **per-app audio mute via WASAPI session control** — true muting the page can't see, restoring §26's mute posture on Windows.
- *Native apps (Netflix app, etc.):* detection cannot read protected pixels (capture path is blocked — analysis of the video is impossible by design). Observe-only sources that remain: UI Automation trees where apps expose ad/skip elements, window/title metadata, and audio-session heuristics. Treated as per-app "compositor adapters" (community-maintained, same repo posture as §5); apps exposing nothing simply get no intermission — degradation stays "no feature, never broken playback."
- Full §26 rules bind identically: observe-only, cover-slow/uncover-fast, pass-through interaction only (UIA *invoking* a skip happens only on human activation), no synthetic input.
- Limits: true exclusive-fullscreen apps (rare; modern apps use borderless) cannot be overlaid; multi-monitor and DPI tracking are the engineering meat.
- If compositor-side detection for browsers ever matures to parity, the extension becomes optional — until then the hybrid is the design, not a stopgap.

**Windows shell architecture — four options, ranked, spike-gated.** How tiles (§1–§8) get realized on Windows, from most-integrated to fallback. The ranking is provisional until the DRM spikes report; the deciding question for each is *what DRM tier does a Netflix tile get, with our overlay working over it.*

1. **WebView2 host app — CONFIRMED (POCs 1–2, Aug 2026).** Native app hosting N WebView2 controls (Evergreen runtime) as embedded tiles. Verified: Netflix and Hulu sign in, persist sessions, and play simultaneously in separate controls; hero switching/resizing during playback is clean; a host-owned composition surface renders over protected video (occlusion, not capture); injected observers drive the overlay on ad-break signals; `CoreWebView2.IsMuted` mutes page-invisibly (the §26 mute posture restored); host-side capture returns black for DRM regions without disrupting playback (§16/§18 snapshot model holds with DRM regions treated as opaque). **This is the Windows shell and the Phase-1 flagship** — the full §1–§25 design plus the original compositor-level §26 posture. Open item: record the served resolution/robustness tier per service; if software-tier for any service, that service's hero uses the launched-Edge-window hand-off (kiosk hybrid below) for 4K while everything else stays embedded.
   **Kiosk profile:** auto-login user whose shell is the host app (custom shell / Assigned Access); watchdog restart; snapshots persisted so boot shows the last dashboard (§16); pairing QR at first boot; Optimizer as step one of setup.
2. **Orchestrated Edge windows (works today, extension-only).** Each tile is a real top-level Edge window (installed-app windows preferred for chromeless; `type:"popup"` fallback), positioned/animated by the extension via the windows API driving the reference solver; human drags reconcile as intent edits (nonce echo-filter, nearest-slot promote/swap/demote, pinned sizes). Guaranteed 4K (windows are Edge's own); veil runs inside each via content scripts; no native code required. Costs: thin title bars on popup-type windows, z-order re-assertion, multi-monitor care. Reference: `docs/window-orchestrator-sketch.md`, `prototypes/orchestrator-mock.jsx`.
3. **Reparented Edge windows (hybrid fallback).** The compositor companion `SetParent`s installed-app windows into its own container, fusing them into one surface with hidden chrome — option 2's guarantees with option 1's look, at the cost of Win32 reparenting fragility (focus, DPI, Chromium's own window management). Deploy only where option 1 fails the tier test and option 2's chrome is unacceptable.
4. **Electron / CEF — rejected.** Chromium embeds get Widevine L3 without Verified Media Path; Netflix refuses non-VMP clients outright. Recorded so no one re-proposes it.

Options 1 and 2 are both spiked; the shell ships on whichever wins the tier test, with option 2 always retained as the zero-native-code path.

**Phase 2 — The privacy box (Pi/mini-PC, PrismOS).** Unchanged and now the flagship differentiator: the only platform running the *full* original design — Wayland compositor overlay (structurally invisible to pages), system audio capture, private listening, zero vendor telemetry. The extension is the ten-second on-ramp; the box is the same idea with nothing watching and nothing compromised.

Dashboard/frame product (§1–§25) remains the long arc; Phase 1 ships the intermission engine as its own product first and funds the audience for it.

## 30. Popup doctrine & the Popup Control Center

Complement to §26/§27, with an explicitly different rule, principled not ad hoc: **ads that play get veiled; pages that spawn get blocked.** An in-player ad is content declined — it may run covered. A popup is *code*: executing it (visibly or hidden) means redirect chains and fingerprinting scripts running on the user's machine. Popups are therefore intercepted **unexecuted** — never loaded offscreen, never run invisibly. Hidden execution is prohibited for the same reason synthetic interaction is (§26): it fabricates a reality the user never chose.

**Automatic tier (runs silently):**
- **Click-consistency rule:** the window a gesture opens must match the destination the user visibly activated (same URL or same-origin). Gesture laundering — click on X opens unrelated Y — is intercepted. Multi-window bursts from one gesture: first attempt evaluated, rest intercepted (no legitimate UI spawns N windows per click).
- **List classification:** `$popup`-class rules from the attributed filter lists (§5 transparency: the ledger names whose rule matched). Functional allowlist for structurally-legitimate popups: OAuth/SSO, payment processor checkouts, print/preview.
- **Stub WindowProxy:** intercepted `window.open` returns a mock window object (supports `.focus()`, `.closed`, etc.) so the launching page's scripts proceed without error paths or "disable your popup blocker" nagging. This deceives only the launcher's error handling — no window exists, no navigation occurs, no impression is fabricated.
- **Backstop:** tab-creation/opener tracking catches evasions (form targets, `about:blank` bounce redirects — the *final* URL is what's evaluated and logged).

**The Prism button (on-page presence).** The Control Center's front door is a small translucent pill anchored bottom-right of the page:

- **Idle:** semi-transparent "Prism" label at low opacity; **collapsed state** docks it to a slim edge tab at the bottom-right corner (one tap re-expands; collapse state remembered per site).
- **Status morph:** on interception events the pill morphs its label to the update — "3 popups blocked" — holds ~3s, then morphs back. Event-driven only, rate-limited (bursts coalesce into one count; max one morph per ~10s), announced via aria-live for screen readers. The pill must never become the distraction it removes: no pulsing, no color alarms, no unprompted expansion, motion honors reduced-motion (dissolve instead of morph).
- **Tap → Control Center** opens as an in-page panel above the pill (ledger, Open / Always allow, per-site controls); tap-away closes.
- **Stays out of the way:** auto-hides in fullscreen video and picture-in-picture; repositions above site cookie bars/players when overlap is detected; per-site "hide the button here" in the panel (interception continues, toolbar badge remains the fallback surface).
- **Implementation:** Shadow-DOM isolated so site CSS can't restyle it; rendered by the extension in-page (page-visible in principle, like all §29 Phase-1a surfaces — the compositor companion renders the same pill OS-level on Windows where present).

**The Popup Control Center (the human tier):**
- **Per-site ledger, local-only** (§19/§22 apply — nothing leaves the machine): every intercepted attempt with destination domain, count, last-seen, and triggering context. Toolbar badge counts; one click opens the panel.
- **Three grains of control:** per-destination allow/block going forward · per-site "block all popups here" · global default policy. Human decisions become per-site policy the automatic tier honors thereafter.
- **Plain-language allow flow (no "whitelist" anywhere in UI):** each ledger row offers two verbs — **Open** and **Always allow**. "Always allow" is scoped site→destination under the hood but phrased humanly: "Always open *checkout.example.com* popups from *shop.com*." Teach-by-doing: after a deliberate Open, a one-line inline prompt asks "Open these automatically next time?" (Yes / No, dismissible, never modal); opening the same destination a second time triggers the same nudge. The rule is that allowing something is always one tap at the moment of use — never a settings expedition.
- **Undo lives one screen away:** a simple "Popups you've allowed" list (site → destination, plain sentences) with a Remove button per row. Removing restores interception immediately.
- **Deliberate open — the functionality guarantee:** any ledger entry opens *now, visibly, by user choice*. Nothing is ever unreachable; even a false positive is one tap from working. Interception without this recovery path is not compliant with this section.
- Ship default: automatic tier decides; unknowns are intercepted into the ledger rather than shown or silently dropped.

## 31. Site catalog & tile picker

Picking what goes in a slot should feel like choosing an app on a TV — a poster grid of known-good services — while any URL on the web stays one tap away, with region and zoom chosen visually.

**The catalog (data, in the adapter repo — `prism-adapters/catalog/`).** One entry per optimized site/app:

```json
{
  "id": "netflix",
  "name": "Netflix",
  "url": "https://www.netflix.com/browse",
  "adapter": "netflix",
  "aspectHint": "16:9",
  "audio": "exclusive",
  "poster": { "source": "site", "fallback": "wordmark" },
  "drm": { "windows-host": "hardware|software|none — recorded from POC reports" },
  "zoom": 1.0,
  "focusPresets": [
    { "id": "browse", "label": "Browse", "selector": null },
    { "id": "continue", "label": "Continue watching", "selector": ".lolomoRow[data-list-context='continueWatching']" }
  ],
  "notes": "Sign in inside the tile; sessions persist (§10)."
}
```

- **Posters are fetched, not bundled.** `source: "site"` means the shell pulls the service's own icon the way a browser's "install app" does — web-app manifest icons, `apple-touch-icon`, or `og:image` — cached locally per profile. No vendor logo files ship in the repo (brand-asset licensing stays untouched; nominative reference by the site's own served artwork is the standard launcher posture). `fallback: "wordmark"` renders the service name in the Prism type on a hue derived from the site's theme-color when no icon is available. Community can't "improve" a poster by committing a logo — CI rejects binary brand assets in the catalog.
- **Focus presets** are named `focus` (§17) configurations per site — "YouTube · Subscriptions," "Hulu · Live guide," "Twitch · Following" — maintained with the adapter's selectors, so a preset is a one-tap choice, not a selector hunt.
- **DRM tier per platform** recorded from evidence (POC reports), shown in the picker as a small badge ("4K in Edge hand-off" / "1080p embedded" / "no DRM") so expectations are set before a tile exists.

**The picker (editor + host, same flow):**

1. **Catalog grid** — posters, name, badge; search/filter; "Add" drops the tile in with its defaults (adapter, aspect, audio, zoom, first preset).
2. **Any website** — URL field with live preview in an isolated temporary profile; the shell reads the page's title/icon for the tile's poster; "Add" creates a `custom` tile.
3. **Region** — with the live preview showing, **tap an area** to frame it (§17 pick-an-element: the shell highlights the hovered element's box, tap records the selector; drag-select a rect as the alternative when no element bounds the region well). Presets appear as chips for catalog sites; "Whole page" is always first.
4. **Zoom** — slider (0.5×–3×) applied live to the preview; the aspect hint updates to the framed region's shape automatically so the solver treats the tile honestly. Reset to preset default one tap.
5. **Account** — profile dropdown (§10): new isolated / share with an existing tile's account.

The picker writes ordinary schema (`url`, `adapter`, `focus`, `zoom`, `profile`, `aspectHint`) — nothing picker-specific persists, so layouts stay shareable (§15) and slots substitute cleanly.

**Scene Templates (out-of-box wizards, not prebuilt scenes).** Facets vary by user — subscriptions and tastes differ — so a template never names apps, only **slot roles**: e.g. "Kitchen Classic" = 16:9·XL *video hero* · 3:4·M *calendar* · 4:3·M *weather* · 8:1 *news ticker*. Each role carries multiple catalog suggestions (video hero → Netflix / Hulu / YouTube / Twitch / …) plus "any app" always; tapping one runs the in-place wizard (App setup → facet from the role's tuned preset for that slot class). Completing the template *is* building your first scene — the template is a guided path, and nothing prebuilt ships that could sit half-broken for a user who lacks the presumed subscription. Templates set runtime defaults correctly: exactly one audio owner (the hero role, `exclusive`); utility roles `mute` + `scroll`.

**Utility facet presets (catalog data):** per-slot-class tuned presets for the staples — weather (region-focused on current conditions, zoom set for glanceability), calendar/Merge agenda view, ticker-class news strips (headline-river focus + zoom so an 8:1 strip reads at distance). Maintained with adapters; presets reference adapter selectors by name.

**News defaults (out of the box — §5 posture, normative):** the news picker's default shelf is **derived, not curated**: sources meeting a stated criterion on a named public dataset — v1: rated "generally reliable" on Wikipedia's Perennial Sources list (CC BY-SA, methodology public) — with that attribution displayed in the picker and each entry linking to its rating rationale. The derived shelf spans wire services and outlets of differing perspectives; Entangled adds and removes nothing by hand. Any URL remains addable as a news facet — the shelf is a starting point, never a wall — and the optional credibility-badge adapter (§5) can label user-added sources, off by default. No unlabeled editorial judgment ships in defaults, ever.

## 32. Universal music controller

One experience, any service — built as layers from unbreakable to optional, using the service's **own player** as the real interface. The service's web player runs in a hidden or floating facet under the user's session (App setup sign-in; §10; no service APIs or Entangled developer credentials).

**Placement model (simplified): music facets are hidden-only.** A music service never occupies a slot and has no floating placement — it exists in a scene solely as a hidden facet (audio + Media Session state). What's *visible* is a **visualization**: ordinary placeable content (assign to any slot, or floating) whose `source` is a hidden music facet — dancing lights, transparent background, artwork on/off, styles as local packs. One hidden facet can feed multiple visualizations; a visualization with no playing source idles dark.

**Reveal is transient, not a placement.** Tapping a visualization (or a mapped key / the pill) expands the hidden facet's native player as a temporary overlay — floating panel or hero-sized, via the §16 crossfade — for playlists, search, shuffle in the service's own UI; collapse returns it to hidden. The player is a *visitor* on the scene, never a resident.

**Layer 1 — Visualizer (zero page coupling).** The host's WASAPI loopback (already capturing for §14) feeds an FFT; the composition layer renders the visualization. Works for every service and station identically; cannot break.

*Styles (local packs, per placement):* v1 ships four — **Prism Beams** (the signature: a beam split through a prism into the brand's four bands, refracting with the audio), **Spectrum** (classic bars, tasteful), **Ribbon** (smooth waveform trail), **Bloom** (particle pulses on beats). Community styles are pack data (shader/canvas presets), same repo posture as imagery packs.

*Artwork modes (per placement, from Media Session artwork — service-served now-playing art, nothing bundled):* **off** · **backdrop** (album art blurred and dimmed behind the visualization, slow drift, palette of the visualization tinted from the art's dominant colors) · **focal** (art sharp and centered, visualization framing it). Track changes crossfade the art through the §16 path; no art → style's default palette. All modes honor reduced-motion (static art, gentle levels).

**Layer 2 — State via Media Session (standards-based, service-maintained).** An injected observer reads `navigator.mediaSession` metadata (title, artist, artwork, playback state) — the same data services publish for lock screens and Windows' media flyout, so *they* maintain it across redesigns. Artwork display on/off per placement. No per-service state scraping.

**Layer 3 — Transport via pass-through (§26).** Play/pause/next/previous on our chrome, the pill, remotes, and the phone's now-playing card (§6) forward the human's press to the player's own standard shortcut or button — a small per-service key/click map, not a contract. Unsupported actions render disabled.

**Layer 4 — Reveal the native player** (transient overlay per the placement model above): playlists, search, shuffle, repeat happen in the service's own UI the user already knows; collapse tucks it away. This is the answer for everything beyond transport — deliberately unmapped.

**Layer 5 (v2, only if demanded):** full MediaController contract per service and `reverse order` emulation (playlist/album only, `previous`-at-`ended` as a standing instruction). *Demanded 2026-09-17 ("I need some special playlist controls: normal, shuffle, and reverse order" + "true shuffle would be nice"), built as **play orders**: a playlist in Quick play plays *in order* / *shuffle* (the service's own switch, through the adapter's `musicShuffle`) / *true shuffle* / *in reverse* (Prism's: the collection's track list from the adapter's `musicTracks`, put in order in core - `play-order.ts`, true shuffle a uniform Fisher-Yates permutation from the cryptographic source, every track once before any repeat - and handed to the player's own queue through `musicQueue`). The order is a standing instruction per source (restored on restart) and the block names it. The `previous`-at-`ended` emulation was not built: it rides the player's three-second rule for what previous means and fails quietly. Apple Music first (MusicKit: shuffleMode, the library tracks endpoint, setQueue by song id); the page-driven services follow.*

**Cross-cutting:** audio focus (§3) and audio intermission (host-spec §5) apply — service ad breaks mute on the adapter's break signal with optional ambient; controls live in the visualization's chrome, the pill/Control Center, and the phone remote; per-service notes live in catalog data (Spotify on-demand needs Premium — surfaced, not fought; Pandora is adapter-only by design; embed vs offscreen-Edge hand-off per the Widevine-audio POC).

**Video, the same layers (VP-2, 2026-09-19).** "I want the config to be much like what we've done for music." A video service's face is read the same way: layer 2 from the Media Session where the page publishes one, and the adapter's `videoContext` script for what the Media Session never says (the series, the episode, the id); the library (Continue Watching, My List) from `videoLibrary`; a Quick play through `videoPlay`; the wall's verbs through `videoCmd` first (Skip Intro, next episode, captions are verbs only the service's own page has), then the declared control, then the element. The video player is the household's Movie Night scene, switched from the Prism menu (scene-model-spec §6); the DRM posture of §13 stands (in-tile at the policy cap; the Edge hand-off is B-24). Core `video.ts`; the contract in `packages/core/src/adapters.ts`; nothing of it touches the music model.

## Future directions

- **Moments packs** (§26 adjunct, future): optional break content beyond art — a breathing cue, a stretch prompt, "refill your water." Strictly opt-in, understated, never interactive-engaging (no trivia/games — rebuilding the attention trap with nicer wallpaper is the counterfeit of this tool). Deferred until the core intermission experience is shipped and stable.

- **Prism Photos** (separate concept doc): user-owned encrypted photo storage at wholesale cost, deliberate sharing to frames via §15 slots, client-side legible algorithms. Phase two; the bridge between Prism and the broader ENTANGLED platform.
