# Break watch packs: one person's reports, every PRISM's covers

*Status: first cut built 2026-11-07 (the models, the picture network and the ad catalog as pack parts; rules, settings, channel logos,
sounds and the revocation list still to come); the first pack, 2026-11-07.1, published that afternoon (4 files, 5.75 MB) and verified from
outside: signature valid, every file's hash as named, pack.json at max-age 60, the files immutable; 2026-11-07.2 an hour later with the
app's low-channel model (3.48 MB new), verified the same way. Since the same evening `publish-windows.py` fetches the live pack into
`Assets/breakwatch/pack/` and verifies it (`scripts/release/fetch-pack.mjs`) before it builds, and refuses to publish when it does not
verify: every release carries the newest pack, as decided on 2026-10-07.* `scripts/release/publish-pack.py` builds, signs (the pack's own key,
`~/.prism/prism-breakwatch-signing.pem`) and uploads a pack to `prism.entangled.world/breakwatch/`; `--bundle` puts it into the app's
`Assets/breakwatch/pack/` and stamps the extension's bundled model with the serial. The app (`Services/BreakPack.cs`) uses the newer of
the bundled and the downloaded pack, verifies both the same way, checks once a day with the one opt-in on (Watch settings) and applies a
newer pack between looks while no cover is up. The extension (`bg.js`) fetches with the panel's opt-in, verifies in the browser and keeps
the model and the network in storage; the offscreen page reads the newer of the bundled and the kept at a channel's start. 2026-10-07:
*Decision:* yes, a signed pack from us, drafted here before any of it is built.

The break watch (`targets/win-host/PrismHost/Services/BreakModel.cs`, `MainWindow.BreakWatch.cs`) covers a live channel's commercials
read off the picture, because YouTube TV's page and traffic say nothing about them (memory: ytv-linear-breaks-no-traffic). Everything it
knows is either built in (word lists, timings) or learned on the one PC (a channel's logo, the fingerprints of ads it has seen). A pack
moves the first kind out of the code and shares what we have checked of the second, so a fix made from one household's reports reaches
every PRISM in hours, without a release.

PRISM covers ads; it never blocks or skips them (docs/third-party-services-policy.md). A pack changes what PRISM covers, nothing else.

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
  "models": {
    "prism": { "file": "files/7d0e...a4.json", "minPrism": "0.36.0", "exams": "90.6% / 2.46%" },
    "veil":  { "file": "files/c31b...08.json", "minVeil": "0.8.0",  "exams": "90.0% / 2.14%" }
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
  that does not compile, `minPrism` above this PRISM) leaves the held one in place. The status line says why, once.

## On the PC

- **The fetch** (only with the setting on): at start (after the windows are up) and once a day after (*Decision 2026-11-07*, six hours before), `GET pack.json` and `pack.sig`, no query string, the UA
  "Prism/<version>" and nothing else; `If-None-Match` with the server's own ETag, so an unchanged pack costs a few hundred bytes. The
  named files only when their hashes are new. Added to docs/network.md in the commit that builds it.
- **Applied without a restart:** a window's model picks the new rules at its next look; a running break is not re-judged mid-way.
- **The built-in rules stay the floor:** the code ships today's lists as the defaults, and a pack replaces a list only as a whole, so a
  PRISM with no pack (offline, a fork without a server) works as it does now.
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
- **A setting, off by default:** Watch settings, "Get ad cover updates from Entangled". *Decision (2026-10-07):* Until it is turned on PRISM fetches no pack and runs on its built-in rules and what this PC learned, exactly as it
  does today. The address and key sit beside the update server's for forks.

## Every release carries the newest pack

*Decision (2026-10-07):*

- **Bundled at publish:** `publish-windows.py` copies the newest signed pack (`pack.json`, `pack.sig` and every file it names) into the
  build's `Assets/breakwatch/` before it builds, and refuses to publish if the pack does not verify. A fresh install starts with every
  rule, logo and fingerprint checked up to that day; nothing has to be fetched.
- **The newer pack wins:** at start PRISM holds two at most, the one in its own install and the one last downloaded (only with the
  setting on), and uses the one with the later `pack` serial. A new version with the downloads off moves the person to the newest pack
  of its day; with the downloads on, a pack published after the release is used until the next release brings a newer one.
- **Verified the same way:** the bundled pack is checked against the pack key like a downloaded one. A bundled pack that fails is
  dropped and the built-in rules carry on, said once in the log.
- **No difference in what it can do:** a bundled pack is held to the same guards in code as a downloaded one.

So the opt-in is about timing, not about who gets the detections: everyone has the newest pack as of their version, and the setting adds
the ones published between versions.

## The learned models, and the PRISM extension (draft 2026-11-06)

*Decision (2026-11-06):* the break watch's models reach the PRISM extension as a signed data pack, not as extension releases. The extension carries the PRISM
app's ad covering into browsers; this section extends the pack to the learned detector and to the extension; it is a design for review, nothing of it is built.

**The models are a pack part.** `models` names two learned detectors, each a file addressed by its sha256 like the rest:

- `prism`: the PRISM app's model (today's `Assets/breakwatch/learned.json`), read by `LearnedBreak.cs`;
- `veil` (the file's key; the extension's model), trained on the same days in the same run but without the inputs a browser cannot read (on-screen text and
  QR codes; captions only when the person has them on; no sound), read by the browser port (`src/breakwatch/learned-break.js`).

Each carries its own minimum version (a model can name an input only a newer build fills, such as `cover_up`) and its exam scores, so
the notes say what changed. A model is data: trees, thresholds, word weights, the cover policy. Nothing in it runs as code, which is what
the Chrome Web Store and Firefox Add-ons both require of anything an extension downloads, and the reader refuses a file whose fields are
not the ones it knows.

**A model ships only when it beats the one it replaces**, on the same check the household's retraining uses: the seven exams and
election night, at least as much ad time covered and no more show wrongly covered. The extension's model also passes the port's parity test
(`scripts/breakwatch/parity-js.mjs`: every input, the chance and every cover the same as the C# bench) before it is signed.

**In the PRISM extension:**

- **Bundled, then updated:** every extension release carries the newest signed pack's `veil` model (today `src/breakwatch/model.json`,
  unsigned and hand-copied; it becomes the bundled pack). The newer of the bundled and the downloaded one wins by the pack serial, as in
  the PRISM app.
- **The fetch is the panel's opt-in**, off by default, beside the live TV picture options: "Get ad cover updates from Entangled". With it
  on, the extension fetches `pack.json` and `pack.sig` once a day and at start, from the address it already may reach (its manifest's
  `https://prism.entangled.world/*`; no new permission, no new install warning), with no cookies (`credentials: "omit"`), no query string
  and nothing about the person; the named files only when their hashes are new. Added to docs/network.md in the commit that builds it.
- **Verified in the browser:** WebCrypto checks the ECDSA P-256 signature (raw r||s, the same scheme as the art index and the source
  lists bg.js already verifies) against the pack key built into the extension's source, and every file against its hash. A pack that fails leaves
  the held one in place, and the panel says why, once.
- **Kept in `chrome.storage.local`** (the model is about 1.7 MB; the quota is 10 MB), read by the offscreen page when it starts a tab's
  watch. A new model is picked up at the next channel's start, never in the middle of a break.
- **Firefox** has no tab stream, so it never runs the model: its build leaves the model out and its fetch skips the `models` part.

**Logos for a fresh install.** A channel's learned logo saves the eight minutes a new window spends learning it. The PRISM app keys channels by
YouTube TV's channel id; the extension by the live stream's watch address, which may not be the same for a channel across days. *Open:* map
the two (the watch page names its channel) before the `channels` part is of use to the extension.

**What the extension sends:** nothing, in this design. The opt-in uploads above are the PRISM app's; the extension's "Not a break" stays on the PC.

**Questions for the owner before it is built:**

1. One opt-in for everything a pack carries in the extension (rules, model, later logos), or the model on its own switch?
2. The fetch once a day: enough, given a model changes at most nightly?
3. The pack key: the same key as the PRISM app's packs (one pack, two readers), or one of the extension's own (a leaked
   extension key could not sign the app's covers)?

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

*Decision (2026-11-07):* one opt-in covers the pack: the one Watch setting named above (ad cover updates from Entangled) turns on the
fetch and everything the pack feeds, in the app and in the extension alike; no second switch. *Decision (2026-11-07):* the fetch runs once a day
(at start, then every 24 hours), not every six hours; a release still carries the newest pack. *Decision (2026-11-07):* the on-device
learning of logos and known ads stays beside the pack as a gap filler (measured 2026-11-04: this PC's own library 93.1% of ad time for
1.09% of show, joined with another day's labelled ads 94.4% for 1.22%; a fresh install starts with the pack's, and keeps learning), under
the pack's revocation list. *Decision (2026-11-07):* the pack has a signing key of its own, as drafted above: a leaked pack key signs no
release, and the daily pack signing never touches the release key.

- Fingerprints across services: YouTube TV first; the same national ads run on Sling, Hulu Live, Fubo. A print is a picture's, so it
  carries over; logos and channel ids do not.
- The pack's size: 18,000 prints is about 1.2 MB; a delta (new prints since the held pack) when it grows.
- Whether settings should differ per channel (FX's banners want a longer logo wait than TLC's).
