# Roadmap — what is deferred, and why

Decisions and ideas the household's walkthroughs produced that are not being built now. Each line says what was asked, what was
decided, and what it would take. The build order itself is in the spec (dashboard-schema §29); this is the list beside it.

## Sign-in and sessions

- **The browser's password manager** (on since 2026-10-03): Chromium's own, in the shared profile; a re-sign-in after a signout is a
  tap. PRISM never sees a password. The first sign-in stays on the service's page.
- **Sharing sign-ins and saved passwords between PRISM boxes in a household** (asked 2026-10-03). Not by copying the profile: Chromium encrypts its cookies and
  saved passwords with DPAPI, keyed to the Windows account of that machine, so a folder copied to another box cannot be read there, and
  decrypting them to move them would make PRISM a credential handler, which the services policy rules out. The clean route is a
  password manager the household already uses, as a browser extension in the shared profile (WebView2 runs extensions): Bitwarden or
  1Password keep the passwords, sync them between boxes themselves, and fill the service's own login page; each box still signs in
  once, which is a tap with the manager. What it takes: extension loading in the host (`AreBrowserExtensionsEnabled`, a place to put
  the extension's files), the manager's own unlock on the wall, and a walk of each service's login page with the manager filling it.
  Sessions themselves (the cookies) stay per box: a service's session is a device's, and the services would not thank us for cloning
  one.
- **A keyboard on the phone** (build order 3, the remote PWA): what you type on the phone lands in the field focused on the wall, a TV
  remote's keyboard. Nothing stored. Makes the first sign-in painless on a wall with no keyboard.
- **A standardized login modal that fills the services' fields** - asked and declined (2026-10-03): PRISM would hold passwords, most
  services' logins have a second step (Apple's code, Amazon's code, Disney's OneID frame), and scripted typing is what their bot
  detection looks for.

## Privacy

- **Third-party cookie blocking in the shared profile** - decided against (2026-10-03); what it would
  break is in docs/features/sign-ins.md. **A tracker blocklist** on the request hook is the opt-in middle ground if ever wanted: refuse
  known ad and analytics domains without touching the sign-in frames.

## Covering ads

- **Break watch packs: what one person's reports teach, every PRISM gets** (asked 2026-10-07,; *Decision:* agreed; add it here and draft the format). A signed pack in the bucket beside the update manifest: the break
  watch's word lists and bounded settings as data, channel logos learned on our own recordings, and the ad fingerprints we have checked.
  With the person's opt-in (off by default, *Decision:*), PRISM fetches it every few hours with
  nothing about the person in the request and applies it without a restart. Every release carries the newest pack in its install, so a
  person who leaves the downloads off still gets the detections with each new version (*Decision:*); the newer pack wins. The reports (and,
  opt-in, fingerprints of ads that named themselves) come in through the inbox, are checked against our recordings each day, and go out
  in the next pack - same day at best, next day at worst. Never one person's report straight to everyone: a shared fingerprint still
  needs the channel's logo away, the guard that ended C-SPAN2's ten-minute wrong cover (2026-10-06). The format, the guards and the
  privacy terms are in docs/features/break-watch-packs.md. What it takes: the built-in lists in BreakModel.cs moved to a data file the
  pack extends, a pack signer and checker beside the update scripts, the publish step that bundles the newest pack into each release, the
  host's fetch and merge, the opt-in upload and its inbox route, and the daily check.

- **The break watch on other live TV services** (said 2026-10-11): the watch is built for YouTube TV's live channels today - its adapter, its channel logos, its
  trained model. Sling TV, when the household subscribes, takes the same technique: the picture, the sound and the captions. Not
  started: it needs the service's own adapter and its own marked hours. The tour already speaks of live channels in general and
  names YouTube TV once as where it works today. The labels in Watch settings and on the phone still say YouTube TV, and change
  with the second service.

- **Live TV picture reading in the PRISM extension for Firefox** (asked 2026-11-14; *Decision:* planned, not in 0.8.0 or 0.9.0).
  In Edge and Chrome the extension reads a live TV tab's picture through the tab stream (`tabCapture` and an offscreen page) to
  spot commercial breaks. Firefox has neither, so there the extension covers only the service's own ad marks and the option is
  not offered. The routes Firefox has: (a) tab snapshots (`captureVisibleTab`) about once a second, with no new permission and
  no prompt, but snapshots were ruled out on 2026-11-06 (in Edge about 150 ms a snapshot, near 15% of a core at one a second),
  only the tab in front is read, and PRISM's own cover is in the picture; (b) the share dialog (`getDisplayMedia`), which in
  Firefox shares a whole window or screen and never one tab, asks on every page load, and cannot be restricted to the video;
  (c) reading the video element, which gives black for protected video. The candidate is (a), for Firefox alone, and it needs
  the 2026-11-06 decision lifted for that browser. Not proven: that protected video shows in a Firefox snapshot at all, and that
  the model holds its results at one frame a second (it runs on two in Edge). What it takes, in this order: a small probe in a
  signed-in Firefox on a live channel (is the picture readable, what does a snapshot cost); the model scored on the bench at one
  frame a second; then the reader on the Firefox background page (no offscreen page needed), the model and the Tesseract text
  reader back in the Firefox package (about 8 MB, with their sources named for Mozilla's review in SOURCE-NOTES.md), the option
  offered in Firefox with its own tooltip, the live TV pack fetched there through the one opt-in, and the store text, the
  reviewer notes and the privacy policy changed to match. Nothing leaves the browser on any route.
  **Probe, 2026-11-15** (*Decision:* snapshots are allowed for Firefox alone; the 2026-11-06 rule stands for Edge and Chrome): in a
  headless Firefox 157 a public Widevine test stream was readable through `tabs.captureTab` with a rectangle and a scale (the video's
  box at 320x180): a picture with detail that moves, 30 to 67 ms a snapshot in software rendering, against 55 to 68 ms for the whole
  tab. A tab that is not in front gives the same still frame again, so only the tab in front can be read. Not yet seen: a real
  Firefox window with hardware acceleration on YouTube TV. The tool for that is `prototypes/prism-veil-extension/dev/firefox-snapshot-probe`
  (a temporary add-on, never packaged): pressed on a playing tab it reads 20 snapshots and says readable or black and the cost.
  **Probe in a real Firefox, 2026-11-18** (the person's run, Firefox 160, YouTube TV, a protected live channel playing in a
  2309x1299 box): readable and moving at 320x180, 19 ms a snapshot at the median and 36 ms at worst. The route holds. Next: the
  reader on the Firefox background page. (The model needs no new score for the rate: in Edge it already judges one look a second.)
  **First cut built, 2026-11-18** (extension 0.9.41, local): in Firefox the reader (`offscreen.js`) is a background script and asks
  `tabs.captureTab` for the video's middle 16:9 once a second; the model, the picture network, the known-ad prints and the Tesseract
  text reader are in the Firefox package again, the option is offered there, and the live TV pack is read there. A tab behind
  another is not read. Seen in a headless Firefox 160 on an unprotected film: a frame a second judged, the text reader reading, no
  frames while the tab is behind, and the existing http/https host permission is enough (no new permission). Owed: a break covered
  on YouTube TV in the person's Firefox; how the model does on snapshot pictures (they are JPEG, the stream's frames are not); and,
  before a release, SOURCE-NOTES.md for the bundled Tesseract, the store text, the reviewer notes and the privacy policy.
  **On YouTube TV, 2026-11-18** (a hidden Firefox 160 on a copy of the sign-in cookies, a local NBC station set to all breaks, 15
  minutes): a frame a second read from the protected picture, the stream's noise 0.8 to 1.6 grey levels, the text reader reading,
  and the cover drawn. One real break was covered and its cover came down as the show came back. Faults in the same run: a cover
  of 44 seconds over the show three minutes after the channel was opened (no logo learned yet), a cover that began while the show
  was still on, and 12 seconds of commercials shown in the middle of the break. The channel is one the model was not measured on,
  which the default (sure breaks only) keeps from this. Not known: whether Edge does better on the same channel and minutes.
  **Snapshots against the stream on the bench, 2026-11-18** (the seven exams, the extension's model and network, the standing
  conditions; `SNAPSIM=90` in bwtest makes each recorded frame a JPEG 640 wide at quality 90, read back and halved): as recorded
  90.4% of ad time covered, 1.72% of show time wrongly covered, 10 pop-ups; as snapshots 91.3%, 1.68%, 9. The compression costs
  nothing that the exams can see. Left out: Firefox's own scaling of the video, which the recordings cannot show.

- **A delay for the big screen, so the break watch sees ahead** (asked 2026-11-06): the person watches the big screen a few seconds
  behind live while a hidden window on the same channel stays at the live edge for the break watch, so a cover can go up on the
  break's first frame and come down on the show's first frame. Most of what the watch misses is timing (on the seven exams: covers
  begun late 510 s, kept on after a break 581 s, lifted early 124 s). *Decision:* the big screen only; multiview stays live; a setting
  the person turns off, which also turns itself off on sports channels (a delay spoils a game the phone already scored). It costs a
  second stream: YouTube TV allows 3 at once on the base plan (4K Plus lifts that at home, but only in its own app, so a web page
  likely stays at 3), and PRISM never reads the plan from the account pages; the hidden window backs off by itself when the service
  says too many streams are playing, and the delay is off for that session. The live-edge rule counts PRISM's own delay as live. Never
  by holding back and replaying the picture itself: that would be re-showing protected video (the third-party services policy). What
  it takes: the look-ahead measured on the bench first (the gain at 5, 10, 20 and 30 s), then the hidden live window and its tune,
  the big window's own seek behind live, the covers timed from the hidden window's calls, the back-off on the too-many-streams
  message, the setting and its sports rule, and docs/network.md for the extra stream. PRISM for Windows only; the extension would need a
  second tab.
  **Read on the live page 2026-11-17** (ABC News Live, PRISM muted, the Video player; the page's own buttons only). The big window
  holds a place behind live exactly: two presses of Back 15 seconds put it 30.3 s behind and it was 30.3 s behind three minutes
  later; a pause of 7.5 s by the page's Pause added 7.5 s (37.8 s) and that held too, so any delay can be set by a timed pause. The
  page keeps about 18 s of video ahead at the live edge and about 55 s when held behind. Forward to live is off at the edge and on
  when behind, which is the page's own sign. A second window on the same channel at the edge played beside the delayed one for
  two minutes with no message from the service. Two faults for the design: a page on the hidden work surface does not play (the
  page says the video format is not supported), so the live look needs a real window, off the stage or behind it; and the two pages
  count time from different starts, so their positions cannot be compared, and the delay has to be kept by PRISM's own clock from
  the presses it made. The morning's failed tunes did not come back: the first tune after a start worked.
  **Built 2026-11-17** behind a switch in Watch settings, off unless the person turns it on: docs/features/look-ahead.md has the
  rules, how it works and what was read on the live page. The live look is a hidden page that is not a reading page (it may play
  protected video), and the delay is measured from the two pages' sound. Still owed: the service's words for too many streams
  (the back-off rests on the live page not playing until they are known), a person's eye on where the covers fall, and an
  evening of use.
- **Channel promos covered too** (asked 2026-11-18; ranked under advertisements: a change that covers more promos must not
  cover fewer advertisements): since 2026-11-04 a channel's own promo counts as show, in the marks, the training and the
  scores. The owner would rather have promos covered. What is known: the watch already keeps a cover over most closing promos
  (about 220 of the 327 s the bench calls show covered after a break, 2026-11-18), and the model taught to let promos through
  covered about two points less advertisement time than the one before it on the same marks (2026-11-05). To study on the
  recordings first: score three kinds (advertisement, promo, show) so a promo covered is neither a miss nor a wrong cover, then
  a training with promos marked as break, judged first on advertisement time covered and then on promo time covered. Nothing
  in the app until the bench says advertisements lose nothing. A first three-kind count is made (2026-11-18, 19 exams, the
  shipped model's kept calls, raw seconds with no allowance at a break's edges, so not to be set beside the bench's own
  figures): promos are 3,175 s against 44,261 s of advertisements; 47% of the promo seconds and 91% of the advertisement
  seconds are under a cover. The training with promos as break is not started.
- **The look-ahead's end finder** (asked 2026-11-17: with seconds in hand a cover should also lift where the show returns): the
  look-ahead moves a cover's start and leaves its end where the watch lifts it, which is a few seconds after the show is back
  (a median of 4 s over 76 covers of the seven exams, 6 s on one channel). When the watch lifts a cover, the true return is in
  the seconds just before, and they are in hand: search them for the place (the cut in the picture, the gap in the sound, the
  first line of the show's captions) and lift there. Order: on the recordings first (`scripts/breakwatch/lookahead.py` and the
  exams' readings per look, `run_exams.py FEATDIR=`), scored in the same table as the delays; into `LookAheadPlan` only if show
  time is gained without ad time lost. **Measured 2026-11-17** (the table is in docs/features/look-ahead.md): ending a cover at the
  first black frame in the 10 s before the lift gains 96 s of show for 3 s of advertisements over the seven exams; silence and cuts
  cost ad time. The black frame rule is in `LookAheadPlan` since 2026-11-17 (not yet seen on a live break). For the ends with no black frame, a reading that looks both ways (`endfinder.py`) was trained and measured the same day: with the
  black frame rule, show wrongly covered 1.62% to 1.06%, ads covered 93.8% to 93.6%. In the app since 2026-11-17 at the careful setting (0.7): `EndFinder`, the
  trees in `Assets/breakwatch/end-finder.json`, parity by `bwtest ENDMODEL=`. It is not in the detection pack: a new training
  reaches a household with a new build.

- **Cover the advertisement and leave the scores in view, on every channel that keeps its strip** (asked 2026-11-15): NFL Network
  has this since 2026-10-08 (B-359: the veil leaves the channel's bottom band open, the band set by hand). The error study of
  2026-11-15 (docs/break-watch-scorecard.md) found the same habit on FS1, on ESPN in some breaks and on Bloomberg TV+, and there the
  break watch covers far less of the ad time (FS1 31% with the strip kept against 76% with it gone), because the strip's logo reads
  as the programme. Two parts: the cover (the band learned per channel in place of one set by hand, so the scores stay in view
  under a cover) and the detection (a reading of the picture above the strip alone on those channels). What it takes first: a
  measure of the strip that holds for a scrolling ticker (`scripts/breakwatch/tickerstudy.py` compares against a still median and
  misses ESPN's), then the band per channel from the recordings, then the detector's inputs with the strip masked, scored on the
  exams by `edges.py`. PRISM for Windows first; the extension's picture reader after it.
  **Built for FS1 in PRISM for Windows, 2026-11-15** (the cut above row 167 and the open band under the cover; in the source,
  live at the app's next build): what is left is a live FS1 break seen with the scores in view, ESPN's row and its second cause,
  the band learned per channel in place of a table, and the extension.

- **The picture quality as a control of PRISM's** (asked 2026-11-15): the Video player shows the service's video and hides the
  player's own buttons, so the person cannot reach the service's quality menu. That day YouTube TV on the big screen served 640x360
  on Auto with 1080p on offer, the page in view at 2400x1350 and the player's own network estimate at 52 Mbps; chosen in the
  player's own menu (Settings, Quality, 1080p60 HD), it served 1920x1080 with no dropped frames. What it takes: a Quality control on
  the stage bar beside the size it already reads, which lists what the service's menu offers and picks one by the same presses a
  person makes (a page action, per docs/third-party-services-policy.md; never the player's internal functions), per service in its
  adapter, YouTube TV first; and a look at why Auto sat at 360p (a low size at the first load is the first suspect). Built for YouTube TV, 2026-11-15: a Quality button on the stage bar (adapter `videoQuality`, core `videoQuality`), the read and the pick proved on a live page with the service's menu kept out of sight; pressed by the mouse in the running PRISM the same day (the menu listed six choices, 1080p60 HD took the picture from 720p to 1080p). Other services and the cause of the 360p are open.

- **The service's own page in a window, for trouble** (asked 2026-11-15): a Service page button while a title plays, which shows
  the playing page with the service's own controls and messages (its settings, an error, a prompt it puts up) so a person can
  deal with something PRISM has no control for. The rule of 2026-11-05 holds (the video windows show the video or nothing): the page
  opens in a window of PRISM's over the player, as the inline app window does for a music service, never in the video window
  itself. *Decision (2026-11-15):* a window over the player, not the player's own window. What it takes: the playing page placed
  in that window with the adapter's hiding styles off for as long as it is up (one switch in core, no work per service), the
  fullscreen keeper held meanwhile, Done or Esc putting the page, the styles and the stage back and reading the page's state again,
  and the button kept in the settings menu, not on the bar. **Built 2026-11-15** (`MainWindow.ServicePage.cs`): a Service page button on
  the stage bar over the big window (asked the same day to be reachable there, where the trouble is met), the playing page moved into
  the window as Watch's corner moves it, the adapter's style element off meanwhile, Done or Esc putting both back. Opened and closed
  by the dev command on a live YouTube TV channel (the page's controls at full opacity in the window, hidden again after). The
  same day, by mouse presses in the running PRISM: the button opens the window, a press on the service's settings button opens the
  service's menu, Done closes it and the page goes back. The first try found the press taken by the break cover's clear ground
  (in Watch's corner the whole break is the way back, so the press opened Watch): in this window that ground and the stage shield
  are down (`SurfaceManager.SetShieldOff`). Open: the service's captions show in the window, the Esc key is not tried, and no
  service other than YouTube TV is tried.

## The PRISM extension in Safari, on a Mac and an iPhone (taken up 2026-11-19; not started in a Safari)

Asked 2026-11-19: what it takes to offer the extension in Safari. *Decision:* it is the next browser for the extension, after
Edge, Chrome and Firefox. It reverses the deferral of 2026-09-12 (docs/veil-release-checklist.md).

- **What Apple asks:** a membership of the Apple Developer Program as a company (the D-U-N-S record exists; Apple's lookup found it,
  2026-11-19), the extension inside an app, and App Store review of every version. The app is made by App Store Connect's Safari Web
  Extension Packager from a zip of the extension (the Xcode Cloud tab; no Mac and no Xcode), and tried through TestFlight.
- **What is built:** `node build-firefox.mjs safari` makes `dist/safari` and `prism-extension-safari-<version>.zip` from the one source, only
  when named. Its background is a page that sleeps (the rule updates' reader, the soundscape, bg.js); it has no tab stream, no
  offscreen page and no picture reader, and asks for storage, alarms and scripting.
- **What is unknown until a Safari runs it** (nothing here is claimed): the content scripts declared for the page's own world
  (`world: MAIN`, the popup hook and the IMA hook); the tab mute under a video cover; the popup handling; the settings panel in its
  frame (Firefox gave that frame no tabs calls, 0.9.42); video covers on an iPhone, where a video plays in the system's own player;
  and whether the packager is offered to the account (others report the section missing, or a bundle identifier fault that took Xcode).
- **The live TV picture is not read in Safari:** no call was found there that gives a tab's picture to an extension as a stream or by
  rectangle. The option shows as not available. Marked ad slots need no picture.
- **A Mac:** not needed to package. Reading the extension's errors needs Safari's Web Inspector on a Mac; one is rented by the hour
  when the first fault needs it, not before.
- **Owed, in order:** the membership (the owner's); an app record and the first upload; a walk of the site matrix in Safari on an
  iPhone through TestFlight; then the store text for the App Store and a line in docs/network.md if Safari adds or drops a connection.
- **Drafted 2026-11-21:** the App Store text, the privacy label's two choices and the review notes in `docs/veil-store-text-safari.md`;
  the 1024 px opaque app icon from `scripts/brand-icons.py` (`assets/store/prism-appstore-icon-1024.png`). Found then: the report
  server's CORS admitted no Safari origin. *Decision:* Report an ad stays in Safari (the privacy label declares it), and the server
  admits `safari-web-extension://` since the same day.
- **First run in Safari, 2026-11-21** (a macOS virtual machine, the zip added as a temporary extension): the button on the page
  works. A press on the toolbar icon crashed the page's process on msn.com as the settings panel's frame went into the page.
  *Decision:* in Safari the settings open in a window of their own (0.9.45); the frame over the page stays for the other browsers.
- **Mac session, 2026-11-21, 0.9.45** (Safari 26 on macOS 26.7.3 in the virtual machine, `dist/safari` added as a temporary extension,
  allowed on all websites; read by script from Apple Events and screenshots):
  - **`world: MAIN` works.** On a local test page and on msn.com both page-world scripts run: `window.__prismImaHook` and
    `window.__prismPopupHook` are set, and `window.open` is the popup hook's wrapper.
  - **Display covers on msn.com are drawn, each on its ad:** the banner under the search box, the row of sponsored tiles and the
    sponsored cards. No crash of the page's process. A test page's `google_ads_iframe_…` slot and `ins.adsbygoogle` were covered too.
    The PRISM pill sits over msn's own Feedback button at the bottom right.
  - **Facebook and X: not tested.** Neither is signed in on this Mac, and a signed-out page shows no ads.
  - **YouTube video ad: not settled.** A signed-out watch page showed an ad (`ad-showing` on the player) with 11 covers in the page
    in the first seconds; the Mac then stopped answering screenshots and scripts (WindowServer at full load), so the tab mute is
    not read yet. The virtual machine has no sound device, so nothing could be heard either way. The system log puts the freeze in
    the machine, not yet in PRISM: the screen is drawn in software (no graphics acceleration in the VM), WindowServer logged a
    25-second stall as the page's players started, and the media stack failed for want of an output device (`Default-Output` not
    found). A run with the extension switched off would show whether the covers add to it.
  - **A temporary extension is gone after Safari quits** and has to be added again each time.
  - **The settings window opens** from the toolbar icon (a window of its own, "PRISM settings"), and its switches reach the page:
    Veil off took the covers off the test page and the pill read "PRISM off"; Veil on put them back.
  - **Report an ad works:** the panel's Report, a click on the covered slot, the card, Send to PRISM; the page said "Sent. Thank you.",
    which it says only on the server's 204. Firefox's consent step does not appear (the Safari build has no `data_collection` key).
- **First upload to App Store Connect, 2026-11-21** (the hold on registering was lifted that day; the membership is still Individual):
  the packager is offered to the account. Build 0.9.46 (1) ended in Apple's "Service Error", with a warning that `persistent` and
  `world` are unsupported. 0.9.47 without `persistent` got the same error, sat at 0%, and warned that iOS takes a background with
  no `persistent: false` as persistent, which it refuses: the key is back from 0.9.48. Both failures came before the zip was read;
  the cause is Apple's or the account's. `world: MAIN` stays until a Safari shows whether it runs those scripts in the page.
- **In TestFlight through Xcode, 2026-11-21:** 0.9.48 (1), built on the Mac (`targets/safari-app/`, iOS only), archived unsigned
  and signed for distribution on export with an App Store Connect API key. Apple's check refused the first upload over the
  manifest's `description` (112 characters at most for a Safari extension); the Safari build has a shorter one. Processed as
  valid; an internal group (all builds) holds the account holder as tester, and the app is installed on the owner's iPhone. How
  the extension behaves in iOS Safari is not read yet.

## Buying and renting

- **A code for the phone in place of buying on the PC** (talked through 2026-10-11): pressing Rent or Buy under a title's Where to watch shows a card with a
  code for the service's own page, an Open here instead (today's behaviour: the service's page in the big window) and an I've
  bought it that reads the service's library again. PRISM never handles payment, takes no cut and adds no referral code, as it never
  signs anyone up. **Built 2026-10-11** (; docs/features/purchases.md): the card is the default press, a service
  PRISM has an adapter for gets a code whether or not the household has set it up, and it goes out with the next release.
- **Where a service sells is the service's own fact, kept in its adapter** (same day): each adapter says whether a purchase is made in the service's app or only in a
  browser, with the source it was read from, and the card's words follow it. A code is a web address, and a phone with the service's
  app installed may hand the address to the app, where a browser-only service shows no way to buy: the card has to say so, and each
  service needs a try on an iPhone and an Android phone. To check before building: each service's own help page on where it sells,
  whether the availability data carries prices (it is believed not to), and the title's own address per service.

## YouTube as a Video player service

- **YouTube beside YouTube TV, its subscriptions as a Watch row** (said 2026-10-11): today's YouTube adapter frames the page and
  nothing more. As a service it needs what Twitch has: a context script (what plays), a library script that reads the Subscriptions
  feed as the service's own row (the shape Twitch's Followed row has) and History as Continue watching, a search address, a play
  script. The Google sign-in is YouTube TV's already (signInWith). YouTube's own ads: "They can be covered. We're doing it via the
  extensions already. Look at those for clues" (same day). The adapter already carries the extension's ad signal (its js script
  reads.html5-video-player's ad-showing and the skip buttons, from prototypes/prism-veil-extension/src); the host's cover on it is
  what has not been tried, with the extension's known YouTube traps in memory (the hardware overlay flash, the tab mute). TMDB's
  YouTube provider (192) would then also give its Rent or Buy offers a code. Not built.

## Categories of your own

- **Built 2026-10-11**: `docs/features/categories.md`. Watch settings > Categories: a name, hashtags
  and one of four rules (newest first, watched most recently by this household, A to Z, the service's own order), each said in full on
  the row's disclosure and in the tab. The hashtags offered are the words that recur across the household's own rows in PRISM, counted
  there, nobody's trend feed. Still open: a title's own hashtags are read only where the service writes them in its name or line under
  (YouTube's description hashtags are not read), and Twitch's stream tags are not yet in its rows.
- **The open pool by YouTube's API, with the person's own key** (asked 2026-10-11): `search.list`
  with `order=date` is a published sort, gives exact dates, and answers to a key rather than the signed-in account, so nothing of the household's
  shades it. Deferred: a YouTube key means a Google Cloud project per household, 100 searches a day (reads would cache two hours), Google's
  limits on keeping results and its branding on the row. The page read with the Recently uploaded chip stands until it proves brittle.
  Twitch's API cannot list streams by tag and needs an app token, so its directory page stays.

## Performance

- The per-page cost is measured each minute (perf.log, the Performance tab). Left on the list: the 10 MB/s three playing windows draw
  (that is the video), and the brain's menu answers to the Watch page's follow loop (30 KB every three seconds; a change signature
  would cut it to a few bytes).

## Devices

- **PrismOS daemon and image** (Pi, mini PC): build order 4, after the Windows host is proven.
- **Android shell**: parked, a dead end (WebView DRM); no feature owes it anything (decision 2026-09-09).
- **PRISM Photos**: phase two/three (docs/prism-photos-concept.md).
- **Odesli (song.link) for the music search's service list** (2026-11-04): one request per pressed song
  would name every service that carries it with that service's own id, replacing the hidden-page searches (five to ten seconds). Its
  public API answered "PUBLIC_API_ACCESS_DEPRECATED" that day and a key comes by mail from developers@song.link; one key for all of PRISM is fine
  (2026-11-04,: the person's own key was a cost call, not a rule);
  built behind the same switch when PRISM has one, if Odesli grants it free. Songwhip is gone. Discogs (details, works without a token) would be a details card for a song, if
  one is ever wanted; MusicBrainz + Cover Art Archive measured too slow for suggestions (docs/features/music-search.md).
- **Prisms that know each other on the home network** (2026-10-21): the PC's name (docs/features/this-pc-name.md) is the first piece, the name a household gives each PRISM. Later each PRISM announces
  that name on the home network and lists the others by it, so the phone remote and a scene can pick a PRISM by name and a household's sign-ins,
  scenes or playlists can move between them. Box work (memory: app features parked until the box): nothing is built from this note alone, and
  any announcement stays on the local network and carries the name and nothing else.

## Room sound in step with a phone's listening (built 2026-10-31; docs/features/phone.md)

Asked:, for music only. Two routes failed first - a session at
zero or muted leaves the process loopback silent, and WebView2's share picker offers no tab, so Chromium's tab capture with its own
playback suppressed is not there - and then the measurement that opened it: the per-app volume scales the capture before the tap and
loses nothing, down to a ten-thousandth. So the browser sits at -80 dB while a listener listens to music, the host multiplies its
capture back up, and plays it to the room the slowest listener's lag later. Video is left as it is. A PRISM audio device of its own
(a signed driver) would be the cleaner general answer and stays out of scope for the host.

## Lyrics on the screen (started 2026-11-15; docs/features/lyrics.md)

Asked for 2026-11-15: the song's words on the screen, lit as they are sung. Decided: read the lines the music service's own page draws
(nothing fetched, nothing kept), service by service through an adapter route, `musicLyrics`.

- **Built:** Apple Music (word timing), the Lyrics button on the control bar, the three-line view on the Music player.
- **Next:** the other music services, each from its own page; a song with only untimed lyrics; the lyrics on the phone page.
- **Later:** Jellyfin's own lyrics for the household's files.
- **Left out:** a public lyrics collection (LRCLIB). If ever added: opt-in, off by default, listed in `docs/network.md`.

## The music panel (started 2026-11-16; docs/features/music-panel.md)

One drill-in panel in place of Quick play's menus within menus, six screens, built in four steps with a review after each:
(1) Home and a service's library, built 2026-11-16; (2) Up next and Add to playlist with the match step; (3) Scenes; (4) Song
history. Approved and the old menu removed 2026-11-16. Decided 2026-11-16: the
service's own shuffle is not offered in the panel; Remove from the queue and from a playlist are to be built; the screen of
visuals is named Scenes.

## Resume after a restart (asked and built 2026-11-17)

- **The rule**: after a start nothing plays by itself. What was up (films, series and live channels alike) is held, the windows stand
  in their places at their services' home pages, and the big window's `Nothing is playing` face has one `Resume` button with the
  first name and how many more. Resume brings every window back by the restore's own path (the title's address, or the service's
  home and its tune). A pick of the person's own, or Clear screens, ends the offer. A second start with nothing pressed offers the same.
- **Where**: core `orchestrator.ts` (`videoUpBoot` holds, `videoResumeOffer`, `videoResume`, `videoResumeEnd`), the runtime's
  `videoMultiview("resume")` and `resume` in its state, the host's empty stage (`MainWindow.MultiviewDrag.cs`). A switch of players
  still brings the windows back as before. Tests: `multiview.test.ts`, the Resume group.
- **Proven on the PC**: a start with three live windows played nothing, held all three and drew the button, and Resume brought the big
  window back. **Owed**: the small windows coming back by Resume seen on the PC (the idle sampler ended its run and closed them in the
  same second), and a person's press on the button itself (the proof called the verb).
- **Note**: the idle sampler (`scripts/breakwatch/sampler.mjs`, a scheduled task from 06:30) opens three YouTube TV windows by itself
  when nobody has used the PC or PRISM for 60 minutes, with PRISM muted. Windows seen playing on an unattended PC are usually its own.
  Both sampler tasks (`Prism break-watch idle sampler`, `Prism break-watch sampler`) were disabled on 2026-11-17: labelling had
  stopped on 2026-11-15, so new recordings were not used. `Enable-ScheduledTask` puts them back. The recordings made stay.

## Convergence: listening together (noted 2026-11-12; not started)

A plan carried over from the earlier Entangled project, to be built in the town of the Seasons visual (docs/features/seasons.md; under construction and held back from releases since 2026-11-12).

- One song plays for everyone who joins, at the same moment, and a five-minute meditation follows, also in step.
- The scene shows a count of the people who listen now, and a globe on which their places light up.
- "Convergence" is the name of the town (chosen 2026-11-12; it is on a board in the square).

Open before any of it is built:

- **Privacy (spec 19/22).** A count and lit places need a server that knows who is present. It has to be opt-in, with no
  identifier, a place no finer than a region, and a row in docs/network.md.
- **The song.** A stream to everyone needs music PRISM has the right to send; a person's own service plays only for that person.
- **Time in step.** The room-step work (docs/features/phone.md) keeps one house on one clock; many houses need a shared clock.

## A model on the dev side (ranked 2026-11-03; nothing in a shipped build calls a model)

Asked:, then, then (*Decision:* "Go"). The ranking, by impact against the effort to
get there. The guardrails are the same for every item: it runs from the developer's own machine with their own key, it is handed
structure and logs, never a person's content and nothing about the household, every change it proposes arrives as a diff proven
before it ships, and no shipped build of the PRISM app or the PRISM extension calls a model.

Start now:

1. **Site-structure doctor for the extension** (the first build). The project's largest recurring cost is a site's markers found by hand and
   found again when the site changes, and the sites never reached. A tool reads a site's structure (the dumped DOM around the
   players and the ad slots, from the Firefox BiDi harness, headless, never the screen), proposes the site's rules as a diff, and
   proves the proposal on the same dump before it is accepted by hand. **First cut built 2026-11-03** (docs/doctor.md): `scripts/doctor/`
   dump, ask and prove; the dump and the proof ran on MSN the same evening, and the first ask went out at 23:09: no rule warranted, MSN's feed already covered (docs/doctor.md, Status).
2. **Adapter doctor for PRISM**: the same pipeline pointed at the host's adapters, proven on a hidden page in place of the harness. **Built 2026-11-03** (docs/doctor.md): `dump-tile.mjs` reads a hidden page through the dev eval hook in strict mode, `prove-adapter.mjs` counts the adapter's selectors before and after a proposal and doubles as the health check (item 7); the first adapter ask (23:33) found Apple Music's dead header Play and proposed dropping it, declined on reading core and repointed instead (0.1.16).
   One tool with two rule formats, not two tools.
3. **Nightly log triage**: the day's host.log through the existing redaction, back as a few lines of anomalies. The smallest effort on
   the list; it would have named the silent capture of 2026-11-03 (B-475) in one line. **Built 2026-11-04** (docs/doctor.md): `scripts/doctor/triage.mjs`, the day's log as its shape (counts per hour, gaps, templates), the host's redactor ported plus a content scrub, ten anomalies on the first night and the silent capture among them, about fifty cents a night.

Next:

4. **The release gate walked by machine** (docs/veil-release-checklist.md): the harness drives both browsers through the site matrix
   and a vision pass judges the screenshots. After the doctor has settled how a site is loaded and dumped, since it reuses that. **First cut 2026-11-04** (docs/doctor.md): `scripts/doctor/gate.mjs`, eight public rows walked in headless Firefox and judged by vision against each row's Expect; evidence for the person, never a mark. It found two faults in the doctor's own dump and one in the extension's trace on its first walk.
5. **Labelling for the break detector** (memory: learned break detector): hours of recordings labelled offline for retraining. A
   batch job run when there is time to retrain, not a tool kept running. **Built 2026-11-04** (docs/doctor.md): `scripts/doctor/label.mjs`, contact sheets of a kept recording to a vision pass, marks in the marking page's format; the FX hour scored 99.2% of ad time and 0.64% of show time against the person's marks, about eighty cents an hour.

As needed, no build:

6. **Reading ad SDKs** when a new build of IMA, DAI or a stitcher appears: a workflow, not a feature. **The watch built 2026-11-04**
   (docs/doctor.md, "The ad SDKs watched"): `scripts/doctor/sdk-watch.mjs` in the night run fetches Google's IMA and DAI SDKs, keeps a hash
   and a copy, and on a new build checks every name ima-hook.js relies on; the attention page carries the change. A stitcher has no public
   file to watch. Reading a changed build is still the workflow, done when the page says a build changed.
7. **Art pool verification** the next time the pool is touched: one pass per batch, licences and credits checked.

Wait:

8. **Nightly adapter health**: comes free as a check mode of the doctors once they exist. **Built 2026-11-04**: `scripts/doctor/nightly.mjs` runs the triage, the health check of every hidden page (no model) and, with `--gate`, the public rows of the release gate; the Task Scheduler line is in its header, not registered by the repo.
9. **Report triage** for the inbox: when it carries volume.
10. **A natural-language remote and ranked picks on the phone**: app-side, so they wait for the TV box (memory: app features parked
    until the box), and they need a person's own key and plain words on screen about what leaves the house.

Never:

11. **Real-time vision for ad breaks**: seconds of latency, and screenshots of what the household watches leaving the house. The
    learned detector stays.
