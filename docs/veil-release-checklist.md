# PRISM extension — release checklist (Edge / Chrome / Firefox)

The browser extension only. The Windows host is in development and is out of
scope here. Written 2026-09-12 against the PRISM extension **0.7.170** (`prototypes/prism-veil-extension`).

Each step is **Do → Expect**. If what you see differs from *Expect*, stop and
report the step id (e.g. `SM-4`): that is a bug or a wrong script, and both are
mine to fix. Marks:

| mark | meaning |
|---|---|
| `USER` | you verified this on 2026-09-12 on the build named; not re-run since |
| `CODE` | I read the code path; nobody has run this step on the release build yet |
| `KNOWN` | a documented limit — the step says what you will see instead |
| `AUTO` | a script or test does it; the step says the command and the pass line |

The gate is: every `AUTO` step green, every site row walked on **both** browsers
with no unexplained difference, and every store asset in place. A row that fails
is a hotfix on the release branch, then the row is walked again.

---

## 0 · What "release" means

- A version that stops moving. Development ran twenty builds on 2026-09-12; a
  release is one number, **0.8.0**, and stays that number for the review cycle.
- Store-distributed, so it updates itself: Edge Add-ons, Chrome Web Store, and
  Firefox's *listed* channel on AMO (today's unlisted xpi is hand-shared and
  never updates). The same two packages feed all three stores.
- A soak first: freeze the rules for at least a week; only report-driven fixes
  land, each with a fixture from the report, as today's did.

## 1 · Freeze and version

| id | Do | Expect | mark |
|---|---|---|---|
| FV-1 | `git checkout -b release/0.8` from `main` | branch exists; `main` keeps moving | CODE |
| FV-2 | set `"version": "0.8.0"` in `manifest.json` (the only version string; the Firefox manifest derives from it) | `grep '"version"' manifest.json` shows 0.8.0 once | CODE |
| FV-3 | write `CHANGELOG.md` in the extension folder from `git log --oneline 3999664..HEAD -- prototypes/prism-veil-extension` (extension 0.7.150 → 0.7.170), grouped by site | one line per user-visible change; no internal chatter | CODE |
| FV-4 | tag: `git tag veil-0.8.0` after the gate passes, not before | tag on the commit the stores received | CODE |

## 2 · Pre-flight (automated)

| id | Do | Expect | mark |
|---|---|---|---|
| PF-1 | `npx vitest run --config prototypes/prism-veil-extension/tests/vitest.config.mjs` | `Tests  78 passed (78)` or more | AUTO |
| PF-2 | `node build-firefox.mjs` in the extension folder | `dist/prism-veil-chromium-0.8.0.zip` and `dist/prism-veil-firefox-0.8.0.zip`; `[build] v0.8.0 …` twice | AUTO |
| PF-3 | `python -c "print(sum(1 for x in open('src/covers.js','rb').read() if x>127))"` | `0` — the file stays ASCII (the editor once decoded `\u` escapes into raw glyphs) | AUTO |
| PF-4 | `unzip -l dist/prism-veil-chromium-0.8.0.zip` | no `tests/`, `dist/`, `node_modules/`, `README.md`, `sign.log`, `.env`; `art/` present | AUTO |
| PF-5 | `git diff main -- prototypes/prism-veil-extension/manifest.json` | the version, `scripting` and the all-sites host permissions (`http://*/*`, `https://*/*`, B-414/B-416) are the only changes; `tabs` only optional; no new line on the extension's Warnings entry at edge://extensions | AUTO |
| PF-7 | with two or three pages open and covered, reload the extension at edge://extensions, then switch it off and on again (both stand in for a store update) | within a couple of seconds each open page has its covers and its PRISM button back, no page reload; an embedded player's veil waits for that page's next load | CODE |
| PF-8 | the temporary capture probe is gone (2026-11-06) | no `src/capture-probe.js`; `manifest.json` has no `capture-probe` content script and no `<all_urls>`; bg.js has no `captureProbe` / `streamProbe` | CODE |
| PF-9 | `grep '"permissions"' -A8 dist/*/manifest.json` | chromium: `tabCapture` and `offscreen` (the live TV picture; neither adds an install warning); firefox: neither, and no `offscreen.*` or `src/breakwatch/model.json` in its package | AUTO |
| PF-6 | load the built `dist/chromium` unpacked in a **fresh** Edge profile | popup opens, shows 0.8.0, no console errors on `about:blank` and on a plain news page | CODE |

## 3 · Privacy gate (spec §19 / §22)

Walk with DevTools → Network open, filter to the extension's requests.

| id | Do | Expect | mark |
|---|---|---|---|
| PV-1 | fresh profile, open five ordinary pages | the extension makes **no** request at all | CODE |
| PV-2 | popup → art refresh (or first veil) | requests only to `https://prism.entangled.world/veil/art/…` — the signed index and images; no query string, no cookie, no identifier | CODE |
| PV-3 | PRISM button → Report an ad, click any ad, read the panel | it lists exactly what is sent (the site's domain, the element details, what was chosen, the note, the version); ticking **Include the full page address** adds the page address and the embedded players' addresses to the list; nothing leaves until **Send to PRISM** | USER (0.7.181) |
| PV-4 | press Send | one `POST https://reports.entangled.world/v1/report`; body = only what the panel listed (no `url`, `frames`, `framesDirect` or `diag.iframes` unless the box was ticked; no `ua`, `fb` or settings); no cookies; no IP or id fields (server stores none) | CODE |
| PV-5 | grep the packages for telemetry hosts | `grep -rl "google-analytics\|sentry\|segment\|mixpanel" dist/` → nothing | AUTO |
| PV-7 | YouTube TV with Read the live TV picture on, through a break | no request of the extension's at all while it reads: the stream, the text reader, the known ads and the model stay in the browser (the offscreen page loads only extension files: the model, the text reader, the sounds) | CODE |
| PV-6 | update checks | there are none in the extension; the stores update it. Confirm no `update_url` in either manifest | AUTO |
| PV-8 | development hooks (2026-11-07): install the packed zip as a normal install (not Load unpacked), open a localhost page and YouTube TV with the picture reading on | `<html>` carries no `data-prism-version`, `data-prism-live-picture` or `data-prism-live-text`; a `prism-dev-reload` event does nothing. These exist for an unpacked install alone (bg.js asks `management.getSelf` once and keeps `pv:dev`) | CODE |

## 4 · Art gate

| id | Do | Expect | mark |
|---|---|---|---|
| AR-1 | `prototypes/prism-veil-art/pool/manifest.json` | every hosted file has a Commons page, author, and a licence matching CC0 / public domain (`fetch-art.py` keeps nothing else) | AUTO |
| AR-2 | `unverified/` (46 NASA-library images with no per-image provenance) | not hosted, not bundled; `grep -c unverified dist/chromium/art/list.json` → 0 | AUTO |
| AR-3 | `node verify-hosted.mjs` | every hosted URL answers and matches the signed index | AUTO |
| AR-4 | the bundled `art/` folder in the package | same provenance rule as the pool; the store listing's "content credits" line points at the manifest | CODE |

## 5 · Site matrix

Walk every row on **Edge** and on **Firefox** (temporary add-on from
`dist/firefox/manifest.json`, Firefox 128+). Reload the extension, then the
tab, before each browser's pass. Where a row says *X through the veil*, click
the ad's own close control inside the hole: the ad and the veil both go.

### YouTube

| id | Do | Expect | mark |
|---|---|---|---|
| YT-1 | home feed with in-feed ads | each ad tile is art with the half-moon top-left; no caption over the art | USER (0.7.163) |
| YT-2 | hover an ad tile | no holes open on hover; the inline preview box, if it opens, is covered while it sits on the ad and clear over an ordinary video | USER (0.7.161) |
| YT-3 | play a video with a pre-roll | full-card intermission centred: "Your show returns after the break", clock, ad count, Resume / Full screen as applicable; the half-moon alone top-left; the tab's mute icon lights; Skip reachable through its hole when it appears | USER (0.7.165) |
| YT-4 | break ends | veil drops, sound returns, show plays on; the "After the break" choice is back to Play for the next break | USER (0.7.170) |
| YT-5 | AI veil on (popup): open a video YouTube labels "Altered or synthetic content" | four-point star; "Watch anyway" lifts it for that video | CODE |
| YT-6 | AI veil on: a video with no such label, opened right after a labelled one | **not** veiled; its tile stays clear (the stale-section bug of 0.7.161) | USER (0.7.162) |
| YT-7 | YouTube Shorts ad reel | reel's own container covered, not the shared player | CODE |

### Fox News (Jetpack masthead)

| id | Do | Expect | mark |
|---|---|---|---|
| FX-1 | home page, masthead expanded (478px) | art over the whole masthead; the GAM spacer under it is not covered (no art on page content once the ad is gone) | USER (0.7.153) |
| FX-2 | scroll: masthead collapses to the 212px fixed strip | strip covered by a fixed veil that rides the viewport; not mistaken for the site header (covers below are not clipped under it) | USER (0.7.153) |
| FX-3 | the collapse / close buttons (42px "closeleavebehind") | holes over them; the click lands on Fox's own control; masthead and veil both go | USER (0.7.153) |

### CNN

| id | Do | Expect | mark |
|---|---|---|---|
| CN-1 | home page header ad (Wunderkind / Celtra, 1897×475 on a ~900px window) | covered (was refused as page-sized before 0.7.152) | USER (0.7.152) |
| CN-2 | its X (`a.bx-close` in the wrapper above the banner) | hole; the click closes the unit | CODE |
| CN-3 | an in-feed bolt player in the `fave-ad` state | covered like a display ad; the main player gets the full veil | CODE |

### X / Twitter

| id | Do | Expect | mark |
|---|---|---|---|
| X-1 | Explore: the promoted video hero at the top | covered at its outermost box; the caption link is **not** clickable through the veil | USER (0.7.156) |
| X-2 | home timeline: a promoted post (wrapper around the whole post, or X's "Ad" label) | whole post covered | CODE |
| X-3 | an organic post with a video | **not** covered (0.7.155 veiled these; fixed 0.7.157) | USER (0.7.157) |
| X-4 | sidebar: a trend reading "Promoted by …" | trend cell covered | CODE |

### LinkedIn

| id | Do | Expect | mark |
|---|---|---|---|
| LI-1 | feed: a promoted post (header reads "Promoted"), including one taller than the window | the whole post covered, header to social bar | USER (0.7.159) |
| LI-2 | a promoted post with comments open | comments covered too (inside the list item) | USER (0.7.170) |
| LI-3 | right rail 300×600 | the unit covered, not the footer links under it | USER (0.7.160) |
| LI-4 | scroll a long feed, then a promoted post far down | still covered (walker budget 120k) | CODE |

### Pandora

| id | Do | Expect | mark |
|---|---|---|---|
| PA-1 | station page, 300×600 beside Now Playing | covered | USER (0.7.167) |
| PA-2 | the "Get My Skips" video ad | video veil up; tab mute icon lights; **no** "Resume your video" pause; sound returns after | USER (0.7.169) |
| PA-3 | an audio-only ad between songs | not detected — **open; needs a report** clicked on Now Playing during one | KNOWN |

### Paramount+ (and Pluto TV, same skin)

| id | Do | Expect | mark |
|---|---|---|---|
| PM-1 | a commercial break | veil, clock from the top-left counter, tab mute | USER (0.7.169) |
| PM-2 | break ends | show resumes by itself, **not** paused; "After the break" reads Play at the next break | USER (0.7.170) |
| PM-3 | choose Pause on the card during a break | that break only: Paused card with Resume; Resume goes through the skin's control; the next break is back to Play | CODE |
| PM-4 | pause the show yourself: the pause panel with its half-screen ad | the ad unit covered; "Click to return to the video" reachable | CODE |

### Other registered players

| id | Do | Expect | mark |
|---|---|---|---|
| OP-1 | Hulu break (server-stitched, "Ad" badge) | veil with countdown; Skip hole if offered | CODE |
| OP-2 | Peacock break | veil (Peacock may show no countdown for 30s: the card holds without one) | CODE |
| OP-3 | Twitch main player ad + a shelf mini player | main player veiled; the mini player covered like a display ad | CODE |
| OP-4 | Kick stitched ad | veil; countdown from "NNs left"; count from "Ad N of M" | CODE |
| OP-5 | SOOP chat-column banner and an IMA ad in the player | banner covered; player veiled; in-stream pixel ads are **not** detectable | KNOWN |

### YouTube TV (live channels)

Both options are off by default; for now they act on tv.youtube.com alone (the panel's Live TV sites list starts with it).

| id | Do | Expect | mark |
|---|---|---|---|
| LT-1 | fresh profile, open the panel | Veil marked ad slots in live TV and Read the live TV picture are both off; in Firefox the picture option is shown disabled, its tooltip saying why | CODE |
| LT-2 | marked ad slots on; a channel that runs YouTube TV's own slots (one show around the clock) | the slot is covered by a marked veil; the Sponsored tray at the top left gets no cover of its own | USER (0.7.226) |
| LT-3 | the same, rewound a minute or playing a recording | no cover (live edge only) | CODE |
| LT-4 | picture on; on a YouTube TV channel press the page's PRISM button, choose Allow | the player's box gets isolation: isolate; the tab shows its sharing mark; the toolbar button's title on that tab opens with a line saying the extension reads its picture; the panel has a line saying so too | USER (0.7.239) |
| LT-5 | let it play through a network commercial break, about ten minutes in | a spotted veil: opaque, its picture still, the card saying it looks like a commercial break with Not a break and Show ad; it lifts within seconds of the show's return, not in the middle of the break | CODE |
| LT-6 | press Not a break | the veil lifts at once; that channel gets no spotted veil for five minutes (as the PRISM app's Not an ad) | CODE |
| LT-7 | a marked slot starts while a spotted veil is up | the veil turns marked (opaque, the normal card) | CODE |
| LT-8 | switch the picture off with the stream running | the sharing mark and the toolbar line go at once; reload the page: no stream | CODE |
| LT-9 | add another live TV site in the panel, open it | its picture is read there too (no marked slots, no live-edge rule: those are YouTube TV's) | CODE |
| LT-10 | the panel's During ad breaks: Mute only, then Show, on any video ad | Mute only: the ad in view, no sound, an Unmute box that brings the sound back; Show: nothing done | CODE |
| LT-11 | Sound during breaks: River, then a veiled break | the loop fades in under the veil and out as it lifts; the tab stays muted | CODE |
| LT-12 | on a reading channel, the panel's All breaks / Sure only / None | None: no veil on that channel; Sure only: only YouTube TV's own slots and paid programming | CODE |
| LT-13 | Show ad on a spotted or marked veil | the break shows; the corner chip brings the veil back | CODE |
| LT-14 | a commercial with words on screen (a phone number, a web address) | data-prism-live-text shows the words read; the person's captions are not among them | USER (0.7.253) |
| LT-15 | reload the extension, reopen the channel and start the reading | the channel's learned logo comes back (no eight minutes of learning) | CODE |

### Feeds and portals

| id | Do | Expect | mark |
|---|---|---|---|
| FP-1 | MSN home: infopane native ad slide; stripe tile with an "Ad" subtitle | slide covered whole with the pager raised above the veil; tile covered; the search bar never painted over | CODE |
| FP-2 | Facebook feed: a Sponsored post | only that post covered; organic posts clear (data-ad-* alone never counts) | CODE |
| FP-3 | Instagram feed and Reels: an "Ad" post / reel | the media box covered | CODE |
| FP-4 | Reddit: promoted post and sidebar unit | covered | CODE |
| FP-5 | Amazon: "Sponsored" product tiles | **not** covered — by design (the label walker is off there); real ad-network banners still are | KNOWN |
| FP-6 | any news site with Google Ad Manager / AdSense slots | slots covered; a slot that balloons to page size drops its cover in the same frame | CODE |

### Cross-cutting

| id | Do | Expect | mark |
|---|---|---|---|
| CC-1 | Escape during any veil | every cover down, sound back, 6s hold-off | CODE |
| CC-2 | hold the pill (3s) | reveal for 15s, then covers return | CODE |
| CC-3 | popup → Intermission → Corner chip | video card hidden; chip with clock top-left opens the popover; back to Full card restores the centred card | USER (0.7.164) |
| CC-4 | a page with a sticky header and covers below it | covers clip under the header as you scroll, no smear | CODE |
| CC-7 | popup → Veil on → off, on a page with covers up | every cover and any video veil drops at once, no reload; the PRISM button reads "PRISM off"; on again covers again at once | CODE |
| CC-8 | PRISM button → Report an ad | the panel closes, the button reads, the crosshair prompt shows; clicking the button cancels, clicking an ad opens the report | CODE |
| CC-9 | switch the extension off at edge://extensions (or about:addons) with covers up | the covers come down within about a second, no reload | CODE |
| CC-10 | a page that opens a cross-site popup from a button or script, with the PRISM button docked | the button comes out of its tab, reads "1 popup blocked" with an amber breathing edge for 5 s, then docks again; tapped during the hold it opens the panel and stays out | CODE |
| CC-5 | Firefox only: a pre-roll on YouTube | tab mute icon lights (tabs.update muted); if it does not, the element fallback mutes — note it | CODE |
| CC-6 | Firefox only: Fox masthead | MAIN-world hook and holes behave as in Edge | CODE |

## 6 · Store assets

Draft once, reuse in all three listings.

- **Name**: PRISM. **Summary (≤132 chars)**: *Ads become art. Ad breaks become intermissions. Nothing is blocked, nothing is tracked.*
- **Description**: what it covers (display ads, promoted posts, video ad breaks), what it never does (no blocking, no tracking, no data sales, everything open source), the Report ad tool and that sending is a per-report choice, the AI-content veil as opt-in keyed on the platform's own label.
- **Screenshots (1280×800, five)**: YouTube feed with art tiles; a video intermission card; Fox masthead with the hole over its X; the popup; the PRISM button's panel with the Report an ad prompt.
- **Icons**: from `assets/brand` (already derived, 0.7.146 / B-190).
- **Privacy policy page** on `entangled.world` (all three stores require a URL; `prism.entangled.world` is the extension's storage, not a site): no data collected; art fetched from PRISM's own host without identifiers; reports contain the site's domain, the ad element's details, the kind of ad, the person's note and the version - the full page address and embedded players' addresses only if the person ticks the box - and are sent only when the person presses Send; the receiver keeps no IP and no log. Link the reports receiver's README statement.
- **Permission justification** (the reviewers' question is running on every site in the page's own context): *PRISM detects ad markup on any page the person visits, so it must run on all sites; it needs the page context to read players' own ad signals; it blocks no requests and reads no user data.* `storage` = settings and the art index; `alarms` = the art refresh timer; `scripting` and the all-sites host permissions = re-entering the pages already open after an update (the content scripts already run on every site, so the warning is unchanged); the PRISM host permission = PRISM's art host; `tabs` is optional and only ever requested by the person.
- **Category**: Productivity / Privacy & Security (each store's nearest).
- **Content credits**: Wikimedia Commons, CC0 / public domain, per-file provenance in the pool manifest.

## 7 · Submissions

| id | Do | Expect | mark |
|---|---|---|---|
| ST-1 | **Edge Add-ons** (Partner Center, free): upload `prism-veil-chromium-0.8.0.zip`, listing assets, privacy URL, permission notes | review typically days; listing goes live on approval; updates by uploading the next zip | CODE |
| ST-2 | **Chrome Web Store** (one-time $5 developer registration): same zip, same assets; fill the Privacy practices tab (no data collected; justify each permission) | review days to a week; a "broad host permissions" question is likely — answer with the justification above | CODE |
| ST-3 | **Firefox AMO, listed**: `web-ext sign` cannot list; submit `prism-veil-firefox-0.8.0.zip` through the developer hub as a **listed** submission with source not required (no minification) | human review; keep submissions spaced — AMO throttles frequent uploads for hours | CODE |
| ST-4 | after approval: install each store build in a fresh profile | version 0.8.0, updates enabled, PV-1..PV-4 hold on the store build | CODE |

## 8 · After release

- **Inbox**: pull reports every day for the first week (`python pull-reports.py`), then weekly. Each report that changes a rule ships with a fixture from that report.
- **Hotfix rule**: on the release branch, one fix per build, walked against the affected site rows on both browsers, then a patch version (0.8.1 …) to all three stores the same day.
- **Rollback**: each store keeps the previous package; the unlisted Firefox xpi and the previous zip are in `dist/` on this machine.
- **Known limits to say out loud** (listing and README): in-page covers are page-visible in principle; audio-only ads (Pandora) are not detected yet; SOOP in-stream pixel ads and Amazon sponsored products are by design; the X Explore hero has no text disclosure and is covered by structure.
- **iOS Safari**: deferred (decision 2026-09-12): needs a Mac, Xcode and a developer membership; the value on iPhone is feed covers, not the intermission.
