# Prism — Marketing shots (composition references)

*Six shots for the site, extracted from `prototypes/prism-website-mockups.jsx`
(committed 2026-09-03) and tied to the Scene Templates and the Parkers demo
household (`scripts/seed-demo-household.mjs`, charter §7), so each screenshot
becomes reproducible from the demo once the features it depends on land.*

**Rules the mockups follow, kept here as the rules for the real shots:** no
third-party content frames (abstract "playing" surfaces or open-licensed
media with a CC label), the demo household only, service names as wordmark
chips only, no tokens / IPs / emails, nothing that phones home. Every shot is
taken from a seeded store (`node scripts/seed-demo-household.mjs --live`),
never from a household's real config.

This document **describes compositions; it does not order work.** Where a
shot needs something the wall cannot do yet, the gap is named with its
charter or ledger reference, and the shot waits. Mock 4 (Prism Beams) is
handled in charter §2.5.2 / §2.5.4 and is not repeated here.

---

## 0. One thing every shot depends on: the household's names

The mockups' Parkers are **Alex** and **Sam** (adults), **Maya** and **Leo**
(kids), and a pet, **Biscuit**. The names appear on the calendar, the weather
line ("grab a jacket, Maya"), the chores and the listener chips — every shot
but the Control Center.

*Done (CS-10.5, 2026-09-03).* The seed (CS-5) had invented **Dana, Omar,
Sofia, Milo** and "the cat" before the mockups existed; its members, its
chore list ("Feed Biscuit") and the `demo-household` fixtures now carry the
mockups' four, so **the shots and the fixtures answer to one household**.
Seed data only — no code path changed, and §10 was re-demonstrated after the
rename (seed twice byte-identical, reset back to `{"version":1,"data":{}}`).
The member **ids** moved with the names (`dana` → `alex`, and so on), because
the chores and the calendar render `nameOf(id)`: leaving the ids behind would
have shown "Maya" against a `sofia` record. The CS-5 ledger row still names
the original four — it is the record of what CS-5 did, and is left standing.

---

## 1. Kitchen Command

**Caption:** *the archetype — video hero, Merge family + work calendars,
weather, derived-shelf news ticker. The quiet Prism pill sits bottom-right.*

**Composition (16:9, fractions of the canvas):**

| region | rect | content in the mock |
|---|---|---|
| hero | `{0, 0, 0.665, 0.82}` | an abstract playing surface labelled `▶ Open movie night · Big Buck Bunny (CC-BY)`, thin amber outline (`#F0A83C` at 33 %) |
| calendar | `{0.665, 0, 0.335, 0.476}` | **"Today · The Parkers"** / `MERGE · family + 2 work calendars` / five rows: `8:00 Bus — Maya & Leo` · `9:30 Sam · design review` · `12:00 Alex · client lunch` · `3:45 Maya — soccer practice` · `6:30 Family dinner 🍝`, each with a colour lane |
| weather | `{0.665, 0.476, 0.335, 0.344}` | `⛅ 72°` / `Partly sunny · H 78° L 61°` / mono `rain 6pm · grab a jacket, Maya` |
| ticker | `{0, 0.82, 1, 0.18}` | `NEWS` in amber mono, three headlines separated by middots |
| pill | bottom-right, above the ticker | `Prism`, mono, translucent |

**Template:** `kitchen-command` (charter §2.1). **Differences from the
shipped blueprint:** the mock has **no chores slot** and its right column is
calendar-over-weather (58/42); the template is a three-up column
(weather · agenda · chores, each `4:3·M`) with the ticker under the hero
only, not full width. Recorded in charter Appendix A.1 — the shot can be
taken from the template as-is (a chores panel in the column is on-brand) or
the blueprint amended; not decided here.

**From the seed today:** the chores panel (live), the calendar *data*
(`demo:calendar`, 11 events — but see the gap), placeholders for hero and
weather.

**Gaps before the shot reproduces:**
- **A calendar facet that renders `demo:calendar`.** The seed writes the
  week as local data behind one reconcile point; nothing draws it yet.
  Options: a first-party `prism-agenda` micro-facet (the "ICS → agenda"
  generic feed facet of Appendix A.3, fed locally) or Merge itself. The
  `MERGE · family + 2 work calendars` line is the Kitchen killer feature and
  is a **Merge** roadmap item (ICS subscriptions).
- **A weather facet with the wear line.** `weather · current-conditions`
  is a real site facet; the mock's `grab a jacket, Maya` is
  weather-to-wear, which no facet produces. For the shot: the real facet.
- **Hero content:** an open-licensed video (Big Buck Bunny, CC-BY) in a
  YouTube facet, not a placeholder. Manual, one-off.
- **The pill** exists (`Prism · …`); the mock's is silent — confirm the
  idle pill text is just `Prism`.

## 2. Intermission — "the ad break becomes a Bierstadt"

**Caption:** *the moment that sells everything: the ad break becomes a
Bierstadt. Intermission card with pause-after-break, attribution in the
corner.*

**Composition:** Kitchen Command exactly as shot 1, with the hero veiled:

| element | placement | content in the mock |
|---|---|---|
| scenery | hero rect, full bleed | a warm landscape (radial ochre → slate) with an amber glow top-right |
| card | centred on the hero | `◑ Intermission` (amber, grotesk) / `Your show will be paused after the break` / mono `0:52 left` — translucent dark, blurred, 11 px radius |
| attribution | **bottom-right of the hero**, small mono at 45 % white | `Bierstadt · Rocky Mountain Landscape, 1870` |

**Feature:** §26 intermission, `pack:gallery` (CS-2), the §26 card corner
(CS-2), pause-after-break (§26), the countdown when the adapter reads
remaining time. All shipped.

**From the seed today:** Kitchen Command's hero carries
`intermission: pack:cosmos` (charter §2.1) — the shot wants **`pack:gallery`**
on this hero, or the shot is taken on Movie Night, which already names it.

**Gaps before the shot reproduces:**
- **No Bierstadt in the Gallery pack.** The fetch pulled Church, Cole,
  Inness, Gifford, Kensett, Heade, Cropsey, Durand. *Rocky Mountain
  Landscape* (1870) is in the White House collection; the Met's *The Rocky
  Mountains, Lander's Peak* (1863) and AIC/Met Bierstadts are public domain.
  `node scripts/fetch-pack.mjs gallery` with a Bierstadt query, manifest
  entry included — provenance rules unchanged (charter §3.1).
- **Attribution format and corner.** Charter §3.2 says title — creator —
  credit + license; the mock shows `creator · title, year` bottom-right with
  no license. Which corner CS-2 chose and the exact line format are not
  pinned in a fixture; align before the shot (the charter's line is the
  normative one — the mock omits the license, which the charter does not).
- **`0:52 left`** needs an adapter that reads remaining ad time
  (`frame.adInfo`); YouTube's does. A real ad break, manual.
- **The card's own text.** Mock: `Your show will be paused after the
  break`; shipped card: pause-after-break is a checkbox. The shot should show
  the checkbox checked and whatever confirmation line the card renders —
  match the mock's wording if the card has a line.

## 3. Sports Multiview

**Caption:** *a main game with two beside it, both advancing as living
previews. Scoreboard strip below; §14 listener chips bottom-left, both
phones on the game that owns the sound.*

**Corrected 2026-09-03.** The old caption sold "one game to the room, one to
Sam's earbuds (split listening)". §14 carries **one capture of the frame's own
output**, so every private listener hears the §3 audio owner — per-listener
sources are NOT YET (ledger B-25, and §14 now says so in the spec). The mock
and this shot were redrawn to what the wall actually does.

**Composition:**

| region | rect | content in the mock |
|---|---|---|
| game hero | `{0, 0, 0.665, 0.84}` | `▶ Game 1 · LIVE · audio: room + 1 phone`, amber outline; chip top-right `♪ room` (active green) |
| game 2 | `{0.665, 0, 0.335, 0.42}` | `⏸ Game 2 · preview · 0:12 ago`; chip `still` |
| game 3 | `{0.665, 0.42, 0.335, 0.42}` | `⏸ Game 3 · preview · 0:28 ago`; chip `still` (inactive) |
| scores | `{0, 0.84, 1, 0.16}` | `SCORES` amber mono, then `HOME 21 — 17 AWAY · Q3` · `EAST 3 — 2 WEST · P2` · `BLUE 88 — 84 RED · 4Q 5:12` |
| listener chips | bottom-left, above the strip | `♪ Alex's phone ▸ Game 1` (active) · `♪ Sam's phone ▸ Game 1 (paused)` — both on the audio owner |

**Template:** `sports-multiview` (charter §2.2). **Resolved by CS-10.2
(2026-09-03):** the shipped template IS hero-plus-two — the mock was always
right and the 2×2 is gone. `game1 {0,0,0.665,0.84}` · `game2`/`game3`
`{0.665, 0/0.42, 0.335, 0.42}` · `scores {0,0.84,1,0.16}`, keeping the
audio-follows-tap and peek settings. Note the classes are the **derived**
ones — `4:3·XL` and `3:2·M`, not `16:9` — because a 16:9 slot on a 16:9
canvas needs equal w/h fractions; charter §2.2 carries the reasoning. The
fourth game was dropped deliberately: four concurrent players exceeded §18's
budget on every build but the mini PC.

**Features:** audio-follows-tap (CS-1/CS-4, shipped); §25 living previews
(CS-1/CS-4, shipped — the `still` chip); **§14 private listening chips
(CS-10.2, shipped)** — core composes them (`listeningChips`), the host draws
them bottom-left, and the label is the paired device's name. Every chip names
the **audio owner**, because §14 carries one capture of the wall's output;
`Sam's earbuds` on a *different* game is B-25 and NOT YET.

**From the seed today:** five placeholders (charter §7 — no accounts).

**Gaps before the shot reproduces:**
- Real video in three slots (YouTube/Twitch live streams — manual, and
  the content must be shot-safe: abstract or CC-labelled).
- **Peek visible:** on a 16 GB box nothing demotes (§18), so `Game 3` will
  play, not hold a still; take the shot on the N100 or lower
  `maxLiveTiles` (B-94's neighbour in `DeviceBudget.cs`).
- ~~Listener chips — UI over §14 state, not built.~~ **Shipped (CS-10.2).**
  To make them appear you must actually pair a phone and turn on "Listen on
  this phone": no listeners means no chips, by design.
- **`0:28 ago`** — a peek-age label; §25 has no such surface text. Ledger
  candidate.
- **Scores strip content** — a scoreboard region facet (ESPN/league) per
  the library; the template's `scores` role is the news ticker
  (`headline-river`). The mock's strip is scores, not headlines.

## 5. Popup Control Center

**Caption:** *the transparency receipt: every intercepted popup named,
attributed to the rule that caught it, one tap to open or always-allow.
Time-reclaimed ledger underneath.*

**Composition:** a dim, striped page behind; bottom-right a 300 px panel:

| element | content in the mock |
|---|---|
| title row | `Popup Control Center` · right-aligned mono `this site · 24 intercepted` |
| rows (4) | `trk-adserve-example.net` ×14 `EasyList · $popup` · `win-a-prize-example.com` ×6 `click-consistency` · `video-plyr-popcdn-example.io` ×3 `EasyList · $popup` · `checkout.stripe.com` ×1 `allowed · payment` — each with **Open** and **Always allow** (amber outline) buttons |
| footer | mono `4h 12m reclaimed this month · everything stays on this device` |
| pill | bottom-right `Prism · 3 popups blocked` |

**Feature:** §30 popup doctrine and the Popup Control Center (core
`popups.ts`; host `MainWindow.Menu.cs` / `MainWindow.QuickActions.cs`); the
§26 time-reclaimed ledger (`reclaimed.ts`; three windows — week · month ·
all time — the mock shows the month). The mock uses the two human verbs the
UI is required to use, **Open** and **Always allow**, and no jargon for the
allow-list — that is the shot's copy, verbatim (CLAUDE.md vocabulary). Not a Scene
Template — this shot is of the shell, on any scene.

**From the seed today:** nothing — the ledger and the interception list
are runtime state, and the seed writes no popup history (nor should it
invent one against a real domain).

**Gaps before the shot reproduces:**
- **A staged interception fixture.** The mock's domains are
  `*-example.net/.com/.io` (RFC 2606-style, safe) plus `checkout.stripe.com`
  as the allowed example. A `--popups` seed option writing a demo
  interception ledger with exactly these rows, and a reclaimed total of
  `4h 12m` for the month, would make the shot deterministic. Ledger
  candidate; the store keys the Control Center reads are the reconcile
  point.
- **Rule attribution text** (`EasyList · $popup`, `click-consistency`)
  must be what the shipped ledger actually records per interception — verify
  the shipped wording before staging it.

## 6. Family Hub, portrait

**Caption:** *the solver's range: Merge week, shared album, weather-to-wear,
chores. Proof the frame isn't TV-shaped.* (Mock aspect 9:14, a tall tablet;
the template's canvas is 9:16.)

**Composition:**

| region | rect | content in the mock |
|---|---|---|
| calendar | `{0, 0, 1, 0.46}` | the same "Today · The Parkers" facet as shot 1 |
| photos | `{0, 0.46, 1, 0.30}` | a green-dark gradient with mono `Shared album · Lake weekend (demo)` bottom-left |
| weather | `{0, 0.76, 0.5, 0.24}` | the weather facet |
| chores | `{0.5, 0.76, 0.5, 0.24}` | `Chores` / `✓ Feed Biscuit — Leo` (faint) / `○ Trash out — Maya` / `○ Water plants — Sam` |

**Template:** `family-hub` (charter §2.4). **Divergence:** the mock leads
with the **calendar** (46 %) and puts photos second; the template leads with
**photos** (`4:3·XL`, 40 %) and has six roles (adds timer and ticker).
Appendix A.1 records the library's order (Merge week upper). Either the
shot uses the shipped layout (photos on top, chores and timer live) or the
blueprint is amended toward the mock. Not decided here.

**From the seed today:** chores (live, the Parkers list), timer (live),
placeholders for photos, agenda, weather, ticker.

**Gaps before the shot reproduces:**
- The calendar facet (shot 1's gap).
- **A photos facet** with a shared-album label — Prism Photos is phase two
  (charter §2.4); for the shot, an open-licensed still in a plain facet
  labelled `(demo)`.
- The chores list's *content* — three items in the mock vs. six in the
  seed; the mock's ✓/○ marks and `— name` format match the shipped page's
  data shape (`who`), rendering differs (the page shows a check-box row,
  not a glyph). Cosmetic; take the shot from the shipped page.

---

## Cross-cutting

| Item | Shots | Status / where |
|---|---|---|
| Household names (Alex, Sam, Maya, Leo, Biscuit) | 1, 2, 3, 6 | proposal §0 — seed data only |
| Calendar facet rendering `demo:calendar` | 1, 2, 6 | not built; Appendix A.3 "generic feed facets" (ICS → agenda) or Merge |
| Bierstadt in `packs/gallery` | 2 | fetch + manifest entry, charter §3.1 rules |
| `sports-multiview` hero-plus-secondaries variant | 3 | data-only proposal, Appendix A.1 |
| Listener chips / `♪ room` `♪ phone` badges over §14 | 3 | not built — ledger candidate |
| Peek-age label (`0:28 ago`) | 3 | not in §25 — ledger candidate |
| Staged popup interception fixture | 5 | not built — ledger candidate |
| Token typefaces bundled locally (Space Grotesk, IBM Plex Mono) | all | charter §2.5.4 P6 |
| Mock 4 amendments P1–P5 | (4) | charter §2.5.4 |

The rule that decides every open row above: **the wall is the truth, the
mockup is a sketch of it.** Where the two disagree, either the charter
absorbs the mock (a `Decision:` line, then code) or the mock is redrawn
from a real screenshot of the seeded household — never a marketing image
that the product cannot produce.
