# Lyrics on the screen

*2026-11-15. Asked for: the words of the song on the screen, lit as they are sung, the way the music service's own page shows them.*

## What it is

While a song plays, PRISM shows three lines low on the Music player's screen: the line before, the line being sung (large, its
sung words in amber) and the line after. They are the music service's own lyrics. The service has the right to show them to its
subscriber, and PRISM shows what the service's page is showing.

## How it works

1. A service's adapter may carry a `musicLyrics` script. It defines `window.__prismMusicLyrics(cmd)`, which answers at once with a
   JSON string: `open` and `close` press the page's own Lyrics control, `read` gives the line being sung and each word's progress
   (0 to 100), `lines` gives the text of every line the page has drawn.
2. Core's `musicLyrics(tile, on)` opens or closes the page's lyrics (a page action, the person's press on PRISM's Lyrics button), and
   `musicLyricsState(tile)` says whether the service has the route.
3. The app reads the page five times a second while lyrics are on and the Music player is on the screen, the way it reads a video
   page's captions, and draws the three lines (`MainWindow.Lyrics.cs`).

## The rules

- **Nothing is fetched.** PRISM makes no request for lyrics, to the service or to anyone else. It reads the lines the page drew.
  There is no entry for this in `docs/network.md` because there is no connection.
- **Nothing is kept.** The lines live in the view while the song plays. They are not written to the store, a log or a diagnostic.
- **No lyrics, no view.** A song with no timed lyrics, a paused song and a service with no route show nothing. A service whose
  adapter has no `musicLyrics` has no Lyrics button.
- **Music player only.** Nothing is drawn while the Video player is on, and the music page is not woken for it.

## Where it is

The Music player's control bar has a Lyrics button, at the right of the play controls (2026-11-15, moved there from Quick play the same day). It is there only for a service whose adapter has the route, and it is amber while lyrics are on. The choice is remembered (`music.lyricsTile`).

## Services

| Service | State |
| --- | --- |
| Apple Music | Built 2026-11-15. Read live on one song with word timing: 39 lines, the sung line and its words' progress. A song with only untimed lyrics is not yet seen. |
| Others | Not built. Each needs its page's lyrics read and a route written. |

## Later (docs/roadmap.md)

- Jellyfin: the server's own lyrics for the household's own files.
- A public lyrics collection (LRCLIB) for services that show none: left out. If it is ever added it is an opt-in, off by default,
  and a connection listed in `docs/network.md`, because it sends the song's title and artist to another party.
