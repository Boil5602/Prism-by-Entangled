# SM-6 — the atomic rename commit: plan (for review before the commit)

Baseline: main `a8d6281` (full gate 13/0/0). Canonical vocabulary (CLAUDE.md):
**App · Slot · Layout · Facet · Scene · Canvas class · Visualization · Frame = the
physical device only.** After this commit `node scripts/verify.mjs --strict-vocab`
becomes the gate default and "frame" for anything but the device is review-rejectable.

The inventory below is exactly what `node scripts/audit-vocabulary.mjs --json` sees
on `a8d6281` (18 UI strings + 13 bare code tokens) plus the identifier / channel /
store / doc surface the audit deliberately does not scan. Each row says what kind of
thing it is, because the kinds carry different obligations:

| Kind | Obligation |
|---|---|
| UI string | rename in place; `--strict-vocab` must come out clean |
| code identifier | rename in place (TS + C#); `tsc --noEmit` + host build prove it |
| store key | **never renamed in place (§10)** — read the old key forever, write the new one, migration alias + report line. Result: there are **none** in this inventory (verified: no store key contains "frame"; the pre-model keys are `dashboard`, `layout:<id>`, `tile:lasturl:*`, `apps`, `master-layouts`, `scenes`, `shortcuts:*`) |
| stored value | a value inside a persisted document (`schema` ids, `tile.kind`). Same §10 posture as a key: read both spellings forever, write the new one |
| channel op / field / value | `Channel.g.cs` must regenerate byte-identically from `win-channel.ts` (gate step) and the host must handle both spellings for one release if the value travels the wire |
| doc line | rename; the spec keeps "frame" only for the device |

---

## A. UI strings (18) — rename in place

| # | File:line | Today | Proposed | Notes |
|---|---|---|---|---|
| 1 | `targets/win-host/PrismHost/MainWindow.Layouts.cs:192` | "Floating frames" | "Floating facets" | the list holds facets placed floating (§5 scene-level) |
| 2 | `MainWindow.Layouts.cs:104` | "Prism · nothing to save yet - the frame has no page" | "Prism · nothing to save yet - the slot has no page" | pill |
| 3 | `MainWindow.Menu.cs:118` | "No frames on the wall - add one above" | "No slots on the wall - add one above" | |
| 4 | `MainWindow.Menu.cs:250` | "Hero frame" | "Hero slot" | menu label |
| 5 | `MainWindow.Menu.cs:1216` | "Empty frame" | "Empty slot" | |
| 6 | `MainWindow.Menu.cs:662` | "A view is this page + the placed region, made for one frame shape (pick the shape below - the shapes come from your saved layouts). …" | "A facet is this page + the placed region, cut for one slot class (pick the class below - the classes come from your saved layouts). …" | "view" → **facet** too: the old word for facet must not survive the rename either |
| 7 | `MainWindow.Menu.cs:703` | "No region: the frame shows the page at its own size." | "No region: the slot shows the page at its own size." | |
| 8 | `MainWindow.Menu.cs:705` | "Leave without changing the frame." | "Leave without changing the slot." | |
| 9 | `MainWindow.Menu.cs:719` | "…app-level, so every frame and scene that uses the app starts there. …" | "…app-level, so every facet and scene that uses the app starts there. …" | a home page is per App; what "uses" it is a facet |
| 10 | `MainWindow.Menu.cs:723` | "Back to the wall. The frame keeps the page it is on for now; …" | "Back to the wall. The slot keeps the page it is on for now; …" | |
| 11 | `MainWindow.Menu.cs:1060` | "Use this view in the frame now: " | "Use this facet in the slot now: " | |
| 12 | `MainWindow.Menu.cs:523` | "Prism · no frames to pick" | "Prism · no slots to pick" | pill |
| 13 | `MainWindow.Menu.cs:1024` | "Prism · {id}: region applied at page zoom {z}×, fills the frame at {magnification}×" | "… fills the slot at {magnification}×" | pill |
| 14 | `MainWindow.Menu.cs:143` | "Full Frame" | "Fill slot" | the player's own fullscreen control inside its slot (commit b04bda6: "video fills its frame, WebView2 contains it"); pairs with "Full Screen" which stays |
| 15 | `MainWindow.Menu.cs:1266` | "Full Frame" | "Fill slot" | same control, Control Center row |
| 16 | `MainWindow.xaml.cs:767` | "Full Frame" | "Fill slot" | same control, HUD card |
| 17 | `targets/win-host/PrismHost/Surfaces/SurfaceManager.cs:248` | "Empty frame" | "Empty slot" | placeholder label |
| 18 | `packages/core/src/types.ts:183` | "Movies, streams, YouTube - the widescreen frame; the solver keeps it letterbox-free" | "Movies, streams, YouTube - the widescreen slot; the solver keeps it letterbox-free" | `PURPOSES` description shown in the layout editor |

Plus the `devicePatterns` in `scripts/vocabulary.allow.json` stay as they are (they
name the device). No new exceptions are added by this commit.

## B. Bare code tokens the audit classes separately (13)

| # | File:line | Token | Kind | Proposed | Obligation |
|---|---|---|---|---|---|
| 1 | `MainWindow.Menu.cs:672` | `Content = "frame"` on `frameShapeBtn` | UI string (a one-word toggle: frame ↔ floating) | `"slot"`; rename the button `slotClassBtn` | UI + identifier |
| 2 | `packages/core/src/catalog.ts:39` | `kind?: "frame" \| "floating"` | TS union value on `PickerChoices` | `"slot" \| "floating"` | identifier; not persisted |
| 3 | `packages/core/src/drivers.ts:139` | `setChrome(id, kind: "frame" \| "floating", …)` | seam signature → **channel value** (`surface.setChrome.kind`) | `"slot" \| "floating"` | field type is `string` in `win-channel.ts`, so `Channel.g.cs` does **not** change; the host's `SetChrome` only tests `kind != "floating"` (SurfaceManager.cs:1064), so the new value is accepted with no C# change — still run the channel-repro step |
| 4 | `packages/core/src/orchestrator.ts:309` | `kind?: "frame" \| "floating" \| null` | TS type (updateTile patch) | `"slot"` | identifier; **stored value**: `tile.kind` in `dashboard` docs — today only `"floating"` is ever written (`"frame"` is the implicit default), but read both (`"frame"` → slot) in `normalizeTile`/wherever `kind` is read, forever |
| 5 | `orchestrator.ts:3251` | `popped ? "frame" : "floating"` | channel value | `"slot"` | as row 3 |
| 6 | `orchestrator.ts:3256` | `setChrome(id, "frame", "page", false)` | channel value | `"slot"` | as row 3 |
| 7 | `packages/core/src/runtime.ts:288` | `setChrome` bridge signature | seam signature | `"slot"` | identifier |
| 8 | `packages/core/src/types.ts:211` | `TileSpec.kind?: "frame" \| "floating"` | TS type + **stored value** | `"slot" \| "floating"` with a doc comment "`"frame"` is the pre-rename spelling, read as slot" | read-both on load; never rewrite the stored doc for this |
| 9 | `types.ts:7` | `SCHEMA_VERSION = "frame.dashboard/v0.1"` | **stored value** (every dashboard's `schema`) + share/import id | **keep as is.** It is a schema *identifier*, not vocabulary; the frame-editor prototype, the gallery (§15) and every stored document carry it. Renaming it would force a read-both branch for zero user-visible gain. Record it in `vocabulary.allow.json` `exact` as a schema id — or better, extend the audit's `isCodeLiteral` to treat `^frame\.[\w-]+/v` as code (it already does; this row is listed for completeness) | none |
| 10 | `packages/core/src/sharing.ts:28` | `SHARE_SCHEMA = "frame.layout-share/v0.1"` | stored / exported value | **keep** (same reasoning; layouts already shared carry it) | none |
| 11 | `sharing.ts:178` | `"frame.dashboard/v0.1"` literal | stored value | **keep** | none |
| 12 | `packages/core/src/adapters.ts:257` | injected JS: `window.frame.onMediaCommand` | the **page-side adapter API** `window.frame.*` (`frame.adBreak`, `frame.ready`, `frame.skipAvailable`, `frame.adInfo` — also referenced by 7 adapter/extension files in `prism-adapters/` and the Veil extension) | **keep for SM-6.** This is a published contract with the community adapter repo and the shipped extension; renaming it is a separate, versioned change (`window.prism` alias with `frame` kept as a deprecated alias for one adapter-schema version). Not vocabulary in the UI sense | none now; file a follow-up row |
| 13 | `packages/core/src/focus.ts:43` | injected JS mentioning `PrismTile` / framing | code literal; "framing" = §17 region focus, a verb, not the noun | **keep**; §17 "framing"/"framed"/"unframed" stay (they describe fitting a region into a slot and never name the slot itself) | none |

## C. Identifiers the audit does not scan (rename in place; tsc + host build prove them)

TypeScript (`packages/core/src`):
- `FrameShape` (types.ts:171) → `SlotShape`; `frameShapes` (orchestrator.ts:529/1299/2447, `state().frameShapes`) → `slotShapes`. **Channel note:** `frameShapes` is a field of the `state()` JSON the host reads (`MainWindow.Menu.cs:319 TryGetProperty("frameShapes")`) — rename both sides in the same commit; it is a host-call return, not a `COMMAND_SCHEMA` op, so `Channel.g.cs` is unaffected.
- `startFraming` / `finishFraming` host calls (win-channel.ts:153–154) → **keep**: "framing" is §17's verb (region focus). Only their comments change ("the frame pops out" → "the slot pops out").
- Comments in win-channel.ts:148–158 ("configure frame", "app-less frames", "empty frames") → slot wording. Comments don't touch `Channel.g.cs` (only op/field names are emitted) — verify with the repro step anyway.
- Doc comments in orchestrator.ts:516/635, runtime.ts:110, types.ts:118 ("the frame raised", "Frames with a shape") → slot.

C# (`targets/win-host/PrismHost`):
- `FrameContextMenu` (event, 5 refs) → `SlotContextMenu`; `ShowFrameContextMenu` → `ShowSlotContextMenu`.
- `BeginFrameRegion` / `StartFramePick` / `CancelFramePick` / `_framePick` / `_vfFrameAspect` (viewfinder + region pick) → `BeginSlotRegion` / `StartSlotPick` / `CancelSlotPick` / `_slotPick` / `_vfSlotAspect`.
- `WaitForFrameAsync` (ModelBridge, 4 refs) → `WaitForSurfaceAsync` (it waits for a surface id to go live).
- `FloatFrame` (the floating chrome border) → `FloatBorder`.
- `fullFrame` / `frameBtn` / `frameShapeBtn` → `fillSlot` / `slotBtn` / `slotClassBtn`.
- `FrameworkElement`, `requestAnimationFrame`, `TargetFrameworkAttribute` are not vocabulary — untouched.

## D. Store keys and stored values (§10)

- **Store keys renamed: none.** (Audit performed: no key under `%LOCALAPPDATA%\Prism\store.json` or in core's `store.set` calls contains "frame".)
- **Stored values that carry the old spelling:** `tile.kind === "frame"` (possible but never written by current code) and the schema ids (`frame.dashboard/v0.1`, `frame.layout-share/v0.1`, kept). Obligation: `tile.kind` readers accept `"frame"` as `"slot"` forever; add one line to the migration report (`scene-migration.ts` `ambiguous[]`) when a source tile carries an explicit `kind: "frame"`, so the human sees it. No source document is rewritten.
- Migration alias table (for the ledger): `tile.kind "frame" → "slot"` (read-alias, in `types.ts` normalizer). That is the whole table.

## E. Channel

- `COMMAND_SCHEMA`: no op or field names change. One **value** changes: `surface.setChrome.kind` `"frame"` → `"slot"`. Host `SetChrome` already treats every non-`"floating"` kind as a slot, so the change is wire-compatible; the flight-recorder line (`MainWindow.xaml.cs:378`) just prints the new word.
- `HOST_CALLS`: names unchanged (`startFraming`/`finishFraming` kept, see C); comments updated.
- `state().frameShapes` → `slotShapes` (host-call return field; C# reader renamed in the same commit).
- Gate: `node scripts/generate-win-channel.mjs` + `git diff --exit-code` must be clean (expected: `Channel.g.cs` byte-identical, since only comments and a value changed).

## F. Docs

- `docs/win-host-spec.md`, `docs/dashboard-schema.md`, `docs/scene-model-spec.md`, `docs/prism-project-map.md`, `CLAUDE.md`: keep "frame" only where it means the device ("dashboard frames", "the frame is furniture", "this frame"); every "frame (in layout)" / "app frame" / "floating frame" / "master layout (app-less frames)" phrase becomes slot / facet / floating facet / layout. `scene-model-spec.md §1` already states the mapping; add one sentence to CLAUDE.md Vocabulary: "`frame.dashboard/v0.1` and the page-side `window.frame` adapter API are schema/contract identifiers, not vocabulary — they keep their names."
- `docs/bugs/LEDGER.md`: SM-6 row → `done (<commit>)`; the migration alias table from D; a follow-up row for the `window.frame` adapter API rename (versioned, with the adapter repo).
- Test plans (`GOLDEN-PATH.md`, `MUSIC-TESTS.md`, `PRESENTATION-ESC-TEST.md`): "Full Frame" → "Fill slot" where they quote the control.

## G. Gate posture change (part of the same commit)

- `scripts/verify.mjs`: `--strict-vocab` becomes the default (a `--lenient-vocab` escape stays for local runs); the ledger's "How to run the gate" paragraph updated.
- `scripts/audit-vocabulary.mjs`: add "view" (the pre-model word for facet) as a second report-only term? **Proposal: yes, report-only**, so the next sweep can see it — it is not in CLAUDE.md's rule, so it must not fail the gate.

## H. Files to touch, in order (one commit; each step leaves the tree building)

1. `packages/core/src/types.ts` — `TileSpec.kind` union + read-alias normalizer, `FrameShape → SlotShape`, PURPOSES string, doc comments.
2. `packages/core/src/catalog.ts`, `drivers.ts`, `runtime.ts`, `orchestrator.ts`, `scene-migration.ts` (report line), `win-channel.ts` (comments) — the union value, `slotShapes`, `setChrome("slot", …)`.
3. `packages/core/tests/*` — the 3 test literals using `"frame"` as a kind; `npx tsc --noEmit && npx vitest run` green (651 + any new alias test: "a stored tile with kind 'frame' loads as a slot").
4. `node scripts/generate-win-channel.mjs` — expect no diff in `Channel.g.cs`; if there is one, stop: something renamed an op.
5. `targets/win-host/PrismHost/MainWindow.Menu.cs`, `MainWindow.Layouts.cs`, `MainWindow.xaml.cs`, `MainWindow.ModelBridge.cs`, `Surfaces/SurfaceManager.cs` — the 17 strings + identifiers in C + the `slotShapes` reader; `dotnet build … -p:Platform=x64` clean.
6. `docs/*.md`, `CLAUDE.md`, `docs/bugs/LEDGER.md`, `docs/bugs/*-TESTS.md` — F.
7. `scripts/verify.mjs`, `scripts/audit-vocabulary.mjs`, `scripts/vocabulary.allow.json` — G.
8. Run `node scripts/verify.mjs --no-known-gaps --require-all` (strict vocab now default): expect **13 PASS**, vocabulary line `"frame" not meaning the device: 0`.
9. Back up `%LOCALAPPDATA%\Prism` (the ledger's pre-merge rule) — the rename itself writes nothing to the store, but the same commit turns the gate strict and is the last stop before the migration merge.

Estimated diff: ~40 files, ~250 lines. No behaviour changes except the `setChrome` wire value and the `state().slotShapes` field name, both host-side in the same commit.

## I. Explicitly NOT in SM-6 (follow-up rows)

- `window.frame.*` page-side adapter API → `window.prism.*` with a deprecated alias (needs an adapter-schema version bump and a prism-adapters repo release; the Veil extension ships the same prelude).
- `frame.dashboard/v0.1` / `frame.layout-share/v0.1` schema ids — kept indefinitely; a future `prism.dashboard/v1` id, if ever, is a schema migration, not a rename.
- `startFraming` / `finishFraming` / §17 "framing" — the verb stays.
