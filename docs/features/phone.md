# The phone: a keyboard for the wall, and private listening

2026-10-03: "can we create a simple web app delivered via QR codes directly from the Prism software enabling keyboard entry from
phones. The app should also enable the private listening feature through the phone sound."

## What a person does

1. Prism menu, **Pair a phone…** A QR code over the wall (MainWindow.PairPhone.cs). Scan it with the phone's camera; the page the
   host serves opens (Services/RemotePage.cs), with the pairing token in its address. The card closes when the phone connects.
2. **Keyboard.** Press into a field on the wall (a sign-in page's email box, a search box), type on the phone, press Send or Send +
   Enter. The text lands in the focused field; the arrows, Enter, Backspace and Tab are keys below the box. Above the box the phone
   names what it is typing into, in the page's own words ("Email or mobile number", "Netflix · text · 3 characters there"); when
   nothing on the wall is focused it says so and Send is off. The field's contents are never shown, only how many characters it holds
   (2026-10-04, "look alike labeling for the fields on the screen"). The strip also says the field's role as the wall's browser
   reads it - *username* or *password*, from the autocomplete hint, the type, or a password field beside it in the same form - and
   a password on the wall is typed into a masked box on the phone (Show to peek), so the phone's own keyboard neither learns nor
   suggests it. Whether the wall's password manager offers to save is the page's doing (its own markup); the phone's text arrives
   through the browser's input pipeline like a keyboard's, so the offer should come as it would for one - to be seen on a real
   sign-in.
   A username or password on the wall is typed into a sign-in form's own boxes on the phone (autocomplete `username` and
   `current-password`, inside a form), so the phone's password manager - Bitwarden, 1Password, the phone's own - offers to fill it
   (2026-10-15, "How do we make the keyboard allow entries from password managers like Bitwarden?"). The manager fills the phone and
   the person presses Send (or Go, which is Send + Enter), one field at a time as for anything typed; Prism fills nothing itself and
   keeps nothing. The page is served from the PC's address, not the service's, so a manager matches no login by itself: the person
   searches the vault for the service, or adds the Prism page's address to the item once. A manager that fills both boxes at once
   leaves the password waiting in its box until the wall's password field is focused.
3. **Listen.** Earbuds in, press *Listen on this phone*. The wall's sound plays on the phone. The wall keeps playing for the room:
   while a phone listens, the wall's mute and volume act on the playback device (the TV or soundbar) and the phone has its own
   (2026-10-04, "We should have volume separation between the two"). Two ways to carry the sound, swapped under the page's options
   (the ⋯ menu): *keeps playing in the background*, a live MP3 the phone's own player fetches, which goes on with the page put away
   or the screen locked, a few seconds behind the wall (the default on an iPhone); or *low delay*, a tenth of a second behind, which
   a phone stops when the page is hidden (the default elsewhere). The page's own volume is under the options too, 100% unless moved;
   an iPhone ignores a page's volume and keeps its own on the buttons, and the page says so there. The tab is *Private Listening*. In
   the background mode the status line says how many seconds the phone holds (that is how far behind the PC it hears) and, while
   filling, a share of what it needed last time before it played; a pause from the Music tab pauses the phone's player at the same
   moment, and Play fetches the stream fresh, since the PC's pause alone would play on here until the buffer ran dry. When listening starts the page asks *Mute this PC's speakers while this phone listens? Other apps on the PC go quiet too until
   you stop.* under the button, with *Mute the speakers* and *Keep them on* (2026-10-23; it had muted by itself with a checkbox to turn
   that off). It is the playback device that is muted, so every app on the PC: Prism alone cannot be muted, since the phone hears
   Prism's audio after its own mute and session volume. The sound starts first and the PC plays on
   until the answer; a mute the phone asked for goes back when the listen ends (`POST /audio/private-mute`).
   While the phone listens, its lock screen and Control Center show the song playing in Prism, with its art from the service's own
   artwork address, and their play, pause, previous and next act on that song as the Music tab's buttons do (2026-10-27, "it is able
   to show the song title, album art, etc in the iOS now playing areas"). With the Video player on the PC the entry carries the title on
   screen, its episode and poster, with play, pause and the 15-second skips ("If we're listening to video, can we do something similar?").
   With nothing playing in Prism the entry reads Prism, and its pause ends the listen. The entry's buttons act on the PC only in the
   background sound mode: iOS fires the pause for its own interruptions too (the page put away in low delay, a call, another app's
   sound), and in low delay any of those ends what the phone hears, so there the lock screen's pause ends the listen, as before,
   and never touches the PC (2026-10-27, "why does it automatically pause the video I'm playing"). The picture on the lock screen carries a
   Prism mark in its bottom-right corner, an eighth of its area, about a third of its width (2026-10-27, "there is no indication that
   prism is the player", "I meant for it to cover about 1/8 of the total image"); it is
   composed on the phone from the service's picture, and a picture whose host will not share it with a page stays plain. Android's
   notification reads the same data (Chrome's Media Session), with the picture's size and type declared as it asks. The entry's
   clock is the PC's elapsed and total each poll, run on by the phone between polls (2026-10-27, "show the elapsed/total time").
   *Mute the PC* on the Music and Video tabs is one switch for the PC's speakers (2026-10-27, "When I mute the pc from the private
   listening tab option, it still shows unmuted on the main music tab"): it reads muted when either the person's wall mute or the
   device mute a listening phone asked for is on; while this phone listens it mutes the device, since the wall mute would silence the
   pages the stream carries; Unmute lifts whichever is on (`/now-playing` carries `privateMuted` beside `wallMuted`). While a phone
   listens the PC reads the speakers' mute every 1.5 s and tells core on a change (the `device-mute` event), so a mute key pressed at
   the PC, or the mixer, shows on the phones within a poll ("If the user unmutes the PC locally, will the app realize").
4. **Music.** While the Music lounge is on: the card (the service and the collection it holds, the track with its art from the service's
   own artwork address, "0:20 of 1:40" with what is left and a thin bar advanced each second between polls), the transport (previous,
   play/pause, next, thumbs, Mute Prism on PC - the buttons read the PC's real mute), the order chips (In order / True shuffle / Reverse
   and a standing Repeat, the PC's own choices and limits: a station has no order, a service without track lists has no true shuffle)
   and the services' Quick play as an accordion (`GET /music/quick`, `POST /music/play`, `POST /music/repeat`; 2026-10-04).
   A tap on the card's picture opens the lounge visual on the phone (2026-10-27, "Can I tap the album art ... and get the music lounge
   visual streamed to that area instead? Let the user full screen it without interrupting the music"): the PC's own bands (its loopback
   FFT, 48 a frame at 30 a second over the `/viz/bands` WebSocket, the pairing token) drawn on the phone: Sunrise Meadow first (the
   lounge's own scene, Tableaus.cs SunriseMeadow redrawn move for move from the same 24 levels; "What about trying the sunrise one, with
   the sun, birds, clouds, grass"), then Bars, Ribbon and Particles; the first choice, *Like the PC*, follows the stage's style where
   one is ported and takes the stage's palette (core's, tinted toward the art) and its artwork mode (2026-10-28, "Can we apply the album
   art over the visual like we do in the windows app?"): *backdrop* draws the art blurred and dimmed behind the scene with the PC's slow
   drift (the scene's sky becomes a wash so the picture shows through), *focal* draws it sharp and centred over the scene at the PC's
   size; the details sit at the bottom left as the PC's chrome has them (the service and collection, the title, the artist with the
   state, the album, the clock run on between polls; "Should show the details normally at the bottom left"), rising above the buttons
   while they show; there is no Full screen button, since an iPhone puts only a video full screen and from the home-screen icon the
   page already fills the screen; Full screen, Close and the style under the picture, fading after a few
   seconds (a touch brings them back); the screen stays awake while it is open; the music, the listen and the PC are untouched.
   A music ad break (the adapter's signal, core's audio intermission) reads *an ad is playing* on the card, *Ad break* for the title
   when the service names none, and the same on the lock screen; while this phone listens the PC silences that page itself for the
   stream, so the ad is not heard here, and the speakers keep whatever mute they had (2026-10-27, "I just listened to a Pandora ad.
   Reason they're not muted and identified on companion app?"; `/now-playing` carries `ad` per source).
   A service's entry opens on its actions (2026-10-27, "We should add an actions menu, to the quick play services"): *Play <service>* or
   *Start over*, *Play a playlist*, *Play a station*, and while a song plays, *Add <song> to a playlist* (the one playing included) and
   *Create station from <song>*. The list an action asks for takes the entry's place with *‹ Actions* above it; a pick folds the entry
   as before, and a done add says *Added <song> to <playlist> on <service>* on the work line and folds it. The add and the station are
   the PC's own lookup (docs/concept-scenes.md, Decision 2026-09-16; "add songs to a playlist cross service like I can do in the pc player"):
   the service's page searches for the song in the person's own session, core decides the match strictly, and the line reads
   *Found on <service>: <title> · <artist>* (with the percent and its reasons when it is a lone partial hit), *<service> has
   something like <song>. Which one is it?* with the candidates to pick from, or *<song> is not on <service>*. Then the service's
   playlists as *Add to <name>* (the service's own curated lists greyed) and *Create station from this song*; the result is said
   under them. `POST /music/lookup`, `/music/lookup-state`, `/music/lookup-pick`, `/music/add`, `/music/station`, each `{tile, ...}`.
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
     to the collection and order only. Verified live 2026-10-05: "picked up at 2:21 in reverse". `POST /music/restore`, `DELETE
     /music/restore`.
   - A signed-out service's row opens its sign-in on the PC (`prism://app/:id/setup`) and brings up the Keyboard tab; a press on a
     signed-out source says so instead of sending into the service's gate (Pandora's "Keep the music playing for free").
   - The card is the stage's source, else a source that plays, else "Nothing playing" with the stage's service named; a paused leftover
     on another service never takes the card.
4b. **Video.** While the Video player is on: the Watch screen without the picture, for a phone (2026-10-04, "a full watch (with no
   video) page for video ... Optimizes for mobile"). The big window's title with its art (TMDB's poster as the PC's bar shows it),
   season and episode, the service, a seek bar (the spot goes when the finger lifts; off for a service whose adapter cannot seek),
   and the bar's own verbs: start over (the previous episode in the first 5 s, the PC's rule), back 10 s, play/pause, forward 10 s,
   next episode, skip intro (shown only while the service offers a skip, 2026-10-05), captions (a sheet of the service's own
   subtitle and audio tracks as the PC's menu lists them, the one in use marked, a tap picks it on the PC, Close lets a service's own
   panel close - `POST /video/tracks`, `/video/track`, `/video/tracks-done`; a service without a tracks script gets its own captions
   button pressed on the PC instead, 2026-10-05), mute Prism on PC. The page's own error under the card in amber with a Retry
   button (2026-10-05, Netflix's "Too many people are using your account right now" and its screens: Retry is the `retry` tile
   command, which presses the page's own Retry through the adapter's videoCmd, or opens the title again where the page has none;
   the Upgrade button is never pressed). A service's own gate over its player (2026-10-13, Twitch's content disclaimer, "I want them to
   see the disclaimer attached") shows in the same place in the service's words, its button's verb on the phone's button (`gate` tile
   command: the adapter's videoCmd presses the page's own button, on the person's press only). Below: Continue watching and My list as
   poster rows (the same cards and order as the PC's rows, 40 each), and Live as an accordion by service with what is on - a
   service's live events (Apple TV's Formula 1 and MLS) among its rows as on the PC's tab, the series before the event's name
   (2026-10-05, "Isn't Live supposed to show the Formula 1 stuff from Apple?": the list had come from the channel guides alone). A press
   plays on the PC through the same calls the PC's own cards make (`GET /video`, `POST /video/play`, `/video/tune`, `/video/seek`,
   `/video/start-over`, and `/tiles/{id}/command` for the verbs). Never a picture: the services' video is DRM and Prism does not
   touch it (docs/third-party-services-policy.md); the sound comes by Private Listening.
4c. **Playlists** (2026-10-12, "Make sure I can manage playlists through the companion app"). An accordion under the Video tab's rows,
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
4d. **Search everywhere** (2026-10-14, "make the search and details screens on the companion app tied to it in the app so as changes
   are made they come to both"). The phone reads the search as the PC's Search draws it: one view in core (search-view.ts, the PC's
   `videoLookupView`; `GET /video/search`, `POST /video/search/view {genre?, app?}` under a filter chip) with the household's own
   titles, the top result when the words name one, one card per work with every service that carries it, the people (a tap searches
   their work: `POST /video/search {person: {id, name}}`), and the genre and service chips. Every word is core's - the lines under the
   cards, the "Play on X · offer" labels, the headings, the status line, why there is nothing - so a rule changed in core changes both
   screens; the PC's C# and the phone's JS only draw. Not yet walked on a phone.
5. **Options (⋯).** *Prism on PC: Music lounge | Video* switches the PC's player (`POST /ui/route {"route":"prism://player/music"}`,
   dispatched through the PC's own player switch; `GET /players` says which exist and which is on). The Music tab is only shown while
   the Music lounge is on. Add to home screen (the phone's own instructions; the icon opens the wall already paired through the manifest's
   start address), the sound mode, the page's volume, Refresh this page, Forget this PC. A support line (2026-10-21, donations live: "we should make sure the link opens to a
   mobile browser not within the prism companion app"): one sentence that Prism is free, and entangled.world/support as a link that
   opens in the phone's own browser, never inside the companion page, so the Ko-fi button runs there too. *Watch settings* (2026-10-14, "Let me edit as
   many of the watch settings as possible from the companion app") opens a full sheet of what core keeps, read in one (`GET /video/settings`)
   and saved a piece at a time (`POST /video/settings/<what>`, through the same core calls the PC's Watch settings make): the rows' orders
   and reverses, the ads look, the suggestion rows, the update pause and a refresh, The Binge's limits, animation and Kids mode, every
   category (edit, add, delete) and the titles hidden from The Binge. The PC's own settings (break covering's lists, performance) stay on the PC.
   When the PC's software changes the page (its
   version at `/remote/version`, a hash of the page and the host's version, written into the page itself as it is served), a banner says
   so and the page refreshes itself in five minutes, or at once on *Refresh now*; the page checks every twenty seconds and whenever it
   comes back to the front. Before 2026-10-14 the page took its first successful check as its own version, so one loaded while the PC
   restarted, or whose first check failed, never showed the banner ("I should see a refresh button on the phone but do not").

- **Details from the phone** (2026-10-11, "Can I open the TMDB details using the companion app too?"): every card on the Video tab
  (Continue watching, My list, the lens rows and the categories) carries an i in its corner. It opens a sheet with the title's TMDB
  details as the PC's Details card has them: poster, year, certification, runtime or seasons, genres, TMDB's rating with its vote
  count, the overview, the cast, and where it streams, is free, or rents and buys in the US as TMDB lists them. Play on Prism plays
  the card. `POST /video/details {title, kind?, app?}` answers working until core's read lands (the phone asks again every 1.5 s),
  then ready with the details, or none with the reason (no TMDB key, not on TMDB). The same read the PC makes, nothing new leaves. Search everywhere's results carry a Details button too, the household's own titles and the catalog's.

- **Setting up from the phone** (2026-10-11, "if setting up on a tv, you'd likely setup the remote app first, and then configure all the
  services from the phone"): the Nothing is set up yet screen shows a pairing code under its button, so a TV with no mouse starts
  from the phone. The Video tab's Services section lists every built-in video and music service (the PC's catalog, put into the
  page when it is served) with its state here: signed in, signed out, set up, or not set up. Sign in on the PC / Set up on the PC
  opens the service's sign-in on the PC (`prism://app/<id>/setup?signin=1`; a service not set up yet joins its player first, as the
  welcome page's row does) and brings the Keyboard tab up, which types into the sign-in's fields. The phone never holds a password.
- **The cast, drilled through** (2026-10-11): a face on the Details sheet opens the person's page (`POST /video/person {id}`, TMDB's
  person with their films and series, newest first); each opens its own details.
- **A video's own description** (2026-10-11, "maybe we can show the channel they're on"): a YouTube video has no TMDB page, so its Details
  sheet shows the service's own: the channel, the length, the date, the description and the creator's tags, from the same public page
  the tags come from, with About this channel opening the channel's page (`POST /video/channel {app, url}`: name, handle, counts,
  description, latest videos, each playable) and Open the channel playing its page on Prism. The PC's Details card shows the same.
  A Twitch video says its channel in its own line.
- **Posters** (2026-10-11, "a mix of formats"): every card carries TMDB's poster beside the service's own picture, and the phone draws
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
- A title on this phone (2026-10-10, "make it so the phone companion app opens the video in their native apps"): the Video tab's
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
  the visualizer uses, 16-bit PCM at 48 kHz stereo in 20 ms frames, about 1.5 Mbit/s. One capture serves every phone. The page plays
  it through the Web Audio API with a short lead; a phone that falls behind has frames dropped, not queued. The same ticket opens
  `GET /audio/live.mp3?ticket=`, a live MP3 at 128 kbit/s (NAudio.Lame, one encoder for every MP3 phone, started with the first and
  stopped with the last), served Icecast-style: `audio/mpeg`, no length, `Connection: close`. The phone's `<audio>` element plays it,
  which is the one kind of sound a phone keeps playing in the background; a phone that cannot take a chunk within a second is
  dropped. The process loopback taps AFTER a page's own mute and a session's volume and BEFORE the device volume, so while any phone
  listens (SurfaceManager.PrivateListening.cs) the audible pages' mutes are lifted, the sessions sit at full level, and the wall's
  mute and volume are mapped onto the playback device (NAudio endpoint volume); when the last phone leaves, the pages' mutes and the
  device's state go back where they were.
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

## Which window the phone hears (2026-10-05)

"Remote listening for video should allow the user to select which window they're listening to. In the main app, we normally only
let the big window play sound. But with remote listening, we should allow any 1 (big or mini) window to be selected." With multiview
on, the Private Listening tab shows a chip a window, big first, each with what it plays; the chosen one takes the audio the stream
carries (`GET /audio/windows`, `POST /audio/listen-window {tile|null}`; core's `setListenWindow`). The PC's speakers are muted while
a phone listens unless the phone's switch says otherwise, so the room keeps hearing nothing or, with the switch off, hears the chosen
window too - the person's choice. A swap keeps the choice; the last phone leaving gives the sound back to the big window (the host
clears it). A window that plays by itself while another is heard stays quiet, as a small window always did.

