# Music checks — universal music controller (SM-5 test plan)

A human runs this at the machine, once per service: **Spotify**, **Apple
Music**, **Pandora** (dashboard-schema §32; the three the ledger names). It
needs signed-in accounts; Spotify on-demand needs Premium (surfaced, not
fought — a free Spotify account still runs the intermission check, T5).

Stage gate first: the Widevine-audio POC (`docs/reports/music-webview2-poc.md`,
SM-4) must have concluded EMBED / HAND-OFF / FAILED-BOTH per service. A
HAND-OFF service runs these checks in the launched Edge window with the Veil
extension (win-host-spec §5 last bullet) — note which mode each run used.
FAILED-BOTH services are skipped with the row marked so.

Spec anchors: §32 placement (music facets hidden-only; visualization is the
visible thing; reveal is transient), Layer 2 (Media Session metadata),
Layer 3 (transport only via pass-through), §16 crossfade, host-spec §5 audio
intermission, §3 audio focus.

Log tail: `Get-Content $env:LOCALAPPDATA\Prism\diagnostics\host.log -Wait -Tail 80`.
The lines below are today's host.log vocabulary; the SM-4 branch may add
names (the flight recorder must cover every new message) — Agent 5 fills the
placeholders at review.

## Scene under test

A scene with: one hidden music facet (the service), one **Prism Beams**
visualization in an M slot sourced from it (artwork `backdrop`), one video
hero (Hulu, muted for these checks - it must not own audio), one utility
facet. Build it via the scene builder; not via the golden path.

## T1 — Metadata round-trip (Layer 2)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Reveal the player (tap the visualization), start a known track, collapse | Visualization comes alive; **title / artist / artwork** appear in the pill's now-playing card within ~2s of play | `-> {"type":"now-playing","info":{"playing":true,"title":"<track>","artist":"<artist>",…,"artwork":[…]}, "id":"<music-facet>"}` followed by `<- surface.setNowPlaying <music-facet>` |
| 2 | Skip to the next track **in the service's own UI** (reveal, tap next, collapse) | Card updates to the new title; visualization's backdrop crossfades to the new art (§16 path, no cut) | a new `now-playing` event with the new title; no `call {"fn":"tileCommand"…}` (the human used the page, not our chrome) |
| 3 | Pause in the service UI | Card shows paused; visualization idles (levels fall to the style's idle) | `-> {"type":"playback","playing":false,"id":"<music-facet>"}` then `now-playing … "playing":false` |
| 4 | Repeat 1–3 for each service | Same for all three; record per service which fields arrive (title / artist / album / artwork) — Pandora and Apple Music may omit album | three `now-playing` shapes recorded in the ledger row |

FAIL if any field the service publishes to Windows' own media flyout (open it
with the hardware media key to compare) is missing from our card - Layer 2 is
"the same data services publish for lock screens".

## T2 — Transport only via pass-through (Layer 3)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Press **play/pause on Prism's chrome** (the visualization's control, the pill, or a mapped remote key) | The service's own player toggles; the card follows | `call {"fn":"tileCommand","args":["<music-facet>","pause"]}` → `<- surface.sendKey <music-facet>` **or** `<- surface.evaluate <music-facet>` clicking the service's own control → `-> {"type":"playback",…}` |
| 2 | Press **next** on Prism's chrome | Next track in the service's own queue | `tileCommand … "next"` → the pass-through op → new `now-playing` |
| 3 | Look at every transport control Prism draws for this service | Actions the service's key/click map does not cover are **disabled, not hidden** (§32 Layer 3: "Unsupported actions render disabled"; SM-3: "transport chrome disabled-not-hidden") | — (visual) |
| 4 | Leave the scene idle 10 minutes with the track playing | **No** `tileCommand`, `sendKey`, `typeText`, or `evaluate` lines appear for the music facet that a human did not cause | grep the window: `Select-String -Path host.log -Pattern 'sendKey <music-facet>|typeText <music-facet>|evaluate <music-facet>'` shows only the lines from steps 1–2 |

FAIL on any transport op reaching the page without a `tileCommand` (a human
tap) immediately before it - that is synthetic interaction (§26).

## T3 — Reveal / collapse with audio uninterrupted (Layer 4, §16)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | With a track playing, **tap the visualization** | The native player expands as a temporary overlay (floating panel or hero-sized) via a crossfade; **audio never gaps** - listen for a dropout, and confirm the card never flips to paused | `<- surface.setRect <music-facet>` (from zero-size to the overlay rect), `<- surface.setZ`, `<- surface.reveal <music-facet>`; **no** `playback … false`, **no** `surface.navigate`, **no** `surface.suspend` / `resume` for the facet |
| 2 | Browse a playlist, start a different track in the service UI | Works as in a browser | new `now-playing` |
| 3 | **Collapse** (tap outside / Back / the same key) | Overlay crossfades away; visualization keeps dancing; audio continues | `<- surface.setRect <music-facet>` back to `w:0,h:0` (hidden) or its zero-size equivalent; no `playback false`; no `destroy` / `create` |
| 4 | Repeat 1–3 five times quickly | No audio gap on any cycle; no renderer restart | zero `RENDERER FAILED` lines; the facet's surface id is constant |

FAIL if the facet is ever navigated, suspended, destroyed, or re-created on
reveal/collapse: "the player is a visitor on the scene, never a resident"
means the *surface* is the same one the whole time.

## T4 — Audio focus with a hidden facet (§3, host-spec §5)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Unmute the Hulu hero (it is `exclusive`) while music plays | Exactly one audio owner: core mutes the music facet (or refuses per §3 - record which) - never both audible | `<- surface.setMuted <music-facet>` true when Hulu takes focus; `<- surface.setMuted hulu` false |
| 2 | Mute Hulu again | Music facet regains audio per §3 | `<- surface.setMuted <music-facet>` false |

## T5 — Intermission mute on a free-tier ad break (host-spec §5 audio intermission)

Use a free-tier account (Spotify Free, Pandora free) so a real ad break
arrives. Apple Music has no ad tier — mark N/A.

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Play until an ad break starts | Within the cover-slow debounce (~1s after the adapter's signal) the music facet is **muted page-invisibly**; the visualization shows its intermission treatment (idle/art) - no page-side mute, no click | `-> {"type":"ad-break","active":true,"id":"<music-facet>"}` → `intermission up: <music-facet>` (or the audio-intermission line SM-4 names) → `<- surface.setMuted <music-facet>` true |
| 2 | Optional ambient audio enabled in settings | Ambient plays at its ceiling volume only while the veil is active | the ambient start/stop lines SM-4 names |
| 3 | Ad ends | **Uncover fast**: audio restored on the end signal before any fade completes | `-> {"type":"ad-break","active":false,…}` → `<- surface.setMuted <music-facet>` false within the same second; `intermission down: <music-facet>` |
| 4 | During the ad, watch the log | **No** `sendKey`/`evaluate`/`typeText` to the facet; nothing skips or dismisses the ad | absence of those lines between steps 1 and 3 |
| 5 | Pull the network cable mid-ad (missed end signal) | The §26 safety timeout lifts the mute; music is never trapped muted | `intermission down: <music-facet> (timeout)` or equivalent, then `setMuted … false` |

FAIL if the mute is page-side (a `sendKey`/`evaluate` did it) rather than
`IsMuted` (`<- surface.setMuted`), or if audio stays muted after the end
signal for longer than the fade.

## Recording

One row per service in the ledger's SM-5 notes: mode (EMBED/HAND-OFF),
T1 fields seen, T2 pass-through ops observed, T3 gap-free (y/n), T4 owner
behaviour, T5 ad-break covered (y/n/N/A).
