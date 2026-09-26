# prism-adapters (in-repo staging of the community adapter repo)

Spec §5/§31 territory: **data, not code**. This folder is the staging ground
for the separate community repo of the same name; it splits out unchanged when
that repo opens. Everything here is reviewable text — CSS/JS adapter payloads
and JSON catalog entries. **No binaries, ever** (enforced by
`validate-catalog.mjs`, run from the repo's `npm test`): posters are fetched
from the service's own site at runtime (§31 — manifest icon →
`apple-touch-icon` → `og:image` → wordmark fallback), never committed.

## catalog/

One JSON file per optimized site (§31 schema). Rules the validator enforces:

- Allowed files: `*.json`, `*.md` only. A PR adding a `.png`/`.svg`/anything
  binary fails — a poster cannot be "improved" by committing a logo.
- Required fields: `id` (= filename), `name`, `url`, `aspectHint`, `audio`,
  `poster.source` (`"site"`) + `poster.fallback` (`"wordmark"`).
- `drm.windows-host` must be `"hardware" | "software" | "none"` **with an
  `evidence` pointer** to the report that recorded it (docs/reports/…). No
  evidence, no tier — expectations shown in the picker are traceable (§5).
- `focusPresets[].selector` is a **name**, resolved against the adapter's
  named selector table — never raw CSS. Selector drift is adapter-repo
  churn; catalog entries stay stable. `null` selector = whole page, and a
  "Whole page" preset is always first.
- `zoom` in 0.5–3; `audio` in `exclusive | mix | mute`.

`_example-custom.json` shows the shape the picker writes for "any website"
tiles — it produces plain tile schema (§31: nothing picker-specific persists).

## adapters/ — the data blocks (scene-model era additions)

- `selectors` — the named table presets resolve against (unchanged).
- `controls` — §26/§32 pass-through map: `play | pause | next | prev | skip |
  fullscreen | normal | close` → the site's OWN control. Value grammar: a CSS
  selector; a deep selector whose `>>>` segments descend open shadow roots
  (`amp-playback-controls-play >>> button`); or `key:<Binding>` for a
  shortcut the page handles (`key:Space`, `key:Shift+N`). Core forwards a
  control **only on a human press** (remote, pill, phone card, intermission
  chip) — never on a timer. A toggle button is declared twice with
  state-conditioned selectors (`[aria-label="Play"]` / `[aria-label="Pause"]`)
  so a human's *play* can never pause; an undeclared play/pause falls through
  to the page's own Media Session handler in core.
- `presentation` — §26 presentation keeping: `enterFullscreen | enterTheater |
  play`, same grammar. Invocable **only** under a standing per-assignment
  instruction (`keepPresentation` / `onEnd`): core's presentation keeper is
  the single call site (`packages/core/src/adapters-presentation.ts`, asserted
  by test). Nothing else — no menu, no remote route, no timer — can reach it.
- `verified` — per-key provenance for review (`true`, or a note saying what
  was checked and when, or why it could not be). Unverified entries are
  allowed; unlabeled ones are not the convention.
- `js` — observe-only (`frame.adBreak / skipAvailable / adInfo`); the §26 lint
  in `validate-catalog.mjs` and core reject any synthetic interaction.
- **Music scripts** (spec §32, `music*`): `musicContext`, `musicLibrary`, `musicPlay`,
  `musicCmd`, `musicLookup` (+ `musicLookupNote` / `musicLookupCannot`),
  `musicShuffle`, `musicTracks`, `musicQueue`, `musicQueueAppend`, `musicRepeat`,
  `musicStartOver` — each a page-side script defining one `window.__prismMusic*`
  function, documented in `packages/core/src/adapters.ts`. They read the
  service's OWN player object or page, never a private endpoint or a session token.
- **Video scripts** (VP-2, 2026-09-19, the same shape for the video player;
  `packages/core/src/video.ts`): `videoContext` → `window.__prismVideoContext()`
  = `{kind, title, series, season, episode, id, url, playing, position, duration, ad}`
  (what the page plays, as the page says it); `videoLibrary` fills
  `window.__prismVideoLibrary.cache = {continue: [VideoItem], list: [VideoItem],
  shelves: [{title, items: [VideoItem]}]}` (Continue Watching, My List, and the
  page's own rows as shelves - the menu structure for starting things;
  `VideoItem = {id, title, kind, url, artwork, subtitle, progress}`); `videoPlay` → `window.__prismVideoPlay(kind, id, url)` (a human's
  Quick play; reports `window.__prismVideoPlayState`); `videoCmd` →
  `window.__prismVideoCmd(cmd)` true when the player took `play | pause |
  seekforward | seekbackward | next | nextepisode | skipintro | captions |
  fullscreen`; `videoLookup` (cross-service search, 2026-09-19: `window.__prismVideoLookup(token, q)` runs the service's own search from the page core put on a hidden surface and posts `PrismTile.notifyMusicResult({token, op: 'lookup', ok, candidates: [{id, title, kind, year, url, poster, play}]})` - `needs-profile` as the error when a gate stands in the way) and `videoLookupNote` as for music; `videoSearch(q, openId)` presses the result with that id once shown; `videoListUrl` (the service's own My List page, read on a hidden surface for the combined My list) or `videoListRoute` (`window.__prismVideoListRoute()` walks there from a mounted home);
  `videoProfiles` → `window.__prismVideoProfiles()` = `{gate, profiles: [{id, name,
  avatar}], current}` (the service's "Who's watching?" gate) and
  `window.__prismVideoProfile(id)` (a human's pick from the wall; "always watch
  as" is a standing instruction core applies when the gate shows again). A tile
  is a video tile when its adapter declares any of them. Netflix 0.2.4 carries
  the set, read live on the wall 2026-09-19 (the new browse rows, the profile
  gate, the player's keyboard shortcuts); the title-while-hidden reading stays
  unverified.

## catalog/ — `facetPresets` (§31 utility facet presets)

Per-slot-class tuned presets, keyed by a slot class (`"4:3·M"`) or an aspect
bucket (`"8:1-ticker"` = any tier): `{ id, label, selector: <adapter name>,
zoom?, pad?, fit?, url?, notes? }`. The facet editor offers them as chips when
the App's entry has one for the chosen class; Scene Template roles name them
by id (`tunedPreset`). Selector names must exist in the adapter's table — the
validator and `packages/core/tests/adapters-data.test.ts` fail on a dangling
name. Shipped: `weather` (NWS current conditions / 7-day), `npr` (text edition
headline ticker), `google-calendar` (schedule view; the honest stand-in until
Merge has a public web client), and the two first-party pages below.

## catalog/ — first-party entries (`account: "none"`)

`prism-chores` and `prism-timer` (docs/concept-scenes.md §6) are Prism's own
pages, served by the host at `https://tiles.prism/chores/` and
`https://tiles.prism/timer/` from `targets/win-host/PrismHost/Assets/tiles`.
They share one adapter (`prism-tiles`) because they share a host, and they
carry two fields the third-party entries do not:

- `account: "none"` — there is nothing to sign in to. The host reads this when
  it creates the App: such an App is **set up on arrival** (`setup.status:
  "signed-in"`), shows no sign-in button in App setup, and never wears a
  needs-attention badge for an account that does not exist. It is also what
  lets a Scene Template role naming one of them pre-resolve (charter §1).
- `firstParty: true` — the page ships with Prism and reaches no network at all;
  its state lives in this device's store (§10). Enforced, not asserted:
  `scripts/verify-tile-assets.mjs` fails the gate on any external origin.
