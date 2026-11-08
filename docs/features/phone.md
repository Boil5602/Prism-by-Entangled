# The phone: a keyboard for the wall, and private listening

2026-10-03:

## What a person does

1. Prism menu, **Pair a phone…** A QR code over the wall (MainWindow.PairPhone.cs). Scan it with the phone's camera; the page the
   host serves opens (Services/RemotePage.cs), with the pairing token in its address. The card closes when the phone connects.
2. **Keyboard.** Press into a field on the wall (a sign-in page's email box, a search box), type on the phone, press Send or Send +
   Enter. The text lands in the focused field; the arrows, Enter, Backspace and Tab are keys below the box. Above the box the phone
   names what it is typing into, in the page's own words ("Email or mobile number", "Netflix · text · 3 characters there"); when
   nothing on the wall is focused it says so and Send is off. The field's contents are never shown, only how many characters it holds
   (2026-10-04). The strip also says the field's role as the wall's browser
   reads it - *username* or *password*, from the autocomplete hint, the type, or a password field beside it in the same form - and
   a password on the wall is typed into a masked box on the phone (Show to peek), so the phone's own keyboard neither learns nor
   suggests it. Whether the wall's password manager offers to save is the page's doing (its own markup); the phone's text arrives
   through the browser's input pipeline like a keyboard's, so the offer should come as it would for one - to be seen on a real
   sign-in.
   A username or password on the wall is typed into a sign-in form's own boxes on the phone (autocomplete `username` and
   `current-password`, inside a form), so the phone's password manager - Bitwarden, 1Password, the phone's own - offers to fill it
   (2026-10-15). The manager fills the phone and
   the person presses Send (or Go, which is Send + Enter), one field at a time as for anything typed; Prism fills nothing itself and
   keeps nothing. The page is served from the PC's address, not the service's, so a manager matches no login by itself: the person
   searches the vault for the service, or adds the Prism page's address to the item once. A manager that fills both boxes at once
   leaves the password waiting in its box until the wall's password field is focused.
3. **Listen.** Earbuds in, press *Listen on this phone*. The wall's sound plays on the phone. The wall keeps playing for the room at
   Prism's own mute and volume, which the phone's stream undoes, so the phone hears Prism at full and has its own volume
   (2026-10-04,; B-472, 2026-11-01: by the captures' gain, never by the playback device). Two ways to carry the sound, swapped under the page's options
   (the ⋯ menu): *keeps playing in the background*, a live MP3 the phone's own player fetches, which goes on with the page put away
   or the screen locked, a few seconds behind the wall (the default on an iPhone); or *low delay*, a tenth of a second behind, which
   a phone stops when the page is hidden (the default elsewhere). The page's own volume is under the options too, 100% unless moved;
   an iPhone ignores a page's volume and keeps its own on the buttons, and the page says so there. The tab is *Private Listening*. In
   the background mode the status line says how many seconds the phone holds (that is how far behind the PC it hears) and, while
   filling, a share of what it needed last time before it played; a pause from the Music tab reaches the phone as many seconds later
   as its sound is behind, with the lock screen's entry, and the player is never held (B-473, 2026-11-01: it used to pause and fetch
   the stream fresh, and an iPhone's Safari drops a paused live stream's connection within seconds and would not fetch it again; then
   to play on muted, and iOS put the muted player away within seconds). A stream that ends or errs is fetched again at once with a
   fresh ticket, and a player the phone paused on its own (the earbuds out) fetches it again on the lock screen's Play, which leaves
   the PC alone while it plays; more than three fetches in two minutes end the listen and say so (2026-11-01 evening, "Fix it": the
   day's two listens ended on the player's own pause and on a dropped connection, Safari dropping the stream within seconds either way). When listening starts the page asks *Mute Prism in the room while this phone listens? Other apps on this PC keep their sound.*
   under the button, with *Mute Prism in the room* and *Keep it playing* (2026-10-23; it had muted by itself with a checkbox to turn
   that off). It is Prism's own mute, the one switch (B-472 below); the phone hears on. The sound starts first and the room plays on
   until the answer; a mute the phone asked for goes back when the listen ends (`POST /audio/wall-mute`).
   While the phone listens, its lock screen and Control Center show the song playing in Prism, with its art from the service's own
   artwork address, and their play, pause, previous and next act on that song as the Music tab's buttons do (2026-10-27). The entry follows the phone's own sound: it shows what the
   PC played as many seconds ago as the phone is behind, from the polls' reads kept that long, so a change of song reaches the title
   and the earbuds together (2026-11-01,: the phone heard the PC eleven seconds late and the entry showed the PC's present). The Music tab stays the PC's present,
   since its buttons act there. With the Video player on the PC the entry carries the title on
   screen, its episode and poster, with play, pause and the 15-second skips.
   With nothing playing in Prism the entry reads Prism, and its pause ends the listen. The entry's pause and play act on the PC only in
   the background sound mode: iOS fires the pause for its own interruptions too (the page put away in low delay, a call, another app's
   sound), and in low delay any of those ends what the phone hears, so there the lock screen's pause ends the listen, as before,
   and never touches the PC (2026-10-27). Previous, next and the skips are
   presses only, so they act on the PC in both modes (2026-10-28). The picture on the lock screen carries a
   Prism mark in its bottom-right corner, an eighth of its area, about a third of its width (2026-10-27,); it is
   composed on the phone from the service's picture, and a picture whose host will not share it with a page stays plain. Android's
   notification reads the same data (Chrome's Media Session), with the picture's size and type declared as it asks. The entry's
   clock is the PC's elapsed and total each poll, run on by the phone between polls (2026-10-27).
   *Mute Prism* on the Music, Video and Listen tabs and the visual is one switch (the Listen tab's own button since 2026-11-01,: the Music tab's is an icon in its transport, shown only while a title plays) with one meaning (B-472, 2026-11-01,; before it, 2026-10-27, the same button muted the PC's playback device while this phone
   listened, every app on the PC with it, and read Unmute for either): Prism's own sound in the room, whether or not a phone listens.
   The PC takes Prism's audio sessions to the floor the room in step uses (SessionMuter.RoomMuted, `ui.roomMute`), and the captures a
   phone, the listen page and the visualizations hear multiply it back up, so the listeners and the meters hear the music while the
   room hears nothing; other apps on the PC and the playback device are never touched. Like every app on a desktop, and on a TV box
   Prism's mute simply is the room's. The page mutes are audio focus, the breaks and the holds, and stay what they were: a page muted
   for those is silent for the listeners too. `/now-playing` carries `wallMuted`; there is no device mute or `device-mute` event.
4. **Music.** While the Music lounge is on: the card (the service and the collection it holds, the track with its art from the service's
   own artwork address, "0:20 of 1:40" with what is left and a thin bar advanced each second between polls), the transport (previous,
   play/pause, next, thumbs, Mute Prism on PC - the buttons read the PC's real mute), the order chips (In order / True shuffle / Reverse
   and a standing Repeat, the PC's own choices and limits: a station has no order, a service without track lists has no true shuffle)
   and the services' Quick play as an accordion (`GET /music/quick`, `POST /music/play`, `POST /music/repeat`; 2026-10-04).
   The service playing now leads the list, its head saying *Now Playing* beside a five-bar meter drawn from the PC's own bands
   (the visual's `/viz/bands` socket, opened while the Music tab shows a playing service and closed when it does not; 2026-10-29). With nothing playing the stage's
   service leads.
   Under the accordion, with a gap, *Recent stations and playlists*: the last five collections played across the services, flat rows
   under the service's name, a tap playing one as the accordion's rows do (`recent` on each source of `/music/quick`; 2026-10-29,). The PC's Quick play has the same section.
   While a pick is still loading over a song that plays on, the work line carries *Cancel*: the pick is dropped on the PC
   (`POST /music/cancel {tile}`, core's cancelMusicPick: the pending clears, a track-list read under way is let fall, and the page's
   adapter is told, Apple's dropping the play after its setQueue) and the song plays on; 2026-10-29,. The PC's block has the same
   Cancel beside its loading line.
   A tap on the card's picture opens the lounge visual on the phone (2026-10-27): the PC's own bands (its loopback
   FFT, 48 a frame at 30 a second over the `/viz/bands` WebSocket, the pairing token) drawn on the phone: Sunrise Meadow first (the
   lounge's own scene, Tableaus.cs SunriseMeadow redrawn move for move from the same 24 levels; (asked for the sunrise scene first)), then Bars, Ribbon and Particles. There is no "Like the PC" entry: with one scene ported it drew a
   stand-in for the other fifteen under that name (2026-10-28); the PC's other scenes are ported one at a time, by name, as asked. Every style takes the stage's palette; the view takes no pinch
   or double-tap zoom, and its details and buttons keep clear of the camera cutout on every side, in landscape too (2026-10-28,) (core's, tinted toward the art) and its artwork mode (2026-10-28): *backdrop* draws the art blurred and dimmed behind the scene with the PC's slow
   drift (the scene's sky becomes a wash so the picture shows through), *focal* draws it sharp and centred over the scene at the PC's
   size (in portrait, over the sun's travel in Sunrise Meadow, the sun keeping the landscape's proportions to the picture, its size
   and travel off the width, so the rays come from behind the art and the disc stays hidden; 2026-10-28); in landscape the details keep to the column left of the art, each line cut with an
   ellipsis, so none runs across the picture (2026-10-28). Installed on an iPhone, the Music tab shows once a note that the Now Playing title can open a different web app, with
   Open in Safari (docs/ios-now-playing.md, B-446). The stage's source can be another service's facet than the one playing (Apple Music's, idle, while Pandora plays), and
   that feed carries no art: the phone then shows the playing song's own art in the stage's mode (2026-10-28); the details sit at the bottom left as the PC's chrome has them (the service and collection, the title, the artist with the
   state, the album, the clock run on between polls; "Should show the details normally at the bottom left"), rising above the buttons
   while they show (a tap on the scene brings up the transport with them: Previous, Play or pause, Next and Mute Prism, the Music
   tab's own presses with its state; 2026-10-28); there
   is no Full screen button, since an iPhone puts only a video full screen and from the home-screen icon the
   page already fills the screen; Full screen, Close and the style under the picture, fading after a few
   seconds (a touch brings them back); the screen stays awake while it is open; the music, the listen and the PC are untouched.
   A music ad break (the adapter's signal, core's audio intermission) reads *an ad is playing* on the card, *Ad break* for the title
   when the service names none, and the same on the lock screen; while this phone listens the PC silences that page itself for the
   stream, so the ad is not heard here, and the speakers keep whatever mute they had (2026-10-27,; `/now-playing` carries `ad` per source).
   A service's actions sit on its bar (2026-10-27,; 2026-11-01): the service's mark, its name over its status and meter, and four chips: *Play <service>* or *Start over*
   (amber, acts at once), *Playlists*, *Stations*, and the song playing (add it to a playlist, or make a station from it). A list chip
   opens the entry on that list alone, lit while it is open, and folds it again when pressed a second time; a chip that cannot act now
   is dim and opens the one-line reason instead (its lists still being read, nothing playing, the adapter's own reason). Nothing opens
   by itself. A pick folds the entry as before, and a done add says *Added <song> to <playlist> on <service>* on the work line and folds it.
   A signed-out service keeps the old fold, its one row the way to the PC's sign-in. The add and the station are
   the PC's own lookup (docs/concept-scenes.md, Decision 2026-09-16):
   the service's page searches for the song in the person's own session, core decides the match strictly, and the line reads
   *Found on <service>: <title> · <artist>* (with the percent and its reasons when it is a lone partial hit), *<service> has
   something like <song>. Which one is it?* with the candidates to pick from, or *<song> is not on <service>*. Then the service's
   playlists as *Add to <name>* (the service's own curated lists greyed) and *Create station from this song*; the result is said
   under them. `POST /music/lookup`, `/music/lookup-state`, `/music/lookup-pick`, `/music/add`, `/music/station`, each `{tile,...}`.
   - A tap on a collection while something plays offers *Play now* or *Play after this track*. Play now cuts the sound at once (every
     other playing source is paused), folds the list, and the card becomes the new service and collection with "Loading…" and a blank
     poster until the PC's pending pick clears and the page names the track; the work line pulses with the PC's own words and counts
     ("Reading the track list of Vibes on Apple Music 1,100 of 1,908…", "Queueing in reverse…") and ends with "Playing Vibes reverse on
     Apple Music: …". *Play after this track* queues one pick in core (`POST /music/play {"when":"next"}`, `DELETE /music/next`), shown
     under the card as "Next: … Drop"; it starts when the playing page names another title or stops at its end, never on a pause.
   - The chips act on the pick in flight before the card's source (a reverse pressed while a pick still loads goes to that pick); the lit
     chip is the PC's standing order only when it is for the collection playing now. While a Prism-made queue plays (true shuffle,
     reverse) the page names no playlist, so the card's collection falls back to the standing order.
   - "Up next on Apple Music: … by …" under the card while no pick is queued: Apple Music's player holds its queue, so the next track is
     readable; Spotify, Pandora and Amazon Music show none on the page without their queue panels.
   - **Restore the previous session** (2026-10-04): what the audible source held is written to the store as it plays (collection, order,
     repeat, track, spot; `music:last-session`); while nothing plays the Music tab offers it ("Restore the previous session? Vibes on Apple
     Music, reverse. So Tired by Spazm at 2:21"). Restore plays the collection in its order (a standing Prism order carries on at its
     saved spot), then asks the service's own player to jump to the track and seek to the spot (Apple Music adapter verbs `jumpto:` and
     `seekto:`); a station starts where the station starts; Spotify and Pandora have no player verbs Prism can reach, so they come back
     to the collection and order only. Verified live 2026-10-05:. `POST /music/restore`, `DELETE
     /music/restore`.
   - **After a restart no music starts by itself** (B-471, 2026-10-31). Every page came back on its last address, and Pandora's is a
     station play address, which autoplays, so an ad ran under the boot hold, muted, after every restart. Now only the music page that
     had the sound when Prism closed (`music:owner:<dash>`, written as the audio moves) comes back on its last address, held paused as
     before; every other music page comes back on its home page. Pandora's home page starts the last station by itself all the same (and
     its collection page too, probed the same night, with an ad first), so a service whose adapter says `resumesOnLoad` is play-gated when
     it is not the owner: the shell refuses the page's own play as a browser's autoplay rule would (`surface.setPlayGate`, kept across
     the page's navigations), and the gate lifts the moment a person asks for that service's music, a pick, Play, or a touch in the
     page, before Prism's own click lands. Restore the previous session is the way the music comes back.
   - A signed-out service's row opens its sign-in on the PC (`prism://app/:id/setup`) and brings up the Keyboard tab; a press on a
     signed-out source says so instead of sending into the service's gate (Pandora's).
   - The card is the stage's source, else a source that plays, else "Nothing playing" with the stage's service named; a paused leftover
     on another service never takes the card.
4b. **Video.** While the Video player is on: the Watch screen without the picture, for a phone (2026-10-04). The big window's title with its art (TMDB's poster as the PC's bar shows it),
   season and episode, the service, a seek bar (the spot goes when the finger lifts; off for a service whose adapter cannot seek),
   and the bar's own verbs: start over (the previous episode in the first 5 s, the PC's rule), back 10 s, play/pause, forward 10 s,
   next episode, skip intro (shown only while the service offers a skip, 2026-10-05, and for an ad's Skip the break knows of, 2026-10-29), captions (a sheet of the service's own
   subtitle and audio tracks as the PC's menu lists them, the one in use marked, a tap picks it on the PC, Close lets a service's own
   panel close - `POST /video/tracks`, `/video/track`, `/video/tracks-done`; a service without a tracks script gets its own captions
   button pressed on the PC instead, 2026-10-05), mute Prism on PC. The page's own error under the card in amber with a Retry
   button (2026-10-05, Netflix's and its screens: Retry is the `retry` tile
   command, which presses the page's own Retry through the adapter's videoCmd, or opens the title again where the page has none;
   the Upgrade button is never pressed). A service's own gate over its player (2026-10-13, Twitch's content disclaimer) shows in the same place in the service's words, its button's verb on the phone's button (`gate` tile
   command: the adapter's videoCmd presses the page's own button, on the person's press only). Below: Continue watching and My list as
   poster rows (the same cards and order as the PC's rows, 40 each), and Live as an accordion by service with what is on - a
   service's live events (Apple TV's Formula 1 and MLS) among its rows as on the PC's tab, the series before the event's name
   (2026-10-05,: the list had come from the channel guides alone). A press
   plays on the PC through the same calls the PC's own cards make (`GET /video`, `POST /video/play`, `/video/tune`, `/video/seek`,
   `/video/start-over`, and `/tiles/{id}/command` for the verbs). Never a picture: the services' video is DRM and Prism does not
   touch it (docs/third-party-services-policy.md); the sound comes by Private Listening.
4c. **Playlists** (2026-10-12). An accordion under the Video tab's rows,
   shown when the PC shows its Playlists tab (a TMDB account with lists linked, or lists already on the PC), its line saying how many playlists there are or which one plays. The lists with their completion ("3 of 12 completed · next: …") and a
   bar; New playlist asks a name. A tap opens one (on the PC too: the open list is the PC's open list) with Play (the resume point),
   Rename, Delete (Undo offered for a minute, as on the PC) and its items in the PC's order, completed ones faded, the one playing in
   amber; a tap on an item offers Play from here, Mark watched / not watched, Up / Down / To top (a Manual list only), Remove. While a
   playlist plays: Previous, Next, Stop after this, Stop now. Every change goes through the verbs the PC's own Playlists tab calls (`GET
   /playlists`, `POST /playlists`, `/playlists/open`, `/rename`, `/delete`, `/play`, `/edit`, `/undo`, `/move`, `/stop`). A title is sent
   from the phone's Details sheet (2026-10-13): *Send to playlist* lists the playlists and *New playlist…*, and the PC's own send job
   (`POST /playlists/send {target, source}`, the source as the PC's cards build it: a show sends all its episodes, a movie itself) is
   followed (`/playlists/job`) with its question before a large add put to the phone (`/playlists/confirm`). The sheet also carries
   *Add to My Watchlist* (TMDB, while an account is linked: `POST /video/watchlist {title, kind, on?}`; the PC places the title and
   writes after it answers, saying `working` until it is done, and the sheet asks again until then, up to twelve seconds, before it
   says On or Taken off, or that TMDB could not place the title) or, with no account, *Add to <service>'s My List* (`/video/listinfo`,
   `/video/list`), the same verbs as the PC's card menus. Walked on a phone 2026-10-14: the first press had added the title and said
   Taken off, from one read 1.5 s after the press. Since 2026-10-14 the sheet draws the PC's own Details verbs from the details'
   `actions` block, which core decides once (runtime.ts withPlay) for the PC's card and the phone alike: Play on each service that carries
   the title (the same candidate the PC's Watch on sends), the trailer, the list the PC offers (the TMDB watchlist while an account is
   linked, else each service's own list that Prism can change), Send to playlist only while playlists are on and with the source the PC
   sends, and the facts and rating lines in the PC's words. The card's own words stand in until the details arrive, or for a title TMDB
   has no page for. A Rent or Buy offer that one of the household's stores carries is a button, *Rent or buy on <store>* (2026-10-14):
   the store's own page for the title, opened on the phone as a link (its app when installed, else the browser), signed in as the person
   is there, with no referrer and no sign-in passed; Prism takes no part in the purchase. The same address the PC's purchase card shows
   as a code.
4d. **Search everywhere** (2026-10-14). The phone reads the search as the PC's Search draws it: one view in core (search-view.ts, the PC's
   `videoLookupView`; `GET /video/search`, `POST /video/search/view {genre?, app?}` under a filter chip) with the household's own
   titles, the top result when the words name one, one card per work with every service that carries it, the people (a tap searches
   their work: `POST /video/search {person: {id, name}}`), and the genre and service chips. Every word is core's - the lines under the
   cards, the "Play on X · offer" labels, the headings, the status line, why there is nothing - so a rule changed in core changes both
   screens; the PC's C# and the phone's JS only draw. Not yet walked on a phone.
5. **Options (⋯).** *Prism on PC: Music player | Video player* (the PC's own names for them, settled 2026-10-29) switches the PC's player (`POST /ui/route {"route":"prism://player/music"}`,
   dispatched through the PC's own player switch; `GET /players` says which exist and which is on). *Full screen on the PC* (2026-10-31) is the PC's own F11: the Prism window borderless
   across its monitor, or windowed again (`POST /video/full-screen {"on"}`); the button reads *Leave full screen on the PC* while the window
   is full, however it got there (F11 at the PC, a screen's Full Screen, this button), because the PC reports where its window stands and
   `GET /video/screens` carries it; one press of Leave puts the window back whatever made it full. The Music tab is only shown while
   the Music lounge is on. Add to home screen (the phone's own instructions; the icon opens the wall already paired through the manifest's
   start address), the sound mode, the page's volume, Refresh this page, Forget this PC. A support line (2026-10-21, donations live): one sentence that Prism is free, and entangled.world/support as a link that
   opens in the phone's own browser, never inside the companion page, so the Ko-fi button runs there too. *Watch settings* (2026-10-14) opens a full sheet of what core keeps, read in one (`GET /video/settings`)
   and saved a piece at a time (`POST /video/settings/<what>`, through the same core calls the PC's Watch settings make): the rows' orders
   and reverses, the ads look, the suggestion rows, the update pause and a refresh, The Binge's limits, animation and Kids mode, every
   category (edit, add, delete) and the titles hidden from The Binge. The PC's own settings (break covering's lists, performance) stay on the PC.
   When the PC's software changes the page (its
   version at `/remote/version`, a hash of the page and the host's version, written into the page itself as it is served), a banner says
   so and the page refreshes itself in five minutes, or at once on *Refresh now*; the page checks every twenty seconds and whenever it
   comes back to the front. Before 2026-10-14 the page took its first successful check as its own version, so one loaded while the PC
   restarted, or whose first check failed, never showed the banner.

- **Details from the phone** (2026-10-11): every card on the Video tab
  (Continue watching, My list, the lens rows and the categories) carries an i in its corner. It opens a sheet with the title's TMDB
  details as the PC's Details card has them: poster, year, certification, runtime or seasons, genres, TMDB's rating with its vote
  count, the overview, the cast, and where it streams, is free, or rents and buys in the US as TMDB lists them. Play on Prism plays
  the card. `POST /video/details {title, kind?, app?}` answers working until core's read lands (the phone asks again every 1.5 s),
  then ready with the details, or none with the reason (no TMDB key, not on TMDB). The same read the PC makes, nothing new leaves. Search everywhere's results carry a Details button too, the household's own titles and the catalog's.

- **Setting up from the phone** (2026-10-11): the Nothing is set up yet screen shows a pairing code under its button, so a TV with no mouse starts
  from the phone. The Video tab's Services section lists every built-in video and music service (the PC's catalog, put into the
  page when it is served) with its state here: signed in, signed out, set up, or not set up. Sign in on the PC / Set up on the PC
  opens the service's sign-in on the PC (`prism://app/<id>/setup?signin=1`; a service not set up yet joins its player first, as the
  welcome page's row does) and brings the Keyboard tab up, which types into the sign-in's fields. The phone never holds a password.
- **The cast, drilled through** (2026-10-11): a face on the Details sheet opens the person's page (`POST /video/person {id}`, TMDB's
  person with their films and series, newest first); each opens its own details.
- **A video's own description** (2026-10-11): a YouTube video has no TMDB page, so its Details
  sheet shows the service's own: the channel, the length, the date, the description and the creator's tags, from the same public page
  the tags come from, with About this channel opening the channel's page (`POST /video/channel {app, url}`: name, handle, counts,
  description, latest videos, each playable) and Open the channel playing its page on Prism. The PC's Details card shows the same.
  A Twitch video says its channel in its own line.
- **Posters** (2026-10-11): every card carries TMDB's poster beside the service's own picture, and the phone draws
  the poster first, since it draws every card tall; the service's picture is the fallback.

- **The card menu** (B-381, a long-press or a right-click on a card; 2026-10-15): Play, Details, the verbs the Details sheet carries, and on a
  Continue watching card the PC's own *Remove from X's Continue Watching* (asked once more; `POST /video/remove-info`, `/video/remove-continue`
  polled until done) or, where the service's site cannot remove, *Hide from Continue Watching* on the PC alone (`POST /video/hide-continue`).

## How it works

- The page is one static HTML page in the host, no build, no framework, served at `/remote` on the §6 listener (port 8471, the
  home network). Every call carries the pairing token core minted (`remote.ts`); a phone forgets the pairing with DELETE /pairing.
- Keyboard: `POST /keyboard/type {text, submit?}` and `POST /keyboard/key {key}` (core remote.ts). Core picks the target
  (`orchestrator.keyboardTarget`): a service's setup window when one is up, else the tile a person entered, else the screen. The host
  types through the DevTools protocol's own input (`Input.insertText`, `Input.dispatchKeyEvent`): trusted input into whatever the
  page has focused, as a keyboard's (SurfaceManager.PhoneKeys.cs). Nothing typed is kept or logged; the request body never reaches
  a log.
  That last part was not true until 2026-10-10: every request's body was in host.log, in the line for the http call that hands
  the request to core. The log's copy of a phone request now has no body at all, only its length
  (`ChannelParser.PhoneRequestJson(..., forLog: true)`, `BrainHost.CallLoggedAs`; ChannelParserTests).
- A title on this phone (2026-10-10): the Video tab's
  switch, A title you tap opens On the PC / On this phone, kept in the phone's own storage. On this phone, a tap opens the title's
  own address on its service as a plain link with no referrer: the phone hands it to the service's app when one is installed, to
  its browser otherwise. Prism plays nothing and passes no sign-in. It covers what carries an address: Continue watching, My list,
  the services' rows, search results and live channels. A catalog title (found through a service's own search on the PC) has
  none, and the page says it can only play on the PC. Page-side only, no route. Not tried on a phone yet: which services open
  their app, land on the title, or resume where the PC left off is each service's own doing and needs a walk on iOS and Android.
- The TMDB key: `POST /tmdb/key {apiKey}` (core remote.ts) keeps the person's own TMDB key where a key typed on the PC is kept.
  The TMDB guide's last code opens this page with `#tmdb`, which shows a sheet with one box and Send to Prism: the key was copied
  on the phone a moment before, and a long key is nothing to type with a remote. The box is emptied when it is sent and the
  phone keeps nothing. The answer says only whether a key is set. The key crosses the home network as the rest of the phone's
  requests do, in plain HTTP (section 6); a person who would rather not can type it on the PC, in the guide or in Watch settings.
- Listen: `POST /audio/stream-ticket` (core, §14) gives a short-lived ticket; the phone opens a WebSocket at `/audio/stream?ticket=`
  which the host redeems with core and serves (Services/ListenStream.cs): the shared browser's own sound through the process loopback
  the visualizer uses, 16-bit PCM at 48 kHz stereo in 20 ms frames, about 1.5 Mbit/s, each frame stamped with its time on the PC's
  stream clock when the page asks (`&stamp=1`, 2026-11-03). One capture serves every phone. The page plays it through the one player
  (`Services/ListenPlayer.cs`, the listen page's too) at that time plus the hold: three seconds with the house while the Music player has
  the sound, the network's floor plus a short lead on the Video player; a phone that falls behind has frames dropped, not queued. A capture
  that gives zeros while the browser's sessions show sound (2026-11-03 evening, B-475: the phones and the room
  silent together, since the room step plays that capture) is opened again when a session is born in the browser while the capture has
  heard nothing, or nothing for three seconds (`SessionMuter.Born`, `ListenStream.CaptureAgain`); the stream's minute line in the log says
  the raw level the capture gives before the gain. The capture is the visualizer's own (`ProcessLoopbackCapture.Take`, one a browser, shared):
  a second activation on the same browser gave exact zeros while the first heard the music, however and whenever it was opened. Proven the same
  evening with a scripted listener (`scripts/listen-probe.mjs`): raw 0.2077 in the stream's first ten seconds, and ducked under the room step
  0.000021 by 0.210 sent. The socket is watched:
  three seconds without a frame (the PC sends through silence too) and the phone replaces it with a fresh one, the old closed once the
  new is open so the PC never counts no phone in between; twice in a row with nothing, the listen ends and says why (2026-10-28,: an iPhone keeps a socket open by its own account after a short suspension and delivers
  nothing on it). The same ticket opens
  `GET /audio/live.mp3?ticket=`, a live MP3 at 128 kbit/s (NAudio.Lame, one encoder for every MP3 phone, started with the first and
  stopped with the last), served Icecast-style: `audio/mpeg`, no length, `Connection: close`. The phone's `<audio>` element plays it,
  which is the one kind of sound a phone keeps playing in the background; a phone that cannot take a chunk within a second is
  dropped. The process loopback taps AFTER a page's own mute and a session's volume and BEFORE the device volume: the person's mute
  and volume are the sessions' level (the mute is the room step's floor, SessionMuter.Step, B-472), and ListenStream multiplies the
  capture by the inverse of the level the muter confirms in force (LevelApplied, never the wish), so a phone hears Prism at full
  whatever the room hears. The playback device is never touched (2026-10-04 to 2026-10-31 it carried the person's mute and volume
  while a phone listened, SurfaceManager.PrivateListening.cs, and muted every app on the PC with it).
- Measured 2026-10-04 (desktop client): 200 frames in 4 seconds, real time; the capture starts with the first phone and stops with
  the last. Heard on the user's iPhone the same day after the audio context moved inside the tap (iOS unlocks only sound made in a
  gesture). The MP3 route: 80 KB in six seconds, valid frames from the first byte. Still to hear on the phone: the MP3 mode with the
  page minimized and the screen locked, and the mute separation.

## When Prism is closed (2026-10-23)

The phone's page lives on Prism, so a closed Prism used to leave the phone with nothing to load. The phone launcher answers in its
place: Prism's own exe run with `--launcher`, started by Prism each time it opens and still running after it closes. With Prism closed,
the phone's address (and its home-screen icon) shows **Prism is closed** and, for a paired phone, an **Open Prism** button. A tap starts
Prism on the PC; the page waits and loads Prism's own page once it answers. A phone page left open when Prism closes reloads into the
closed page at its next version check (each minute, and whenever it comes back to the front).

- A Prism that stops without closing (a crash) is started again after fifteen seconds, at most three times an hour. One a person
  closed stays closed until someone opens it.
- It cannot help a PC that is asleep or off, and it is home-network only, like the rest of the phone remote.
- Starting the launcher at Windows sign-in as well (so it is there before Prism has opened once) is not done yet: it is an entry in
  Windows' startup list and waits on a yes.
- Host pref `phone.launcher` (default on) turns it off; Prism then stops a running one at its next start.

## Decisions

- A login modal that fills the services' fields was asked for and declined (docs/roadmap.md): the phone keyboard is the way to type
  on a wall without one, and the browser's own password manager remembers the sign-in after the first.
- Plain HTTP on the home network (§6's trusted LAN); the token is in the QR alone, never on the status line or in the log.

## The room in step (2026-10-31)

"Where private is 3 sec behind, local should sync up to that delay", for music. While a phone
or the listen page listens and a music source has the sound, the PC plays the room behind by the slowest listener's lag, so the room
and the phone hit the beat together. How: the browser's own output is turned down to a ten-thousandth (-80 dB; `SessionMuter.Step`),
which no room can hear; the process loopback the phones are fed from is scaled before the tap, not cut (measured 2026-10-31: the
capture keeps its shape down to a ten-thousandth, no noise added), so the host multiplies it back up - only once the muter confirms
the sessions sit at Step, never on the wish, and never past full scale - streams it to the phones as before, and plays it to the
room through `Services/Audio/RoomDelay.cs`, a fifteen-second ring behind WASAPI, the reader the lag behind the writer, a short fade
on each move. Video is untouched: core says on only while the sound is a music window's (`isMusicTile`); a video taking the sound,
the last stream leaving, or the switch off puts the room live again.

- **Who decides.** Core (`orchestrator.ts`, `roomStep*`): the shell says which streams run (`listenStreams`), each listener says its
  lag (`POST /audio/lag` for a phone, `POST /listen/lag` for the listen page; counted only from a stream that runs, up to ten
  seconds), and core sends `ui.roomStep {on, delayMs}` - the slowest listener's hold (the figure it keeps itself at; its lag of the
  moment swings around it), a drift under 400 ms not a move. A lag is the
  sound the player holds plus a quarter second for the encode and the network, averaged over twenty seconds (one reading swings by
  seconds as the MP3 arrives in bursts). The live MP3 drifts further behind as it plays; past its first steady figure the player
  runs two percent faster until it is back, which the ear does not notice.
- **One clock for every listener** (2026-10-31 evening,; before it,:
  the Echo Show and a phone, both on the listen page). The first evening's design matched listeners to one another's measured lag, and
  the lag itself was unsteady: the PC's stream had no clock of its own, it sent what the browser's loopback handed it and nothing while the
  browser rendered nothing (between songs, at an ad's switch), so a sixty-second pull came two percent short of real time and every player
  starved and fell further behind at each gap, each by its own browser's rebuffering. Now the shared sound is paced (`ListenStream`'s
  pacer): exactly 960 frames every 20 ms from a short queue of the capture, a silent frame where the browser gave nothing, the oldest
  dropped past 300 ms, so the stream is real time by construction, and its frame count is the clock. `GET /audio/clock?ticket=` (the
  ticket that opened the stream, which only that page holds) answers where the page's own stream began on the clock and where the clock
  stands; the phone in background mode keeps its player three seconds behind it (`targetMs` in every lag answer, core's
  `ROOM_TARGET_MS`), nudged by rate when close, held by a short pause when early, and a player that holds more of its own accord (an
  iPhone's Safari holds seconds of a live MP3 before playing it) trims at five percent and says its real lag. The listen page does not
  use a media player for the live stream at all (asked why the phone kept saying it was catching up instead of buffering locally): it takes the PCM
  over `/audio/stream` and schedules it itself three seconds behind arrival, the low delay path with a longer lead, the same on every
  browser. So every listener plays the same moment at the same time, and the room sits the same three seconds back (the hold every
  listener reports is the target). A report still carries the lag of the moment (`lagMs`, measured against the clock)
  and the hold (`holdMs`); two pages on the house code count apart by an id each chose. A phone on the low delay path is left as it is:
  it follows the PC closely by design, and sits ahead of the room by the room's delay. Neither path holds its buffer by pitch any more
  (2026-10-31 night): the speed stays within a fifth of a percent on an error smoothed over a
  second, and an error past a quarter second is one short cut under a fade (docs/features/listen-page.md).
- **One player, one clock (2026-11-03,; before it,: an iPhone and an Echo Show, both on the listen
  page).** Each page had held three seconds behind the arrival of its own first frame, on its browser's audio clock, and corrected only a
  smoothed error past a quarter second, so wherever a start landed (an iOS context's late first tick, a queue toward a slow receiver) it
  stayed for the whole listen: at 09:52 that morning the two pages sat at 3.3 s and 3.0 s. Now the phone's Private Listening and the
  listen page run one player (`Services/ListenPlayer.cs`, spliced into both pages where they say `__LISTEN_PLAYER__`): the PC stamps
  every frame with its time on the stream clock, the page asks the clock once a stream opens (`GET /audio/clock`, the tightest round
  trip kept, the rest followed slowly) and plays each frame at its stamp plus the hold, the error smoothed over a second and taken by a
  speed within half a percent, past three tenths by one cut under a fade; a frame past its time (the page was held) is dropped, never
  played late. So two pages agree within a frame whenever either started, and a stop and a start change nothing. The hold is the house's
  three seconds while the Music player has the sound (the phone's Private Listening too: it had followed the PC within a fifth of a
  second and so sat three seconds ahead of the room it stood in), and following a picture (the Video player) the network's floor plus
  the short lead as before, grown 40 ms a stall and eased back while the network is clean, with each stall a cut as before. The
  background mode's live MP3 is the one player the PC steers: an iPhone's Safari takes no rate on it (8.1 s behind in every reading that
  day, the hold 3.0), so the phone's report says `shift`, and core's one rule (`orchestrator.ts listenerLag`: a lag more than half a
  second off the hold for fifteen seconds is shifted by the difference, once in thirty seconds at most, never past eight) has the host
  cut that stream nearer the clock or hold it back with silence (`ui.listenShift`, `ListenStream.Shift`: the frame at the seam faded out,
  the first after faded in), and the clock answer carries the total shifted so the phone's lag reads true. The rate trimming and its
  stall guards (B-464, B-473) are gone. Verified under stubs (`scripts/verify-listen-player.mjs`, a verify step: two pages fed with
  different delays sound the same stamp at the same moment; a burst after a hold is dropped; the close policy's floor, lead and cut) and
  by the core suite. Heard the same evening, and the Echo Show "negligibly but noticeably behind the iphone", the same after a stop and a
  start, with both pages reporting 3.0 s: the way from Silk to the Show's speaker, which the browser does not report. So the listen page
  has Earlier and Later beside Stop, 25 ms a press, kept on that device (`trimMs` in the player, taken off the house hold).
- **The switch.** "Room in step with this phone" on the Private Listening tab, and "Keep the room in step with a listener" on the
  PC's Listen page card (`GET`/`POST /audio/room-step`, the `roomStep` host call); on unless turned off, kept in the store
  (`audio:room-step`).
- **What it costs.** The room runs behind the PC's own player by the lag: Next pressed anywhere, the phone hears the new song at
  once and the room a few seconds later; stopped, the room's music stops a few seconds later. When the first listener joins, the
  room goes quiet for the lag and comes back behind; when the last leaves, it jumps forward to live. With a phone on the low
  delay path the gap is a fraction of a second.
- **Seeing it.** The Private Listening tab lists every listener's figures under the switch (the lag it measures, the figure it holds
  to), and the PC's log carries the same words on each change (`room step: on, N ms behind | 2 listeners:...`); no ids in either.
  The listen page loads itself again when the PC's page changes (a minute's poll of `/remote/version`), so a tablet left on it is
  never on an old one.
- **Safety.** The gain follows the muter's word for the captured browser tree alone, falls on any pass that cannot confirm the
  level, and the samples are clamped before the room hears them; turning off lowers the gain before the browser comes back up.
- **Ads stay silent.** A music ad break mutes the page at the same ten-thousandth the room step uses, and the first evening the stream
  multiplied the ad back up for the phones and the room (2026-10-31). A muted pass now tells
  the stream the level is not confirmed, so the gain is one for the break: the ad is silence on the stream and in the room. Prism's own
  intermission sound (the soundscape a person chose for the service's breaks) reaches the phones and the listen page too (2026-10-31 evening): the soundscape is a hidden page in the
  prism-ambient profile's own browser process, which the stream never captured; `ListenStream` now captures that process beside the
  services' browser while a break has made one, and the pacer adds its frames to the shared ones, each at its own tree's room-step gain.
  So a listener hears the break as the room does, and under the room step the room hears the soundscape in step as well (its tree sits
  at the same ten-thousandth, and before this the room step had silenced it).

## Which window the phone hears (2026-10-05)

 With multiview
on, the Private Listening tab shows a chip a window, big first, each with what it plays; the chosen one takes the audio the stream
carries (`GET /audio/windows`, `POST /audio/listen-window {tile|null}`; core's `setListenWindow`). The PC's speakers are muted while
a phone listens unless the phone's switch says otherwise, so the room keeps hearing nothing or, with the switch off, hears the chosen
window too - the person's choice. A swap keeps the choice; the last phone leaving gives the sound back to the big window (the host
clears it). A window that plays by itself while another is heard stays quiet, as a small window always did.

