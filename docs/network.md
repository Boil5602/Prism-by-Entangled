# Every connection Prism makes, and the one it accepts

The list behind the promise (dashboard-schema §19/§22: no identifier of yours in any call). Written 2026-10-03 from the code, for
the website to point at. The services' own pages load whatever they load inside their windows; that is theirs, not Prism's, and is
not listed here.

## Incoming

- **The Quick play search sends a service only the words typed** (2026-11-04, docs/features/music-search.md): the same search pages and Apple's catalog route the playlist lookup already uses, now with the person's own words in place of the playing song's title; the services' own answers come back as rows and nothing is sent anywhere else.
- **Dev tooling is not Prism.** The scripts under `scripts/` run on the developer's own machine: the publish scripts talk to the bucket and
  the stores with the developer's keys, and the doctor (`scripts/doctor/`, docs/doctor.md) sends a page's structure dump to the Claude API with
  the developer's own key from `~/.prism/claude.env`. No shipped build of Prism or the Veil calls a model or carries such a key (2026-11-03).
- **One listener, your home network only.** The host listens on port 8471 (Services/RemoteServer.cs), on every interface of the
  machine, for the phone remote (§6): the pairing page, the keyboard, private listening. Every route but the pairing page needs a
  token the phone gets from the QR code on the wall; a phone forgets the pairing itself (DELETE /pairing). The routes the host answers
  without core that say anything about the PC (the phone's diagnostics line, the PC's playback device) check that token against
  core's record of the pairings too (2026-10-05); the page's version hash alone is answered to anyone, as the page itself is. Plain HTTP (a trusted
  home LAN, §6); reachable from the internet only if a router is told to forward it. Nothing else listens. Private listening is a
  WebSocket on the same port (`/audio/stream`, a ticket from core) or a live MP3 (`/audio/live.mp3`, the same ticket), the wall's
  sound to the phone, outbound from the wall's point of view once the phone has connected (docs/features/phone.md); `GET /audio/clock`
  with the ticket that opened a stream answers where that stream began on the PC's stream clock, where the clock stands, and how much
  the PC has shifted that stream (three numbers, for the player to hold three seconds behind; 2026-10-31, the shift 2026-11-03). A page
  that asks (`&stamp=1` on the socket, 2026-11-03) gets each frame with its time on that clock in front of the samples, nothing else. The lounge visual's
  bands go the same way (`/viz/bands`, a WebSocket on the same port, the pairing token; 48 bytes a frame, 30 a second, nothing else;
  2026-10-27). A paired phone's Full screen on the PC (`POST /video/full-screen`, 2026-10-31) asks the PC for its own F11, and
  `GET /video/screens` says where the window stands.
- **The listen page, on the same port, behind a switch (2026-10-31, docs/features/listen-page.md).** Off by default. On, the Prism
  menu shows an address with a household key core minted once (`remote:house`); that key opens `GET /listen` (the page, the host
  checks the key against core's record), `GET /listen/now` (what plays and the stage's visualization feed), `GET /listen/silence.wav` (two seconds of nothing, which the page loads each minute on an Echo Show's Silk so the browser stays; no key), `POST /listen/ticket` (a
  stream ticket for `/audio/stream`, the frames a phone's Private Listening plays, and for the `/viz/bands` socket), and nothing a
  pairing opens; a pairing opens nothing of it. Core counts wrong codes per client address (the host passes it in the request, never
  stored or logged) and locks that client for a minute after ten. A paired phone reads and sets the switch (`GET`/`POST /listen-page`, the pairing token). The room in step (2026-10-31): a phone says its lag (`POST /audio/lag`), the listen page says its (`POST /listen/lag`, the house code, with an id the page chose for itself), each with the figure it holds to (`holdMs`) and, for a phone's live MP3, `shift: true` (the PC may cut or hold back that stream by core's rule, 2026-11-03; nothing new crosses the network for it), answered with the slowest other listener's hold (`othersMs`), and the switch is `GET`/`POST /audio/room-step` (a pairing); nothing of it leaves the home network. Anyone on the home network with the address can see what plays and hear it while the
  switch is on. Off, the address answers a page that says so. The page makes no outbound connection; it fetches the song's artwork
  from the service's own address as the phone's page does.
- **The same port while Prism is closed (2026-10-23).** The phone launcher (Services/PhoneLauncher.cs) is Prism's own exe run with
  `--launcher`; it listens on 8471 only while Prism is not running, and gives the port back the moment Prism starts. It answers a
  "Prism is closed" page, the page's icons and manifest, `GET /launcher/state` and `POST /launcher/open` (a paired phone's token,
  checked against core's stored pairings read from disk), and "closed" on every other route. It makes no outbound connection.
  A paired phone can also send the person's TMDB key to the PC on this listener (`POST /tmdb/key`, the TMDB guide, 2026-10-10):
  inbound, home network only, the body never logged. The guide's check of a key is one more request to api.themoviedb.org under
  that key (`GET /3/authentication`), in the TMDB row below.

- **A Rent or Buy code is opened by the phone.** The card's code (docs/features/purchases.md) is the service's own search page for the
  title. The PC makes no request for it, and nothing about the PC or the person is in the address.
- **The phone opens a title's own address when asked.** With the Video tab's switch on On this phone, a tapped title is a link to the
  service's own page for it, opened by the phone (its app or its browser) with no referrer. The PC makes no request for it.
- **The phone opens the support page in its own browser.** The Options menu's support line (2026-10-21, donations live) is a plain
  link to entangled.world/support, opened by the phone's browser outside the companion page, so the page and Ko-fi's run there and
  never inside Prism. The PC makes no request for it.
- **The phone's page fetches artwork itself.** The Music and Video tabs show the services' own artwork addresses (the album art,
  a title's poster) and TMDB posters the PC already uses; the phone's browser fetches those from the services' and TMDB's image
  hosts directly, as the PC does. No identifier of the person goes with them beyond what any image fetch carries.

## Outgoing, Prism's own

Each request is to the address named, with no account, device or person identifier in it; the TMDB calls carry the person's own
key and, once linked, their own session.

| to | for | from |
|---|---|---|
| api.themoviedb.org (v3, v4), image.tmdb.org | the catalog rows, search, details, ratings, the watchlist, the playlists' lists, posters; the person's own key | core lenses.ts, catalog-search.ts, playlist-tmdb.ts; host FetchKeyedAsync |
| (every host call) | the User-Agent names the project and its address, `Prism/<version> (+https://entangled.world/prism; open-source dashboard; no identifiers)` (2026-11-04: Wikimedia asks an anonymous client for a way to reach it, and a bare one is throttled); nothing of the person or the device | host MainWindow.xaml.cs Http |
| api.deezer.com, cdn-images.dzcdn.net | the music search's suggestions as the words are typed (2026-11-04): Deezer's public search, no key and no account, given the words and nothing else; the rows' artwork from its image host. Off with the catalog switch (store `music:suggest`); the services' own searches stand alone then | core orchestrator.ts musicSuggest; host FetchKeyedAsync, the panel's Image |
| wikimedia.org (pageviews), en.wikipedia.org (summaries), wikidata.org (ids; and a search for works also known by a store title's name when TMDB's pick is not one the store sells, 2026-10-15) | Most read this week, a person's or title's summary, matching an owned title | core most-read.ts, lenses.ts |
| site.api.espn.com, site.web.api.espn.com | Live's Sports mode scores | core scores.ts |
| the networks' own feeds named in the adapters (`newsFeeds`) | Live's News mode front pages | core news-feeds.ts, adapters |
| easylist.to (EasyList, EasyPrivacy), raw.githubusercontent.com (one hosts list) | the Veil's ad covers and the news shelf's source list | core blocking.ts, news-shelf.ts |
| the household's own Jellyfin server, at the address the person typed when they added Jellyfin (plain http on the home network allowed for that host alone) | Jellyfin's own web pages in its window and on its hidden page, signed in as the household is: the home's rows, Favorites, search, a title's page, the player (2026-11-03, docs/features/jellyfin.md); nothing is fetched from it for a mark (the icon comes from jellyfin.org) | adapter prism-adapters/adapters/jellyfin.json, core catalog.ts fillServer, adapters.ts fillHome |
| the services' own sites | a service's icon and artwork for its card (its home page, manifest, icon), and the cover of the music playing for the stage's card (B-392, 2026-10-22: the same picture the page shows, fetched once by the host and kept on the disk) | host Services/PosterService.cs, ArtCache.cs |
| the services' own pages, on the service's hidden page, signed in as the household is | a category's open pool (2026-10-11): YouTube's search for the hashtag with its own Recently uploaded chip pressed, Twitch's tag directory in its Recently started order; nothing else pressed, and Twitch's search page's Past videos for the hashtag's word (2026-10-13) | core categories.ts via runtime.ts, adapters youtube.json and twitch.json `videoPool` |
| www.youtube.com/watch/<video id> (no query string, no cookie, Prism's own agent string) | the tags a creator wrote on a video in the household's rows (the page's keywords meta), for the categories' chips and matching (2026-10-11): a dozen titles a pass, each kept a month, one at a time with a breath between | core orchestrator.ts videoTagsFetch, adapter youtube.json `videoTagsFetch` |
| www.twitch.tv/directory/following/live, on Twitch's hidden page, signed in as the household is | the tags and category a streamer set on each followed live stream, for the same chips (2026-10-11) | adapter twitch.json `videoTags` |
| www.twitch.tv/ (Twitch's home), on Twitch's hidden page, signed in as the household is | the Continue Watching shelf, for the Continue watching row (2026-10-13) | adapter prism-adapters/adapters/twitch.json |
| www.twitch.tv/videos/<id>, on Twitch's hidden page, on the person's Remove alone | Twitch has no remove control: the video is played muted to its end (a finished video leaves Twitch's Continue Watching), then the home shelf is read to confirm (2026-10-13) | adapter prism-adapters/adapters/twitch.json |
| prism.entangled.world/veil/art | the ambient art pool, when the person chooses it | host Services/ArtService.cs |
| reports.entangled.world/v1/report | a report, when the person presses Send; an ad report (Ad debug's Not an ad / This is an ad, the cover's Not an ad, 2026-10-07) carries the window's id, the page's site, the report's kind, whether the cover was up and how many seconds late it came, the channel's name and the break watch's last forty readings (its chance, the logo's score, the reason), never the page's address | host MainWindow.xaml.cs SendReportAsync, MainWindow.AdDebug.cs, MainWindow.BreakWatch.cs |
| reports.entangled.world/v1/app-report | the report flag's report (kind, player, service and adapter version, Prism, Windows and WebView2 versions, the words; the page's origin and path and the recent log only when ticked), when the person presses Send; a saved one from the outbox later | host MainWindow.ReportFlag.cs SendReportAsync, FlushReportOutboxAsync |

**The update check (2026-10-05, docs/features/updates.md):** once a day, `GET https://reports.entangled.world/v1/update/windows/manifest.json` and `manifest.sig` beside it, no query string, the UA "Prism/<version>" and nothing else. That address is a counter (2026-10-21): it adds one to the day's number and sends the fetch on to `https://prism.entangled.world/windows/manifest.json` in the bucket, keeping no address, version or time; the day's count, public at `/v1/checks`, is what the website's download page shows as PCs that checked for updates. When the counter is down the PC reads the bucket address directly, so it can never hold an update back; a release named there is fetched from the same host when the person installs (or the night window does): since 0.26.0 its file list (`windows/files/Prism-<version>-<commit>.files.json`) and only the files the PC lacks (`windows/files/<sha256>.gz`), else the zip. The address is a setting a fork changes. Nothing about the machine or the person goes with any of it. Formerly: there was no update check. Links the
wall shows (letterboxd.com, imdb.com, themoviedb.org pages, entangled.world) open only when pressed.

## Outside Prism

The pages run in Microsoft's WebView2 (Edge). The runtime updates itself and talks to Microsoft on its own schedule; that is the
browser's, like Edge on a laptop, and Prism neither adds to it nor can stop it.
