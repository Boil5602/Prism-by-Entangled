# Jellyfin: the household's own media server

*2026-11-03. Asked for after a Plex user's complaint: Jellyfin has no remote-playback paywall and no catalogue of anyone else's, so a Prism owner who hosts their
own library can watch it on the screen like any other service.*

## What it is

Jellyfin is a free, open-source media server a household runs itself (a NAS, a mini PC, a Pi). Its web client is a page the
server serves, so Prism shows it the way it shows every service: a page of its own, signed in by the person, with Prism's
Watch page reading its rows and its player answering the remote. There are no ads, no DRM and no third-party account.

## The address is the household's own

Every other service in the catalog has a fixed address. Jellyfin's is wherever the household put it: `http://192.168.1.20:8096`
on the home network, or an https name they reach it at from outside. So the catalog entry carries a template and a question:

```json
"url": "{server}/web/#/home",
"site": "https://jellyfin.org/",
"address": { "ask": "Your Jellyfin server's address", "example": "http://192.168.1.20:8096" }
```

- **When Jellyfin is added** (the welcome page's card, the catalog picker, the App list), the host asks for the address in the
  entry's own words, with the example as the box's hint. The template is filled with what was typed (the server part alone:
  no fragment, no query, no trailing slash; `catalog.ts fillServer`, the host's `WithServerAddressAsync`), and the App's home
  and its home facet are that address. Cancel adds nothing. Once the App exists, its `baseUrl` is the record and nobody is asked
  again.
- **Plain http is allowed for this App alone.** Servers on a home network usually have no certificate. Core's rule that a hidden
  page is only ever pointed at the service's own site (`onServiceSite`) takes plain http only for the very host of an http home.
  Every other service stays https.
- **The adapter's page addresses are written against `{home}`**, the App's home up to its fragment: `{home}#/search?query={q}`
  for search and `{home}#/home?tab=1` for Favorites (`adapters.ts fillHome`). A plain address in any other adapter is untouched.
- **The icon comes from `site`** (jellyfin.org): there is nothing to fetch from a template, and nothing is fetched from the
  household's server for a mark.
- Player setup lists a template entry as a video service and refuses to set it up on the template alone ("Jellyfin needs its
  server's address first"); the host fills the address before it asks.

## Sign-in

On the page itself: the server shows its user cards and its manual form, with Remember me. Prism has no sign-in address for it
(the login is a route inside the page, `#/login`); the session markers decide. Signed out, the login page stands; signed in,
a library page does (home, a details page, search, the player).

## What the adapter reads and does (page actions only)

| | How |
|---|---|
| Continue watching | the home's **Continue Watching** row, then **Next Up** (the next episode of a started show) |
| Favorites (Prism's My list, named *Favorites*) | the home's second tab, `#/home?tab=1`, a section per kind |
| Suggestions | the home's **Recently Added in Movies / Shows** rows (Music and My Media left out) |
| Search | `#/search?query=…`, a section per kind; people skipped |
| Play | the title's details page, then its own **Play** (Resume when the title has a position) |
| Episodes | the series page's **Seasons** cards, each season's **Episodes** list |
| The player | the title from the player's header (`Sahara (1943)`; `Pioneer One - S1:E2 - The Man From Mars (2010)`), the position from the video element; a direct file, no MSE, no DRM |
| Remote verbs | the player's own buttons: play/pause (read from the element so play never pauses), next episode, subtitles, full screen; seeks on the element |
| Subtitle and audio tracks | the player's Subtitles and Audio sheets (`.actionSheet`) — **unverified**, written from the client's source |

Nothing of Jellyfin's web client's own API object is used (third-party services policy, rule 3). The server is the household's;
every request the page makes is the page's own.

## What has not been done

Everything above was read on Jellyfin's public demo (12.4.0, `demo.jellyfin.org/stable`, the demo user) in a browser on
2026-11-03. Nothing has run on a wall yet: each script's `verified` note says so, and the DRM matrix row is marked the same.
To walk it without a server of your own, add Jellyfin with the address `https://demo.jellyfin.org/stable` and sign in as
`demo` with no password (the demo resets daily and is anybody's).
