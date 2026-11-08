# The live TV picture in the Prism extension

*Status: built 2026-11-06 (extension 0.7.216 to 0.7.254), off by default. Seen working on Edge on a YouTube TV channel that night:
the real picture read under the extension's own veil, spotted and marked veils, the screen's words read. Not yet judged over a whole
evening against marked breaks.*

The Prism app covers a live channel's commercials by reading its picture (the break watch: `BreakModel.cs`, `LearnedBreak.cs`,
`MainWindow.BreakWatch.cs`). YouTube TV's page says nothing about a network's own commercials, so an extension that only reads the page
can cover just the ad slots YouTube TV inserts and marks. The Prism extension carries the app's ad covering into browsers; this is how
it reads the picture too.

## The options

*Decision (2026-11-07):* the safe detection is on by default and the advanced one off, in both products. In the extension, **Veil
marked ad slots in live TV** (the service's own marks) is on unless switched off, and **Read the live TV picture** (Prism's own
judgement) is off until switched on. In the app a new install's break watch starts at **Sure breaks only** (marked slots, paid
programming, nothing that guesses) and the person turns on All breaks; an install that had the earlier on/off switch keeps its choice.
A spotted veil's card carries **Turn this detection off**, which opens the panel's page at the two live TV switches, lit.

In the extension's panel:

- **During ad breaks:** Veil (the cover and the mute), Mute only (the ad in view with its sound off and an Unmute box) or Show (nothing
  done), as the app's three looks. Video ad breaks only; pauses and AI-labelled content keep their own veils.
- **Sound during breaks:** Off, River, Chimes or Stars, three of the app's CC0 field recordings (`sounds/`), played from the extension's
  offscreen page while a veil covers a break (the tab itself is muted).
- **Veil marked ad slots in live TV.** YouTube TV marks the slots it adds to a channel (`Cuepoint-Event` in the stream data its page
  hands the player) and shows a Sponsored tray while one plays. `src/ytv-cues.js` reads the marks, `video.js` the tray, and the slot
  gets a **marked** veil. YouTube TV only: the marks are its format.
- **Read the live TV picture.** The break watch reads the channel's picture once a second and, when it judges a commercial break is on,
  the slot gets a **spotted** veil. It reads the sites in the panel's **Live TV sites** list (tv.youtube.com to start with; a person can
  add another live TV service to try the detection there). On such a channel the panel also offers **All breaks / Sure only / None**
  for that channel, as the app's channel covers: Sure only covers only what does not guess (YouTube TV's own slots, paid programming).

A marked veil wins over a spotted one: the service's own word is certain, the break watch's is a judgement.

## How the picture is read

- **Started from the page.** On YouTube TV a Prism button appears on the watch page; a click on it lets the browser ask to share the
  tab (once a visit; the dialog names the site, which no extension can change). The tab shows the browser's sharing mark while it runs,
  and the extension says it in its own places: the toolbar button's title on that tab and a line in the panel.
- **Only the player's box, the veil left out** (Element Capture). The shared stream is restricted to the player's box (`div.ypl-video`),
  which is made a stacking context of its own while reading (`isolation: isolate`, the only style that sufficed; put back after).
  What is drawn over that box, the extension's veil above all, is not in the picture, so under an opaque veil the break watch reads the
  real broadcast, as the app's does (its veil is a layer above its window). Restricting to the video element itself, or any box below
  `div.ypl-video`, gives no frames; the page's own video cannot be read (copy protection: canvas, `captureStream` and `VideoFrame` all
  refused).
- **The frame is the app's frame:** the middle 16:9 of the video's area, 320x180, grey = (B*29 + G*150 + R*77) >> 8, as
  `SurfaceManager.CaptureForWatchAsync`; every other look also a 960x540 picture for the QR finder and the text reader.
- **Judged in the extension's offscreen page** (`offscreen.html`, `offscreen.js`), one state per channel (named by the watch page's
  network logo, as the app names it).
- **Sites without a known player box** fall back to the tab's own stream (`chrome.tabCapture`, started by opening the panel on the tab),
  in which the veil is part of the picture: under it the watch holds rather than reads.

## What the break watch reads (the app's inputs)

- **The model** (`src/breakwatch/model.json`) is the extension's own (since 0.7.262: ext-a's recipe, trained with the app's recipe on
  the same days without the screen's words or QR codes, plus the minute of the hour), run by the browser port of the C#
  (`src/breakwatch/`), held to it by `scripts/breakwatch/parity-js.mjs`. Beside it, a small **picture network**
  (`picture-net.json`, `picture-net.js`, trained by `scripts/breakwatch/cnn.py`) gives its own chance from the frame and its change,
  added in logit at weight 0.75. On the seven exams with every rule: 94.3% of ad time covered, 2.05% of show wrongly covered, against
  ext-a's 91.2% and 2.34% with its 4 s lift hold; the network keeps the veil through a break without the hold, so the hold is gone.
  Since 0.7.264 (2026-11-07) a veil begins only after four looks above the threshold instead of two: the network had raised the
  pop-ups (veils on the show gone within 20 s) from 11 to 21 on the exams; four looks bring them to 13, for 91.8% of ad time covered
  and 1.76% of show wrongly covered (three looks: 18, 93.1%, 1.92%). Since 0.7.267 (2026-11-07) the model's policy also asks for
  **agreement to start** (`agree`, `treeMin` and `netMin` 0.5): a veil begins only when the trees' own chance and the network's both
  lean to a break; up, the blend alone holds it. Seven exams: 90.4% of ad time, 1.72% of show, 10 pop-ups (13 without); the
  ordinary evening 90.3%, 3.13%, 15 (91.6%, 4.12%, 30 without). The same flag is read by the app's break watch. The app's own v6 was tried the same night and put up no
  spotted veil in 45 minutes on Food Network: it leans on the screen's words as Windows' reader gives them, and Tesseract's differ.
- **The cover is composed as the app's:** the learned call with its guards (the rules decide a channel's first 45 s; no cover begun while
  the show is plainly on or on a dark scene alone), joined with the rules that do not guess (a marked slot, one read and coming, an
  infomercial, a phone number or web address with the logo away, paid programming by title, card or opening, a ticker channel's inset
  picture), never on an ad-free channel (C-SPAN, PBS), not for five minutes after Not a break, and only at the live edge.
- **The screen's words:** Tesseract.js 6 (Apache-2.0, bundled in `vendor/tesseract` with its English data; nothing fetched), every other
  look, lines it is unsure of (under 55) left out, and lines that are mostly the person's captions left out (captions the person has
  on are drawn inside the player's box; the app keeps its hidden). The app's model learned on Windows' reader; how Tesseract's
  readings serve it is judged live.
- **QR codes:** the app's own finder (three finder squares in an L), ported line for line.
- **Captions:** switched on and kept hidden while reading, as the app does, unless the person has them on; their words feed the model.
- **The sound:** the video's sound through Web Audio (it still plays), read as the app's YouTube TV meter reads it: level, peak and
  silences, and its fingerprint (the app's: 33 bands from 300 to 2000 Hz, twenty words a second), matched against the ads heard before.
  A sure break's sound, all but its last twenty seconds, is learned on this PC in the app's sounds.bin format, until the pack ships a library.
- **Known ads:** pictures of breaks the watch is sure of are learned on this PC (the app's AdPrints format, in the extension's storage)
  and a picture seen again is a known ad.
- **Programme edges** from YouTube TV's scrub bar; **YouTube TV's marks**, read and as they play; each channel's **learned logo**,
  kept across restarts.

## The spotted veil

The same veil as a marked one, its picture held still. Every video veil's corner glyph opens the peep (0.7.266, 2026-11-07): rest the
pointer on it and a small panel shows the video as it plays behind the veil, sound off, with a Reveal 15 s button under it. A page's own
unprotected video is copied (captureStream); a protected one is shown through a keyhole in the veil, the page's video drawn small
inside it and put back when the pointer leaves. Its card says it looks like a commercial break, and its tooltip names Prism's
break watch. **Not a break** lifts it and leaves the channel uncovered for five minutes; **Show ad** reveals the rest of the break (the
corner chip brings the veil back). Tried and dropped the same day: a see-through veil (the art at 90% opacity, subtracted again so the
model could see; a still picture with the show moving behind it is hard to look at) and a blind veil on a time limit (on the seven
exams 9.9% of the show covered at a 90 s limit, against 2.1% with sight).

## The veil log

Since 0.7.263 (2026-11-07) the extension keeps a record of every video veil over an ad break, as the Prism app keeps its calls.log:
when it went up and came down, the site and the channel, marked or spotted, the break watch's chance and the rule that called it
(learned, marked slot, slot coming, infomercial, ad line, paid programming, inset picture; for a marked veil the service's own signal),
and at the drop the reason and how long it stood. The newest thousand records stay in the extension's storage (`pv:veil-log`, written
by `bg.js` from `video.js`); the panel's **Veil log** row copies them to the clipboard as text, one line a record, or clears them.
Nothing of it leaves the browser.

## The exams' pop-up gate

A veil that comes up on the show and is gone within 20 s is the pop-up a person sees for nothing. Since 2026-11-07 `exam.py` counts
them whole (a cover with no marked ad within 4 s of it, in reviewed time) and `run_exams.py` sums them as **pop-ups**; `--max-short N`
fails the run when a model raises the count past N. A new model must not raise it against the one it replaces. The exams score the
networks' promos as show (`PROMOS=show`, the standing condition since 2026-11-04; `run_exams.py` sets it when the environment does
not), and the extension's models are judged with `NOTEXT=1` (no screen text or QR codes, what a browser extension's recordings lack).

Three exam sets since 2026-11-07, none of them ever trained on (cnn.py and the recipes leave their days out): the **seven exams**
(2026-10-08, hand-marked hours), the **11-04 evening** (the local stations on election night, marked by the doctor's labeller; an odd
evening, kept as a check on its own terms), and the **ordinary evening** (`exams-night.json`: four hours of one weekday evening the
day after, the two YouTube TV windows then on live TV, 27 and 24 breaks, marked by the same labeller on 2026-11-07, its unsure
stretches left out; no promo pass has run on it yet, so a network promo counts as an ad there). A model deploys only when it covers at least as much ad time,
no more show, and no more pop-ups than the one it replaces on the seven exams, and no worse on the two evenings.

## What it costs and what leaves the browser

Nothing leaves the browser: the stream, the frames, the words read, the known ads and the model stay in the extension. No permission
adds an install warning (`tabCapture`, `offscreen`; the extension's pages may run WebAssembly for the text reader). The text reader
costs CPU while it reads. Firefox has neither the tab stream nor the offscreen page: the picture option is shown disabled with the
reason, and its package leaves out the offscreen page, the model, the text reader and the sounds.

## Open

- Judge the spotted veil over an evening against marked breaks, and whether Tesseract's readings serve the app's model (the ext-a
  model, trained without text, is one file away).
- Learned logos and known ads shared through the signed pack (docs/features/break-watch-packs.md), so a fresh install starts with them.
- Other services' stream markers (2026-11-06, Pluto TV looked at first, its playlists only): no SCTE-35, DATERANGE or CUE tags; only a
  discontinuity where one clip gives way to the next. With whole segment paths logged through two breaks the same night, a break does
  show itself: Pluto's own bumper clips are named for it (`..._ad_bumper_animation_dots_normal...` going in at 23:17:20,
  `...adbumperanimationdotsinverted...` coming out at 23:19:48), and between them the playlist ran discontinuities with no segments
  (an anonymous poller was given no ads, so the ad clips' own addresses were not seen). The second break (23:31 to 23:32) showed the
  same gap with no bumper. A Pluto adapter reading the player's playlist could mark breaks from the bumpers and the clip runs. Looked
  at in the browser 2026-11-07 (a real session on pluto.tv, muted): the web player plays DASH, a programme's clip as segments under
  `siloh-ns1.plutotv.net/<n>_pluto/clip/<clip id>/.../dash/`, and the ad clips it is given carry their own mark in their addresses:
  `siloh-ns1.plutotv.net/v1/mp4/.../p(<n>_ad/creative/<creative id>_ad/720p/...)`, one creative after another through the break (three
  breaks in 35 minutes: five creatives of 30 s from 08:00:12, three from 08:19:52, two from 08:33:09; between the creatives Pluto's own
  clips come from the same `v1/mp4` route without the ad mark in their path, so a run of creatives, not the route, is the break). So on Pluto a marked veil needs no bumper reading: the page's own resource timings name the
  clip playing, and an address with `_ad/creative/` is a commercial. The stitcher's manifest (`.../playout/v2/stitch/dash/channel/<id>`)
  did not answer a second fetch from the page, so the periods' own labels were not read. Built in the extension the same day (0.7.268,
  `video.js` plutoStream, a source with `adNow()`): a marked veil from the stream's word, each change dated by the player's buffer lead.
  The first live try never saw the show return (that channel's programme came from a studio's clip folder, not Pluto's own), so since
  0.7.272 any Pluto media segment that is not an ad creative is the show; seen working after that, a veil up on the stream's word and
  down 68 s later as the show came back.
