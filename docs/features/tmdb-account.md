# The person's TMDB account: ratings from the wall

2026-10-03. "Let's build ratings writes to TMDB for individual accounts, if linked."

## What it is

With their own TMDB key already on the wall (Watch settings, General), a person may link the TMDB account that key came from. Once
linked, the stars on a title's details page write a rating to TMDB under their name, and their own rating of a title shows on the wall
beside TMDB's public mean. Nothing else rates anything: a rating is a press on a star, never inferred from watching.

## How the link works

TMDB's v3 flow, three calls under the person's key (core `tmdb-account.ts`, `lenses.ts` linkStart / linkFinish; host
`MainWindow.TmdbAccount.cs`):

1. **Link my TMDB account** (settings, under the key): Prism asks TMDB for a request token and shows the approval page as a QR for the
   phone and an *Open here* for the wall (the link window, which allows `www.themoviedb.org/authenticate/` for this alone). The person
   signs in to TMDB there and presses Approve.
2. **I approved it**: Prism trades the token for a session and reads the account's name. Pressed too soon, TMDB answers 401 and the
   card says so; the token stands.
3. The session is kept on the device beside the key (`lens:tmdb:session:<dash>`), sent to TMDB alone, only with a rating or its
   read-back. **Unlink** ends the session on TMDB's side and forgets it; the ratings stay on the account.

No account is ever created: TMDB has no API for that, and Prism signs in, never up (docs/third-party-services-policy.md).

- **Asked right away** (2026-10-03, "Can we ask for this approval right when they enter the account info? That way it's possibly still
  logged in on whatever device they're going through, like their phone"): saving a key brings the card up as the settings close, unless
  the account is linked already. *Not now* is fine.
- **The note** (2026-10-03, "add a note in options to indicate where ratings approval hasn't been granted"): with a key in and no
  session, the General tab says in amber "Ratings approval not granted yet. You see TMDB's ratings, but can't rate from the wall until
  you approve Prism on your TMDB account", with *Approve now* beside it.

## Rating

- Ten stars under "Your rating" on a title's details page, the person's own lit in amber; a press writes that whole number (TMDB takes
  half steps from 0.5 to 10; `ratingValue` rounds); the lit star pressed again takes the rating back (a DELETE). TMDB's word on the
  write is checked (`writeOk`); the pill says what happened.
- The account's own rating of a title is read once (`/account_states`) and kept (`lens:tmdb:ratings:<dash>`, "kind:id" to value, 0 for
  none), so a card shows it without a call; a write updates the record and clears the title's cached public mean so the next read
  shows the moved average.
- Not linked: the line reads "Link your TMDB account to rate" and opens the settings. No key: no line.

## One rating, every service, one line (2026-10-03)

"Make sure the rating affects the same title on any service ... maybe we should come up with an overlay color pattern to make it
display both combined somehow without taking up extra space."

- A rating keys on the TMDB title (kind and id), never the service: the same film on Netflix and on Paramount+ is one rating, and every
  card of it shows the same star (core `mineOf`, cards carry `mine`; Watch's rows, the Library, Browse, search and the catalog cards).
- The card's existing rating line carries both numbers: the star glyph is the person's - dim when they have no rating, filled amber from
  the left by their rating's share of ten - and the words beside it stay TMDB's ("6.2 · TMDB · 126 votes"). No extra line, no extra
  width. The tooltip names both. The details page's rating fact draws the same star and fills as the stars below are pressed
  (host `MainWindow.RatingLine.cs`).

## My list is the TMDB watchlist (2026-10-03)

"Can we let users select and add titles to their TMDB 'My Watchlist' ... disable the existing My List items from different services and
replace it with TMDB My Watchlist. Offering to add all titles from individual services watch lists ... If this TMDB link gets deleted or
removed from prism, then the previous per app setting for populating My List should be restored. This would reduce prism's workload."

- While an account is linked, Watch's My list row is **My Watchlist**: the account's TMDB watchlist, both kinds, newest added first,
  read every ten minutes and kept on the device (`lens:tmdb:watchlist:<dash>`). Each title is a card the way Browse makes them - the
  household's services that carry it, from JustWatch through TMDB, one press plays and several offer the choice; a title on none of
  them is still shown ("Not on your services") and its press opens its page.
- The services' own My List pages are **not read** while linked (`refreshChain` skips the list step): the workload saving. Their lists
  are not changed.
- **The offer**: "Add N titles from your services' My Lists" on the row's head while some of their titles are not on the watchlist
  (the last kept copies of the services' lists, matched by name). The copy matches each to its TMDB work (the facts kept, else TMDB's
  search narrowed by the service's providers), adds it at a person's pace, and reports added / already there / couldn't match, the
  unmatched named in the tooltip. A person's press; nothing runs it alone.
- **On and off**: "Add to My Watchlist" / "Remove from My Watchlist" in every card's menu (by the card's title through the facts' TMDB
  match), and a My Watchlist toggle on a title's page in place of the services' My List button. The services' "Add to My List" items are
  not offered while linked.
- **Unlink** forgets the watchlist with the session, and the row is the services' own My Lists again, read as before: nothing to restore,
  since nothing of theirs was turned off. TMDB's watchlist itself cannot be deleted; unlinking is the way back.

## Decisions

- No corporate key, no relay (2026-10-03): the person's own key stays the way in. A key shipped in an open-source build is public, a
  relay would see every household's lookups, and the cost is recurring. So no guest sessions either: anyone who can rate already has
  the account, and a guest session is not an identity (a new one each day could vote again).
- Host calls are synchronous (the brain is asked through `PrismRuntime.*`), so each call starts the work and answers the state it has;
  the host asks again a moment later (`tmdbLinkState`, `tmdbRated` with `working`).
- The keyed fetch may write: `net.fetchKeyed` carries an optional method and JSON body (the host sends a GET otherwise).

## Lists: the v4 sign-in, and what a TMDB list holds (2026-10-03)

The playlists are to move onto the person's TMDB lists (public or private, named), so they follow the account to any device. A read
access token (the v4 key, a JWT) links through TMDB's v4 sign-in: one approval gives the user access token for lists and a v3 session
converted from it for the ratings and the watchlist. A v3 key links as before and has no lists. The primitives are in `lenses.ts`
(`listCreate`, `listGet`, `listUpdate`, `listDelete`, `listItems`, `listsOfAccount`), always under the user's token, never the key.

Measured on a private "Prism test" list the wall made and deleted each run (the one write test the person approved), 2026-10-03:

- An item's **comment is kept**, set through the update call (`PUT /4/list/{id}/items` with `comment`; the add call ignores it, as
  TMDB's reference says "only adding a comment is supported"). Three quirks, each seen more than once:
  - **set once**: a later update of an item that already has a comment answers success and changes nothing. To change a comment,
    take the item off the list and add it again with the new one (which also puts it last in TMDB's own order).
  - **sometimes dropped**: about one write in five answered success and read back null (prose of 200 and 1,000 characters once each,
    a 68-character string twice, a run of one repeated letter twice). So a write is verified by a fresh read and done again until it
    is there; TMDB's answer alone is not the record.
  - **reads are cached by address**: a read right after a write at an address TMDB served before shows the old answer. Read at a
    fresh address (a changing query value) after a write. The first probes read the stale cache and wrongly concluded comments were
    never kept.
  - Kept at 300 and 499 characters; 1,000 dropped the once it was tried. 500 is the working ceiling.
- The **description keeps 5,000 characters**; 10,000 is refused.
- Items come back in **add order** (`original_order.asc`); adding an item already there is refused ("Media has already been taken").
- A list holds **films and shows**, never episodes.

*Decision:* the playlists are the account's lists (docs/features/playlists.md "On TMDB", `playlist-tmdb.ts`): a playlist's state
per show or film lives in its entry's comment as short structured text within 500 characters - status, the spot and its seconds,
and for a show the episodes it covers, the ones watched and the ones left out; order is release date ("Let's just sort them by
release date only for now"), so none is written. Every comment write is read back and done again until kept.

## Tests

`packages/core/tests/tmdb-account.test.ts`: the readings of TMDB's answers; the link in two steps against a fake TMDB (pressed too soon,
then approved; the session kept); a POST under the session, one read-back, a DELETE, the refusal when unlinked, the unlink; the v4
link from a read token (the approval page, the access token, the converted session) and the list primitives under the user's token.

## On the Set up services page (2026-10-06)

"It was supposed to have the details on adding TMDB as a resource with a tooltip informing what benefits it adds to the app. Also
note about any data practices that are in conflict with our own." The TMDB block (`MainWindow.Welcome.cs`, FillWelcomeTmdbAsync)
says in one always-shown line what TMDB is and that Prism works without it. Two chips under it: **What TMDB adds** (the benefits
on its tooltip and, pressed, written out: ratings with vote counts, the catalog rows and Browse, Search everywhere, the Episodes
list; linked, rating from the wall, the watchlist as My List, Playlists) and, in amber, **How TMDB's data practices differ from
Prism's**, which written out says:

- From TMDB's privacy policy (effective 2026-08-24): TMDB keeps API usage data, IP addresses and device identifiers; its website
  and apps use Google Analytics and advertising partners for interest-based ads, and it shares personal data with them in a way it
  says "may be considered a sale" (opt-out: Your Privacy Choices on themoviedb.org).
- What Prism sends, only with the person's key: the titles on their rows and their search words (the key ties them to the TMDB
  account, the one request kind Prism makes that carries an identifier, as docs/network.md records); linked, the ratings, the
  watchlist and the playlists, which live on the TMDB account (a list public or private; TMDB may show public content to others).
- Nothing else goes to TMDB and nothing passes through Entangled; clearing the key stops all of it. The notice TMDB's terms require
  closes it: "This product uses the TMDB API but is not endorsed or certified by TMDB."

The chips are pressable as well as hoverable: a wall is read from across a room, where there is no hover. Rewrite the text when
TMDB's policy changes; its date is in the note.
