# Working with third-party services

PRISM shows streaming and music services (Netflix, Hulu, Disney+, Spotify and the rest) in its own
windows, on the household's own accounts. This page is the project's rules for how PRISM's code
and adapters treat those services. It applies to everyone who contributes code or adapters.

It is a statement of how we build PRISM, not legal advice. Questions about a specific service's
terms go to Entangled Labs LLC.

## What PRISM is

- **A client, installed and run by the household.** Each copy runs on the user's own computer.
  The project cannot reach into an installed copy, change it, or switch anything off. What the
  project controls is what it publishes: new releases, and the adapters shipped with them.
- **A browser for the household's own accounts.** People sign in on the service's own page, inside
  PRISM. PRISM never asks for, sees, stores or sends a password.
- **Open.** The source is public under the GNU GPL v3 or later, so anyone can see exactly what
  PRISM does with a service.

## The rules

1. **Never handle credentials.** No password fields filled by PRISM, no stored passwords, no
   tokens lifted from a service's pages. Sign-in happens on the service's own page, by the person.
2. **Never touch copy protection.** Protected video plays through the browser's own protected
   player. No code decrypts, captures, records or bypasses DRM, and no "unlock" scripts that
   change what a service's player is willing to serve. (Community experiments of that kind stay
   out of this repository; see `docs/dashboard-schema.md`.)
3. **Page actions only.** Adapters read what a service's page shows and press the page's own
   controls. No calls to a service's private or internal interfaces, no use of its session tokens.
   *Exceptions, named (decided 2026-10-16):* Netflix's player object in its own page
   (`netflix.appContext`, the video player's seek and its subtitle and audio tracks), because
   Netflix's page refuses a scripted seek and its track menu cannot be reached by keys; and
   Fandango's own Continue Watching delete, which has no button on its site. Nothing else of
   either's internals, no tokens, and no new exception without a line here.
4. **The household's own accounts only.** No account sharing, no reading anyone else's data, no
   collecting a service's catalogue beyond what the household's own pages show.
5. **A person's pace.** Background reads are paced, rest when nobody is about, back off from a
   service that stops answering, and stay under a daily ceiling (the polite client in
   `packages/core/src/orchestrator.ts`). No bulk crawling.
6. **Respect a block.** If a service's pages refuse PRISM, PRISM shows the service's own page and
   says so. No workarounds, no disguises built to get past a block. A gate a service puts in front of
   a person (Twitch's content disclaimer and its Start Watching) is shown in the service's own words
   with its own verb, and only the person's press goes through to it; PRISM never presses it alone.
   *Exception (decided 2026-10-16):* a removal the person asked for from Twitch's Continue
   Watching plays the video out on a hidden page, and there it may press Twitch's content
   disclaimer's Start Watching for that one video. A gate on screen is still the person's to press.
7. **No disguises.** PRISM does not mask what it is to avoid a service's detection.
8. **Ads.** On streaming services PRISM covers an ad's picture and mutes the tab while the ad
   plays underneath. The ad is still served. It does not block or skip ads on a service's player.
   When a service itself offers a Skip button on an ad, PRISM shows a Skip of its own on the
   cover, and a person's press on it is passed to the service's button. PRISM never presses it
   by itself. Covering ads is part of PRISM and stays.
10. **Nothing plays unasked.** After a restart, a music page that starts its last station by itself on any
   signed-in page it loads (Pandora does, on its home and its collection page alike) has its own play() refused,
   the way a browser's autoplay rule refuses it, until a person asks for that service's music; the page shows its
   own Play button meanwhile. It is not about ads, it blocks and skips nothing a person asked for, and the page
   that was playing when PRISM closed is never gated. Decided 2026-10-31 (B-471); the adapter says `resumesOnLoad`.
9. **Names and logos identify, never endorse.** Service names and logos are shown only to say
   which service something is on. PRISM never suggests a service endorses or works with it.
   Credits carries the "not affiliated" statement.

## If a service objects

A cease-and-desist letter, a formal complaint or any legal notice about a service goes to
Entangled Labs LLC straight away, and no contributor responds to it alone. The company decides
the response with legal advice. Any change that follows reaches users in a new release or
adapter update. Copies already installed stay as they are.

## For reviewers

A change that breaks one of the rules above is review-rejectable, the same as a vocabulary or
hover-audit failure. When in doubt, ask before merging.
