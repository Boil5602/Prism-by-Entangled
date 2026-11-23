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
| PF-2 | `node build-firefox.mjs` in the extension folder | `dist/prism-extension-chromium-0.8.0.zip` and `dist/prism-extension-firefox-0.8.0.zip`; `[build] v0.8.0 …` twice | AUTO |
| PF-3 | `python -c "print(sum(1 for x in open('src/covers.js','rb').read() if x>127))"` | `0` — the file stays ASCII (the editor once decoded `\u` escapes into raw glyphs) | AUTO |
| PF-4 | `unzip -l dist/prism-extension-chromium-0.8.0.zip` | no `tests/`, `dist/`, `node_modules/`, `README.md`, `sign.log`, `.env`; `art/` present | AUTO |
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

- **Name**: PRISM by Entangled in both store packages (the trademark's name; `short_name` PRISM where space is tight), PRISM in the development folder. **Summary (≤132 chars)**: the store build's manifest description, *Ads become art. PRISM covers the ads on a page with pictures you chose and closes popups you did not ask for. Ads still load.* (125)
- **Description**: what it covers (display ads, promoted posts, video ad breaks), what it never does (no blocking, no tracking, no data sales, everything open source; the line on what leaves the browser reads *It does not send the pages you visit, their text, or their addresses anywhere, unless you choose to send a report.*, 2026-11-14), the Report ad tool and that sending is a per-report choice, the AI-content veil as opt-in keyed on the platform's own label.
- **Screenshots (1280×800, five)**: YouTube feed with art tiles; a video intermission card; Fox masthead with the hole over its X; the popup; the PRISM button's panel with the Report an ad prompt.
- **The five as made (2026-11-14)**: `assets/store/shot-1-news.png`, `shot-2-feed.png`, `shot-3-intermission.png`, `shot-4-popups.png`, `shot-5-report.png`, 1280×800, 24-bit PNG with no alpha, the store build running in a headless Chromium on stand-in pages with made-up names (`assets/store/standin/`; `node assets/store/standin/capture.mjs` makes them again). They are a news page, a feed, a video intermission, the popup list (a page that opened four windows by itself, the PRISM button's panel listing them with Open and Always allow; it took the place of the settings shot the same day) and the PRISM button's panel with Report an ad; no real site or logo is in them, so the Fox masthead is not one of them.
- **Icons**: from `assets/brand` (already derived, 0.7.146 / B-190).
- **Privacy policy page** on `entangled.world` (all three stores require a URL; `prism.entangled.world` is the extension's storage, not a site): no data collected; art fetched from PRISM's own host without identifiers; reports contain the site's domain, the ad element's details, the kind of ad, the person's note and the version - the full page address and embedded players' addresses only if the person ticks the box - and are sent only when the person presses Send; the receiver keeps no IP and no log. Link the reports receiver's README statement.
- **Permission justification** (the reviewers' question is running on every site in the page's own context): *PRISM detects ad markup on any page the person visits, so it must run on all sites; it needs the page context to read players' own ad signals; it blocks no requests and reads no user data.* `storage` = settings and the art index; `alarms` = the art refresh timer; `scripting` and the all-sites host permissions = re-entering the pages already open after an update (the content scripts already run on every site, so the warning is unchanged); the PRISM host permission = PRISM's art host; `tabCapture` = the live TV picture, off until the person turns it on, read in the browser and never sent; `offscreen` = the page that holds that stream and plays the sound chosen for ad breaks; `tabs` is optional, only ever requested by the person, and not in the store build at all (section 6a).
- **Small promo tile (Chrome, 440×280)**: `assets/store/prism-promo-440x280.png`, 24-bit PNG with no alpha, the logo with the store name.
- **Category**: Productivity / Privacy & Security (each store's nearest).
- **Content credits**: Wikimedia Commons, CC0 / public domain, per-file provenance in the pool manifest.

## 6a · The store build (2026-11-14)

`dist/chromium` and `prism-extension-chromium-<version>.zip` are the store build for the Chrome Web Store and Edge Add-ons. It is made
by `build-firefox.mjs` from the one source (`STORE` in that file); the folder itself, loaded unpacked, is the development build,
and the Firefox package has the start page cut the same way (SB-10) and is otherwise as it was. Each difference, and why:

| id | The store build | Why | Checked by |
|---|---|---|---|
| SB-1 | name `PRISM by Entangled`, `short_name` `PRISM` | the name in the trademark filing; the short one for the toolbar and the extensions menu | the build writes both |
| SB-2 | no start page: `ntp.html`, `ntp.css`, `ntp.js` are left out; the lines between `@store-strip-begin` and `@store-strip-end` in `bg.js`, `popup.js` and `popup.html` are cut (the new-tab and start routing, the two switches, the `tabs` request); the phrases that name it are taken out of the tooltips | Chrome's API Use policy lets an extension replace the New Tab page through `chrome_url_overrides` alone, and the store's single purpose rule counts a new tab page as a purpose of its own | the build stops if `ntp.html`, `ntpEnabled`, `startEnabled`, the words for the page or `open-meteo` are in any text file of the package; each cut script is parsed |
| SB-3 | no `optional_permissions` (`tabs` was only the start page's) | follows SB-2 | the manifest the build writes |
| SB-4 | no requests to Open-Meteo, to a calendar feed or to the person's own PRISM devices | only the start page made them (`ntp.js`) | SB-2's check |
| SB-5 | no `optional_host_permissions` | it repeated the required host permissions and did nothing | the manifest the build writes |
| SB-6 | the description says what happens to popups and that ads still load (125 characters) | the earlier one said nothing is blocked from loading while PRISM closes a popup nobody asked for | the build stops over 132 |
| SB-7 | the vendored Tesseract files name no CDN: the three default addresses are empty strings, the blob worker and the `new Function` fallback are gone (`vendor/tesseract/PRISM-CHANGES.md`); this one is in the source, so every build has it | the store's rule against remotely hosted code, and the scanners that read for it; PRISM always passed its own paths, so nothing it runs changed | the build stops if the CDN's host name is in the package |
| SB-8 | what still depends on the start page: nothing in the store build. The Wikipedia source list (`list`) is still fetched for the source marks; the picture sets are still used by the veils | | |
| SB-9 | the picture refresh has no start page trigger: the background fetches only on Get photos, on the weekly alarm and on its catch-up at start (the start page loaded its own pictures in `ntp.js`, which is left out) | asked 2026-11-14 to confirm the refresh works without the start page | headless run of the store build 2026-11-14: Get photos in the settings stored 24 pictures from the server; the weekly box made the `prism-art-weekly` alarm (10080 minutes) and cleared it; the alarm was not waited for |
| SB-10 | the Firefox package is a store build too: no start page (the same files left out, the same marked lines cut, the same check), the store name, short name and description, no `optional_permissions` and no `optional_host_permissions`. Its id (`prism-veil@entangled.world`) and its data declaration (required none, optional `websiteContent`) are as they were. It has no Tesseract, no sounds and no offscreen page; the ambient sound row is hidden there and the live TV picture option is shown disabled with its reason | asked 2026-11-14 for the Firefox package to match the Chromium one and be ready for addons.mozilla.org | 2026-11-14 in a headless Firefox 157: the manifest's name and id read back, Get photos stored 24 pictures, the weekly box made and cleared its alarm, three ad slots covered on the stand-in news page. `web-ext lint` on the zip: 0 errors, 4 warnings (the settings' tooltip writes its own markup with innerHTML; three calls of Chromium-only APIs that the code guards). `SOURCE-NOTES.md` in the extension folder lists the generated files and the build steps for a reviewer |
| SB-11 | American spelling in what a person reads: the switch is `Veil AI-labeled content`, the cover's reason `Labeled AI content`, in every package and the development folder | asked 2026-11-14 | the tests (175 pass); read back from the settings page in Firefox |
| SB-12 | Firefox 0.8.0 follow-ups: the browser's own permission for website content is asked for once before the first report (the report panel opens the settings page as a tab, the press is made there, the background refuses to send until it is given); `Get ad cover updates` is hidden and makes no check where nothing reads the pack; `src/live-picture.js` and `src/breakwatch/` are left out of the Firefox package. `node build-firefox.mjs firefox` now leaves the Chromium folder and zip as they are | asked 2026-11-14 | headless Firefox 157 the same day: not allowed at first and the background refused a send, allowed after a real press on the settings page (the browser's prompt itself was accepted by a test setting and not seen), the row hidden; `web-ext lint` 0 errors; the Chromium zip's SHA-256 the same before and after; the report panel's own notice was not walked |
| SB-13 | 0.9.0 is the version for the three stores (2026-11-14, in place of 0.8.0): rule updates through the same opt-in in every browser, as signed data (docs/features/rule-updates.md). The first rule file (2026-11-14.1, it adds nothing) is live. The paste-ready text for the three forms is docs/veil-store-text-0.9.0.md | asked 2026-11-14 | the extension's tests (196 pass, 21 for the updates); `rules-test.mjs` passed in a headless Chromium and Firefox with the demonstration file and with the live file; the built 0.9.0 packages in a headless Chromium and a headless Firefox fetched the live file, verified it and showed `Rules 2026-11-14.1` in the settings, and the switch off removed it; web-ext lint on the Firefox zip: 0 errors, 4 warnings. Not walked by a person in Edge or Chrome |

Walk PF-6 and PF-7 on this build before a submission: the popup has no PRISM page section, and `edge://extensions` shows PRISM by Entangled.

## 7 · Submissions

| id | Do | Expect | mark |
|---|---|---|---|
| ST-1 | **Edge Add-ons** (Partner Center, free): upload `prism-extension-chromium-0.8.0.zip`, listing assets, privacy URL, permission notes | review typically days; listing goes live on approval; updates by uploading the next zip | CODE |
| ST-2 | **Chrome Web Store** (one-time $5 developer registration): same zip, same assets; fill the Privacy practices tab (no data collected; justify each permission) | review days to a week; a "broad host permissions" question is likely — answer with the justification above | CODE |
| ST-3 | **Firefox AMO, listed**: `web-ext sign` cannot list; submit `prism-extension-firefox-0.8.0.zip` through the developer hub as a **listed** submission with source not required (no minification) | human review; keep submissions spaced — AMO throttles frequent uploads for hours | CODE |
| ST-4 | after approval: install each store build in a fresh profile | version 0.8.0, updates enabled, PV-1..PV-4 hold on the store build | CODE |

## 7a · Chrome updates by script (2026-11-17)

The Chrome Web Store has PRISM by Entangled since 2026-11-16 (version 0.9.0, item `dhdlohmmnplaadhpafnbmamjciapcnfj`). A later
version goes up with `python scripts/release/publish-chrome.py`: it checks the package, reads what the store has, sends the zip and
submits it for review. `--dry-run` checks and sends nothing; `--status` reads the store's state; `--upload-only` leaves a draft.
The owner runs it, or says to; on a weekday it waits for the evening.

The one-time setup, the owner's (the Chrome Web Store API, version 2):

1. Google Cloud Console: a project, then `Chrome Web Store API` enabled in it.
2. `OAuth consent screen`: External, the app's name and the two email addresses, no scopes, the owner's address as a test user.
3. `Credentials` > `Create Credentials` > `OAuth client ID`: Web application, with
   `https://developers.google.com/oauthplayground` as an authorized redirect URI. This gives the client ID and the client secret.
4. The OAuth Playground: the settings icon > `Use your own OAuth credentials`; the scope
   `https://www.googleapis.com/auth/chromewebstore`; `Authorize APIs`; `Exchange authorization code for tokens`. This gives the
   refresh token.
5. The publisher ID is in the Developer Dashboard under Publisher > Settings.
6. The four values go in `~/.prism/chrome-webstore.json` (`client_id`, `client_secret`, `refresh_token`, `publisher_id`), outside
   the repository. The file can publish to the store account: it is kept like the signing keys.

The access file was made on 2026-11-18 with `scripts/release/chrome-store-access.py` (a client of the type Desktop app, the owner's
address as a test user, Google's own consent page) in place of steps 3 and 4. The status check reads the store (0.9.0 published)
and the dry run passes for 0.9.41. 0.9.41 was sent for Google's review the same evening.

## 7b · A release to both stores by one command (2026-11-18)

`python scripts/release/publish-extension.py --notes "<what is new>"` does a release: the tree clean and pushed, the packages built,
the tests, each store asked what it has, the public snapshot pushed (the source Mozilla builds from), then the Chrome Web Store
(`publish-chrome.py`) and addons.mozilla.org (`publish-firefox.py`, a listed version with the source archive and the notes in
`docs/veil-amo-reviewer-notes.md`). `--dry-run` runs the checks and sends nothing; `--only chrome` or `--only firefox` sends one.
The Firefox listing's own text (2026-11-19): its summary and its ON FIREFOX section were set through the store's interface to
what `docs/veil-store-text-0.9.0.md` holds. Until then the listing said the sound and the picture reading were not in Firefox, and
carried an old summary. A release that changes what Firefox can do also changes that section.

Since 2026-11-19 a release to Firefox also walks the built package in a hidden Firefox (`scripts/release/firefox-check.mjs`): the
settings open over a page, tell their height, name the site, offer Picture detection and close, and no part of the extension
(the page's scripts, the settings page, the background) reports an error. It fails on 0.9.41, whose panel did not close.
The packages sent are copied to `dist/<version>-submitted/`. The owner runs it, or says to; on a weekday it waits for the evening.

Firefox's one-time setup, the owner's: a key made on `https://addons.mozilla.org/developers/addon/api/key/` while signed in to the
account that owns PRISM by Entangled, its two values in `~/.prism/amo.env` as `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. The owner's
key has been in that file since 2026-11-18 (the one before it belonged to another account, the one the unlisted signing used).
Edge has no listing of its own: it installs from the Chrome Web Store.

Firefox's first release by the command: 0.9.41 on 2026-11-18, a listed version sent for Mozilla's review with its source and both
sets of notes (the store had 0.9.1 listed). Chrome's dry run passes too (section 7a).

## 8 · After release

- **Inbox**: pull reports every day for the first week (`python pull-reports.py`), then weekly. Each report that changes a rule ships with a fixture from that report.
- **Hotfix rule**: on the release branch, one fix per build, walked against the affected site rows on both browsers, then a patch version (0.8.1 …) to all three stores the same day.
- **Rollback**: each store keeps the previous package; the unlisted Firefox xpi and the previous zip are in `dist/` on this machine.
- **Known limits to say out loud** (listing and README): in-page covers are page-visible in principle; audio-only ads (Pandora) are not detected yet; SOOP in-stream pixel ads and Amazon sponsored products are by design; the X Explore hero has no text disclosure and is covered by structure.
- **Safari, Mac and iPhone**: taken up 2026-11-19 (it was deferred on 2026-09-12 for want of a Mac, Xcode and a developer membership). Apple now packages a web extension from a zip in App Store Connect with no Mac, and the company has the D-U-N-S record the enrollment asks for. The plan and what is unknown are in `docs/roadmap.md` (Safari); `node build-firefox.mjs safari` makes the zip. No Safari has run it yet.
