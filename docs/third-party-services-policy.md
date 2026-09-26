# Working with third-party services

Prism shows streaming and music services (Netflix, Hulu, Disney+, Spotify and the rest) in its own
windows, on the household's own accounts. This page is the project's rules for how Prism's code
and adapters treat those services. It applies to everyone who contributes code or adapters.

It is a statement of how we build Prism, not legal advice. Questions about a specific service's
terms go to Entangled Labs LLC.

## What Prism is

- **A client, installed and run by the household.** Each copy runs on the user's own computer.
  The project cannot reach into an installed copy, change it, or switch anything off. What the
  project controls is what it publishes: new releases, and the adapters shipped with them.
- **A browser for the household's own accounts.** People sign in on the service's own page, inside
  Prism. Prism never asks for, sees, stores or sends a password.
- **Open.** The source is public under the GNU GPL v3 or later, so anyone can see exactly what
  Prism does with a service.

## The rules

1. **Never handle credentials.** No password fields filled by Prism, no stored passwords, no
   tokens lifted from a service's pages. Sign-in happens on the service's own page, by the person.
2. **Never touch copy protection.** Protected video plays through the browser's own protected
   player. No code decrypts, captures, records or bypasses DRM, and no "unlock" scripts that
   change what a service's player is willing to serve. (Community experiments of that kind stay
   out of this repository; see `docs/dashboard-schema.md`.)
3. **Page actions only.** Adapters read what a service's page shows and press the page's own
   controls. No calls to a service's private or internal interfaces, no use of its session tokens.
4. **The household's own accounts only.** No account sharing, no reading anyone else's data, no
   collecting a service's catalogue beyond what the household's own pages show.
5. **A person's pace.** Background reads are paced, rest when nobody is about, back off from a
   service that stops answering, and stay under a daily ceiling (the polite client in
   `packages/core/src/orchestrator.ts`). No bulk crawling.
6. **Respect a block.** If a service's pages refuse Prism, Prism shows the service's own page and
   says so. No workarounds, no disguises built to get past a block.
7. **No disguises.** Prism does not mask what it is to avoid a service's detection.
8. **Ads.** On streaming services Prism covers an ad's picture and mutes the tab while the ad
   plays underneath. The ad is still served. It does not block or skip ads on a service's player.
   Covering ads is part of Prism and stays.
9. **Names and logos identify, never endorse.** Service names and logos are shown only to say
   which service something is on. Prism never suggests a service endorses or works with it.
   Credits carries the "not affiliated" statement.

## If a service objects

A cease-and-desist letter, a formal complaint or any legal notice about a service goes to
Entangled Labs LLC straight away, and no contributor responds to it alone. The company decides
the response with legal advice. Any change that follows reaches users in a new release or
adapter update. Copies already installed stay as they are.

## For reviewers

A change that breaks one of the rules above is review-rejectable, the same as a vocabulary or
hover-audit failure. When in doubt, ask before merging.
