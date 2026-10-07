# Sign-ins: one login for a person, used by both players

Status: built 2026-09-29. Ledger VS-93. Walkthrough: `docs/test-scripts.md` section 16 (SN).

The household's words: "Apple is also a little strange in that profiles are separate by login. So I've
considered allowing the user to select an existing login OR add another, when choosing a new profile set in
the video player ... If someone logs into 1, give them the option to use that same auth for their movies in
their profile set. But if my wife wants to see her own movies and queues in Apple TV, she will need to
login as herself, same with Apple Music. How do we reduce logins where possible but grant this
flexibility." And: "we don't yet have the concept of profiles in the music player. But I want to. Ideally
it uses the same profiles set on the video side." And: "It would be nice for a user with all their profile
info and sign ins configured on both sides would be able to just switch from music to video."

## The idea

Some services keep their people inside one login (Netflix's profiles). Others have one person a login
(Apple). Prism handles both with two things:

- a **sign-in**: one login kept on this device, under a name a person gave it;
- a **profile set**: for one person, the sign-in each service uses and, where the service has profiles, the
  profile in it.

A profile set belongs to the wall, not to a player. It names music services and video services alike, so
the Music player's people are the Video player's people. With a person's set on, switching from music to
video and back asks nothing and moves nothing.

## Fewest logins

- Services that share an account share its sign-ins (the catalog's `signInWith`: Apple Music and Apple TV;
  Amazon Music and Prime Video). A sign-in made for one is there for the other.
- A sign-in already on the device is always offered first. "Sign in as someone else" is the last choice in
  the list.
- A second person signs in once an account, not once a service.

## What a person does

Prism menu, **Profiles**, or the triangle on Watch.

| To | Do |
|---|---|
| see who each service is signed in as | the **Sign-ins** section lists every service under MUSIC PLAYER and VIDEO PLAYER |
| use a login already here | choose it under *Signed in as*, then **Save & exit** |
| add a person | choose **Sign in as someone else**, give the name, sign in on the service's own page |
| keep it as that person's set | type the name at the foot, **Save & exit** |
| switch person | choose the set from the Profiles menu: every service moves, music and video |

Before the first other person is added, Prism keeps the wall as it stands as a set called *Household*, so
there is one to switch back to.

## Rules

- **Nothing is signed out or deleted by a switch.** Each sign-in has a browser profile of its own, and both
  stay on the device, signed in (section 10).
- **Nothing is mixed.** What the wall keeps of a person on a service (their rows, what they own, where
  they left off, the profiles their login has) is set aside under the sign-in the service leaves, and the
  other sign-in's is brought back. A sign-in with nothing kept shows nothing until its pages are read.
- **A switch reloads the service's page**: it is another browser session. Its windows on the wall are made
  again, and its hidden pages the next time they are wanted.
- **The sign-in is the person's.** Prism opens the service's own sign-in; no credentials pass through it.
- The profile a device began with is its first sign-in, named *Household*. A wall from before sign-ins
  changes nothing until a person adds one.
- *Household* is only where the names begin: right-click a sign-in (or a preset) in the Profiles window to
  rename it. A sign-in's new name is taken by every service whose sign-in carried the old one.

## Named from the account page

The household's words: "Instead of even naming the sign ins, can you just capture the username or likely
email address that is used?" and "Just get the ones we can but the rename will catch any that go to
household."

Where a service's own account page shows whose account it is, the sign-in is named from it. The adapter
names the page (`account: { url, within?, name? }`); after the person has signed in, core opens it once on a
hidden page and reads the email in its visible text, else the name the adapter points to.

- **The wall shows the part before the @.** The whole address is not put on a screen a guest can read, and
  it is not kept.
- **Only what the page shows the person signed in.** Never a sign-in form's fields (that is a credential,
  third-party policy rule 1), never a page's script data (rule 3), never text that is not visible.
- **The service's own addresses are nobody's**: one on the service's domain, or `support@`, `help@`,
  `privacy@` and the like, is passed over.
- **A person's name stands.** A sign-in a person named or renamed is never changed by a read.
- **Off the list is not gone.** A sign-in taken off the list keeps its login; a person brings it back.
- **Read once.** A sign-in is read again only after a week, and only while nobody has named it.
- A service with no `account`, or whose page shows nothing, keeps *Household* or *New sign-in* until a
  person renames it. "Sign in as someone else" asks for no name on a service that has an account page.

Read live 2026-09-29 on the household's own services: Netflix (`/account/security`), Paramount+
(`/account/`) and Fandango at Home (`/content/account/myinfo`) each named their sign-in from the email;
Apple Music names it from the account holder's name on its home page (`.user__name`), which names the
shared Apple sign-in for Apple TV too. Not covered yet: Peacock (its account settings ask for the password
again), Apple TV on its own (the name is behind a menu), Tubi (the address is only in the page's script
data), Movies Anywhere, Spotify, Amazon Music and YouTube (their pages show nothing to go by), and the
services not signed in on this wall (Disney+, HBO Max, Hulu, Prime Video, Pandora).
Looked again 2026-09-30 (the household's walls, hidden pages): Hulu and HBO Max send their account pages through
a fresh sign-in first, which is never done for them; Spotify's player names its account holder by the opaque
username only; Tubi's account page shows a profile's name behind hashed class names, not the account; Twitch,
Pandora and Disney+ are not signed in here. Nothing more to add without a page that shows the person.

## One browser, many sign-ins (2026-10-03)

"Why do we need so many profiles? Seems like one per profile set would generally cover it." A browser
profile holds one session a site, the way a person's own browser holds every service at once, so a
browser a service was never needed - it came from the first model, where an App was identity plus session.
Now:

- The first sign-in of every account lives in ONE shared browser profile (`shared`); the second sign-in
  of any account in a second (`shared-2`), and so on: a slot a sign-in. A wall with one login a service
  runs one Chromium instead of nine. A second person's Apple sign-in brings one more browser, for Apple
  alone, and a second person's Netflix sign-in joins that same second browser.
- A new App's profile is `shared`; a new sign-in takes the first slot its account does not hold.
- The one-time move (`sharedPlan` in core, `profile.migrate` to the host, MainWindow.ProfileMove.cs):
  before the first surface of a boot, core plans each legacy folder's slot - the household's own legacy
  sign-ins of one account ("Household", "Household (Apple TV)", Prism's ids, labelled from a page or not)
  all into the first slot, the extra records hidden - and the host copies each folder's sessions onto the
  shared folder: cookies through the DevTools protocol with every attribute (host-only and `__Host-`
  ones included; always set from the https address, since Chromium binds a cookie to the scheme it was
  set from; a session cookie given a year, because a cleanly closed browser purges them and the wall's
  never closed cleanly), each origin's local storage through a page that runs none of the service's own
  script (robots.txt), IndexedDB by copying the origin folders. The old folder is never changed or deleted
  (section 10); a marker file in it says where its sessions went. The sign-ins keep `wasProfile`; the
  Apps move; a kept document's tiles and any surface still naming a legacy id go to `shared`. Marker:
  store key `profiles:shared`; report: diagnostics/profile-move.md.
- Measured on the wall (perf.log): 41 processes and 5.5-6.8 GB at 9 surfaces became 26 processes and
  3.3-3.7 GB at 15 surfaces; CPU 8-9% became 2-3%. PlayReady hardware-secure answers unchanged.
- The tradeoff: a service's third parties can see another service's cookies in the one profile, as in
  Edge. *Decision (2026-10-03, "We'll leave it as they are"):* third-party cookies stay allowed. Blocking
  them would break the sign-ins done in a frame (Apple's idmsa, Disney's OneID for Disney+ and Movies
  Anywhere, Google's for YouTube), the user-state frames Paramount+ and Peacock keep on sibling domains,
  and any license path that rides on a cross-site cookie, while WebView2 shows no Storage Access prompt
  to fall back on; the gain is only cross-service correlation by embedded trackers. A tracker blocklist
  on the request hook is the opt-in middle ground if ever wanted.
- A rehearsal on a copy of the data folder consumes the real sessions of services whose refresh token
  rotates (Tubi, Fandango at Home, Movies Anywhere, Amazon Music): the copy spends the token, the real
  folder's goes stale. Rehearse once, from fresh copies, or not at all.

## In core

`packages/core/src/sign-ins.ts` (pure rules), the runtime's `signInsView`, `signInAdd`, `signInUse`,
`signInRename`, and `signIns` on a profile set (`videoProfilesCommit`, `videoPresetSave`,
`videoPresetApply`). A service moved to another sign-in has its App's profile changed;
`orchestrator.appSignInChanged` closes its hidden pages and `video.switchSignIn` swaps what is kept of the
person. Kept on the device under `sign-ins`.

## Open

- Nobody has signed in through a second sign-in for real. The window opens in the new profile and the
  service's sign-in page loads there; the rest needs a person.
- Resolved (2026-09-30): a music service's resume point, recents and library are the person's, keyed by the
  tile's profile (which a sign-in is). Another sign-in on the same service starts with nothing of the first
  person's; the first person's come back with their profile. Records from before sign-ins are claimed once,
  for the sign-in in use when first read; nothing is deleted.
- Resolved (2026-09-30, "we could hide it as long as it's recoverable in case they need it later"): a sign-in
  is taken off the list from its right-click menu (*Take X off the list*). Its login stays on the device,
  untouched (section 10); it comes back from the same menu (*Bring back X*), from a *Bring back X* entry at
  the foot of the service's "Signed in as" list, or by adding the same name again. Never the one a service is on, never the last one an account has. A set that still names a hidden
  sign-in brings it into use; it is then listed, marked, until the service moves off it.
