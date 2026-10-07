# Remove the playing song from a playlist

2026-10-06: "I'm playing the vibes playlist right now ... Under Quick Play > Apple Music > Vibes > And if this song is IN this playlist,
I want to have the option to 'Remove Playing Title from Playlist' or something more intuitive than that."

## What the person sees

In Quick play, a playlist's own submenu (Play now, Play after this track, True shuffle, In reverse, Repeat) ends with
**Remove "<song>" from <playlist>** when all of these hold:

- the service is playing a song now (the page names its id);
- Prism has read that this playlist holds it (the Prism order's list or the track list read for an order - a playlist Prism has not
  read is never claimed either way);
- the service's library marks the playlist the person's own (`edit: true`; Apple's curated playlists cannot be changed).

A short confirmation names the song, the artist and the playlist and says it comes off on every device and keeps playing. The status
line holds "removing ..." while it works and says how it ended ("<song> is off <playlist>", or the reason it could not).

## How it is done

Page actions only (docs/third-party-services-policy.md). Apple publishes no API to remove a track from a library playlist, so the web
player's own undocumented call is never used. Core (`musicRemovePlaying`) opens the playlist's own page on the service's hidden work
page (adapter `musicPlaylistUrl`) and runs the adapter's `musicRemove` script: it finds the song's row by its title and artist, opens
the row's menu, and presses the page's own **Remove from Playlist** (and a confirm, if the service asks), then checks the row went.
The Prism order and the read track list drop the song, so the order plays on without it.

Apple Music's playlist page draws a hundred rows at a time as it is scrolled, and slowly on a hidden page (measured 2026-10-06 on Vibes:
row 1,200 in about two minutes, row 1,904 of 1,910 in six). The script is told where the read track list puts the song and stops once it is well past that spot;
minutes are allowed. The song keeps playing meanwhile.

## Services

- **Apple Music** (adapter 0.1.11): built. The row and its Remove from Playlist item verified with a dry run that stops before the
  press ("Ocean on Fire", row 1,904 of Vibes' 1,910, found in 376 s; ten minutes are allowed); a real press is the person's (never a test removal on the household's playlists, per the rule after 2026-09-23).
- Spotify, Amazon Music, Pandora: not yet. The item does not appear for a service whose adapter has no `musicRemove`.
