# Break watch packs: one person's reports, every Prism's covers

*Status: draft, not built (roadmap: Covering ads).* 2026-10-07: "Should we allow the users to synchronize these ad blocking heuristics
from us? So when users point out ads, what can we do to supply the benefit for others in a timely way?" *Decision:* yes, a signed pack
from us, drafted here before any of it is built.

The break watch (`targets/win-host/PrismHost/Services/BreakModel.cs`, `MainWindow.BreakWatch.cs`) covers a live channel's commercials
read off the picture, because YouTube TV's page and traffic say nothing about them (memory: ytv-linear-breaks-no-traffic). Everything it
knows is either built in (word lists, timings) or learned on the one PC (a channel's logo, the fingerprints of ads it has seen). A pack
moves the first kind out of the code and shares what we have checked of the second, so a fix made from one household's reports reaches
every Prism in hours, without a release.

Prism covers ads; it never blocks or skips them (docs/third-party-services-policy.md). A pack changes what Prism covers, nothing else.

## What a pack carries

| part | what | why share it |
|---|---|---|
| rules | the word lists and patterns: an ad's words, web endings, phone numbers, promo words, the show's card, credit words, sponsor tags, QR | each fix of 2026-10-07 was a list edit (`.now`, "join now", the card/credit split) |
| settings | the break watch's bounded numbers (the logo wait, the quiet after a show card, the hold limits) | tuned on everyone's labelled breaks, not one PC's |
| channels | per channel: its name, whether it carries commercials, a logo learned on our recordings | a new window skips the 8-minute learning and the wrong-learning failures (a badge taken for the logo) |
| fingerprints | picture prints (AdPrints, 496 bits) and sound words (AdSounds) of ads we have checked | national ads run on every channel in every home: one confirmed ad covers it everywhere |
| revoked | fingerprint ids and logos withdrawn | a bad print found after it shipped is taken back in the next pack |

Not in a pack, ever: frames, screenshots, captions, anything that reads as what someone watched.

## The files

At `https://prism.entangled.world/breakwatch/pack.json`, `pack.sig` beside it, and the content-addressed files the pack names:

```json
{
  "format": 1,
  "pack": "2026-10-08.1",
  "minPrism": "0.27.0",
  "notes": "USA's MS NOW ad (.now addresses); the credits-dressed Chick-fil-A ad no longer quiets HGTV.",
  "rules": {
    "adWords":     ["join now", "become a member", "..."],
    "urlEndings":  ["com", "org", "net", "tv", "now", "..."],
    "promoWords":  ["set your dvr", "season finale", "..."],
    "showCard":    ["the following program", "viewer discretion", "..."],
    "creditWords": ["starring", "directed by", "..."],
    "sponsorTags": ["continues", "presented by", "..."],
    "adFreeChannels": ["^(C-SPAN\\d?|PBS( Kids)?|PBS .*)$"]
  },
  "settings": { "sureSeconds": 30, "showCardQuiet": 90, "promoHoldSeconds": 35 },
  "channels": {
    "UCz4RdhiXDaZpaVyLjQjb3kQ": { "name": "TLC", "logo": "files/9f2c...e1.logo" }
  },
  "prints": { "file": "files/4b1a...77.bin", "count": 18240 },
  "sounds": { "file": "files/0c9e...3d.bin", "count": 2210 },
  "revoked": { "prints": ["a1b2..."], "logos": [] }
}
```

- **Signed like the update manifest:** ECDSA P-256 / SHA-256 over the pack's exact bytes, raw r||s in base64 (docs/features/updates.md).
  A key of its own (`~/.prism/prism-breakwatch-signing.pem`): a leaked pack key cannot sign an update, and the reverse. A fork sets
  its own address and public key, as it does for updates.
- **Every file a pack names is addressed by its sha256** and checked against it before use. A file already on the PC is not fetched again.
- **`pack` is a serial**, newer is later. A pack older than the one held is ignored, and a refused pack (bad signature, bad hash, a pattern
  that does not compile, `minPrism` above this Prism) leaves the held one in place. The status line says why, once.

## On the PC

- **The fetch** (only with the setting on): at start (after the windows are up) and every six hours, `GET pack.json` and `pack.sig`, no query string, the UA
  "Prism/<version>" and nothing else; `If-None-Match` with the server's own ETag, so an unchanged pack costs a few hundred bytes. The
  named files only when their hashes are new. Added to docs/network.md in the commit that builds it.
- **Applied without a restart:** a window's model picks the new rules at its next look; a running break is not re-judged mid-way.
- **The built-in rules stay the floor:** the code ships today's lists as the defaults, and a pack replaces a list only as a whole, so a
  Prism with no pack (offline, a fork without a server) works as it does now.
- **The guards are code, never data.** A pack cannot change them:
  - an ad's words and a known ad count only with the channel's learned logo plainly away;
  - a shared fingerprint never keeps a cover going on its own, and never counts on a channel whose logo is set aside (C-SPAN2's slides
    matched the library and covered a Supreme Court argument for ten minutes, 2026-10-06);
  - near a program's edge only an ad's own words or a QR code cover;
  - every number is clamped to a range the code sets (the logo wait never under 20 s, the show-card quiet never over 180 s);
  - a pattern is compiled with a match timeout and a length limit, and a pack with one that fails is refused whole.
- **Shared and local kept apart:** shared fingerprints sit in their own file beside the PC's own (`prints.bin`, `sounds.bin`), so a
  revoked one goes without touching what this PC learned, and what this PC learned is never overwritten. A logo from a pack is used until
  the PC has learned its own; the PC's own wins after that.
- **A setting, off by default:** Watch settings, "Get ad cover updates from Entangled". *Decision (2026-10-07):* "Pack updates off by
  default, opt in." Until it is turned on Prism fetches no pack and runs on its built-in rules and what this PC learned, exactly as it
  does today. The address and key sit beside the update server's for forks.

## Every release carries the newest pack

*Decision (2026-10-07):* "I also want to ensure each copy of the software receives the latest ad block detections. So if a user doesn't
want auto updates, at least with new versions downloaded they will."

- **Bundled at publish:** `publish-windows.py` copies the newest signed pack (`pack.json`, `pack.sig` and every file it names) into the
  build's `Assets/breakwatch/` before it builds, and refuses to publish if the pack does not verify. A fresh install starts with every
  rule, logo and fingerprint checked up to that day; nothing has to be fetched.
- **The newer pack wins:** at start Prism holds two at most, the one in its own install and the one last downloaded (only with the
  setting on), and uses the one with the later `pack` serial. A new version with the downloads off moves the person to the newest pack
  of its day; with the downloads on, a pack published after the release is used until the next release brings a newer one.
- **Verified the same way:** the bundled pack is checked against the pack key like a downloaded one. A bundled pack that fails is
  dropped and the built-in rules carry on, said once in the log.
- **No difference in what it can do:** a bundled pack is held to the same guards in code as a downloaded one.

So the opt-in is about timing, not about who gets the detections: everyone has the newest pack as of their version, and the setting adds
the ones published between versions.

## What comes in, and how it goes out

Today a report (Ad debug's Not an ad / This is an ad, the cover's Not an ad) sends the channel, whether the cover was up, how late it came,
and the break watch's last forty readings to the inbox (docs/network.md), and the bench recording on our own PCs holds the frames. That
is enough to fix rules and to learn fingerprints from our recordings, which is where the first packs come from.

**Opt-in: share ad fingerprints** (Watch settings, off by default). With it on, the fingerprints this PC learned from breaks an ad named
itself in (the learning gate that exists today) go to the inbox once a day, batched:

- what goes: the prints and sound words, and the date. No channel, no time of day, no window, no identifier; the same plain request as a
  report;
- what it says about the person: that a set of ads was on a screen in this home that day. That is a hint of what was watched, which is
  why it is opt-in and why nothing finer than the day goes with it.

**Our daily check** (`scripts/breakwatch/`, beside the release scripts):

1. Rule changes come from reports read against our recordings, and every one is a commit with the reports it answers. The replay
   (`bwtest bench`) runs the morning's recordings through the old and new rules, and a change that adds a wrong cover does not ship.
2. A fingerprint ships only if it matches a recorded break on our bench in which an ad named itself, or it has come in on three separate
   days' batches. The inbox cannot tell people apart (it keeps no identifier), so "three days" is the honest measure, not "three people".
3. A logo ships only when it was learned on our recordings and passes its own replay: no wrong cover over a day of that channel.
4. The pack is built, signed on the publishing machine, uploaded (files first, the pack last), and its notes line goes to the changelog.

Same day when a fix is a list edit; the next day when it waits for the check.

## Failure modes

| what | what happens |
|---|---|
| a wrong report, or a deliberate one | it changes nothing until our check agrees; a fingerprint needs a recorded break or three days, and still the logo's absence |
| a bad pack gets out | the next pack revokes it; the guards above keep a print or a word from covering a show with its logo up |
| the pack server is down | the held pack stays; nothing changes on the wall |
| a fork with no server | the built-in rules, as today |
| a channel changes its logo | the PC relearns it as today (a logo missing six minutes is learned again); the pack's copy is replaced at the next check |

## Open questions

- Fingerprints across services: YouTube TV first; the same national ads run on Sling, Hulu Live, Fubo. A print is a picture's, so it
  carries over; logos and channel ids do not.
- The pack's size: 18,000 prints is about 1.2 MB; a delta (new prints since the held pack) when it grows.
- Whether settings should differ per channel (FX's banners want a longer logo wait than TLC's).
