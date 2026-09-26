# Video services — DRM matrix (WebView2, the Windows host)

*Phase 1 of the video services build-out (2026-09-19). Before a service's adapter is written, a title is played in
the embedded tile SIGNED IN and two things are recorded: the robustness the CDM granted (the host's EME auto-probe,
`diagnostics/eme.log`, `requestMediaKeySystemAccess` for PlayReady and Widevine) and the resolution the service
actually served (the playing `<video>` element's `videoWidth × videoHeight`, read through the dev eval gate).*

*Verdicts, per the work order: **HARDWARE** (PlayReady HW_SECURE_ALL / Widevine HW) → embed. **SOFTWARE** (SW_SECURE_DECODE
and the service's software cap, spec §13) → embed at that tier and say so in the catalog's `drm` field. **FAILS** (no key
system accepted, or playback refused signed in) → the Edge hand-off per §29 (B-24: not built; the service is recorded and
marked, not chased with workarounds).*

| service | date | signed in | PlayReady | Widevine | served (w×h) | verdict | notes |
|---|---|---|---|---|---|---|---|
| Netflix | 2026-08-31 / 2026-09-19 | yes | HW_SECURE_ALL (3000) once the CDM is warm; SW_SECURE_DECODE (2000) on the first-ever run | SW_SECURE_DECODE | *(to read)* | HARDWARE (provisional until the served size is read) | plays embedded (DANG! resumed at its episode, 2026-09-19); the player's chrome hides its title from the DOM (memory: netflix-page-structure) |
| Hulu | 2026-09-19 19:21 | yes | rejected | SW_SECURE_DECODE | 1280×720 | **SOFTWARE** - embed at 720p, said in the catalog | What We Do in the Shadows S1E6 resumed from Continue Watching at 19:56 in, playing (readyState 4); the probe run inside the playing tile; the ad bar (`.AdUnitView__adBar`) visible on the stitched ad, the veil up at 19:20:35 (gallery, Heart of the Andes) |
| Tubi | 2026-09-19 19:32 | yes | SW_SECURE_DECODE (2000) | SW_SECURE_DECODE | 854×472 (3 From Hell, 13 min in) | **SOFTWARE** - embed | `?start=true` autoplays a title; the feature is one MSE element; no ad in the first 13 minutes even after a seek, so the ad-signal reading waits for a break a person sees; the served size may be the title's own rendition - re-read on a known-HD title |
| Fandango at Home | 2026-09-20 15:33 | yes | pending | pending | ad: 569 px wide | **FAILS -> Edge hand-off** (two runs) | the person's own play of Dark Skies (free, with ads): the player is a same-origin frame (bluesteel/player_frame.html); the pre-roll is an EME-protected MSE element (mediaKeys set) that buffered fully (0-19.2 s) and stalled at 18.80 of 19.24 s with readyState 1 - not paused, not ended, not advancing for 15+ minutes, no error; the page's own indicator sat at 'Ad 1 of 1 00:01' and the feature never started. Nothing of Prism's touched it (blocking off for the tile, the veil is a cover only, the ad watcher observes). The retry at 16:11 stalled the same way (the person backed out at 16:14 after two minutes on 'Ad 1 of 1'). Two runs, the same freeze at the protected pre-roll's last frame: FAILS in WebView2 -> the Edge hand-off for Fandango at Home, no workarounds (the work order's rule). The signed-in reads (wish list, search, play path) stand for the menu; the play itself hands off |
| Disney+ | 2026-09-20 17:12 | yes | offered 3000, 2000 (query) | SW_SECURE_DECODE (the play's session) | 1280×720 (Dance Moms S2 E21, 53 s in) | **SOFTWARE** - embed | Hulu's stack, as expected; the stage entered the player's fullscreen on the wall's ask; the home's Continue Watching row read once the home was on the screen |
| Movies Anywhere | 2026-09-20 17:06 | yes | offered 3000, 2000 (query) | SW_SECURE_DECODE (the play's session) | 1280×720 (Poltergeist, 26 s in) | **SOFTWARE** - embed | a purchase locker; the feature plays on the movie's own page, mediaKeys set; controls hidden until a pointer moves |
| Peacock | 2026-09-19 19:47 | yes (a session kept from earlier) | SW_SECURE_DECODE (2000) | SW_SECURE_DECODE | 960×540 (live: Dateline NBC) | **SOFTWARE** - embed | the profiles gate (/watch/profiles) passed with a tile press; a live channel played on the preview surface; no ad text or adBreakActive class in two minutes of live; VOD size and break still to read |
| Peacock (VOD) | 2026-09-20 17:21 | yes | offered 3000, 2000 (query) | SW_SECURE_DECODE (the play's session) | 1920×1080 (The Gentle Art of Swedish Death Cleaning S1 E1, 2 min in) | **SOFTWARE** - embed | the full press-the-tile path from a My list card (home → My Stuff → the tile → the asset page's Watch button → /watch/playback/vod/_/<uuid>); the stage entered the player's fullscreen on the wall's ask |
| Paramount+ | 2026-09-19 20:13 | yes (a session kept from earlier) | SW_SECURE_DECODE (2000) | SW_SECURE_DECODE | 960×540 (Colin from Accounts S1E1, an episode page, which autoplays); 1280×720 on the movie page's 86 s stream | **SOFTWARE** - embed | the ad tier's pre-roll seen 34 s in: the ad-info-manager panel (class show, Advertisement, a countdown) then remove; the adapter raised ad-info and ad-break as it ended - the veil signal verified |
| Prime Video | 2026-09-19 | no | | | | *(pending sign-in)* | signed out on this wall: the nav's Sign In (auth-redirect?signin=1) read for the needs-attention signal; adapter 0.1.0 draft |
| HBO Max | 2026-09-19 | no | | | | *(pending sign-in)* | signed out on this wall: Sign In goes to auth.hbomax.com/login?flow=login; adapter 0.1.0 draft; max.com redirects to hbomax.com |
| Apple TV | 2026-09-21 | no | | | | *(pending sign-in)* | added 2026-09-21 (VS-21); tv.apple.com; one Apple Account per sign-in, no profile picker; adapter 0.1.0 |

## How a row is filled

1. Sign the service in from the hub's chip (App setup, the header strip's Sign in).
2. The EME auto-probe records the key systems on the tile's first load (`eme.log`: `<app>: PlayReady=… Widevine=…`).
3. Play a title from the service's own page; through the dev eval gate read
   `document.querySelector('video')` → `videoWidth`, `videoHeight`, `readyState`, and `location.href`.
4. Write the row; set the catalog entry's `drm.windows-host` to `hardware` / `software` / `hand-off` with the
   evidence line pointing here.
