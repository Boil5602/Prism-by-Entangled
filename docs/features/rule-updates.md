# Rule updates: a fix for a changed site the same day

*Status: built 2026-11-14 on the branch `veil-rules-updates` as the PRISM extension 0.9.0 (asked for that day: updated ad
detection rules for every browser through the existing opt-in, as signed data and never code). First version: display rules. No
rule file is published yet; the first one in the tree adds nothing.*

A site changes its layout and PRISM stops covering its ads, or starts covering something that is not one. A store review takes
days. With `Get ad cover updates` on, the extension fetches a small signed file of rules once a day and uses it beside the rules
in the package. PRISM covers ads; it never blocks them (docs/third-party-services-policy.md). A rule file changes what is
covered, nothing else.

## What a file is

`https://prism.entangled.world/veil/rules/rules.json`, with `rules.sig` beside it. JSON, 64 KB at most:

```json
{
 "format": 1,
 "serial": "2026-11-20.1",
 "date": "2026-11-20",
 "minVeil": "0.9.0",
 "maxVeil": "0.9.9",
 "notes": "one line",
 "display": {
  "slots":  { "add": ["div.new-ad-unit"], "off": ["a packaged selector, as written in src/rules.js"] },
  "stacks": { "add": [{ "stack": "Vendor name", "sel": "[data-vendor-slot]" }], "off": ["Vendor name"] },
  "labels": { "badge": ["partner pick"], "section": ["more from our partners"] },
  "hosts":  { "noAds": ["tool.example.com"], "labelWalkerOff": ["shop.example.com"] },
  "sites": [
   { "id": "example-rail", "hosts": ["example.com"], "cover": ["aside .unit[data-unit]"],
     "closest": ".card", "text": { "sel": ".kicker", "equals": ["Partner story"] },
     "never": ["[data-unit='house']"], "whole": true }
  ],
  "kill": ["a packaged site rule's id"]
 }
}
```

| part | what it does |
|---|---|
| `slots` | adds a selector to the ad slot list, or switches a packaged one off by its exact text |
| `stacks` | the same for the publisher ad wrappers (a name and a selector) |
| `labels` | exact words for the label walker, compared without case: `badge` beside "Sponsored", `section` beside "Paid content" |
| `hosts` | hostnames (a name covers its subdomains) where nothing is covered, or where the label walker is off |
| `sites` | on its hosts: cover what `cover` matches, or the nearest ancestor that matches `closest`; with `text`, only where an element inside reads exactly one of the words; `never` holds back every cover (a packaged rule's too) on or inside what it matches; `whole` makes the cover win over covers inside it |
| `kill` | switches off a packaged site rule by its id (`src/rules.js`, `SITE_RULES`) |
| `video` | reserved. This version checks that it is an object and reads nothing in it, so video rows can come without a new format |

**Data only.** A file holds strings, numbers and booleans. A selector goes to `querySelectorAll`, `matches` and `closest` and
nowhere else; a word is compared with a label's text; a hostname with the page's. No value reaches `eval`, `Function`, a script
element, `innerHTML`, a URL or a style, and a cover shows only the person's pictures. There are no regular expressions in a file.
What needs code stays in the package and can only be switched off from a file: the twenty site rules' own logic, the label
reader for Facebook, the stream readers, the player hooks, the sound rows, the AI label lookup.

**Limits** (`LIMITS` in `src/rules-pack.js`): 64 KB; 300 selectors in a file; 150 entries a list; 100 site entries; 20 selectors,
hosts or words a site entry; 200 characters a selector. A selector is one selector (no comma), printable ASCII, names an id, a
class or an attribute, and has no `:has()`, no `*`, none of `{ } ; < > \`. An unknown field, a wrong type or a value over a limit
refuses the whole file.

## What the extension does

- **Fetch** (`bg.js`, `rulesCheck`): only with the opt-in on (`pv:ui.packUpdates`), once a day at most (a check not asked for by a
  press waits 23 hours after the last one, however often the background starts), no cookie, no query string, no referrer. In
  Chromium the same check then fetches the live TV pack; Firefox has nothing that reads the pack and fetches the rules alone.
- **Verify** (`src/rules-pack.js`, `accept`): the size, then the signature (ECDSA P-256 / SHA-256, the scheme of the pack and the
  art list) with the pack key or the spare key, then the schema, then `minVeil` / `maxVeil` against its own version, then the
  serial: newer than the kept one and newer than the package's own (`BASE_SERIAL`). A file that fails changes nothing.
- **Keep**: `pv:rules` = `{ serial, date, notes, at, file }` and `pv:rules:last` (the last check's word). Nothing else is written.
- **Use** (`src/rules.js`): each page reads the kept file as it starts, checks the schema and the versions again, tries each
  selector once on an empty fragment (one the browser refuses is dropped alone), and joins it to the packaged rules. Site entries
  that take more than 30 ms a pass three times in a row are dropped on that page. A page-sized element is never covered, by any
  rule.
- **Off**: switching the opt-in off removes `pv:rules`, and a page reads the kept file only while the opt-in is on, so the next
  page load uses the packaged rules alone.
- **The person's own rules**: `pv:rules:mine` = `{ display: {...} }`, the same schema. No screen writes it yet. Nothing in the
  update path writes it. It is joined last and wins: what the person added stays when an update switches it off, what they
  switched off stays off, and their site entry replaces an update's with the same id. It applies with the opt-in off too.
- **The settings** show `Rules <serial>, updated <date>` under the switch, or that the packaged rules are in use, and the last
  check's word. The tooltip says what this browser fetches.

## Versions and rolling back

The serial is the day and a count (`2026-11-20.1`); newer is later. A roll back is the old content published under a higher
serial. A release that takes the published rules into `src/rules.js` moves `BASE_SERIAL` on, and a browser's kept file at or
below it is dropped. `maxVeil` keeps a file away from a later version whose packaged rules it was not written for.

## The keys

A file is signed with the pack's key (`~/.prism/prism-breakwatch-signing.pem`). The extension also accepts a spare key
(`RULES_SPARE_PUBKEY` in `bg.js`), made 2026-11-14, for the day the pack key is lost. Its private half is kept offline and never
signs in normal publishing; `publish-rules.py` refuses it without `--spare-key`.

## Publishing

1. Edit `prototypes/prism-veil-extension/rules-update/rules.json` (a higher serial) and, for a fix, add a stand-in page with the
   site's changed markup to `assets/store/standin/` and its line to `rules-update/expect.json`
   (`{ "host", "page", "why": { "update: <id>": count }, "total" }`). Commit both: git is the record of every rule set.
2. `node prototypes/prism-veil-extension/build-firefox.mjs`, then
   `node scripts/release/rules-test.mjs prototypes/prism-veil-extension/rules-update/rules.json prototypes/prism-veil-extension/rules-update/expect.json`.
   The real packages run in a headless Chromium and a headless Firefox on the stand-in pages, without the file and with it. It
   passes when the pages the file is not meant to change keep their covers, the pages in `expect.json` have theirs, and no cover
   is half the window. A pass writes the file's SHA-256 to `scripts/release/out/rules/tested.json`.
3. `python scripts/release/publish-rules.py --dry-run`, then without `--dry-run` (on a weekday after 6 PM Eastern, or `--daytime`). It checks
   the file with the extension's own reader, refuses unless the tested hash is this file's hash, signs, checks the signature as
   the extension will, refuses a serial that is not newer than the live one, uploads `rules.json` then `rules.sig`, and fetches
   both back to verify them.

`rules-update/demo/` is a demonstration (the stand-in page `changed.html`); the publishing script never sends it.

## Not yet

Video rows (player families and site rows as data), a screen for the person's own rules, and the first check of a published
file by a real 0.9.0 in each browser: until a file is live, the fetch and the signature check have run only in the unit tests and
against a live address that answers 404.
