# Prism — Scene Model & Information Architecture v0.1

*Formalizes the four configuration types, their compatibility rules, and the menu/workflow. Vocabulary: **App → Facet → Slot → Layout → Scene.** "Frame" is reserved for the physical device from here on.*

---

## 1. Vocabulary

| Term | What it is | Replaces |
|---|---|---|
| **App** | A service identity: base URL, profile (session), setup state | — |
| **Slot** | A region in a layout, classed by aspect + size tier | "frame (in layout)" |
| **Layout** | A named arrangement of slots for a canvas class | — |
| **Facet** | One face of an App: page URL + region + zoom, cut for a slot class | "App Frame" |
| **Scene** | Layout + facet-per-slot assignments + floating/hidden extras | — |
| **Canvas class** | Target display shape: aspect + logical resolution bucket | — |

## 2. App

```json
{ "id": "hulu", "name": "Hulu", "baseUrl": "https://www.hulu.com",
  "profileId": "hulu-family", "catalogRef": "hulu", "adapter": "hulu",
  "setup": { "status": "signed-in", "lastVerified": "2026-08-30" } }
```

- **Setup mode:** opens the app **full-screen in a normal browsing view** using its profile — user signs in and configures exactly as they would in a browser. Session lives in the profile (§10 never-wipe). Setup status shown on the App card (signed-in / needs attention), verified passively (a facet hitting a login redirect flips it to "needs attention").
- One App can have multiple profiles later (per family member); v1 = one.

## 3. Slots, slot classes & Layouts

- A **slot** is a rect in a layout. Its **class** = `aspect bucket × size tier`.
  - Aspect buckets (standardized so facets are reusable): `16:9`, `4:3`, `3:2`, `1:1`, `3:4`, `9:16`, `21:9-strip`, `8:1-ticker`. A drawn slot **snaps to the nearest bucket** (override allowed, marked "custom — limits facet reuse").
  - Size tiers relative to canvas: `XL` (hero, ≥35% of canvas area — lowered from 45% on 2026-09-01 so the §8 default hero at 0.62 classes XL), `L` (20–35%), `M` (8–20%), `S` (<8%).
  - Class examples: `16:9·XL`, `3:4·M`.
- A **layout** = name + canvas class + a set of slots (id, rect, class). **Excludes floating/hidden** — those are scene-level.
- **Canvas class**: aspect + resolution bucket (e.g., `16:9 @ 1080-class`, `16:9 @ 4K-class`, `9:16 portrait @ 1080-class`). A layout authored on one canvas class runs on any display matching aspect within 2% and resolution within the same bucket; rects are stored normalized (0–1) so scaling is exact.
- **Duplicate detection:** on save, compare against existing layouts of the same canvas class: if every slot pairs with a counterpart at IoU ≥ 0.85 (equivalently center/size deltas within ~5%), flag "possibly duplicates ⟨name⟩ — use that instead? / save anyway / replace it." Never blocks, always asks.
- **Layout editor:** the existing hero-solver editor plus free-slot drawing; slot class badges shown live; save/rename/duplicate/archive (archive hides from pickers, never deletes — scenes referencing it keep working).

## 4. Facet

One face of an App, cut for a slot class:

```json
{ "id": "hulu-livetv-16x9-XL", "app": "hulu",
  "url": "https://www.hulu.com/live",
  "slotClass": "16:9·XL",
  "focus": { "selector": ".LiveGuide", "pad": 8 }, "zoom": 1.25,
  "label": "Live TV guide" }
```

- **Different pages are different facets** — Hulu "Live guide" and Hulu "My Stuff" are two facets of one App; both use the App's profile/session. (A login page never needs a facet: login happens in App setup mode; a facet landing on login flips the App to "needs attention.")
- **Facet editor:** pick App → pick target slot class **from the list of classes that actually exist in saved layouts** (with a count: "16:9·XL — used in 3 layouts") → live preview at that class's shape → navigate to the page → region pick (§31 tap/drag) → zoom → label → save.
- A facet is valid for its slot class on any canvas; the preview renders at a representative size for the class, and the region/zoom are stored relative so rendering scales.
- **Compatibility rule:** facet fits slot ⇔ same aspect bucket AND size tier within one step (an `L` facet may fill an `XL` slot with a "stretch" note; `S`↔`XL` never offered). Exact-class matches list first.

## 5. Scene

```json
{ "id": "kitchen-evening", "layout": "kitchen-3slot",
  "assign": { "hero": "hulu-livetv-16x9-XL", "side1": "merge-week-3x4-M", "side2": "radio-4x3-M" },
  "floating": [ { "facet": "cams-1x1-S", "anchor": "top-right", "size": 0.14 } ],
  "hidden":   [ { "facet": "spotify-controller", "audio": "exclusive" } ],
  "schedule": null }
```

- **Per-assignment settings** (set when a facet is placed in a slot; editable later): `keepPresentation` (restore player fullscreen/theater when the site drops it at ad/end boundaries — never after user-initiated exits) and `onEnd: none | restart | restart-fullscreen`. Both are standing human instructions per dashboard-schema §26; defaults off except video-hero role templates, which default `keepPresentation: true`.
- **Scene builder flow:** choose layout (thumbnail grid, filtered to this device's canvas class) → each slot shows its class and a picker listing **only compatible facets** (exact class first, one-step matches labeled) → add floating facets (anchor corner + size fraction; always above slots, §26 veils still render above them) → add hidden facets (loaded, zero-size surface — e.g., a music app supplying audio; participates in audio focus normally) → name, save, set as active or schedule (§4 `layout` actions become `scene` actions).
- Missing-assignment slots render the App-poster placeholder, tappable to assign.
- Scenes are what carousel (§9), schedules (§4/§24), and sharing (§15 — facets export as slots with the App stripped to a placeholder) operate on.

## 6. Menu / IA (replaces the current structure)

Left rail, pipeline order — each item is a noun with a list + editor, no modes hidden behind gear icons:

```
▸ Scenes      (default view: what's playing now, scene grid, + New Scene)
▸ Layouts     (grid w/ canvas-class filter, dup badges, + New Layout)
▸ Facets      (grouped by App, class badges, + New Facet)
▸ Apps        (cards w/ setup status, + Add App → catalog §31 / any URL)
▸ Device      (canvas class, schedules, remotes, audio, kiosk, updates)
```

- **The two players (2026-09-19):** beside *Now playing* the menu carries **Music player** and **Video player** - the household's Music Lounge and its Movie Night, the active one checked. A press is a scene switch through the same path as the rail and the schedules, with one addition: the Video player *carries the Music player's hidden sources* (they are written into its `hidden` list, same facet ids and audio policies), so the switch destroys no music tile - the music plays on until a video takes the sound, and the way back resumes what a video paused. No player yet opens that template's wizard. Core `players.ts`; host calls `players` / `switchPlayer`. Beside them, **Watch** (VP-3): the Video player is one player for every video service the household has - the service on the screen with its verbs, "Who's watching?" when the service asks, *Watch on* across services, and Continue watching / My list from every service's kept library; a pick on another service switches the screen to it and plays. Core `videoServices` / `videoSwitch` / `videoPlayOn` / `videoProfile`. The same rows drawn full screen over the video slot are the Video player's **hub** (VP-4, `MainWindow.VideoHub.cs`): service chips, the screen's verbs, Continue watching / My list / Recent merged across services with a service badge per card, then each service's shelves - the wall's own Netflix-style page, cross-service.
- **Golden path for a new user is top-down via one wizard:** "New Scene" walks Add App → make Facet → pick/make Layout → assign — creating the entities as it goes, so the pipeline teaches itself. Power users enter any rail item directly.
- Every picker can create-in-place ("+ New facet for this slot") so no flow dead-ends into "go configure that elsewhere first."
- Edit affordances consistent everywhere: card → open editor; long-press/right-click → rename, duplicate, archive.

## 6a. Quick actions & deep links (no menu-diving, normative)

Every entity screen is **addressable** (`prism://app/<id>/setup`, `prism://facet/<id>/edit`, `prism://scene/<id>`, etc.) so any surface — scene, pill, phone remote, badges — can jump straight there and **Back returns exactly to the scene**.

**On-scene interactions:**
- **Single tap** on a video or music item (facet or visualization) → the full-page native experience: video facets promote to hero/fullscreen presentation; music visualizations reveal the native player overlay (§32). One tap in, one tap/Back out.
- **Long-press / right-click / remote-hold** on any item → a compact **context sheet**: `Open full page (setup mode)` · `Edit facet` · `App settings / sign in` · `Swap facet in this slot` · `Mute` — each a deep link, sheet closes on action, Back returns to the scene.
- **Needs-attention badge** (App signed out, facet on a login redirect, adapter failing): the badge renders on the affected item and **is itself the shortcut** — tap goes directly to `prism://app/<id>/setup`; completing sign-in returns to the scene with the facet reloading (§16 crossfade). No hunting for which app, which screen.

**During full-page/reveal:** a small corner affordance (and mapped remote key) offers `Edit this facet` and `App settings` — so "I'm looking at it and want to change it" is one action from anywhere.

**Phone remote parity:** the remote's scene view exposes the same tap and context-sheet actions per item (§6 remote API), so fixing a login can be done from the couch — the frame shows setup mode, the phone drives it, or setup runs on the phone's own screen where the flow allows.

Rule: no state a user can *see* on a scene may require more than one action to reach its *editor* and two to reach its *App settings*.

## 7. Migration

Existing configs map mechanically: current tiles → one App + one Facet each (slot class inferred from the tile's solved rect); current dashboards → one Layout + one Scene. Migration runs once, never deletes source data (§10), writes a report of inferred classes for user review.

## 8. Storage

All five types are schema documents alongside §1–§31 structures; scenes/layouts shareable per §15 (Apps and profiles never travel; facets export with App→slot placeholder). Everything local; nothing new leaves the device (§22).

## 9. Implementation decisions (SM-1, prism-core) — where §2–§7 were underspecified

Recorded here so the editors (SM-2), scene builder (SM-3) and channel (SM-4) build against one reading. Code: `packages/core/src/scene-model.ts`, `scene-model-store.ts`, `scene-migration.ts`, `presentation-keeper.ts`, `music-state.ts`, `news-shelf.ts`.

- **Class strings.** A slot class is the string `"<aspect>·<tier>"` (U+00B7), e.g. `16:9·XL`, `8:1-ticker·M`; a custom aspect is any `W:H` outside the bucket list and parses with `custom: true` (`CUSTOM_CLASS_NOTE` = "custom — limits facet reuse"). Snapping is nearest bucket in log-space; tiers use the slot's share of canvas area (XL ≥ 0.35, L ≥ 0.20, M ≥ 0.08, else S). Classing uses the slot's **pixel** aspect on the canvas, so a normalized rect's class depends on the canvas class it belongs to.
- **Resolution buckets.** `1080-class` (long axis < 2200 logical px), `1440-class` (< 3200), `4K-class`. §3 names only 1080/4K; the middle bucket exists because a 2560-wide window (the real M1 config is 2558×1353) is neither. Portrait is the canvas class's orientation (`9:16 portrait @ 1080-class`), not a resolution bucket.
- **Compatibility is symmetric one-step.** L→XL is compatible with note `stretch`; XL→L with note `shrink`; two steps never; custom aspects match only themselves. Music facets (`music: true`) are never offered for slots (§32 hidden-only).
- **Per-assignment settings** live in `scene.settings[slotId]` (`{ keepPresentation, onEnd, audio?, touch?, preview?, tapAction?, intermission? }`) so `scene.assign` keeps the §5 shape (slot → id). Defaults are off/absent; migration never sets them; templates set them per role (video hero `keepPresentation: true`). The last three arrived with the concept scenes (`docs/concept-scenes.md` §1/§4/§5): `preview: { mode: "peek", interval, playhead }` is the §25 living preview this placement asks for (carried into the tile spec by `sceneDocument`, floored by the device budget); `tapAction: "promote" | "audio" | "both"` decides what a single tap means (absent === `promote`, §6a unchanged); `intermission: { source }` names the §26 imagery for this placement's ad breaks ("pack:gallery", "pack:cosmos", or a photos ref) and turns intermission on for it.
- **Visualizations** are `scene.visualizations[]` and are assigned by id in `assign`/`floating` exactly like facets (resolution checks the scene's visualizations first, then facets). Until a visualization surface exists in the seam, `sceneDocument` renders them as placeholders and says so in its notes.
- **Floating placement** = `{ facet | visualization, anchor, size, rect?, face? }`: `size` is the width fraction (height follows the content's class aspect); an explicit `rect` (canvas fractions) wins — that is what migration and a drag write, so places survive exactly.
- **Layouts carry provenance** (`source`: hero/grid/template/drawn) for the solver editor; the normalized rects remain the truth and a Layout renders through the additive `layout.mode = "fixed"` document (rects × viewport, no solver).
- **Duplicate detection** includes archived layouts (flagged `archived: true`) and ignores the draft's own id; result text is `possibly duplicates ⟨name⟩`.
- **Presentation keeper timings**: user input within 1.0 s of a drop = the human's exit; a drop and an ad-break/`ended` signal within 1.5 s (either order) = site-initiated. A drop correlated with ad-break *start* is held and restored at the break's *end* (never during the ad). Any user input while a restore is held cancels it (doubt → nothing). `onEnd: restart-fullscreen` restores under its own instruction even when `keepPresentation` is off.
- **Migration** writes only `scene-model:apps | facets | layouts | scenes | active-scene | migration`; canvas = the host's given size, else inferred from `host.boot`, else 1920×1080 (flagged). A tile whose profile differs from its app's is a second App (`<app>-<profile>`, reported) — v1 is one profile per App. Solo dashboards become one full-canvas Layout and one Scene per app. `tile:lasturl:*` is reported, not migrated (B-2). Running the migration twice is refused unless forced. **Host wiring (Prism for Windows, SM-6):** once, after core init, when the store has a `dashboard` and no `scene-model:migration` key, the host calls `PrismRuntime.modelMigrate(<store snapshot>, false)`, writes the report to `%LOCALAPPDATA%Prismdiagnosticsmigration-report.md` and one `migration:` line to host.log, and checks that the store before/after differs only by added `scene-model:*` keys (`StoreDiff`, pinned in PrismHost.Tests); the wall keeps running its `dashboard` document - the migrated entities appear in the rail.
- **App identity** keeps the old registry key (adapter id, else host slug) so profiles line up with `%LOCALAPPDATA%\Prism\profiles\<profileId>` unchanged.
