# Break watch exams

An exam is marked time that no detector has trained on, replayed through each detector and scored against the marks. Every newly marked
stretch is an exam for whatever is live BEFORE it joins the training data - that is how a change is known to have helped. A row is added
here for every exam; a later row that is worse than the one before it is a regression to explain.

How to run one (the replay harness is `scripts/breakwatch/bwtest`, built against the host's own BreakModel / LearnedBreak):

    BENCHROOT=<a folder holding the window's kept frames>  BWDIR=$(python scripts/breakwatch/exam.py --library <day> <from>) \
      LMODEL=<model.json> LVETO=1 LCALLS=<calls.log>  bwtest bench <from HHMMSSmmm> <to HHMMSSmmm> <rules.log>
    python scripts/breakwatch/exam.py --trained scripts/breakwatch/trained.json <day> <window> <from> <to> rules=<rules.log> live=<calls.log>

Rules of the method:

- **The library is the one from before the stretch** (`keep.py` copies it into `golden/<day>/library/<HHMMSS>` at each pass). Replayed with
  the library of the moment, which has since learned those very breaks and that channel's logo, a detector looks better than it was.
- **Only seconds the recording has frames for are scored**, and none the model was trained on (`trained.json`, written at export).
- **Exam hours are marked blind**: end to end, with no suggestions from the model being examined.
- The replay runs the learned detector with the every-rule-says-show veto and nothing else: the dark-scene guard, the ticker's inset rule,
  the infomercial rules and the person's Not an ad are Prism's own and are not in it. It replays at one look a second, the Ad debug
  cadence; without Ad debug a quiet small window is looked at every two.

What is counted. Of the marked ad time: the share covered, and where the rest went (the cover *began late*, *dropped mid-break*,
*lifted early*). Of ALL show time: the share wrongly covered, and whether the cover *stayed on* after a break or came up *on its own* in
the middle of a show. The owner's 0.1% target speaks of covers on their own; the edges are a few seconds a break. The range in brackets is
a 90% interval from resampling the breaks: two detectors whose ranges overlap have not been told apart.

## 2026-10-08 - three stretches marked that afternoon

"Old model": trained on 2026-10-07 (52,906 s), live until 13:59. "New model": 2026-10-07 and 2026-10-08 to 08:32 (104,184 s), live from 13:59
with a cover above 0.85.

| Exam | Detector | Ads covered | Missed: late / mid-break / early | Show wrongly covered | Stayed on / on their own |
|---|---|---|---|---|---|
| **FX**, big screen, 08:33-13:14. 11 breaks, 2,396 ad s, 8,269 show s. Library of 08:33 | hand rules | 86.0% [82-89] | 309 / 0 / 27 s | 1.67% (138 s) | 138 / 0 s |
| | old model | 94.2% [92-96] | 75 / 36 / 29 | 1.51% (125 s) | 51 / 74 s in 9 covers (0.90%) |
| | new model, above 0.85 | 92.9% [91-95] | 135 / 0 / 35 | 0.42% (35 s) | 35 / 0 |
| | new model, above 0.75 | 94.8% [93-96] | 98 / 0 / 27 | 0.44% (36 s) | 36 / 0 |
| **CNN**, small window, 06:37-11:11. 12 breaks, 2,569 ad s, 7,116 show s. Library of 06:34 | hand rules | 77.2% [69-84] | 436 / 71 / 27 (+52 whole) | 7.01% (499 s) | 62 / 128 s in 4 (1.80%); 309 s ahead of a break |
| | old model | 70.5% [61-80] | 331 / 306 / 122 | 0.39% (28 s) | 22 / 6 s in 2 (0.08%) |
| | new model, above 0.85 | 83.5% [78-89] | 236 / 143 / 45 | 0.52% (37 s) | 31 / 6 s in 2 (0.08%) |
| | new model, above 0.75 | 88.6% [84-93] | 158 / 98 / 37 | 0.63% (45 s) | 39 / 6 s in 2 (0.08%) |
| **Comedy Central**, small window, 11:23-13:14 - a channel new to every model, its logo learned at 11:29. 11 breaks, 1,808 ad s, 4,692 show s. Library of 08:33 | hand rules | 74.6% [61-86] | 350 / 56 / 53 | 1.36% (64 s) | 59 / 3 s in 3 (0.06%) |
| | old model | 94.1% [90-97] | 55 / 49 / 2 | 6.91% (324 s) | 119 / 198 s in 7 (4.22%) |
| | new model, above 0.85 | 73.3% [65-81] | 121 / 300 / 62 | 2.32% (109 s) | 78 / 29 s in 2 (0.62%) |
| | new model, above 0.75 | 80.8% [71-88] | 82 / 225 / 41 | 4.24% (199 s) | 124 / 70 s in 5 (1.49%) |
| **The three together** (6,773 ad s, 20,077 show s) | old model | 85.2% | | 2.38% (477 s) | on their own 278 s (1.38%) |
| | new model, above 0.85 | 84.1% | | 0.90% (181 s) | on their own 35 s (0.17%) |
| | new model, above 0.75 | 88.7% | | 1.39% (280 s) | on their own 76 s (0.38%) |

What these rows say. The new model more than halves the show time wrongly covered at either threshold, and nearly removes covers in the
middle of a show on channels it knows. Lowering the threshold to 0.75 is close to free on FX and CNN and costs most on the channel new to
it (wrong covers 109 s to 199 s). On Comedy Central the new model drops the cover mid-break 33-60 s after YouTube TV's own ad slot ends
(6 of its 9 mid-break lifts): it learned from CNN and FX, where the slot comes late in a break, that a slot's end means the break is
nearly over.

### The retrain that followed (same three exams, same pre-exam training seconds)

"Next model" (live from 2026-10-08 15:35): the same marked seconds as the new model plus what was reviewed since inside them (113,446 s), with the rolling inputs over
seconds, one kernel a timer, and WITHOUT the two timers off YouTube TV's ad slot (`since_cue_stop`, `since_cue_predict`). Cover above 0.85.

| Exam | Detector | Ads covered | Missed: late / mid-break / early | Show wrongly covered | Stayed on / on their own |
|---|---|---|---|---|---|
| FX | new model | 92.9% [91-95] | 135 / 0 / 35 | 0.42% (35 s) | 35 / 0 |
| | next model | 95.7% [94-97] | 104 / 0 / 0 | 0.54% (45 s) | 45 / 0 |
| | next model, a look every 2 s while quiet | 95.8% [94-97] | 88 / 13 / 0 | 0.58% (48 s) | 47 / 1 s in 1 |
| CNN | new model | 83.5% [78-89] | 236 / 143 / 45 | 0.52% (37 s) | 31 / 6 s in 2 |
| | next model | 77.7% [72-84] | 185 / 292 / 97 | 0.39% (28 s) | 22 / 6 s in 2 |
| | next model, a look every 2 s while quiet | 78.0% [71-85] | 170 / 298 / 97 | 0.49% (35 s) | 28 / 6 s in 2 |
| Comedy Central | new model | 73.3% [65-80] | 121 / 300 / 62 | 2.32% (109 s) | 78 / 29 s in 2 |
| | next model | 85.7% [77-92] | 101 / 102 / 56 | 1.73% (81 s) | 79 / 0 |
| | next model, a look every 2 s while quiet | 83.1% [75-90] | 111 / 126 / 68 | 1.62% (76 s) | 74 / 0 |
| **The three together** | new model | 84.1% | | 0.90% (181 s) | on their own 35 s (0.17%) |
| | next model | 86.2% | | 0.77% (154 s) | on their own 6 s (0.03%) |

The mid-break drops on Comedy Central fall from 300 s to 102 s and its covers on their own go; CNN loses ad time in the stretch of a break
where the stations' slot sits (its breaks with no slot on record: 09:16, 09:35, 10:29), and the two ranges overlap. Looked at every other
second while quiet, as a small window is without Ad debug, the next model reads about the same.

Tried and dropped: holding the cover after a slot ends until the logo is plainly back at two looks. No ad time gained on any exam, and
on FX the cover stayed on 134 s after breaks against 45 s - the model is quicker to see a show return than the logo rule is.

An earlier cut of this table replayed with the library of 11:50, taken mid-exam: it knew FX's and CNN's morning breaks and Comedy
Central's freshly learned logo, and read 88.1% / 0.62% at 0.85 and 91.7% / 0.73% at 0.75 for the three together. The thresholds were also
tried on these same exams with both the cover and the lift threshold moved, so they are not a clean test of the threshold: the next exam is.

## The cue's two clocks (2026-10-08, live 17:08)

YouTube TV's ad cue was read when the page buffered the data, not when it played: 14 to 31 s ahead of the picture (measured in the
page: the buffer's end at the append less the playhead placed a slot's start at 16:49:09.9, and the player's own ad mark came on at
16:49:10.1). A slot that opens a break therefore covered that much of the show, and the sure rule let go that much before the slot ended.
The page now hands each cue over twice: as read (the learned detector's input, the timing it was trained on) and as it plays (the sure
rule's).

| Replay, live model, cover above 0.80 | Ads covered | Show wrongly covered | Late / mid-break / early | Stayed on / ahead of a break / on their own |
|---|---|---|---|---|
| The three exams, as it ran (one clock, early) | 87.8% | 0.78% (157 s) | 309 / 377 / 143 | 148 / - / 6 s in 2 |
| ... both the rule and the model's input slid 18 s later | 86.9% | 0.77% (155 s) | 338 / 404 / 143 | 148 / - / 6 s in 2 |
| ... two clocks: the rule slid 18 s, the input as recorded | 87.7% | 0.77% (155 s) | 317 / 373 / 143 | 148 / - / 6 s in 2 |
| NBC Sports 00:30-06:34, as it ran (hours the model trained on) | 98.2% | 11.50% (734 s) | 1 / 25 / 21 | 189 / 489 / 56 s in 6 |
| ... two clocks, the rule slid 22 s | 97.4% | 3.39% (216 s) | 53 / 0 / 14 | 149 / 56 / 11 s in 2 |
| NFL Network 00:30-08:32, as it ran (trained on; its unmarked ads read as "on their own") | 94.1% | 17.62% (1781 s) | 41 / 19 / 0 | 60 / 114 / 1607 s in 19 |
| ... two clocks, the rule slid 16 s | 92.1% | 17.59% (1778 s) | 61 / 19 / 0 | 52 / 114 / 1612 s in 17 |

Sliding the model's input with the rule cost 0.9 points of ad time on the exams (the model learned the early clock, and on CNN and FX an
early cue is a true advance word: the seconds before a slot there are already the network's ads), so the input stays on the clock it
was trained on until a retrain on recordings that carry both ("cue" and "cueat" lines; a recording from before has only "cue", and the
replay slides a copy by CUELEAD). The exams' channels keep their slots inside a break and do not move. NBC Sports opens its breaks with
the slot: 489 s of its show covered ahead of a break falls to 56 s with a fixed slide, which over- or undershoots each slot by a few
seconds (the late starts); live, each cue is held by its own measure. The first two live slots: NBC Sports' cue read 17 s ahead, the
cover up 17:12:19.6 against the player's ad mark 17:12:18.8, down 17:14:19.7 against 17:14:19.3; NFL Network's read 21 s ahead, the
slot's start 17:12:34.4 against the mark's 17:12:34.3. A STOP names the piece of the stream a slot ends in, not its end (read at 56.5 s
of a 61 s slot): the sure rule now runs the slot out.

### NBC Sports Network 15:00-16:00, marked blind (2026-10-08): the first exam on a channel whose slots open the break

4 breaks, 568 ad s, 2,990 show s; library of 14:57. The blind marks first held three breaks: the fourth (15:40:52-15:43:19) was found
because every detector covered it and the stream's cue marked a slot there, and the person marked it on seeing the frames.

| Detector | Ads covered | Missed: late / mid-break / early | Show wrongly covered | Stayed on / ahead of a break / on their own |
|---|---|---|---|---|
| Prism as it ran that hour | 99.1% [98-100] | 0 / 0 / 5 | 2.91% (87 s) [2.5-3.5] | 9 / 78 / 0 |
| live model, one clock (the replay of the same) | 99.5% [99-100] | 0 / 0 / 3 | 3.04% (91 s) [2.5-3.5] | 13 / 78 / 0 |
| live model, two clocks (the rule slid 22 s) | 98.2% [97-99] | 7 / 0 / 3 | 1.00% (30 s) [0.6-1.2] | 16 / 14 / 0 |
| ... and the standing ad line's hold | 98.2% | 7 / 0 / 3 | 1.00% (30 s) | 16 / 14 / 0 |

The cover over the show ahead of a break goes from 78 s to 14 s, the ranges apart; 7 s of ad time are lost to late starts, which is
the fixed slide undershooting a slot (live, each cue is held by its own measure). No cover on its own in the hour.

## The standing ad line (2026-10-08, live 19:51)

The CNN exam's largest loss was the cover let go in the middle of long call-now ads (a Medicare supplement 100 s, a car warranty 70 s,
replacement windows 95 s: slow, talkative, one banner). Each keeps a phone number on screen throughout. Rule: one phone number read three
times over six seconds, the last within twelve, with the channel's logo plainly away, keeps a cover that is up or was within twenty
seconds; a web address so read carries the hold for 45 s after a number stood (the reader loses the number for a quarter of a minute at a
time); the channel's own address never counts. It never starts a break's cover.

| Replay, live model, two clocks | Ads covered | Show wrongly covered | Late / mid-break / early |
|---|---|---|---|
| The three exams, without | 87.7% | 0.77% (155 s) | 317 / 373 / 143 |
| ... with a number alone, held only while the cover is up | 89.2% | 0.77% (155 s) | 317 / 296 / 118 |
| ... with the rule as it is | 90.3% | 0.77% (155 s) | 317 / 253 / 85 |
| CNN alone, without / with | 80.0% / 86.9% | 30 s / 30 s | mid-break 267 / 147 |
| NBC Sports 15:00-16:00 (blind), without / with | 98.2% / 98.2% | 30 s / 30 s | |
| Every marked hour of both days (ten window-days, one paired pass), without / with | 78.6% / 80.1% | 5,086 s / 5,129 s | |

The two-day pass reads both settings out of one run on a library copy (LCALLS and LCALLS0): two runs against the live library differ by
themselves, and a first comparison showed a channel losing cover to a rule that can only add it. Its 43 s of added "wrong" cover are 37 s
of a walk-in tub's ad with its number up (CNN 05:30:28, in time marked as show) and 6 s of edges. A first cut that let a web address hold
by itself added 218 s, a minute of it real: a news banner's own address ("CNN.COM/ABBY", 03:59) with the overnight repeat's logo read as
away. The ad time gained over the two days is mostly paid programming overnight (HGTV, AMC), which the guide's rule also covers live.

### Food Network 15:00-16:00, marked blind (2026-10-08)

4 breaks, 1,040 ad s, 2,521 show s; library of 14:57. Two break ends were moved after the frames were read: the 15:24 break ran on to
15:29:16 (an ad and a "we'll be right back" slate past the mark's 15:28:42), and the 15:35 break to 15:39:22, the channel's own promos
counted in ("It's hard for us to track promo vs ad so I say cover them all"). As first marked the same replay read 95.8% and 2.59%
(67 s): most of that "wrong" cover was the detector right about where the break ended.

| Detector | Ads covered | Missed: late / mid-break / early | Show wrongly covered | Stayed on / ahead of a break / on their own |
|---|---|---|---|---|
| Prism as it ran that hour (the model before, then at 0.85) | 85.5% [78-93] | 106 / 16 / 29 | 0.40% (10 s) [0.1-0.7] | 10 / 0 / 0 |
| live model, one clock | 93.4% [90-97] | 41 / 0 / 28 | 0.71% (18 s) [0.2-1.1] | 18 / 0 / 0 |
| live model, two clocks (the rule slid 15 s) | 94.8% [92-98] | 41 / 0 / 13 | 0.71% (18 s) [0.2-1.1] | 18 / 0 / 0 |
| ... and the standing ad line's hold | 94.8% | 41 / 0 / 13 | 0.71% (18 s) | 18 / 0 / 0 |

Nothing missed whole, nothing dropped mid-break, no cover on its own. What is left is the edges: the cover begins a median 8 s into a
break (41 s of the hour's 54 missed) and stays 5 s after it. The two clocks take 15 s off the early lifts: the slot that closes the
15:24 break is held to its own end.

### Where the live detector stands on five blind channels (2026-10-08 evening)

| Exam | Ads covered | Show wrongly covered |
|---|---|---|
| FX | 96.6% | 0.54% (45 s) |
| CNN | 86.9% | 0.42% (30 s) |
| Comedy Central | 86.8% | 1.71% (80 s) |
| NBC Sports Network | 98.2% | 1.00% (30 s) |
| Food Network | 94.8% | 0.71% (18 s) |
| **All five** (8,381 ad s, 25,588 show s) | **91.4%** | **0.79% (203 s)** |

### Comedy Central 13:14-16:00, marked blind (2026-10-08): the weakest channel, and three marks read again

17 breaks, 2,891 ad s, 6,900 show s; library of 11:50. As first marked (14 breaks) the live detector read 82.6% and 4.57% (326 s), 264 s
of it "covers on their own". The frames said otherwise, and the marks were changed with the person's leave:
- two breaks had no mark (14:31:05-14:33:49, 15:31:47-15:34:27): the channel runs a break, the episode's closing scene under its credits
  and the next episode's opening (some 95 s of show), then a second break, and the second was missed;
- one mark ran 14:57:40-15:04:45 across that same stretch of show (14:59:48-15:01:27, credits and the next opening): split in two. The
  detector had let go of it there, which read as 150 s "dropped mid-break".
Both kinds of slip flatter or hurt a detector only where it and the marks disagree, which is where they were looked for; a break both
missed would not have been found this way (every cue slot in the stretch does sit inside a marked break).

| Detector | Ads covered | Missed: late / mid-break / early | Show wrongly covered | Stayed on / ahead of a break / on their own |
|---|---|---|---|---|
| Prism as it ran those hours | 78.1% [69-86] | 348 / 161 / 31, and one break missed whole (92 s) | 0.99% (68 s) [0.8-1.2] | 67 / 1 / 0 |
| live model, one clock | 85.2% [79-91] | 263 / 76 / 89 | 1.04% (72 s) [0.8-1.3] | 72 / 0 / 0 |
| live model, two clocks, the ad line's hold | 84.9% [79-90] | 264 / 83 / 89 | 1.04% (72 s) [0.8-1.3] | 72 / 0 / 0 |

Late starts are 60% of what is missed: the cover begins a median 15 s into a break here, against 8 s on Food Network and 0-1 s on
NBC Sports. Neither of the day's two rules moves this channel.

### Where the live detector stands on five blind channels, six exams (2026-10-08 night)

| Exam | Ads covered | Show wrongly covered |
|---|---|---|
| FX 08:33-13:14 | 96.6% | 0.54% (45 s) |
| CNN 06:37-11:11 | 86.9% | 0.42% (30 s) |
| Comedy Central 11:23-13:14 | 86.8% | 1.71% (80 s) |
| Comedy Central 13:14-16:00 | 84.9% | 1.04% (72 s) |
| NBC Sports Network 15:00-16:00 | 98.2% | 1.00% (30 s) |
| Food Network 15:00-16:00 | 94.8% | 0.71% (18 s) |
| **All six** (11,272 ad s, 32,488 show s) | **89.8%** | **0.85% (275 s)** |

### Late starts: what was looked at (2026-10-08 night)

The cover begins 8 to 15 s into a break on every channel but NBC Sports, whose breaks open with a marked slot. Second by second on
Comedy Central's seventeen starts (scratch `starts.py`), the learned score climbs with the seconds since the logo was last up and passes
0.80 at 5 to 29 s; a black frame at the cut brings it there sooner where there is one. Comedy Central's logo comes and goes in the show
itself, so "the logo is away" says little for the first ten seconds.

Tried and dropped, on the marks alone: a short silence as the mark of a break's first second (the plan's first idea for the start).
Within 2 s of a marked start there is a silence at 0% to 45% of breaks by exam (15 of 59 in all), and silences come 40 to 220 times an
hour in the show itself. It is no evidence.

Not yet tried: a judgement of the picture itself. A person knows an ad within a second or two by what it shows; none of the 48 inputs
looks at what a frame shows, only at whether the logo is there, how it changes, and what is written on it. 380,000 kept frames carry
marks or sit beside them.

## The picture study (2026-10-08 night): does a model that looks at the frame itself shorten the late starts? No

Asked because none of the 48 inputs looks at what a frame shows. 101,611 marked frames of eight channels to learn from (the seconds the
live trees were trained on, NFL Network left out), 39,067 exam frames of five channels to judge by, two of them (Comedy Central, Food
Network) never seen in training. Every training frame was scored by a model that never saw its channel; no exam frame trained anything.
Scripts: `scripts/breakwatch/pic/` (picdata, pictrain, picembed), `train2.py --pic --exams`, `exams.json`.

**A frame alone: is it an ad?** (AUC: 0.5 is a guess, 1.0 is right every time)

| Model | Numbers | Training channels, each unseen | The six exams | Worst |
|---|---|---|---|---|
| A small network trained from nothing (5 layers, 160x90) | 0.2 M | 0.70 | 0.71 | HGTV 0.46, NBC Sports' exam 0.42 |
| ... the logo's corners blacked out | 0.2 M | 0.70 | 0.73 | HGTV 0.45, NBC Sports' exam 0.36 |
| MobileNetV3-small, trained on a million pictures, a plain classifier on top | 2.5 M | 0.68 | 0.75 | CNN 0.40, Comedy Central am 0.43 |
| ResNet-18, the same way | 11 M | 0.67 | 0.72 | CNN 0.36, Comedy Central am 0.32 |
| CLIP ViT-B/32, the same way | 88 M | 0.89 | 0.91 | Comedy Central am 0.73 |

The small ones learn the shows they were given, not what an ad looks like: on a channel they have not seen they are near a guess, and on
some they rank the show above its ads. Masking the logo changes nothing, so it is not the logo they lean on. CLIP does see it.

**CLIP's score as inputs to the trees** (the frame's score and its mean over 3 s and 8 s; the trees alone in Python, none of Prism's sure
rules, so these shares are not the exam table's):

| Trees | Ads covered | Show wrongly covered | Cover begins (median over 58 breaks) |
|---|---|---|---|
| as live, cover above 0.80 | 93.0% | 0.89% (249 s) | 7.6 s into a break |
| with the picture, above 0.80 | 92.8% | 0.71% (199 s) | 7.7 s |
| as live, above 0.85 | 91.1% | 0.73% (204 s) | |
| with the picture, above 0.75 | 93.3% | 0.76% (214 s) | |

A fifth fewer wrongly covered seconds at the same ad time, or two points more ad time at the same wrong cover. The start does not move.
Why: at a break's edge the picture is not evidence. The show's last 12 s before a break score 0.43 on average (45% of those frames
above 0.5: teasers, bumpers, the act's last shot), a break's first 5 s score 0.73, and the two are told apart at AUC 0.74; away from any
break 29% of the show's frames score above 0.5.

**So:** not built. The only model that sees an ad is forty times too large to run every second on a person's PC, what it buys is a
fifth of the wrong cover, and it does nothing for the late start it was tried for. A break's first seconds are not knowable from the
frame, the logo, the sound or the words at the moment they play; they are knowable a few seconds later.

**Prism first:** the study's first evening halved the live break watch's looks (57 a minute a window to 27) by reading frames, replaying
a day and training on the windows' graphics card at once. Study steps now wait while Prism lags (`pic/gentle.py`), one at a time, and
the hourly check reads the look rate.

## The look-ahead, simulated (2026-10-09): what knowing a few seconds early would buy

The idea: the visible picture held D seconds behind a hidden copy of the same channel, so every decision of the detector is known D
seconds before it has to be shown. Simulated on the six exams with the trees as live (the trees alone in Python, none of Prism's sure
rules; `train2.py --exams`, `ahead()`): the same scores and threshold, the covers placed with D seconds of hindsight - a gap of D
seconds or less inside a cover is closed, a cover of 8 s or less is not drawn, a cover begins where its score began to climb and ends
where it began to fall, each at the cut there.

| Hindsight | Ads covered | Show wrongly covered | Cover begins (median) | Stays on after (median) |
|---|---|---|---|---|
| none (as live) | 93.2% | 0.87% (244 s) | 7.6 s into a break | 6 s |
| 10 s, the end placed cautiously | 96.2% | 0.90% (251 s) | 2.1 s | 5 s |
| 20 s, the end placed cautiously | 96.9% | 0.91% (255 s) | 1.7 s | 5 s |
| 30 s, the end placed cautiously | 97.3% | 0.91% (255 s) | 1.7 s | 5 s |
| 20 s, the end where the score left 0.9 | 95.4% | 0.61% (171 s) | 2.4 s | 2 s |
| 20 s, begun from 0.15, the end where the score left 0.9 | 96.4% | 0.71% (200 s) | 1.0 s | 2 s |

Both edges move: three to four points more ad time at the same wrong cover, or two points more with a third less of it. Ten seconds
buys most of it. The placing rules are the first tried and crude; what is left of the wrong cover is mostly Comedy Central's (150 of
the 171 to 255 s), which is not an edge. Not yet looked at: whether two copies of a channel can be lined up and one held behind the
other by the page's own controls alone, and what the hidden copy costs.

*Decision (2026-10-09), the owner on a second copy of a channel playing ahead:* "I don't think the multi stream idea is a good one. Will
hurt functionality" (and before it: "A lot of services won't be okay with more than one stream"). Not built, not to be proposed again.
One stream cannot do it by itself: the 26-34 s a window holds ahead of the picture is encrypted, and Prism holds no picture to show
late. What one stream does hand over early is what the service leaves unprotected, its own ad-slot markers, read 11-31 s ahead.

## One stream's own look-ahead: a slot known to be coming (2026-10-09)

The page reads a marked slot 11-31 s before it plays, and its announcement up to 15 s before that. For those seconds a slot is known to
be coming, so the break is not over: a cover that is up (or was within twenty seconds) stays until the slot arrives. It never starts a
cover. All six exams, live model, cover above 0.80, both of the day before's rules on:

| | Ads covered | Show wrongly covered | Late / mid-break / early |
|---|---|---|---|
| without | 89.8% | 0.85% (275 s) | 629 / 336 / 190 |
| a coming slot keeps the cover | 90.1% | 0.85% (275 s) | 629 / 298 / 190 |

38 s of mid-break drops closed (Comedy Central's afternoon 83 to 60 s, CNN 147 to 137, Comedy Central's midday 94 to 89) and nothing
added. Small, and free. The late starts (629 of the 1,117 missed seconds) are what it cannot reach.

### Covers that stay on after a break: two things tried, neither kept (2026-10-09)

254 s of the six exams' 275 wrongly covered seconds are covers staying on after a break, a median 5 s each.

| Tried | Ads covered | Show wrongly covered | Mid-break / early |
|---|---|---|---|
| as it is: the cover ends below 0.55 | 90.1% | 0.85% (275 s) | 298 / 190 |
| ends below 0.65 | 88.9% | 0.73% (238 s) | 381 / 243 |
| ends below 0.75 | 87.3% | 0.65% (211 s) | 548 / 251 |
| ends at once when every rule says the show is on (PlainShow) at 1, 2 or 3 looks running | 90.1% | 0.85% (275 s) | 298 / 190 |

A looser hold gives up four to five seconds of ad time for each second of wrong cover it saves, in covers dropped mid-break. And the
rules' "the show is on" never comes before the score has already let go: not one second changes, even at a single look. The seconds
that linger are the ones in which the show is back and its logo is not yet.

### Comedy Central, read break by break: it is a channel the model has never seen (2026-10-09)

`exam_timeline.py` lists each marked break with the seconds the replay left uncovered; `frames_sheet.py` shows what was on screen there.
Every uncovered stretch looked at was an ad or a promo (none a marking slip). Three things stand out:

- **No Comedy Central second is in the training set.** `trained.json` holds nine channels; Comedy Central (`H0MU1D4aWjk`, on the
  window from 11:11 on 2026-10-08) is not one of them. Both of its exams are the model on a channel new to it, and its rows (86-87% of
  ads, 1.0-1.7% of show) are that number, not a fault to patch. Its recordings from 16:00 on 2026-10-08 to 08:37 on 2026-10-09 are
  unmarked: two or three hours of them marked for training is the next step for this channel.
- **Starts 30 s and more late** (14:01:14, 14:31:05, 15:01:28): the break opens on a CBS or Paramount+ promo, the hand rules pass 90%
  in twelve seconds, and the learned score sits near 0.1 for twenty seconds and passes 0.80 at 35-40 s. The programme is stand-up on a
  dark stage where the logo often cannot be read, so "logo unread for twenty seconds" is no evidence to the model there.
- **Dropped mid-break when a captioned ad follows uncaptioned ones** (11:26:42 at 0.49, 12:20:26 at 0.54, the rules at 99% and the ad's
  own words read three seconds before): the score falls in the very look a caption line arrives.

Tried on the last, in the harness only (`CCBLIND`): a caption line is not shown to the model while a cover is up.

| Tried | Ads covered | Show wrongly covered | Late / mid-break / early |
|---|---|---|---|
| as it is | 90.1% | 0.85% (275 s) | 629 / 298 / 190 |
| captions hidden under a cover while the logo is known and not plainly up (CCBLIND=1) | 90.7% | 0.95% (308 s) | 629 / 262 / 161 |
| ... while the channel has no logo learned (CCBLIND=3) | 90.0% | 0.85% (276 s) | 629 / 285 / 213 |
| ... whenever the logo is not plainly up (CCBLIND=2) | 90.6% | 0.95% (309 s) | 629 / 249 / 184 |

Not kept: 0.6 points of ad time for 33 s more wrong cover (CNN 30 to 43 s, FX 45 to 56, Food Network 18 to 30) is the wrong trade for a
target that weighs wrong covers first, and Comedy Central itself barely moves (hidden, the score falls a few seconds later on its other
inputs). An input masked at run time is a model fed something it never trained on; the fix for a channel it has not seen is to show it
the channel.

### A paid programme's own card (2026-10-09, B-363)

Food Network 05:30-06:00 on 2026-10-09 was a paid programme the guide did not name; live it was covered in pieces, about 17 of 30
minutes. "The following is a paid program" on the screen now covers to the end of its half hour (harness switch `PAIDCARD=0` replays
without). Replayed 05:15-06:10 with the library copy from 05:08: 272 of the half hour's 1,765 s covered without the rule, all 1,765
with it, in one cover. The six exams do not move (no card in them). "A paid advertisement" was left out on purpose: a law firm's
spot inside ordinary breaks says it.

### Comedy Central joins the training set: model v4 (2026-10-09)

Eight hours of Comedy Central (2026-10-08 16:00-24:00, 47 breaks, marked 2026-10-09 with Prism's covers shown; two breaks the marks
missed were added from the frames and two zero-length marks removed) added to the shipped model's training list. Only that stretch was
replayed for its inputs (15:50-24:00 on its window, with the library copy from 15:59) and appended to the day's feature file. Trained
with `train2.py --only <list> --inset-ads "NFL Network" --no-eval --export`: 139,239 marked seconds (113,446 before), ten channels.
The two Comedy Central exams stay out of training.

| Six exams, replayed through Prism's code | Ads covered | Show wrongly covered | Late / mid-break / early |
|---|---|---|---|
| shipped v3 (cover 0.80, lift 0.55) | 90.1% | 0.85% (275 s) | 629 / 298 / 190 |
| same recipe and list as v3, trained again today (a control) | 91.5% | 0.92% (300 s) | 561 / 211 / 183 |
| with Comedy Central, 0.80 / 0.55 | 93.5% | 0.94% (307 s) | 457 / 167 / 105 |
| with Comedy Central, 0.85 / 0.55 | 92.7% | 0.89% (290 s) | 561 / 137 / 129 |
| **with Comedy Central, 0.80 / 0.60 (deployed)** | **93.4%** | **0.88% (286 s)** | 457 / 182 / 105 |

By exam at the deployed setting: FX 97.0% / 29 s, CNN 92.3% / 37 s, Comedy Central midday 89.4% / 95 s, Comedy Central afternoon
91.8% / 82 s, NBC Sports 98.4% / 29 s, Food Network 96.5% / 14 s. Against v3: 3.3 points more ad time for 11 s more wrong cover; late
starts fall from 629 to 457 s. Comedy Central's afternoon gains six points, its midday two; its wrong cover does not improve (the
midday exam's goes from 80 to 95 s), and CNN's goes from 30 to 37 s while FX's falls from 45 to 29. The control shows part of the gain
(1.4 points, with 25 s more wrong cover) comes from retraining on today's corrected marks alone. Parity with Python on the new stretch:
99.93% of 26,900 looks within 0.001.

### NBC Sports, the evening of 2026-10-08: a seventh exam, and a retrain that is not kept (2026-10-10)

The whole evening on NBC Sports Network was marked (16:06-24:00: two talk shows, a college hockey game, a WNBA playoff game; 20:00-21:00
blind, the rest with Prism's covers shown). Scored against the live model (v4) before anything was trained on it, the first pass read
99.2% of ad time and 4.77% of show wrongly covered, 745 s of it in fifteen covers "on their own". The frames said otherwise: seven of
those covers were whole breaks the marks had skipped (16:59, 17:41, 19:03, 19:29, 20:46 - inside the blind hour -, 22:47, 23:03; about
620 s of ads). They were added to the marks from the frames, to the second, and two zero-length marks removed (the marks as they were are
kept as labels.before-nbc-sports-evening-fixes-2026-10-10.json). A two-minute University of Notre Dame feature shown inside the hockey
broadcast before the 20:46 break, with the network's bug on it, is left as show.

With the marks corrected, v4 on the three stretches: 99.0% of 4,794 ad seconds covered, 2.28% of show wrongly covered (536 s of 23,461:
358 s staying on after a break, 88 s ahead of one, 90 s in eight covers on their own). The blind hour alone: 100.0% / 17 s. It joins
exams.json as "NBC Sports evening" (library copy 19:31:59), so there are seven exams from here on.

The other 6.9 hours (16:06-20:00 and 21:00-24:00) were then added to v4's training list the light way (only that window replayed,
15:55-24:00, with the library copy from 15:59): 161,251 marked seconds against 139,237.

| Seven exams, replayed through Prism's code, cover 0.80 / lift 0.60 | Ads covered | Show wrongly covered | Late / mid-break / early |
|---|---|---|---|
| **shipped v4 (stays live)** | **93.7%** | **0.85% (302 s)** | 457 / 182 / 105 |
| v4's own list, trained again (a control) | 93.6% | 0.84% (301 s) | 469 / 145 / 139 |
| with the NBC Sports evening | 93.3% | 0.91% (325 s) | 475 / 195 / 113 |

Not kept. The new model is a little better on the two NBC Sports exams (wrong cover 28 to 25 s and 17 to 9 s) and a little worse on the
others (FX's wrong cover 29 to 46 s, Food Network's ad time 96.5% to 94.4%, Comedy Central midday 95 to 108 s). The channel was already
the detector's best (98-100% of ad time); six more hours of it teach the model nothing it lacked and tilt it a little toward that
channel. What the stretch does show is where v4 is weakest on live sport: staying on after a break (358 of the 536 wrong seconds), and
that the marks themselves miss breaks - seven in eight hours, all of them short ones between a show's segments. Marking time is better
spent on channels the detector has never been trained on (Big Ten Network, Animal Planet, both recorded all day on 2026-10-09).
