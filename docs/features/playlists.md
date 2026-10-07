# Playlists

User-made, ordered, service-agnostic lists of episodes and movies. They
are built from search and the details window, and played in order until
the user takes a break.

Note: this builds on the existing cross-service search modal and the
details window. The details window opens from search results and from
right-clicking any video card. The "search chips" v1 note in
video-menu-spec §2 predates them; that doc is not edited here.

## Storage
- **On the person's TMDB account (2026-10-03).** Each playlist is one of
  the account's TMDB lists (v4), private unless made public, with the
  name the person gave it. A list on the account made anywhere else is a
  playlist here too (every episode of each show, nothing watched). So a
  playlist follows the account to any device signed in to it. Playlists
  need the account linked with lists (the API read access token plus
  TMDB's approval, in Watch settings); without that the Playlists tab is
  a gate that says which step is missing, and there are no playlists.
  See "On TMDB" below and `packages/core/src/playlist-tmdb.ts`.
- The device's own earlier playlists (the pre-TMDB store, per profile
  set) are never deleted (§10). While an account with lists is linked
  they are hidden, and the Playlists tab offers once to copy them onto the
  account as private lists; unlinked, they come back as they were.
- Nothing is transmitted but to TMDB, under the person's own token (§22);
  never a service session.

## On TMDB (2026-10-03)
- An entry per show and per film; a show's episodes are not entries.
  The playlist's state for an entry is in the entry's comment, short
  structured text a person can read on TMDB's site:
  `Prism: episodes S1E1-29 S2E1-26; watched S1E1-12 S2E3; excluded S2E5;
  now S2E4 31:12; 2026-10-03 07:12` (a film: `Prism: watched; now 1:02:40;
  ...`). "episodes all" is a followed show. The stamp is when the state
  was written; the newer wins when two devices disagree.
- The spot: the episode (or film) last playing and how far in, kept when
  it first shows, every five minutes of play, and at the end. Resuming
  plays that episode on the service; the service itself resumes the
  position as it always did, the seconds are the record.
- Order is release date across the whole playlist ("sort them by release
  date only for now"); no order is written, hand-ordering is not kept.
- What TMDB does, measured (docs/features/tmdb-account.md): a comment is
  set once per entry, so a change is remove + add + comment; about one
  write in five is answered success and not kept, so every write is read
  back at a fresh address and done again; 500 characters is the ceiling,
  detail is dropped from the end (excluded, then watched as "through",
  then episodes as all) to stay under it.
- Sync: the account's lists are read when the tab opens and every ten
  minutes (Refresh reads now); changes are pushed four seconds after the
  last one, one call at a time at a person's pace; a deleted playlist
  comes off TMDB after the undo window; work left at a restart is pushed
  on the next open. A title TMDB can't place stays on the device, named
  on the tab, never guessed onto the list.
- Public or private is chosen when the playlist is made (a checkbox) and
  can be changed from the open playlist's head; a public list carries a
  globe mark.

## Playlist panel
- Its own surface, docked to one side of the screen. It shows the open
  playlist, with a picker to switch playlists or create a new one.
- It opens from:
  - the watch screen's Playlists entry
  - the search modal
  - the details window
  - "Add to playlist…"
- Once open, it stays open, with the same playlist, while the user
  opens and closes the search modal and details windows.
- On narrow screens and in 10-foot mode it collapses to a tab that
  can be toggled.
- Closed by default. The watch screen, search, and details look and
  work exactly as today until the user opens the panel, starts a drag,
  or uses "Add to playlist…".

## Where items come from
- The details window is the main place to build a playlist. It gets a
  right-click menu (the remote's context button opens the same menu)
  at all three levels:
  - Series (the show header): "Add all episodes to playlist…"
  - Season (its header or tab): "Add season to playlist…"
  - Episode (each episode row): "Add episode to playlist…" and "Add
    this and the rest of the season…"
- Each entry opens a short playlist picker:
  - the open playlist first
  - then recent playlists
  - then "New playlist…"
- Movies in the details window get "Add to playlist…".
- The same three levels can also be dragged onto the panel (series
  header, season header or tab, episode row).
- Search results: drag a show or movie card onto the panel.
- Any video card: the existing right-click menu gains "Add to
  playlist…" next to Details. For a show, it adds all episodes. Cards
  can also be dragged onto the panel (same gesture as multi-view).
- Import from My List (below).
- The right-click menus are the remote/d-pad path, and they work even
  where drag can't cross surfaces.

## Service-agnostic items
- An item is the title or episode itself, not a service's copy of it.
  It stores:
  - a catalog identity (TMDB id where available; otherwise show/movie
    title + year, plus season and episode number)
  - every service where search or details found it, with that
    service's deep link when known
- When the same title appears on several services in search results,
  it becomes one item.
- Cross-service episode matching uses season and episode number, then
  air date and title as checks. If services number a show differently,
  the mismatch is flagged on the item, never guessed.
- **Service order:** each playlist has a preferred-service order, set
  in advance. The default is this device's signed-in services, in the
  order the user last set. At play time, the item plays on the first
  service in that order that is signed in on this device and has it.
- Any single item can be pinned to one service, which overrides the
  order.
- Each item shows which service it will play on right now. "Not
  available here" appears only when no signed-in service has it.
- Service availability is checked when playing, not when adding, so
  signing into a new service later just works.

## Episode lists and deep links
- The details window is the source of seasons, episodes, air order,
  and episode deep links. Playlists read what it already loads; they
  don't change what it fetches.
- A show added without opening details (from search results or a card)
  gets its episode list the same way the details window would load it,
  through the same code path.
- Only if the details window has no episode list for a service: fill
  the structure from TMDB under the user's own key (the same key,
  cache, attribution, and terms caveat as The Binge), with TVmaze
  (CC BY-SA, attributed) as the keyless fallback. This lookup is added
  alongside the details window, not inside it.
- If an episode has no deep link on the chosen service: an optional
  menu adapter method, `episodes(showRef) -> [{season, episode,
  deepLink}]`, reads the service's own show page in the signed-in facet
  (observe-only, navigation only; §26). A missing match is recorded
  locally, never guessed.
- With no deep link at all, Play opens the show on that service. A
  "Next up: S2 E5 · <title>" note shows on screen, and the user picks
  the episode in the service's own player. Continuous play waits for
  the user in that case.
- Fetched on-device; nothing routed through Entangled (§22).

## Items: episodes and movies only
- A playlist is a flat list. Every item is a single episode or a single
  movie.
- Adding a season adds each of its episodes as individual items, in air
  order. Adding a series adds every episode of every season the same
  way. Specials (season 0) are left out unless added directly.
- "Add this and the rest of the season" adds that episode through the
  season's last episode.
- Episodes land as a contiguous block: at the drop point for a drag,
  and at the end for a menu add. After that, each is a normal item that
  can be moved anywhere.
- A series add is a snapshot: episodes that air later are not added
  automatically.
- Duplicates (same catalog identity) are skipped, with a note ("3
  already in this playlist"). Adds over 100 episodes ask for
  confirmation first.
- Each item also stores its title, kind (episode | movie), poster, and
  date added. Episodes also store show, season number, episode number,
  and air date.

## Import from My List
- "Import My List" (in the panel and on the playlist menu) copies the
  My List rows, merged across services, into a new or existing
  playlist.
- Choices shown before the import:
  - Which services' lists to include.
  - For shows: all episodes, or season 1 only.
  - Movies are added as single items.
- The import is a one-time copy. It never stays in sync with My List,
  and it never changes My List on any service.
- Same dedup and large-add confirmation as other adds.

## Continuous play
- "Play" starts the first not-completed item, in the current view's
  order, through the existing play path. Tapping any item starts there.
- When an item ends (observed through the existing end-of-play /
  watch-log path), the next not-completed item starts automatically,
  on its own resolved service.
- If the service's own autoplay rolls into the same episode that's
  next on the playlist, Prism keeps it. If it rolls into anything else,
  Prism navigates to the next playlist item. This is navigation only;
  no synthetic clicks (§26).
- The item that played to its end is marked Completed, with an undo
  shown briefly. Items the user leaves early are not marked.
- Taking a break:
  - "Stop after this one" (panel and remote) ends the run when the
    current item finishes.
  - Backing out of the player ends the run immediately.
  - The next Play resumes at the first not-completed item. The service
    handles the in-episode position itself.
- Existing standing instructions (pause-after-break, onEnd) keep
  working as they do now. If one conflicts with continuous play, the
  existing instruction wins.
- A small "Playing from <playlist> · 3 of 12" tag shows on the playlist
  panel tab. It doesn't overlay the video.
- The big window's bar carries a playlist control (2026-10-01, "Can we
  make it so the playlist is playable on that control bar too?"): the
  selection - None or a playlist, a drop-down to change it - then Play,
  and a pencil that opens the playlist on the Playlists tab to build or
  change it. Play starts the selection where it left off (core's resume
  point). While the selected playlist runs the control reads "Star Trek
  · 3 of 12", Play becomes Stop, and the drop-down adds Stop after this
  one.
- Decision (2026-10-01, "Playlist should be a selection or none. None
  means something OTHER than the playlist is playing on the big
  window"): the selection is None whenever the big window takes a title
  of its own while no playlist runs, and when a run ends because another
  title took the window. A run makes its list the selection; Stop keeps
  it, so Play carries on. The panel above the window shows the same
  selection, with None in its list, and its Edit link is the same pencil.

## Sort and grouping
- **Manual** (default): the user's own order. Episodes from different
  shows and movies can be freely intertwined (for example, alternating
  two series). This is the stored order.
- Other views, each remembered per playlist:
  - Grouped by show: episodes under collapsible show headers, in air
    order within each show; movies in their own group.
  - By date added.
- Other views never change the manual order. Switching back to Manual
  restores it exactly.
- Reordering by drag or remote works only in Manual. Starting a drag in
  another view offers "Switch to Manual to reorder".
- Play order always follows the current view.

## Completion
- Items are marked Completed by continuous play (above) or manually,
  and can be un-marked. Completed items are faded and move to the end,
  keeping their relative order. In grouped view they fade and sink
  within their group.
- Manual marking has an undo right after. "Mark all of this show
  completed" is available from an item's menu.
- Un-marking puts the item at the end of the not-completed section.

## Editing
- In Manual, drag items between each other to reorder, with a drop
  indicator at the insert point. Multi-select (for example, a run of
  episodes) moves together.
- Remote/d-pad: Move up / Move down / Move to top / Move to position…
  on items.
- Per item: pin to a service, or clear the pin.
- Per playlist: edit the preferred-service order.

## Finding playlists
- Search and filter the playlist list by playlist name AND by the
  titles and shows inside them. Sort the list by name or last updated.
  This filter is separate from the cross-service search.

## Managing
- Rename, delete (with confirmation and a short undo), remove item,
  remove all of one show's episodes, clear completed.

## Boundaries
Observe-only posture unchanged. Playlists launch playback through the
existing player by navigation and never automate a service's UI. No
ranking or suggestions: the manual order is exactly what the user set.
