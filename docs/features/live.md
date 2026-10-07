# Live

Every live channel the household's services carry, in one place, laid out
as a schedule. Asked for on 2026-09-28:

> "We need to create a live tab. This is where we'll put all stations and
> their schedules. When adding an item to the big window or one of the
> small multi windows, then it is the channel that gets added because the
> show changes throughout the day. So make sure any LIVE items on watch get
> moved into the Live tab, but we need to organize it like a schedule and
> make the channels filterable by type. This likely needs a different
> search function than the others to find the live content. I don't have a
> subscription so I'm not ready yet, but YouTube TV will be an important
> part of this."

## The tab
- A **Live** tab beside Watch, Library and Playlists.
- Top of the tab: type chips (All, then each type with a count), a live
  search box, and a line saying when the guide was read, with Refresh.
- The body is a schedule grid:
  - one row per channel: logo, name and the service it comes from;
  - time runs left to right in half-hour columns, from the current half
    hour to three hours ahead, with a line at the current time;
  - each program is a block as long as it runs, with the program on now
    marked;
  - a channel whose service gives no schedule shows what is on now, up to
    when it ends if that is known.
- Below the grid, **Live events**: live items a service lists as titles
  (a game, a special) rather than as channels.

## A channel, not a show
- Picking a row, or a program on it, tunes **the channel**: "Watch in the
  big window" or "Add to window N" when multiview is on. Whatever is on
  that channel plays, and the window stays on the channel as the programs
  change.
- A channel is kept after a restart as a channel (its service's tune), never
  as the program that was on.

## Types
- A channel's type comes from the service's own category when the service
  gives one (Paramount+'s News, Sports, Drama, Kids & Family, Reality,
  Comedy). Labelled with its source (§5).
- Otherwise Prism's rule reads the channel's name and what is on it
  (News, Sports, Kids, Movies, Music, Local, Entertainment), labelled
  "Prism's guess from the name".
- The chips list only types that have channels.

## Search
- Live search looks through the guide, not the catalog: channel names,
  what is on now, and what is scheduled in the grid's window. A match on a
  program shows its channel with the program highlighted.
- It is a different function from Watch's search and Playlists' search;
  the Live tab's search box uses only it.

## Watch
- Watch no longer draws a Live now row; live items leave Watch's rows
  (Continue Watching, My List, shelves) and appear in the Live tab.

## Reading the guides
- A service's guide page often plays a channel as it opens (Paramount+'s
  Live TV page starts CBS News 24/7; Peacock's guide lives on its live
  player). So guides are **read only while a person has the Live tab open**
  (or presses Refresh), never in the background: on the service's hidden,
  muted page, any video on it paused, closed when read. At most every 15
  minutes per service unless Refresh is pressed.
- Adapter contract (additive):
  - `videoLiveUrl`: the page that lists the channels.
  - the `videoLive` script's items may add `category` (the service's own
    word), `nowEnds` (epoch ms), `nowDesc`, and `schedule`
    (`[{title, start, end}]`, epoch ms).

## Services
- Paramount+: `/live-tv/` lists ~50 channels with what is on, time left
  and a Schedule panel per channel; its filters give each channel's type.
- Peacock: its guide appears on the live player page (now and next).
- YouTube TV (2026-10-05, the household subscribed): its guide page, `tv.youtube.com/live`, IS the schedule - a row per channel
  (name, logo, browse id) and an airing per program (start as text, 10 px a minute, `is-live_` on the one on now, the program
  title and its rating / episode line), about three and a half hours a read; 126 channels on this account, the broadcast
  stations among them. A tune presses the channel's thumbnail and then "Join live" in the page's own question. No category
  from the service; Prism's name rule and TMDB's genre type the channels. Its Library page gives the Watch rows (New in your
  library, Most watched, Scheduled recordings) and the owned library (Recordings & purchases, 1,373 here, read by scrolling
  the grid on the owned page until the header's count is reached).
- Twitch (2026-10-05): Following > Live, the followed channels live now, typed by Twitch's own category.

## What an adapter declares for the Live tab

Everything the tab knows about one service is in that service's adapter file; core holds only what is the same for every service
(2026-10-02, "Other services will eventually be added but we'll make sure the adapter includes the news feature. Can this be within the
scope of some adapters, the kind of live mode headlines/features?" - yes, and it is). A new service with live channels fills in what
applies:

| Field | What it says | Who uses it |
|---|---|---|
| `videoLiveUrl`, `videoLive` | the guide page, and the script that reads its channels, categories, what is on and the schedule | the grid, every mode |
| `videoEventsUrls`, `videoEvents` | pages that list the service's live events (Apple TV's Formula 1 and MLS), and the script that reads them | event rows, Sports mode, a score's Watch |
| `newsFeeds` | a channel, the show on it, and the network's own feed of what that show aired (`channel`, `show?`, `feed`, `only?`, `name?`, `local?` for a station's feed) | News mode's front pages; Local mode's with `local` |
| `broadcasters` | the networks the service carries live, as ESPN's scoreboard names them | a live game's Watch chip on its score card |

Core, for every service: the grid and the modes, the type rules on a channel's name, the "starts in" wording, the feed parser and the
three named exclusion rules, the pairing of a feed with the show on now, ESPN's scores and the match of a game to a service's events
and channels by the teams' names. An adapter never ranks or filters; it names where the service's own words are.

## Decisions
- 2026-09-28: the grid shows three hours from the current half hour;
  schedules further out are kept but not drawn.
- 2026-09-28: guides are read on demand only (the pages play); the tab
  shows the last read with its time until a new one lands.
- 2026-10-05, "taking a lot of time for live tv to get populated, and not in the background while I'm idling on the Watch tab
  either": the Watch screen open on ANY tab starts the guide reads (the hidden, muted work pages with any video paused, as the
  Live tab reads them, at the same 15 min cadence a service), and the phone's Video tab asks the same (POST /video/live-read), so the
  Live tab and the phone's Live section open already filled. Never with the Watch screen closed: the pages still play as they open.
  Paramount+'s guide page takes 20 s and more to render on the hidden surface; its reader waits up to 50 s (it answered empty at 20).
- 2026-09-28: the grid begins at the current minute, so every row's program on now starts at the same left edge ("Just cut it all off evenly"). Paramount+ lists a channel's next 10 programs only (2 to 28 hours); a week needs a listings source (Schedules Direct, to decide with YouTube TV).
- 2026-09-28: a live channel moves from show to show by itself ("We're okay with that. That's expected"): the wall never stops it as an unrelated autoplay, never calls it ended at the live edge, and plays its sound though its page names no show.
- 2026-09-28: a multiview window in an ad break is never closed as empty. Tested: two Paramount+ channels in windows 2 and 4 beside a title in the big window; both came back as channels after a restart. Peacock's live player failed on the account that night with its own playback error; a tune (a service with a tune script) records no pending pick, so its failure closes the window after the usual 45 s instead of at once - to improve.
- Resolved (2026-09-29): a Paramount+ channel in the big window stuck on Paramount+'s "Optimizing" loader was a page whose player began while its window was moved into Watch's corner mid-start (a test's stale multiview state kept Watch up); no reload recovered it, a fresh window played at once. The playback doctor's second try now opens a fresh window (every service). Tuned normally from the Live tab (Watch closes first) the channel plays in the big window, and comes back there after a restart.
- Resolved (2026-09-29): Peacock live "would not play" was the wall's own tune script. Peacock opens its live player on the channel last watched; the script then pressed that channel's entry in the guide, and a press on the channel already on closes Peacock's player (its app steps back a page). It had worked once because the first tune switched channels. The tune now waits for the guide to mark the channel that is on (the mark follows the guide by about 0.4 s) and presses nothing when it is the one asked for. Not protection, not a stream limit: the earlier reading of its Widevine requests was wrong. Peacock's hidden pages still show its playback error (no request made at all) - a hidden page cannot play it, so its guide is read from a window that plays.
- 2026-09-29: Peacock's guide gives each channel's program on now and the next one, with times, in its buttons' labels ("From 8:39 to 9:31am"); its times ran an hour off this PC's clock, so the whole guide is shifted by the whole-hour offset under which the most channels' program on now contains the present.
- Resolved (2026-09-29): a live channel on a service that tunes by its own walk comes back after a restart as the channel: the adapter's live context names its `channel` (the guide's id), the kept record carries it, and the boot loads the service's home and asks the tune once it is up. Read live: Peacock's Dateline 24/7 back and playing 10 s after a restart; two Peacock channels (big window and window 3) restored together.
- Resolved (2026-09-29): Paramount+'s "Optimizing your video playback experience" stall was a double load. A channel's address may redirect (/live-tv/stream/cbsn/ arrives at /cbs-news/); the play script saw an address other than the one asked and loaded the page again 3 s into the player's start. A page that has just arrived at a channel by a redirect is now taken as the channel asked for. Read live: CBS News 24/7 playing 7 s after the tune, beside two Peacock channels. The reCAPTCHA on the page was not involved.
- By design: Prism's hidden reading pages (app:<id>:lookup / :work) are refused DRM and have any video paused, so a guide that draws only beside a playing player (Peacock's) is read from a window that plays it, never in the background.
- Resolved (2026-09-29): the playback doctor keeps watching a title whose address arrived at a neighbouring one (a redirect): the first address a tile reaches within 15 s of the ask, on the same host and in the same folder, is that title's page. A channel that never starts is reopened in place, then in a fresh window.
- Corrected (2026-09-29): Peacock's guide times are the PC's own; the whole-hour shift added earlier had been fitted to a stale guide and is removed. An entry may list up to a day of programs; its labels give running times without ads, so each program runs to the next one's start when that is within 45 minutes; "on now" is only the program the clock is inside.
- 2026-09-29: Peacock's channels page (peacocktv.com/channels, no player) is its guide page for the background read: 36 channels, what is on now for each (times for the first only; hovering shows no more). It is merged by channel into the fuller guide a playing Peacock window reports (77 channels, now and next with times). A guide read may name only some of a service's channels; the others stay as they were.
- 2026-09-29: the grid reaches as far as the services list - three hours at least, twelve at most - and scrolls sideways; the channels' names stay put on the left. A program on now with under five minutes left is not drawn: the next one is drawn from the left edge, saying when it starts.
- Resolved (2026-09-29 evening, "none of the mini windows are playing"): Paramount+ accounts play three streams at once and say nothing when a fourth is asked for. Adapter `maxStreams` (paramountplus: 3): a window past the cap is refused in words before it is made; a window of the same service giving way does not count.
- Resolved (2026-09-29 evening): a live page's word for "playing" is its player's (the adapter reads the element), not its media session's - Paramount+'s session said playing over an empty player, so the pick counted as landed and nothing healed it. A tune carries the channel's page for the playback doctor: a channel that never starts is reopened in place, then in a fresh window; the doctor looks every 5 s on its own (a page with no player reports nothing); a live page the service moved to another channel is the channel asked for, not started.
- Resolved (2026-09-29 evening): the boot self-heal (the first "signed out" inside 90 s recycles a service's windows once) is for the windows the wall began with; a window added after the boot is left alone - two Peacock windows had been destroyed mid-tune by it.
- Resolved (2026-09-29 evening): Peacock's home now sends Channels to /channels, a schedule page with no player; the tune presses the channel's own entry there (its aria-label "On <channel>," - never one that names the channel as coming up next), scrolled into view first. Peacock 0.4.32.
- Resolved (2026-09-29 evening, "The menu ... comes nowhere close to the cursor"): a channel's menu opens at the point pressed, under a shield; it had opened at the middle of a row as wide as the schedule.
- Resolved (2026-09-30): the playback doctor watches a Peacock channel. Every Peacock row names the live player's address and the channel plays one level under it, which the doctor had read as the person browsing on, so a Peacock channel was never healed. A channel's page beneath its row's address is the channel's page. And on a service tuned by its own walk, a page whose own word for the channel names another one (the press landed on the wrong row) is a start that never came: tuned again, twice, then the failure stands for Retry. The adapter reports the channel as its guide's id, the word the tune was asked with.
- Verified (2026-09-30): two Peacock windows on different channels come back on their own channels after a restart (the kept record holds each window's channel; yesterday's pair on one channel was the wrong-row tune, recorded faithfully).
- Built (2026-09-30, "Does Apple have live tv we can incorporate? What about their formula one stuff"): **live events** from a
  service's own pages. The adapter names the pages (`videoEventsUrls`) and a reader (`videoEvents`) that lists the sporting events
  on them: id, title, address, start, whether it is on, the page's live mark, the series. Apple TV 0.4.0 reads its Formula 1 and MLS
  channel pages (every F1 session of the weekend with its time, including the Sky Sports feed; every MLS match of the week, the one
  on with its clock). Core reads them on the hidden work page a minute and a half after the start and every half hour (and at the
  tab's Refresh), keeps them on the device, and lists them on the Live tab ABOVE the grid, on now first then by start, an upcoming
  one within a week (a day and a half until 2026-10-05, "Where's the formula one stuff?"), one over gone (three hours after its start when the page names no end). A card on now plays where it
  is; one still to come is not pressable, its card says when (Today 3:00 PM, Tomorrow 1:50 AM, Fri 12:10 AM).
- Open (2026-09-30): the play press on an Apple TV event page. The event page has the same capsule Watch button a title's has and
  the adapter presses it, but Apple's player never appeared on the household's wall (a small window, twice; a hidden page refuses
  outright). The pick timed out and the empty window closed. To look at with a person at the wall: a real press beside the script's.
- Built (2026-09-30, "Can we group the live channels by service but give us quick jump to buttons for each service" / "Sort the
  groups by service name. Same with the buttons"): the grid is grouped by service, the services by name, a header a service, and a
  *Jump to* strip above the grid with the same chips as above Continue watching (the service's mark and name), each scrolling to its
  service's header. Core's order (type, then name) stands within a service.
- Built (2026-09-30, "Why does your screenshot not show apple in the jump to items"): a service's live events stand in the grid as rows
  too, under the service's header (type Sports, the series), so Apple TV groups and jumps like the others: one on now as what is on,
  one to come as its schedule, and one beyond the window saying when it starts. Within a type, event rows come before channels and
  order by time (on now first), channels by name - one total order (an event against a channel by time on one side and by name on
  the other made a cycle, and the sort came out scrambled). A press on an event row plays it as an event. Apple TV 0.4.1: a scorecard
  whose clock says Final is over, not live.
- Fixed (2026-09-30): the brain's runtime is loaded afresh at every start - WebView2's HTTP cache had served a prism-runtime.js from a
  start before, so a deployed core did not run until the cache's heuristic lifetime passed. The brain profile's disk cache is cleared
  before it navigates (its cache only; nothing stored).
- Built (2026-09-30, "Let's make the filters buttons across the top of the live screen work as 'mode' buttons ... Preferably we turn all
  the filters on live into fun modes for people to choose from"): **modes**. Every type chip but All is a mode with a symbol. Picked, it
  filters the grid as before, puts a title above the grid (SPORTS MODE), and marks each program on now with a symbol: in Sports mode
  the sport's, read by core from the program's and channel's words (scores.ts sportOf: a word of the sport or its league; soccer's words
  first so a bare "football" is the American one; the trophy when nothing says), else the mode's. The mode is kept on the device
  (host-prefs live.mode) and comes back when the tab opens again; All is no mode.
- Built (2026-09-30, "Can we throw today's key sports game scores at the top of the live screen?"; 2026-10-01: "Put all the MLB scores
  under 1 heading", "Team logos, emblems, states, etc. make it more graphical", "I don't think in sports mode that we need the expansion
  pill. Just show the scores"): **scores**, in Sports mode only, shown outright under the title with a caption ("Scores · Thu Oct 1 · 4
  games · ESPN · read 12:10 AM"). A row a league - the sport's mark and the league's name at the left, a league with a game on first -
  and a card a game: each team's mark, a stripe in its colour, its name and score (the winner's in amber), then a state line with a dot
  for on now, a check for over, a clock for to come, the period or Final in the source's own words, and who is showing it; in play
  first; in-play cards in amber. Every picture and colour is the source's, fetched as itself.
  - The last 24 hours, not the day (2026-10-01, "Do you have a way to pull together all scores from the last 24 hours?"): ESPN's
    header lists only the current slate, so every read is merged into what is kept (a game a day after its start, on the device for
    the boot), and the per-league day pages - today's and yesterday's, every league - are read hourly in a hidden page of Prism's own
    browser (they refuse the host's fetch; a browser is what Prism is). The header is read every quarter hour in the background and
    every two minutes while the tab is open in Sports mode. In play first, then finals newest first, then to come; "yesterday" on a
    card that is not today's.
  - The cards lie in one grid across the page, the same size each, their widths sharing the page; two rows at most, with "Show all N"
    as the last cell to drill down and "Show fewer" to come back ("place in cards if fits in under 2 rows").
  - A live game a signed-in service carries gets a Watch chip (2026-10-01, "If the game is live, and we have access to it through one
    of the services, make sure we can click through"): ESPN's broadcaster names map to the wall's services (Apple TV, Peacock,
    Paramount+ and CBS, Prime Video, Hulu, Disney+, Netflix, Max, Tubi, YouTube; ESPN's own networks have no adapter), and the
    service's events and live channels are searched for the game by a distinctive word of each team's name (ESPN's "Red Bull NY"
    against Apple's "New York Red Bulls"). The press plays the event or tunes the channel in the big window.
  - Decision (2026-10-01, "Can't find a sports api or something a little more reliable?"): free and keyless, nothing beats ESPN's data;
    TheSportsDB's free tier has results but no live scores and needs parameters the host's fetch refuses; the leagues' own feeds are
    four shapes for an incomplete set (no NFL); a commercial API (API-Sports, Sportradar) would take a key the person supplies, the
    TMDB pattern, and is open as a later option. ESPN read two ways is the answer for now.
  - 2026-10-01: Sports mode takes every event row too (an event's type is its series - Formula 1, MLS - and the Sports filter had left
    Apple TV out: "Why isn't Apple listed?"); the strip is "Upcoming live events" ("Live events on now and upcoming" while one is on);
    the cards' names and scores larger, a long set score smaller. Apple's site lists Formula 1 and MLS only; Friday Night Baseball is
    seasonal and off at the moment.
  - 2026-10-01, later: an event row's type is Sports and its series (Formula 1, MLS) a label on the row ("Would rather these fall
    under sports"); the explanations live in tooltips, not on the screen ("A little verbose"); a start within the next twelve hours
    is said as "in 3 h 42 min (4:30 AM)" ("Confused by some of these times like today at 4:30 am").
  - 2026-10-01: the scores caption is gone ("Remove the 13 games ESPN line"); the count, the source and the read time sit in the mode
    title's tooltip.
  - 2026-10-01, News mode - what the live news shows reported ("is it possible to show headlines for the news being covered by a specific
    live news show, so you can click the headline to watch the show" / "I would like it tied to that network and what they're reporting
    on. Preferably avoid pundit articles. Stick to our ideals"): the networks publish the segments their shows aired as feeds - CBS News
    one per show (the Daily Report's clips, the Evening News, CBS Mornings, Face the Nation ...), NBC News one feed whose NBC News Now
    segments sit under "/now/video/". An adapter pairs a feed with the channel that carries the show (`newsFeeds`: channel, show, feed,
    only, name; news-feeds.ts); core reads a paired feed every ten minutes while News mode is open, through the host's static fetch,
    one fixed address, nothing of the household in it. Under NEWS MODE a group a show on now ("The Daily Report on CBS News 24/7"), a
    card a segment newest first as the network lists them, two rows with Show all, a press tunes the show's channel in the big window.
    Every word is the network's; Prism ranks nothing. Left out, each a named rule in the group's tooltip: the networks' opinion
    sections (never paired), a full-episode entry, a shopping segment ("Deals", "Exclusive discounts"). A pairing without a show
    (a channel's feed whatever is on) exists in the model but is not shipped for CBS's 60 Minutes and 48 Hours channels: they play
    reruns while their feeds carry the show's site (schedules, podcasts), which is not what aired.
    - 2026-10-02, a front page, not cards ("I would maybe like the headlines to look like newspaper headlines with grouping and linkage by
      service name. But I don't want to take up any more room"): a masthead a network (its name in a serif, the show on now in italics,
      and the channel on its service as a chip that tunes it), a rule under it, then the headlines in a bold serif set down three
      columns like a page with a hairline between, the time in small type after each; nine at a time, "N more" / "Fewer" at the right.
      NBC's four section feeds (news, US, politics, world) merge into one group on their "/video/" items - the segments NBC's shows
      aired, which NBC News Now carries; the guide's "CBS News 24/7 Mornings" pairs with the CBS News Mornings clips.
    - 2026-10-02, Entertainment and the other modes ("let's go to entertainment next, ideas?" / "Yes proceed but add 3. I love it most"):
    - A channel named after one show, given no category by its service, is filed under the Live type TMDB's first genre names
      ("Are We There Yet?" to Comedy, "Below Deck" to Reality), labelled in the row's tooltip "by TMDB's genre for <show>"; Prism's own
      rule on the name stands where TMDB names nothing (live-titles.ts: the channel words that mark a name as a channel's, the exact-
      name acceptance of TMDB's answer, the genre-to-type map). Entertainment fell from 45 channels to 28 on the wall.
    - The Now-on strip, in every mode but Sports and News, behind a "Now on" checkbox on by default (host-prefs `live.nowOn`): a poster
      a show on across the mode's channels - the program on now, or the show a loop channel is named after - where TMDB matched the
      name exactly; TMDB's year and rating and the channel under each, in the guide's own order (Prism ranks nothing); one row, the
      rest behind "N more"; a press tunes the channel. TMDB is asked one name at a time, 120 ms apart, each answer kept a week
      (store `live:titles`); the strip redraws every four seconds while answers are pending, then every two minutes.
    - The show's progress on its poster (2026-10-02, "If the show has already started can we show the lapsed time on the poster? Maybe
      show the part of the poster in the elapsed time space as greyscale and color in the time remaining space"): the elapsed share of
      the width in greyscale (made once from the kept picture, a shade darker), the rest in colour, an amber hairline where now is;
      "42 min in, 18 min left" in the tooltip.
    - Blocked: Peacock's loop channels (thirty rows saying "No schedule listed") come from the live player's guide, where a schedule
      renders only for the channels scrolled into view, and the player page bounces to sign-in while the household's Peacock session
      is lapsed. A scroll walk of that list in the adapter's read is the fix, once signed in (B-316).
  - 2026-10-02, Movies mode ("Movies please"): a channel counts in a mode for what is on now as well as for its own type - in Movies while
    TMDB says the program on now is a film, in Documentary while its genres say so (the same lookups the Now-on strip makes, nothing
    new asked). The chip's count includes it; the row keeps its own type on its second line and its tooltip says "Listed under Movies
    while Collateral is on, a film by TMDB's word". Movies went from Peacock's three loop channels to those plus whatever is showing a
    film now. The elapsed share on a poster uses the program's real start, not the window's edge the guide cuts it to.
  - 2026-10-02, Kids and Local ("Proceed"):
    - TMDB's US rating on a Now-on poster's line (a second call a title, content_ratings for a series, release_dates for a film, kept
      with the title): "2013 · 8.0 · TV-G · Kids & Family Fun". In Kids mode the rating is bold, and one that is not a children's rating
      (TV-Y, TV-Y7, TV-G, G) is amber so a parent sees it; nothing is hidden, the tooltip says "rated TV-PG (TMDB's US rating), not a
      children's rating".
    - Local mode: a station's channel - a network's city news ("NBC Boston News", "News 12 New York") - files under Local by a named rule
      on the name (live-guide LOCAL_NAME), with a map-pin symbol; Paramount+'s /local/ addresses already did. Seven Peacock stations on
      the wall. No Now-on strip in Local (nor News and Sports). Later: the household's own station first by a pick in settings (Prism
      guesses no location), and the stations' own feeds paired as News mode's are.
  - Decision (2026-10-02, "local for me would be Centre County PA. So none of these other local items would make any sense ... remove
    the local category unless you can make it actually local"): the Local mode is gone as a mode of other cities' stations. The name
    rule and the six NBC stations' feeds (which do answer, nbcboston.com/news/local/feed/ and the like) were built and taken out the
    same evening; the stations file as News by their names. Local stays only for a station a service assigns as the household's own
    (Paramount+'s /local/ pages), which no service on the wall lists yet. What would make it actually local: a station pick in settings,
    or a service's own local assignment; the station-feed pairing (`newsFeeds` with `local: true`) remains in the model for that day.
  - Review fixes (2026-10-02): a channel counts in Movies only while the very film that was looked up is on (the guide's own reading of
    the schedule, programOnNow); "deal" in a headline is a story, the shopping rule names the segments; a kept channel is dropped for a
    fresh one's address only when the fresh read holds that address once (Peacock's channels share one player address); the poster's
    elapsed share moves with the minute and shows nothing when only "what is on" is known; no TMDB queue without a key; the grey posters
    are capped at 64 and made from the kept file only; a show's name may hold words like family, court, live - TMDB's exact-name test is
    the judge.
  - 2026-10-02, the mode walk ("Reality mode" / "Comedy" / "Continue"): one poster a title where a show is on two channels ("2 channels",
    the first is the press); a TMDB match needs twenty votes (LIVE_TITLE_MIN_VOTES - ION, REELZ and Love Nature had matched obscure
    titles by their letters alone; the title cache moved to live:titles:v2); the grey half waits up to ten seconds for the art cache
    to keep the poster (a first draw had left the elapsed part a blank block); an empty strip says nothing.
  - 2026-10-02: the broadcaster table (ESPN's "Peacock", "CBS" to the wall's services) moved from core to each adapter's `broadcasters`
    list - service knowledge in the adapter (see "What an adapter declares" above). A name matches when ESPN's is it or begins with it
    as a word.
  - 2026-10-02: a "News Headlines" checkbox beside the mode title, on by default, kept in host-prefs `live.newsHeadlines` ("Let's add a
      checkbox to display the news headlines ... enable it by default. Persist the setting for next time"); off, the front pages are
      gone and the feeds are not read.
    - Decision: no captions. Reading a stream's caption track means fetching the manifest the player fetches under the household's
      session (a private endpoint, docs/third-party-services-policy.md), and captions are speech that only a language model could turn
      into a headline, which Prism neither ships nor calls. The free public streams' caption tracks remain a possible later "on this
      story now" mark against a headline that already exists.
    - Decision: Wikipedia's "In the news" (cross-source, editor-chosen under published criteria) is the other transparent headline
      source, a possible second strip; not built.
    - Fixtures: tests/fixtures/news (the real feeds, 2026-10-01); tests/news-feeds.test.ts.
  - 2026-10-01, a walk of every mode: Prism's name rules gained Comedy, Reality and Drama (Peacock's "Black-Led Comedy" and "Classic TV
    Comedy" had fallen to Entertainment; a Movies word still wins, so "Comedy Movies" is a movie channel); "(Prism's guess)" moved from
    the row's second line to its tooltip; a channel the player had reported by its slug and the guide lists by its uuid under the same
    path is kept once (video.keepLive drops a kept channel at an address a fresh one names).
  - 2026-10-01: the events strip is gone ("Upcoming live events are all repeated in the schedule below. Therefore there is no reason
    for this row, right?" - yes: it dated from a plain grid where 126 channels had pushed the events out of sight, and the grid has since
    been grouped by service with Apple TV first and a Jump to chip). Every event is a row under its service; one on now says LIVE in
    amber on its second line and its program block is on now; one to come says "Starts in 3 h 27 min (4:30 AM)" within twelve hours.
  - 2026-10-01: the Live tab's grey text is ink where it is information on its own ("Too much gray text on gray. Sometimes your contrast
    choices are painful"): the time line, a row's "Starts ...", a block's start time, the card's league and state lines, "Jump to" and
    the reading note. Grey stays only on a row's service line under its name (win-host-spec section 5). A rule under the time line too
    ("1 more row grid line between the times and the first channel").
  - 2026-10-01: a faint rule under every row, names and schedule alike ("Give the episode guide a bit of a grid please"); the half-hour
    rules down the schedule were tried and dropped the same night ("remove those and go with horizontal").
  - 2026-10-01: the service headers above each group are gone ("Let's get rid of the plain text 'Apple TV' above that column of Apple
    TV logos"): the chip above and every row already name the service. A group begins with a gap; a Jump to chip brings its first row
    into view.
  - 2026-10-01: the guide status line beside Refresh ("Peacock 24 channels, read 9:14 PM ...") is gone too ("a lot of unnecessary label
    text to the right of refresh"); it says only "Reading the guides..." while one is read, and each service's count and read time sit in
    Refresh's tooltip.
  - 2026-10-01, the Watch hub: the header's status line ("Paramount+ . South Park . South Park") and its control verbs are gone ("Get rid of
    the paramount South Park South Park at the top of watch ... these controls should either be within the big window or removed"). The
    verbs sit on the big window's bar beside the service's mark; the title is the bar's tooltip, on the big window and the multiview ones. The source is ESPN's scoreboard header,
  its own strip of the day's key games across the leagues in season, one bare address, no key, nothing of the device in the call
  (section 19/22); every number is ESPN's (section 5). Read when the bar is drawn and every two minutes while the tab is open in
  Sports mode, never otherwise.
  - Decision: ESPN's per-league scoreboard addresses answer 403 to Prism's own agent (they take a handful of known clients and refuse
    the rest, a browser string from a non-browser included); Prism does not disguise itself (third-party policy), so the header feed,
    which answers Prism as itself, is the source.
- Known: a pop-up channel with no schedule listed (Paramount+'s Dana White's Contender Series) has a blank row that says so; it still tunes.
- Not done: Paramount+'s channel logos are inline drawings, not images with an address; its rows keep the service's mark.
