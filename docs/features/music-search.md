# Music search and Up next in Quick play

*Asked 2026-11-04:* a search in the Music Lounge for an album, song or artist that plays music directly on a service, built like the
video side's cross-service search without what does not fit there (TMDB). *Decision:* in Quick play, below the service list and before
the Recent list. Then asked for an expandable view of the songs set to play next, in playlist order, or album order when an album is
played from the search.

## Search

One row in the Quick play panel (the ⟲ chip on the stage, or a right-click / hold on it), under the services and above Recent stations and
playlists. Enter asks every signed-in music service at once, each on its own hidden page through the adapter's own search: the route the
playlist feature already uses to find the song playing now (`musicLookup`: Apple Music's catalog search through its own loaded player code
in the person's session, Spotify's and Amazon Music's search pages, Pandora's results rows), given the words as typed. The rows land under
the box as the services answer, grouped by service, each with the song's title, the artist and the album where the service names one, and
a press plays it on that service. The panel polls core while it says the search is working, never for a fixed time, and a new search stands
the old one down.

A catalog stands in front, as TMDB does for video (2026-11-04): Deezer's public search, which answers without a key or an
account in a few hundred milliseconds with songs (artwork, ISRC), albums and artists. As the words are typed (300 ms after the last key,
two characters or more) the suggestion rows come up at once; the services are not asked until a row is pressed. A song row pressed asks
every signed-in service for that song on its hidden page, the row stays where it is with "Asking your services…" under it, and the
services' chips fill in on it as each answers (core puts the wanted song first in the merged list). An album or artist row searches the
services for its name. Enter searches the services for the words as typed, which is also the whole of it when the catalog is off
(`musicSetSuggestions(false)`, store `music:suggest` = "off") or has nothing for the words. Deezer is a music service, not a catalog
company; what PRISM uses is its open search alone, given the words and nothing else (docs/network.md). The open-data stack was measured
the same day (MusicBrainz 650 to 890 ms a query and a typo finds nothing, Cover Art Archive 3.4 s a picture, Odesli's public API retired,
Discogs for details only) and stands in docs/roadmap.md.

The order of the rows is one stated rule, not the catalog's (2026-11-04): how well a row matches the words typed (a title, artist or album name equal to them, or the title and artist
together; then a title that starts with them; then every word found somewhere in title, artist and album; then the rest), then the title
A to Z, then the artist. Songs, then albums, then artists, except an artist or an album named exactly leads the songs. The services'
merged list follows the same rule with the song pressed first. Release date and alphabetical order belong on an album's or artist's page,
where there is a list to browse. Once the suggestions settle, the services are asked for the words in the background and their chips fill
onto the rows in place; a row pressed before they arrive asks for that song and waits on its own row.

Nothing of the video side's that depends on TMDB comes across: no Owned, no ratings, no availability by provider, no "with <person>" rows.

A pressed row plays by the adapter's song route when it has one (`musicPlaySong`, Apple Music: MusicKit queues the song by its catalog id
and plays), else by the song's own address and the page's Play, the way a collection from Recent plays on a service with no in-page player
API. The stage follows the service. A service with no search route, or signed out, says so in its heading and offers no rows.

First cut: songs. Albums and artists are the next cut: Apple's catalog search takes `types: albums,artists`; Spotify's and Amazon's search
pages carry them as sections; a Pandora artist becomes its station.

## Up next

Under the service with something loaded, a small "Up next ›" row opens the player's own queue from its position: the song playing now
marked, then what follows, in the order the player holds (an album's order, a playlist's, the service's shuffle). It is read by the
adapter's `musicQueueView` route (Apple Music: MusicKit's queue items, the same thing `musicContext` already reads for its "next" line); a
service without the route says it does not show its queue to PRISM yet. A play in PRISM's own order (true shuffle, reverse) is named as
such above the list, since the player's queue is PRISM's window into it.

## Core verbs (channel)

- `musicSearch(q)`, `musicSearchState()` → `{q, at, working, services:[{tile, app, status, reason?, candidates:[{id, title, artist, album?, url?, artwork?}]}]}`
- `musicSearchPlay(tileId, candidateJson)` → `{ok}`; the stage follows (`followMusic`)
- `musicUpNext(tileId)`, `musicUpNextState(tileId)` → `{status, reason?, items:[{title, artist, current?}], order?}`

## Network

One new connection: api.deezer.com for the suggestions, the words typed and nothing else, with the rows' artwork from its image host
(docs/network.md). The services' own search pages and Apple's catalog route were already in use for the playlist lookup (the music lookup
rows); the search sends them the words the person typed, nothing else. The phone's music card gets the same row next, for
parity with the wall (docs/features/phone.md).

## Status (2026-11-04)

Three cuts the same day. The first (grouped by service, Enter only) was seen live: the rows came, a press on Apple Music played nothing the
person could see and Vibes landed on track 9 (PRISM's standing true-shuffle order re-queued over the single song; the pending named a kind
the page never reports), Pandora had no play route. The second: one row a song with the services as chips, as-you-type, artwork, paging,
the standing order ended first, Pandora as a station; Spotify's and Pandora's routes verified from the hidden pages. The third: the catalog
in front (Deezer), rows updated in place, albums and artists as rows. Core 1576 tests. The phone's row is next.
