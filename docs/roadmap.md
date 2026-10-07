# Roadmap — what is deferred, and why

Decisions and ideas the household's walkthroughs produced that are not being built now. Each line says what was asked, what was
decided, and what it would take. The build order itself is in the spec (dashboard-schema §29); this is the list beside it.

## Sign-in and sessions

- **The browser's password manager** (on since 2026-10-03): Chromium's own, in the shared profile; a re-sign-in after a signout is a
  tap. Prism never sees a password. The first sign-in stays on the service's page.
- **Sharing sign-ins and saved passwords between Prism boxes in a household** (asked 2026-10-03, "Is it possible to share these
  profiles and their passwords to other prism boxes in the household?"). Not by copying the profile: Chromium encrypts its cookies and
  saved passwords with DPAPI, keyed to the Windows account of that machine, so a folder copied to another box cannot be read there, and
  decrypting them to move them would make Prism a credential handler, which the services policy rules out. The clean route is a
  password manager the household already uses, as a browser extension in the shared profile (WebView2 runs extensions): Bitwarden or
  1Password keep the passwords, sync them between boxes themselves, and fill the service's own login page; each box still signs in
  once, which is a tap with the manager. What it takes: extension loading in the host (`AreBrowserExtensionsEnabled`, a place to put
  the extension's files), the manager's own unlock on the wall, and a walk of each service's login page with the manager filling it.
  Sessions themselves (the cookies) stay per box: a service's session is a device's, and the services would not thank us for cloning
  one.
- **A keyboard on the phone** (build order 3, the remote PWA): what you type on the phone lands in the field focused on the wall, a TV
  remote's keyboard. Nothing stored. Makes the first sign-in painless on a wall with no keyboard.
- **A standardized login modal that fills the services' fields** - asked and declined (2026-10-03): Prism would hold passwords, most
  services' logins have a second step (Apple's code, Amazon's code, Disney's OneID frame), and scripted typing is what their bot
  detection looks for.

## Privacy

- **Third-party cookie blocking in the shared profile** - decided against (2026-10-03, "We'll leave it as they are"); what it would
  break is in docs/features/sign-ins.md. **A tracker blocklist** on the request hook is the opt-in middle ground if ever wanted: refuse
  known ad and analytics domains without touching the sign-in frames.

## Covering ads

- **Break watch packs: what one person's reports teach, every Prism gets** (asked 2026-10-07, "Should we allow the users to
  synchronize these ad blocking heuristics from us? So when users point out ads, what can we do to supply the benefit for others in a
  timely way?"; *Decision:* "Yes", add it here and draft the format). A signed pack in the bucket beside the update manifest: the break
  watch's word lists and bounded settings as data, channel logos learned on our own recordings, and the ad fingerprints we have checked.
  With the person's opt-in (off by default, *Decision:* "Pack updates off by default, opt in."), Prism fetches it every few hours with
  nothing about the person in the request and applies it without a restart. Every release carries the newest pack in its install, so a
  person who leaves the downloads off still gets the detections with each new version (*Decision:* "I also want to ensure each copy of
  the software receives the latest ad block detections"); the newer pack wins. The reports (and,
  opt-in, fingerprints of ads that named themselves) come in through the inbox, are checked against our recordings each day, and go out
  in the next pack - same day at best, next day at worst. Never one person's report straight to everyone: a shared fingerprint still
  needs the channel's logo away, the guard that ended C-SPAN2's ten-minute wrong cover (2026-10-06). The format, the guards and the
  privacy terms are in docs/features/break-watch-packs.md. What it takes: the built-in lists in BreakModel.cs moved to a data file the
  pack extends, a pack signer and checker beside the update scripts, the publish step that bundles the newest pack into each release, the
  host's fetch and merge, the opt-in upload and its inbox route, and the daily check.

## Performance

- The per-page cost is measured each minute (perf.log, the Performance tab). Left on the list: the 10 MB/s three playing windows draw
  (that is the video), and the brain's menu answers to the Watch page's follow loop (30 KB every three seconds; a change signature
  would cut it to a few bytes).

## Devices

- **PrismOS daemon and image** (Pi, mini PC): build order 4, after the Windows host is proven.
- **Android shell**: parked, a dead end (WebView DRM); no feature owes it anything (decision 2026-09-09).
- **Prism Photos**: phase two/three (docs/prism-photos-concept.md).
