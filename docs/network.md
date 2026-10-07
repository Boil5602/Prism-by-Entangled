# Every connection Prism makes, and the one it accepts

The list behind the promise (dashboard-schema §19/§22: no identifier of yours in any call). Written 2026-10-03 from the code, for
the website to point at. The services' own pages load whatever they load inside their windows; that is theirs, not Prism's, and is
not listed here.

## Incoming

- **One listener, your home network only.** The host listens on port 8471 (Services/RemoteServer.cs), on every interface of the
  machine, for the phone remote (§6): the pairing page, the keyboard, private listening. Every route but the pairing page needs a
  token the phone gets from the QR code on the wall; a phone forgets the pairing itself (DELETE /pairing). The routes the host answers
  without core that say anything about the PC (the phone's diagnostics line, the PC's playback device) check that token against
  core's record of the pairings too (2026-10-05); the page's version hash alone is answered to anyone, as the page itself is. Plain HTTP (a trusted
  home LAN, §6); reachable from the internet only if a router is told to forward it. Nothing else listens. Private listening is a
  WebSocket on the same port (`/audio/stream`, a ticket from core) or a live MP3 (`/audio/live.mp3`, the same ticket), the wall's
  sound to the phone, outbound from the wall's point of view once the phone has connected (docs/features/phone.md).

- **The phone's page fetches artwork itself.** The Music and Video tabs show the services' own artwork addresses (the album art,
  a title's poster) and TMDB posters the PC already uses; the phone's browser fetches those from the services' and TMDB's image
  hosts directly, as the PC does. No identifier of the person goes with them beyond what any image fetch carries.

## Outgoing, Prism's own

Each request is to the address named, with no account, device or person identifier in it; the TMDB calls carry the person's own
key and, once linked, their own session.

| to | for | from |
|---|---|---|
| api.themoviedb.org (v3, v4), image.tmdb.org | the catalog rows, search, details, ratings, the watchlist, the playlists' lists, posters; the person's own key | core lenses.ts, catalog-search.ts, playlist-tmdb.ts; host FetchKeyedAsync |
| wikimedia.org (pageviews), en.wikipedia.org (summaries), wikidata.org (ids) | Most read this week, a person's or title's summary | core most-read.ts, lenses.ts |
| site.api.espn.com, site.web.api.espn.com | Live's Sports mode scores | core scores.ts |
| the networks' own feeds named in the adapters (`newsFeeds`) | Live's News mode front pages | core news-feeds.ts, adapters |
| easylist.to (EasyList, EasyPrivacy), raw.githubusercontent.com (one hosts list) | the Veil's ad covers and the news shelf's source list | core blocking.ts, news-shelf.ts |
| the services' own sites | a service's icon and artwork for its card (its home page, manifest, icon) | host Services/PosterService.cs, ArtCache.cs |
| prism.entangled.world/veil/art | the ambient art pool, when the person chooses it | host Services/ArtService.cs |
| reports.entangled.world/v1/report | a report, when the person presses Send; an ad report (Ad debug's Not an ad / This is an ad, the cover's Not an ad, 2026-10-07) carries the window's id, the page's site, the report's kind, whether the cover was up and how many seconds late it came, the channel's name and the break watch's last forty readings (its chance, the logo's score, the reason), never the page's address | host MainWindow.xaml.cs SendReportAsync, MainWindow.AdDebug.cs, MainWindow.BreakWatch.cs |
| reports.entangled.world/v1/app-report | the report flag's report (kind, player, service and adapter version, Prism, Windows and WebView2 versions, the words; the page's origin and path and the recent log only when ticked), when the person presses Send; a saved one from the outbox later | host MainWindow.ReportFlag.cs SendReportAsync, FlushReportOutboxAsync |

**The update check (2026-10-05, docs/features/updates.md):** once a day, `GET https://prism.entangled.world/windows/manifest.json` and `manifest.sig` beside it, no query string, the UA "Prism/<version>" and nothing else; a release named there is fetched from the same host when the person installs (or the night window does): since 0.26.0 its file list (`windows/files/Prism-<version>-<commit>.files.json`) and only the files the PC lacks (`windows/files/<sha256>.gz`), else the zip. The address is a setting a fork changes. Nothing about the machine or the person goes with any of it. Formerly: there was no update check. Links the
wall shows (letterboxd.com, imdb.com, themoviedb.org pages, entangled.world) open only when pressed.

## Outside Prism

The pages run in Microsoft's WebView2 (Edge). The runtime updates itself and talks to Microsoft on its own schedule; that is the
browser's, like Edge on a laptop, and Prism neither adds to it nor can stop it.
