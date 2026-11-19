# The look-ahead: the big screen a few seconds behind live

*2026-11-17. Asked for 2026-11-06 (a delay for the big screen, so the break watch sees ahead); built 2026-11-17 behind a switch that is
off unless the person turns it on. PRISM for Windows only.*

## What it is

On a YouTube TV live channel the break watch finds a commercial break by reading the picture. Live, it cannot know a break has
begun until a few seconds of it have played, and it cannot know the show is back until a few seconds of the show have played. So
covers start late and stay too long.

With the look-ahead on, the big screen plays the channel about 15 seconds behind live (one press of the player's Back button; 15 was chosen 2026-11-17 from the bench below, where 30 seconds added almost nothing). A second page on the same channel, never
seen and never heard, plays at the live edge. The break watch reads that page. By the time a break reaches the big screen the
watch has already seen its first quarter minute, so the cover goes up where the break began. The end of a cover moves back to the show's return where a black frame marks it or the end finder finds it (both in the app since 2026-11-17); elsewhere it comes down where the watch lifts it, as it does live.

## The rules

- **Off by default.** Watch settings has the switch: *Watch the big screen 15 seconds behind live, so ad covers start on time*
  (`video.lookAhead`).
- **The big screen only.** Small windows stay live.
- **Never sport.** A sports channel is never delayed, nor a game on any channel: the score reaches a phone first. Core decides
  (`look-ahead.ts`): the service's own word for the channel, PRISM's rule on its name, a list of sports channels' names, and the
  programme's title (a sport's name, two sides and "vs.", one side "at" another).
- **Only where the picture is read.** A channel covered in sure breaks only (the service's own marked slots) gains nothing: each
  page is told of a slot at its own place. A channel that is not covered gains nothing. Neither is delayed.
- **Only the page's own buttons.** The big screen goes behind by presses of the player's Back 15 seconds and returns by its
  Forward to live. Nothing is held back or replayed by PRISM: both pictures are the service's own player playing its own stream.
- **The person's own moves win.** A person who presses back to live keeps live until the channel changes. A person more than 45
  seconds behind is watching a recording as far as the cover rule goes (no covers, 2026-11-06), as before.
- **A rewound show frees the stream.** Ten seconds after the big screen is more than 45 seconds behind live the live page is
  closed: it has nothing to give there. It opens again, and the delay comes back, when the big screen is at live again. A show
  started from its beginning never opens one.
- **It backs off.** The live page is a second stream on the account. When it does not play, or stops playing, it is closed, the
  big screen goes back to live and the delay stays off for the session. Turning the switch off and on asks again.
- **The break watch on the big screen goes on reading.** Whenever the plan has no say (the live page just opened, or went quiet)
  the big screen's own reading decides, as it does with the switch off.

## How it works

1. **Core** answers `videoLookAhead(tile)`: may this window's channel be delayed, and what the adapter says of the service
   (`videoLookAhead: { backSec, tooMany }`). `videoScout(tile)` opens the live page: a surface of kind "hidden" named `scout:big`, in
   the App's profile, at the address the big screen is on, muted, 960 by 540, with the service's adapter injected. It is not in the
   scene, never revealed, never in audio focus. `videoScout("")` closes it.
2. **The app's break watch** looks at the live page first in every pass, exactly as it looks at a window: picture, words on the
   screen, captions, sound, the service's own marked slots. It never covers it and never reports it to core. Each look is noted in
   the plan with its time, the chance of a break and whether a cover is up (`LookAheadPlan`).
3. **The delay is measured, not assumed.** Two pages of one channel count time from different starts, so their clocks cannot be
   compared. Their sound can: each page's meter already makes a 32-bit word of its sound every 50 ms, and `LagFinder` lays the big
   screen's words over the live page's at every lag and takes the one where the fewest bits differ (about three in ten for the true
   lag, five in ten for any other). Between such readings each page's own clock carries the measure, and a page that moved in its
   programme has its old words dropped.
4. **The presses.** Once the live page plays and the two pages are measured (they stand two or three seconds apart at live), the
   app presses Back on the big screen until it is about 15 seconds behind (one press, as the pages stand), and checks the measure after. Three failed tries leave
   the channel live.
5. **The covers.** The big screen shows the moment *now less the delay*. The plan answers whether that moment is inside a cover:
   - a cover's start moves back to where the chance first stood above 0.5 before the watch called it;
   - its end moves back to the first black frame in the 10 seconds before the watch lifted it, plus a second (about half the
     ends have one); with no black frame, to the earliest look from which every look up to the lift says the show was back (the
     end finder, `EndFinder`: trained trees over the readings at a look and the looks around it, the careful setting 0.7), plus a
     second; with neither it stays where the watch lifted it. A sure cover keeps its end;
   - a cover the watch lifted again within 15 seconds comes down as soon as that is known (with 15 seconds or more in hand it is
     never shown), unless something sure called it.
   Each uses whatever seconds are in hand. These are the rules the bench measured (`scripts/breakwatch/lookahead.py`, below). The channel's own rules and Not an ad stand over the
   plan: a press of Not an ad on the big screen is told to the live page's reading too.
6. **The plan's first minute.** The watch has no history in its first 50 seconds on a page, so the plan speaks only for what the
   live page saw after them. Until that reaches the big screen, the big screen's own reading decides.

## What the seconds buy (the bench, 2026-11-17)

The seven exams (15 hours of recordings, 11200 s of advertisements, 36185 s of show) replayed through the shipped model and the
watch's own code, then the covers placed as the plan places them with N seconds in hand (`run_exams.py --keep-calls LPARITYDIR=...`,
then `lookahead.py`; promos count as show):

| seconds in hand | ads covered | show wrongly covered | ad seconds missed at a break's start |
|---|---|---|---|
| 0 (live, as today) | 90.1% | 1.57% | 784 |
| 3 | 91.6% | 1.61% | 706 |
| 5 | 92.3% | 1.64% | 645 |
| 10 | 93.2% | 1.64% | 549 |
| 15 | 93.8% | 1.62% | 484 |
| 30 | 94.0% | 1.62% | 520 |

- The gain is at the start of a break, and most of it is there by 15 seconds. From 15 to 30 the starts gain nothing more; what 30
  adds is breaks the watch dropped in the middle (81 s missed at 15, 25 s at 30).
- The ends do not move: about 495 s of show stays covered after a break at every setting. A third rule, the end moved back to where
  the chance fell, was measured and left out: no show time gained, 8 s of advertisements uncovered.
- The wrong cover rises a little (1.57% to 1.62%): a cover that should not have begun now begins a few seconds sooner.
- An estimate, not a live measure: the watch's readings are the live ones, and only the placing of the covers is replayed.

## The end finder, on the recordings (2026-11-17; the black frame rule and the reading that looks both ways at 0.7 are in the app)

Asked 2026-11-17: with seconds in hand a cover should also lift where the show returns. The watch lifts a median of 4 s after the
marked end (76 covers of the seven exams; 6 s on Comedy Central almost every time). When it lifts, the seconds before are searched
for a mark of the return and the cover ends there (`lookahead.py` with `LOOKFEAT=` and `LOOKFIND=`, 15 s in hand, searched 10 s back):

| the end of a cover | ads covered | show wrongly covered | show covered after a break |
|---|---|---|---|
| where the watch lifts it (as built) | 93.8% | 1.62% | 495 s |
| every end 3 s sooner | 93.4% | 1.19% | 343 s |
| every end 5 s sooner | 92.9% | 0.97% | 265 s |
| at the first black frame, plus 1 s | 93.8% | 1.36% | 399 s |
| black frame, else silence, plus 1 s | 93.5% | 1.26% | 366 s |
| black frame, else silence, else a cut, plus 1 s | 93.2% | 1.04% | 288 s |
| the first fall of the chance | 93.7% | 1.62% | 495 s |
| the reading that looks both ways, over 0.7 | 93.6% | 1.22% | 347 s |
| black frame plus 1 s, else that reading over 0.7 | 93.7% | 1.16% | 327 s |
| black frame plus 1 s, else that reading over 0.5 | 93.6% | 1.06% | 290 s |

- The black frame is the one rule that gains show time (96 s) and gives up no ad time to speak of (3 s). About half the ends have one.
- Silence and cuts gain more show and lose ad time: both also fall between two advertisements.
- The reading that looks both ways (`endfinder.py`; in the app as `EndFinder` with `Assets/breakwatch/end-finder.json`, the app's
  scores equal to the script's to 0.0002 over an exam's 3795 looks by `bwtest ENDMODEL=`): trees over the break model's readings at a look and at the
  looks up to 8 before and 5 after it, trained on the twelve labelled days' looks around marked break ends (112288 looks; on two
  days held out it is right for 85.5% of them). After the black frame rule it gives back 109 s more show for 21 s of advertisements
  at 0.5, 72 s for 10 s at 0.7. The thresholds were read on the exams themselves, so the true gain is a little less.
- What is left (corrected 2026-11-18; an earlier line here put 265 s on one CNN cover, which was a hole of 4.5 minutes in the
  recording that the scorer already leaves out). Of the 327 s that stay covered after a break, CNN has 145, spread over ten ends
  of 8 to 21 s, and each of those is the channel's own promo after the last advertisement: the bench counts a promo as show by
  its standing rule, and the watch keeps the cover over it. With promos counted as advertisements about 100 s stay covered after
  a break over the seven exams (CNN 28) and show wrongly covered is about 0.4%. So no further end rule is owed for these.
- Searching further back than 10 s for the return was measured and left out: at 15 s, 10 s more show for 24 s of advertisements.

## What it costs

A second stream of the account (YouTube TV allows three at once on the base plan) and a second decode at a small size. PRISM
never reads the plan from the account pages. `docs/network.md` has the line.

## Where it is

| | |
|---|---|
| the rule of which channel | `packages/core/src/look-ahead.ts`, tests `packages/core/tests/look-ahead.test.ts` |
| the live page | `Orchestrator.videoScout` in `packages/core/src/orchestrator.ts` |
| the covers' timing | `targets/win-host/PrismHost.Core/LookAheadPlan.cs` |
| the end finder | `targets/win-host/PrismHost.Core/EndFinder.cs`, its trees `Assets/breakwatch/end-finder.json`, trained by `scripts/breakwatch/endfinder.py --export` |
| the measure of the delay | `targets/win-host/PrismHost.Core/LagFinder.cs` |
| tests of both | `targets/win-host/PrismHost.Tests/LookAheadTests.cs` |
| the steps, the presses, the back-off | `targets/win-host/PrismHost/MainWindow.LookAhead.cs` |
| the break watch's hooks | `MainWindow.BreakWatch.cs` (the lines that name the look-ahead) |
| the adapter | `prism-adapters/adapters/youtube-tv.json`: `videoLookAhead`, the meter's `off`, the command `seeklive` |
| a test without the mouse | `hub.request`: `lookahead on`, `lookahead off` |

## Read on the live page

2026-11-17, PRISM muted, the Video player, the page's own buttons only:

- The live page plays out of sight (a hidden page that is not a reading page is allowed protected video), its picture is captured
  for the watch, and its sound meter runs.
- ABC News Live and Comedy Central: the two pages stood 2.9 s and 2.3 s apart at live; two presses put the big screen 33.1 s and
  32.4 s behind; the measure by sound and the measure by the clocks agreed to a fifth of a second.
- Comedy Central, all breaks: the live page called the end of a break and the big screen's cover came down 33.2 s later, at the
  same moment of the programme.
- Turning the switch off pressed Forward to live, the big screen returned to live and the live page closed.
- Comedy Central, the big screen pressed two more steps back: the live page closed ten seconds later; back at live it opened
  again and the delay returned. One press of Forward to live in that test did not take, so the app presses it a second time two
  seconds after the first when it returns the big screen.
- With the delay set to 15 seconds (Comedy Central): the pages stood 3.7 s apart at live, one press put the big screen 18.9 s
  behind, and turning the switch off returned it to live. The earlier lines were read when the delay was 30 seconds.

- With the end finder (Comedy Central, the delay 18.5 s): the live page called a break and the big screen's cover came up 15.0 s
  later, 3.5 s earlier in the programme; the live page called the show and the cover came down 14.7 s later, 3.8 s earlier in
  the programme, while the big screen's own reading still said break.

- 2026-11-18, Comedy Central, the delay 17.9 s, three breaks: the plan started the covers 2.0, 4.1 and 2.0 s sooner than the
  watch called them. No end moved: two had no mark of the return and one had the end finder's answer only at the last look
  before the lift. The log now has one line a cover with these numbers.
- The same morning the first live page opened about two minutes from live and no measure came in ten minutes; the option
  turned off and on measured at once. Since then a live page with no measure after two and a half minutes is opened again,
  twice at most on one address (built, not yet seen to act).
- 2026-11-18, a second run of an hour, Comedy Central, the delay 17.8 s, six breaks: the starts came 2.0, 6.1, 0, 0, 0 and 0 s
  sooner than the watch called them, the ends 2.0, 0, 0, 0, 2.2 and 0 s sooner (the end finder moved the two).
- In that run the measure by sound jumped twice inside a break, to 48.0 s for about 20 s and to 29.9 s for about 45 s, and
  came back to 17.8 s each time: the same advertisement played on the two pages at different moments and the sound lined up
  there. The share of differing bits does not tell these from a true measure (38 to 41% against up to 40%). Since then a
  measure more than 1.5 s from what the pages' clocks say is taken only after it has stood for 60 s (`LagClaim`, core);
  smaller corrections are taken at once (built and tested, not yet seen to act).

## Not yet seen

- The service's message for too many streams. Its words are not known, so the adapter has no `tooMany` pattern yet; the back-off
  rests on the live page not playing.
- A person watching through an evening with it on. The picture was never looked at by a person in these tests (the PC was locked):
  whether each cover sits on the break's first frame is still to be judged by eye.
- The delay across a programme with the service's own inserted advertisements, where the two pages may play different ones.
