# The music panel

Started 2026-11-16 (asked for one drill-in panel in place of Quick play's menus within menus). It opens from the music-note
button, a right press on the stage and the service page window's Quick play button, as the old menu does.

Status: **every screen is built** (2026-11-16). Home, a service's library and a playlist's play choices were seen on the screen;
Up next, Add to playlist, Start a station, Scenes and Song history were built in one pass after the owner asked for the rest
without a stop. The owner walked the screens the same day and approved the panel: **the old menu is removed** (2026-11-16, its
code and the setting `music.newPanel` that chose between the two). Quick play is the panel for everyone.

## What it is

One panel, 400 wide, a fixed height with its list scrolling inside. A row replaces the panel's content and shows Back. No menu
opens from it and nothing opens on hover. Back or Escape returns one level; at Home, Escape or a press off the panel closes it.
Actions confirm in one line at the foot of the panel. The panel stays open after a play.

Seven screens:

| Screen | Step | Holds |
| --- | --- | --- |
| Home | 1 (built) | the now playing card with play and pause, Add to playlist, Start a station, Up next, Scene, Full Player, the search field, Jump back in, Your services, Add a music service at the foot |
| Play choices | 1 (built) | one playlist: Resume with its place and order, Start over in each order, Play |
| Service library | 1 (built) | signed out: one sentence and Sign in; signed in: Playlists and Stations tabs with counts, a filter, the list, and each row's actions |
| Up next | 2 (built) | the songs that play next, with Remove |
| Add to playlist / Start a station | 2 (built) | the service to act on, its playlists, and the match step when the service has only near matches |
| Scenes | 3 (built) | a grid of every scene with a preview; the one on the screen marked |
| Song history | 4 (built) | songs PRISM itself played, kept on this device, never sent anywhere |

## Rules

- **One brain.** Where the panel is and every list it shows come from core (`packages/core/src/music-panel.ts`; the runtime calls
  `musicPanelNav`, `musicPanelHome`, `musicPanelLibrary`). The app (`MainWindow.MusicPanel.cs`) draws them.
- **Nothing new is asked of a service or the network, but for a recent's cover (below).** Plays, the search, the lookup of the playing song and the add are the old
  menu's calls. The lists are what core already holds; after a start core reads what it lacks and Home is drawn again once it changed.
- **Jump back in** is every service's recent collections in one list, newest first, six rows. A row shows the item's real name:
  its label, else the name the service's library gives the same id, else the album a recent album carries. A row nothing names is
  left out; a bare "Playlist" or "Album" is never shown. A station tuned several times is one row.
- **In your library** (words in the search field) lists the playlists and stations already read whose name holds the words: names
  that begin with them first, then names that hold them, each group A to Z. "Search every service" runs the old search; a row
  plays on the service playing now when that one has the song, else on the first that has it, and the row's "more" lists the rest.
- **Your services**: the service playing now first, then the one the screen draws from, then the rest in the order they were
  added. The line under a name says what its library holds, else the last thing played, else "Not signed in".
- **A playlist's play choices** (2026-11-16, asked for in place of a plain press; core `playChoices`, the runtime's
  `musicPanelPlay`). A press on a playlist opens a screen of the panel, not a window over it. `Resume` is there only where PRISM
  holds a place in that playlist; under it, to read, the place and the order it is in (`Song n of total`, then the order). Under
  `Start over`: `In order`, `Reverse`, `True shuffle`. After a play in order PRISM holds no place of its own, so Resume is the
  place the service's player holds (the playlist its page stands in, else the resume point of its last play): the line names the
  song and `In order`, and Resume presses Play on the service. One of them is picked, Resume at the start where there is one, else In
  order, and `Play` starts it. **The countdown** (2026-11-16, asked for; the one countdown in the panel): with the box
  `Start on its own after 10 seconds` checked (the setting `music.playCountdown`, on at first), the picked choice starts after ten
  seconds, the seconds left on the Play button. One choice is always picked, so the count always has one to start: a press on a choice changes what will start and the count goes on. Clearing the box stops the count; Back or closing the
  panel ends it and nothing plays. An order the service cannot take is listed and
  cannot be picked, with the reason in its tooltip. A station plays on its press, as before. The choices open wherever a playlist the
  service's library lists is pressed: its library, the search's `In your library` rows and `Jump back in`.
- **A saved place.** The playlist PRISM holds a place in shows the place under its name (`Pick up at n of total`). PRISM holds
  one place a service. Under the row's `more` button: `Play next` queues a collection after the playing track, and
  `Add current song` is offered on a playlist the account may add to.
- **Full Player** (named and placed 2026-11-16). Each service has its own page, so the button says whose it opens: on Home it
  is a row of the now playing card with the playing service's name on it, and a service's library has a labelled Full Player
  button for that service. It is not at the panel's foot. The music bar's globe button, the Video player's and the old menu's row
  carry the same name.
- **The service's own shuffle is not offered** in the panel (decided 2026-11-16). It stays reachable on the service's own page.
- Every colour is a token (`Tokens.cs`: Panel, Ink, Amber, Soft for a secondary line, the art tints).
- **Pictures** (2026-11-16). A playlist's or a station's picture is the one its service's page shows: each music adapter's
  `musicLibrary` script gives an `artwork` address with the item (Apple Music from its library answer, Spotify and Amazon Music
  from the row's image; Pandora's is written and not yet seen, the account being signed out). A recent takes the library's
  picture of the same collection, else the cover kept with the entry when it was played (kept since this day), else for an album
  the cover of the track its service holds now. Only an https address is used. Square for a playlist or an album, round for a station.
- **A recent with no cover is asked for** (2026-11-16, core `fillRecentCovers`). The service's own page asks its own site for the
  collection's cover and core keeps the address with the entry. The adapter's `musicCover` names the route: `og` (the collection
  page's og:image; Apple Music, whose route ends `>last-segment=300x300bb.jpg` to take the square cover in place of the page's wide crop) or `oembed:<path with {url}>` (the site's public embed address, its thumbnail; Spotify). Two
  recents a call, each asked once a run of PRISM, a signed-in service only, an address on the service's own site only. Amazon
  Music and Pandora name no route yet (no cover was found on Amazon Music's pages; Pandora is signed out), so their old recents
  draw a tinted tile with a music note until they are played again. This request is in `docs/network.md`.

## The later screens (2026-11-16)

- **The card's Play button says what it waits for** (2026-11-16): from the press until the player answers, the line over the title
  reads `Starting...` or `Pausing...` with the service's name and the button is a ring. After 20 seconds with no start the line reads
  `Did not start. Press Play again`. The rule is one class,
  `PlayWait.cs`, behind every Play that resumes music: this card, the music bar on the screen (on its service line) and the mini player (on the line under its title).
- **On the mini player** (2026-11-16) a right press opens the panel on the mini player's own window, and the panel may leave that
  small window's edges. While the mini player is open the full player's window is parked off the screen and is taken off the
  taskbar and the Alt+Tab list; it comes back to both when the full player returns.
- **Up next** is the list of the songs that play next, and nothing else (2026-11-16: the play order switch and Repeat were taken
  off it; the order is chosen on a playlist's play choices and on the music bar). It reads the queue of the service the now
  playing card shows, by the adapter's `musicQueueView` (Apple Music only today); a service without it says so in one sentence.
  A line above the list names the order when it is PRISM's own. The page's answer reaches core through the app's bridge, which
  carries `items` since this day: before it, the list came back empty.
  Each row shows the song's own cover. A press on a row that is still to play makes the player skip to it (the adapter's
  `musicQueueSkip`, MusicKit's change to the item at that place, after the page checks the track there is the one named). The
  list shows 50 songs (`UP_NEXT_ROWS`); when more are still to play, a line under it reads `Limit 50` with the count still to play.
  The owner walked a skip to a song on Apple Music's playing queue on 2026-11-16.
- **Remove from the queue** is a new page action, the adapter's `musicQueueRemove` (Apple Music: MusicKit's own `queue.remove`,
  only for a track still to play, and only when the track at that place is the one named). Core `musicQueueRemove` drops the
  track from a PRISM order too and reads the queue again. No other service has the route yet.
- **Add to playlist / Start a station.** `On which service?` is a switch of the signed-in services, the playing one picked. The
  song playing now is looked up on the picked service with the old menu's lookup. Found: the playlists the account may add to,
  each showing `Added` after a press; a second press takes the song out again with the old menu's remove, on the playing
  service only (another service says to use its Full Player). A station starts at once when no match is needed. Near matches:
  one sentence with the count, the candidates with title, artist, album and how alike, and `None of these`. Not there: one sentence.
- **Scenes** is the one wide screen (820, asked for 2026-11-16): every visual the music can draw, in order of name, A to Z, four to a row with six rows in
  view (24) and no scroll: the pictures take the height that lets every row show, between 44 and 96 high, and the list scrolls
  only when the window is too small even for that. A narrow window gets three columns, then two. Each scene has its own picture
  (`Assets/scene-previews/<style id>.jpg`, 480 by 240). The pictures are made from PRISM's own renderer (the dev `shot.request`),
  never from the screen, with the lyrics off and the middle of the stage cropped so no album art, song text or control is in
  them; a scene with no picture shows its colours. The one on the screen is outlined and says `On screen now`. A press changes
  the scene's visual (the old Visual style window's save, then core's restyle by the slot the visual sits in); the artwork mode
  is left as it is.
- **Song history** (core `song-history.ts`, tested in `tests/song-history.test.ts`: record, the 30-second rule, the 500 cap,
  clear). The runtime looks at each music service's now-playing every five seconds; a song is kept after 30 seconds of play
  (paused time does not count), newest first, 500 at most, in the store under `music:history` on this PC. Nothing is sent
  anywhere and no request is made. A press plays the song again on the service it played on (by the service's own track id
  where its player names one, else by its search); a signed-out service shows its sign-in screen. `Clear history` empties it.

## The card says a pick is loading (2026-11-16)

Asked for the same day: the music player's block said `loading <name>` while the panel's card said `Nothing playing`. The card
now reads the same state (the transport's pending pick and the work in hand). While a pick loads it says `Loading`, the pick's
name, the work under it (a track list read with its count), and the Play button is a ring. A pick that failed says
`Did not start` and `Could not start <name>`. A loading service comes before a playing one on the card. Not yet seen on the
running app.

## A saved place for every playlist (2026-11-16)

Asked for the same day. Before it PRISM held one place a service, and a play of anything else on the service dropped it. Now,
when a True shuffle or Reverse play gives way to another collection, core keeps its place (the order's song ids and the spot
in them) by collection: `musicPlaces` in the orchestrator, in the store under `music:places:<dashboard>:<tile>`, the newest 25
for a service. The play choices read `musicPlaceOf`, so Resume shows `Song n of total` for a kept place as for the standing
one, and Resume or a plain press on the playlist makes the kept place the standing order again and carries on with no new read
of the track list. A fresh start of the same playlist, in any order, replaces its place. Test: the play orders case in
`packages/core/tests/music-lookup-flow.test.ts`. Not yet walked on the running app.

**A play in order keeps a place too** (2026-11-16, asked for the same day). The service's player holds the place of a play in
order, and the next play takes its queue. So when a play in order gives way to another collection through PRISM, core keeps the
song it stood on (`keepPlayerPlace`: the page's own track id and the title, no order of PRISM's). The play choices show it as
Resume, `<song> · In order`, above the start over choices. Resume reads the playlist's track list (the screen says
`Resume: reading the track list`), finds the song and hands the player the list from there in order; the standing order is then
`normal` with its ids, and its spot is kept like a True shuffle or Reverse one. A song that is gone from the playlist starts the
playlist in order from the top. Only on a service PRISM can read and queue (Apple Music, Spotify); only a play that gives way
through PRISM's own pick, not one changed on the service's page. Not yet walked on the running app.

## Changed from the old menu, by design

- The suggestions from the song catalog as the words are typed are not in the panel: typed words filter the library, and the
  search of the services runs on a press or Enter.
- A play no longer closes the panel.

## Dev

`hub.request`: `musicpanel go <screen> [arg]`, `musicpanel go back`, `musicpanel type <words>`
(fills the open screen's text box; a test never sends keys).

## Owed

- **The later screens.** The owner walked Up next (the list, the covers, the limit line, a skip to a song), Scenes (the pictures,
  the mark, a scene change) and the pictures on Add to playlist on 2026-11-16. Not yet reported on: Remove from the queue, an add
  to a playlist and its second press, Start a station, Song history and its replay, Clear history.
- Remove from the queue for Spotify, Amazon Music and Pandora (none shows its queue to PRISM yet).
- A place in a playlist played **in order** is kept only when the play gives way through PRISM's own pick, on a service PRISM can
  read and queue (see the saved place for every playlist). A play changed on the service's own page keeps no place in PRISM.
- Song history was read through the dev eval on 2026-11-16 and held 158 songs, so it records. Its replay and `Clear history`
  were not pressed.
- Escape has been tested by reading the code only: a test here never sends keys.
- Tests: `packages/core/tests/music-panel.test.ts` (navigation, the lists, the names, the saved place, the play choices). `packages/core/tests/music-queue.test.ts` (2026-11-16: the queue read, a track removed, a skip to a track, an order PRISM holds losing the track; against a made-up page, so Apple Music's own page is still unproven for the remove).
- The play choices' Play button has not been pressed in a test here: it would move the household's saved place.
- The countdown was seen counting on after a press on another choice, and ending on Back with nothing played; it was not let run to its end here, for the same reason.
