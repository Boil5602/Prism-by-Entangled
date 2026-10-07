# A new device: the welcome page

Status: built 2026-09-29. Ledger VS-92. Walkthrough: `docs/test-scripts.md` section 15 (FR).

The household's words: "When I go to a new computer and install Prism, I go to the menu and it has the
music player and the video player. But both indicate neither scene is setup ... I'd love to be able to just
start opening and logging into services on a new computer. Ideally they just get a wizard that has them
choose from all (and can select all or some) of the adapters and start doing logins and seeing things
populate."

## What a person sees

One page (2026-10-03, "Why not let people sign in as they choose their services? Less screens"):
**Welcome to Prism**, the catalog's services as the Watch page's own service cards ("I would like to see
the service cards ... I don't like the pill buttons"), A to Z under MUSIC PLAYER and VIDEO PLAYER, as many
a row as the window holds and a page at a time (‹ 1 of 2 ›) when a player has more than two rows' worth
("Alphabetical and paged, grouped on music v video"). A press on a card adds the service to its player (the
players are made the first time) and opens the service's own sign-in in the sign-in window the rest of the
wall uses; back on the page the card's caption reads *Signed in*, *Not signed in* or *Signed out*, and a
signed-in card presses to Open. A card is in colour with an amber edge when its service is signed in and
in greyscale, its mark faded, when it is not ("Need an indicator which services are logged out. Grayscale
card?"); the Watch page's Services row draws them the same way. A press on a card that is not signed in opens the
service's sign-in page straight away, on both pages, and the window grows out of the card: a picture of
the card expands to the whole window in a third of a second and fades as the page arrives
(MainWindow.ExpandFrom.cs). A right-click on a card that is set up takes it off the player, its
sign-in kept. Nothing is chosen first and there is no Continue: choosing is signing in. **Done** goes to
the wall once a service is set up; **Not now** before that. A sign-in cancelled stays on the player, not
signed in, and its rows fill in once it is. Once something is set up the page is titled *Your services*,
which is also what *Set up services* in the Prism menu opens.

**Music | Video** (2026-10-03, "a simple toggle to swap between music and video on a corner that is common to
both the music and watch screens"): a toggle hangs from the top-right edge of the window on both players,
above every page, the wall's player lit in amber. A press on the other side switches the wall the way the
Prism menu's Music player / Video player items do; a player that does not exist opens this page. It is
hidden until a player exists (MainWindow.PlayerGrip.cs).

The page comes up by itself on a wall with no Music player and no Video player, whatever scenes it has
(2026-09-29: the laptop had scenes from an earlier build and no player, and never saw the page). Not now is
remembered until a player exists. It is in the Prism menu as *Set up services*, and a player that does not
exist yet opens it. Running it again adds services; it removes nothing.

## What is made

Core makes it in one call (`playerSetup`, `packages/core/src/player-setup.ts`):

- an App and a full-screen facet (`<id>-home-16x9-XL`) for each service chosen;
- the **Music player**: a Music Lounge, its stage over every music service chosen (each hidden, in audio
  focus), style `sunrise-meadow`, artwork `focal`, `star-walk` for an ad break;
- the **Video player**: a Movie Night, one service on the screen, every other a switch away.

The two players are separate (2026-09-29, "Why are we adding music adapters to the movie scene? ... Would
prefer some intuitive separation"): a music service is in the Music player only, a video service in the
Video player only, and the setup pages list them under those two headings. While the Video player is the
wall, the music pages are kept loaded beside it so music plays on until a video takes the sound and the way
back is instant. That is how the wall is drawn, not what the Video player's scene holds: nothing of the
Music player is written into it, and what an earlier build wrote there is taken out at the start.

Which service a new player opens on: the first one chosen that its template suggests, in the template's
order. None of those chosen: the first chosen.

A music service is one whose adapter speaks the media session. A video service is any other catalog entry
that owns the sound (`audio: exclusive`). A page with no sound of its own is neither and is not listed.

## Rules

- **What stands is kept.** An App, a facet, a player the household owns: the services chosen join it. A
  seeded demo scene (`demo-*`) is not taken for the household's player.
- **A model made on the device is never migrated over.** The one-shot migration (scene-model-spec section
  7) is for a store from before the scene model. On a device that made its own model it answers
  `native-model`, writes the marker and changes nothing. (Found on the first walk: the second boot wrote
  the migrated wall over both players.)
- **A new device's wall starts empty** (`Assets/first-run-dashboard.json`, no tiles). With no scene and the
  welcome page down it says *Nothing is set up yet*, with a Set up services button.
- **Sign in only, never sign up** (2026-09-29, "we really don't need to support sign up actions, we want people to use
  their browsers to register for services"). Prism opens sign-in pages and presses Sign In controls. It never
  opens a registration page or presses a control that says sign up, register, join or start a trial. The
  sign-in list tells a person new to a service to create the account in their browser first.
- **Nothing signs anybody in.** The sign-in is the person's, on the service's own page. No credentials
  pass through Prism (third-party-services-policy).

## Sign in, one rule

Every Sign in on the wall follows it (the welcome list, the setup window's bar and card, the inline app
window):

1. the adapter's `signIn`, when it names one (Amazon Music: `/forceSignIn`);
2. else the adapter's `login`, when it names a page: a path or a query. `login` is first the address the
   redirect check knows a sign-in page by, and for some services that is only a host (Apple's
   `idmsa.apple.com/`, an error page when opened);
3. else the service's own Sign In control on its page is pressed, because a person pressed Sign in: the
   adapter's signed-out marker, the match that says sign in or log in, never one that says sign up
   (Apple Music, Apple TV).

The sign-in window opens at the sign-in page. In that window the page's own account marker decides what
the card says, not the address.

## One account, one sign-in

The household's words: "Apple Music and tv use the same auth. Amazon Music and prime video using the same
auth."

A catalog entry may name the account its service signs in with (`signInWith`: `apple` for Apple Music and
Apple TV, `amazon` for Amazon Music and Prime Video). Services of one account are given one profile
(`account-apple`, `account-amazon`), so the sign-in made for one is there for the other. The sign-in list
says *same sign-in as ...* on each.

- An App that exists keeps the profile it has, always. Its sign-in lives there (section 10), so a wall set up
  before accounts were shared keeps one profile a service and nothing moves.
- A service added later joins the profile of a service of its account that is already here.
- Signing out of one signs out of the other: they are one session.

Not proven yet: that each service takes the other's session without asking again. The profiles are shared
and the pages load in them; nobody has signed in through a shared one.

## Taking a service off

The household's words: "Can people add/remove adapters to the list? Right now we're kind of using them
all, but I'll come out with more. And some people won't need."

Each row of the sign-in list has **Remove**. The service leaves both players and Watch:

- a music service's facets leave the players' hidden sources; a stage that drew it draws the next one;
- a video service leaves the Video player's list; the screen goes to another service when it was on it.

The App, its facets and its sign-in stay on the device (section 10: nothing of the person's is deleted).
Choosing the service again on the first page brings it back as it was, with no new sign-in. The list of
services taken off is kept under `players:removed`.

## Services added on the device

Prism reads adapters and catalog entries from two places: the ones it ships (`Assets/adapters`,
`Assets/catalog` beside the program) and the ones added on the device (`adapters/` and `catalog/` in the
data folder, `%LOCALAPPDATA%\Prism`). A service needs both files: the adapter, and the catalog entry that
names it. They are read at the start. The first page has **Open the folder**.

| Both places name it | Which stands |
|---|---|
| an adapter | the higher `version`; the same version, the shipped one |
| a catalog entry | the shipped one |

A file that is not a JSON object, an adapter with no `match` list, a catalog entry without an id, a name
and an https address, and a name beginning with `_` are left out, each with a line in host.log
(`adapters: ...`). A bad file never stops the rest. A service that came from the device's folder says
*added on this device* in the list (every label traceable to its source).

An adapter carries page scripts. One dropped into the folder runs on that service's pages with the same
reach as a shipped one, so the folder is for files from a source the person trusts. Nothing is fetched:
Prism downloads no adapters.

## The setup window's bar

| Button | Does |
|---|---|
| Sign in | the rule above |
| Watch | saves, closes the window, opens Watch. Not drawn when there is no Video player |
| Home | the service's home |
| Done | saves the status as the page shows it and closes |

A setup window is always silent, so it has no Mute button.

## Open

- Downloading adapters is not built. It needs signed files and an update check that carries no
  identifiers (section 19/22).
- A service taken off while one of its titles plays in a multiview window: the window is closed with the
  scene's floating list, not checked on the screen yet.

- Nobody has signed in through the page for real yet. The press on a service's own Sign In control is
  tested on sample pages, and the controls were read on the live pages in a headless browser.
- The welcome list shows what the device knew when the page was drawn. A service that signs in while the
  page is up shows it the next time the page is drawn.
