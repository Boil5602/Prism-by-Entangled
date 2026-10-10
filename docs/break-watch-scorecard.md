# Break watch scorecard

The YouTube TV break watch's errors, kept over time (2026-10-07, "I want to keep track of false neg/pos times. That's very important to
me"). Two kinds of error, and the targets the household set:

- **show time wrongly covered** (a false positive: the show, its credits, its rating card or its own banner under a cover), target under
  0.1%, and wrong covers outweigh missed ad seconds;
- **ad time not covered** (a false negative: an ad, or a network's promo for its own shows, playing uncovered), target 99%+ covered.
  *Decision (2026-10-08, asked again over Food Network's promos between its last ad and the show):* "It's hard for us to track promo vs ad so I say cover them all." A break is marked, and scored, to the last frame before the show is back, the channel's own promos included.

## Measured passes (the truth)

Every second of every YouTube TV window labelled by eye from the bench recording (frames each second with Ad debug on), then scored against
the break watch's calls in host.log: `scripts/breakwatch/marked.py <window> <from> <to> 4` makes the marked contact sheets (run from a folder with a sheets/
subfolder; SINCE=<hhmmss> of the last restart), the labels go in a pass file (scripts/breakwatch/passes/), and
`scripts/breakwatch/rates.py <pass>.json` scores it. A neutral stretch (a frame that could be either) counts for neither side. Passes 0-12 were on 2026-10-06 (evening), M1-M3 on the morning of 2026-10-07;

| Pass | Time | Ad time covered | Show time wrongly covered | Notes |
|---|---|---|---|---|
| 0 | 17:42-17:53 | 96% (560/582 s) | 23% (418/1804 s); 1% without AMC | AMC showed no logo through Thirteen Ghosts: fixed (logo set aside) |
| 1 | 18:34-18:44 | 96% (488/506 s) | 0.3% (8/2370 s) | 5 windows, 3 breaks; covers 0-10 s into a break, lifts within 8 s of the show |
| 2 | 18:44-18:54 | 97% (792/820 s) | 0.2% (4/2266 s) | 5 breaks, each covered 3-14 s in; FX's rating card ended its break on the dot. Then: cover after 4 s, not 6, and re-cover at once inside a break (live 18:54:40) |
| 3 | 18:55-19:05 | 96% (662/692 s) | 1.9% (40/2084 s) | Bad: FX's promo banners over its logo covered the film 3 times (8-10 s), C-SPAN2's harvard.edu read as an ad. Fixed (live 19:11 and 19:18): logo alone waits 10 s, words/QR cover at once but only with the logo absent, .edu/.gov dropped; a look a second. Replayed: 0.1% |
| 4 | 19:17-19:27 | 93% (662/714 s) | 0.8% (18/2174 s) | FX's rating card ended a break and the quick re-cover covered the film 16 s; breaks covered 4-15 s in. Fixed (live 19:3x): the show's card cancels the re-cover; a logo lost at a hard cut waits 3 s |
| 5 | 19:33-19:43 | 96% (768/798 s) | 0.7% (14/2086 s) | All 14 s: FX's film opening (no logo yet) after its rating card, covered by the hard-cut rule. Fixed (live 19:4x): 90 s after the show's card only ad words/QR can cover. Without it: 0.0% |
| 6 | 19:47-19:55 | 95% (412/434 s) | 1.0% (14/1440 s) | FX again: the rating card's quick re-cover (order bug, fixed 20:01). FOX 8 froze on one ad frame 7 min (freeze detection added 20:10). Captions + sound level added 20:10 |
| 7 | 21:26-21:36 | 83% (470/568 s); known channels 99.6% (378/380 s) | 0.2% (4/1696 s); known channels 0% | Fingerprints live: FX and AMC breaks covered 0-1 s in, nothing wrong. Adult Swim new (logo not learned for 9 min): half its ads, and a 4 s cover from "zillow.com" said in Family Guy. Fixed: captions weak, show words veto |
| 8 | 21:52-22:04 | 96% (362/376 s) | 0.4% (10/2422 s) | Adult Swim's break covered from its first second (known ads); the cover lingered 9 s as the show returned. FX's break start 14 s late (a promo in the logo corner). Fixed: logo back twice = uncover at once |
| 9 | 22:09-22:20 | ~97% | ~2% (FX film opening 40 s; Adult Swim return 9 s) | "$9" in FX's credits read as an ad, then the film's logo-less opening held the cover. Fixed: covers need an ad's word every 60 s, credits never covered by the logo alone, prices need cents |
| 10 | 22:28-22:39 | - | ~25% (C-SPAN2 covered ~10 min: its promos and the Supreme Court argument) | Fingerprint feedback loop on a channel whose logo was set aside. Fixed 22:43: known ads need a trusted logo, the library learns only from ads' words; bad prints removed |
| 11 | 22:43-22:54 | ~95% | ~0.05% (1 s: Adult Swim's show return) | First pass on the strict rules: C-SPAN2 untouched, FX/AMC/Adult Swim breaks covered. FX's cover flapped on and off near a break's end. Fixed: 8 s settle inside confirmed breaks |
| 12 | 23:03-23:13 | ~95% | ~0.8% (FX film's return 17 s: its TV-14 card matched a learned ad picture) | No flapping. Fixed: pictures learned only 20 s before a break's end; no known-ad re-cover 30 s after a break |
| M1 | 07:01-07:11 | 77% live; 90% replayed with fixes | 0.8% live; 0.3% replayed with fixes | USA, TBS, HGTV, FX, TLC. FX movie phone number, dark ad read as credits, TLC snipe. Fixed 07:2x |
| M2 | 07:19-07:29 | 72% live; 79% replayed with fixes | 1.6% live; 0.6% replayed with fixes | TLC promo snipe 20 s; USA/TBS covers lifted mid-break (stale rule). Fixed 07:36: logo-only waits 30 s, stale only near edges; 07:48: faint logo corners give no evidence |
| M3 | 07:49-07:59 | 77% | 1.9% (TLC's return 22 s with no logo or words; TBS/HGTV return lags) | TBS lost its cover near the hour (end edge 150 s, now 75 s). A show-picture match for returns tried on the bench: no gain, dropped |
| M4 | 2026-10-07 12:45-13:05 | 86% (1398/1626 s) | 2.0% (88/4364 s) | TBS, FX, TLC, USA, HGTV. Wrong: show returns with a faint logo (TBS 12 s, 8 s; TLC 22 s; HGTV 8 s), the show's own graphics (TBS's Friends banner, the Warner Bros. card), FX's rating card 3 s. Missed: networks' promos for their own shows carrying their logo (USA 31 s and 68 s, TBS's break opening 60 s), Coca-Cola at a break start (TBS 40 s). Seen: HGTV's L-bar promo band around the show (a partial-screen ad, not covered) |

## Between passes (the count)

`python scripts/breakwatch/scorecard.py [YYYY-MM-DD]` totals each hour of a day from this PC's own files:

- the person's reports (Ad debug, the cover's Not an ad): wrong covers with how long they had been up, late covers with how late, ads
  missed for 15 s or more. A person's timing is within a few seconds, never exact;
- the watch disagreeing with itself: a cover that dropped for under 15 s and came back (ad time let through), and a cover of under 10 s
  (almost always wrong). A restart drops every cover and is not counted as a gap.

Neither is the truth; a rising count between passes is the sign to measure again.

## The answer key (2026-10-07)

The hindsight labeller is not good enough to score by (on TBS's game it missed real breaks and counted them as wrong covers), so a
person marks the truth. A recording is kept out of the bench's one-hour pruning in `diagnostics/golden/<day>` (each window's frames
and events.log, and `calls.log`, Prism's own covers), and `python scripts/breakwatch/label-ui.py` serves a marking page on
127.0.0.1:8472: a click on a break's first frame and one on its last mark it; the network's own promos inside a break are part of it,
a banner over the show and a rating card are the show; "not sure" marks are left out of the score. The marks land in
`labels.json` beside the recording, in the format `rates.py` reads (`LOGF=<golden>/calls.log python rates.py <golden>/labels.json`);
every change to the break watch is replayed against the marked hours before it goes live.

### The first answer key (marked 2026-10-07 evening)

Five YouTube TV channels from 15:00 to 18:25 marked by hand, break by break: 58 breaks, 2.6 h of ads, 8 h of shows. Scored on a
replay of the kept recording (the live column is pulled down by restarts and by the hours the live log does not reach):

| Rules | Ads covered | Show wrongly covered |
|---|---|---|
| live, as it ran | 67% | 3.4% |
| 0.26.28 (0ffe6c09) | 79.4% | 3.67% |
| bc5effa+ (badge, banners, furniture) | 77.7% | 2.75% |

Per channel at the latter: FX 86% / 0.6%, TLC 79% / 2.6%, USA 87% / 1.9%, TBS (baseball) 46% / 6.9%, HGTV 75% / 3.2%. A change
ships only when this score improves.

## A channel's covers: On, Sure breaks only, Off (2026-10-10)

"A right click channel settings menu, for live stations, with the ability to disable the ad veils. And maybe something under settings
for disabling ad veils for live channels if false positives exceed a certain threshold." - "I like your on, sure breaks, off idea."

- **Where.** Right-click a YouTube TV channel in Live: under the windows it can go to, "Ad covers on <channel>" with the three choices.
  Watch settings lists the channels that are not On (a chip each, pressed to put the channel back) and holds the threshold.
- **On.** Every break the watch finds, as before.
- **Sure breaks only.** The cover is up only for what does not guess: YouTube TV's own marked ad slot as it plays (and one known to be
  coming while a cover is up), and a paid programme the guide or the screen names. The watch still reads the picture and learns on
  that channel; when it finds a break it does not cover, host.log says so once. It will not cover the show by mistake, and it misses
  every break YouTube TV does not mark.
- **Off.** Never covered (the list the cover card's "Never cover <channel>" has always written, `video.breakWatchOff`).
- **The threshold.** Prism only knows a cover was wrong when it is told, so the count is of Not an ad presses: three on one channel in
  seven days (two, five or never, in Watch settings; `video.breakWatchAutoSure`) move that channel from On to Sure breaks only. The
  status line says so when it happens, and the channel's menu or Watch settings put it back. It never moves a channel to Off.
- **Kept** in host-prefs.json by channel name: `video.breakWatchOff`, `video.breakWatchSure`, the week's presses in
  `video.breakWatchNotAd`. Code: `ChannelCovers`, `SetChannelMode`, `NotAdCounted` (MainWindow.BreakWatch.cs), `LiveMenu` (MainWindow.Live.cs).
