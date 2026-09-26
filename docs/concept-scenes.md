# Prism — Concept Scenes v0.1

*Four household concepts become shipped **Scene Templates**, plus the data and
mechanics they need to be real: attributed imagery packs, living previews,
audio-follows-tap, first-party micro-facets, and a demo household.*

Reading order: `docs/scene-model-spec.md` (all) → `docs/dashboard-schema.md`
§24 / §25 / §26 / §27 / §31 / §32 → this file. Vocabulary is canonical
(CLAUDE.md): App · Slot · Layout · Facet · Scene · Canvas class ·
Visualization · **Frame = the physical device only.**

**Provenance note.** This document was reconstructed on 2026-09-02 from the
concept-scenes work order plus the specs and the shipped
`SceneTemplate`/`TemplateRole` schema (`packages/core/src/scene-model.ts`).
Where it decides something the specs left open it says so in a *Decision:*
line, so a later correction has one place to land.

---

## 1. What a concept scene is

A **Scene Template** is a blueprint: slot **roles** (purpose + class), never
concrete apps, with a rect per role and the per-assignment settings that make
the concept behave right the moment it is instantiated. The wizard resolves
role → facet (an existing facet, or a new one cut from a tuned preset), and a
template is never instantiable while a role is unresolved
(`templateCompletion`). Shipping a concept therefore means shipping *data*,
not a screen.

Rules the four concepts hold to:

- **One audio owner.** At most one role is `audio: "exclusive"`
  (`templateAudioOwner` returns it); every other role is `mute` unless §2.4
  argues otherwise in writing. Two exclusive roles is a template bug.
- **Classes come from the blueprint.** A role's `class` must equal
  `classifyRect(rect, canvas)` on the template's own `canvasAspect` at
  1080-class; `instantiateTemplate` emits a note when a real canvas derives
  something else, and that note is the wizard's honest warning, not a failure.
- **Tuned presets by NAME.** `tunedPreset` names a catalog `focusPresets` id
  (`agenda`, `current-conditions`, `headline-river`, `live`, `player`, …) —
  never a selector. Selectors live in `prism-adapters` (§5).
- **First-party roles pre-resolve.** *Decision:* a role whose `suggestions`
  are a single first-party app (`prism-chores`, `prism-timer`) is pre-filled
  by the wizard — no sign-in, no pick, still changeable. This is what keeps
  six-role Family Hub down to four real decisions.
- **Kitchen Classic stays.** SM-5's golden path names it; `kitchen-classic`
  remains the minimal starter and Kitchen Command is the fuller kitchen that
  leads the wizard list.

### Settings a role may set (`AssignmentSettings`)

Existing: `keepPresentation`, `onEnd`, `audio`, `touch`. The concepts need
three more, specified in §4 and §5 below and added by CS-1:

```ts
preview?:      { mode: "peek"; interval: number; playhead: "advance" | "hold" }  // §25
tapAction?:    "promote" | "audio" | "both"                                      // §5 here
intermission?: { source: string }   // "pack:gallery" | "pack:cosmos" | photos ref (§26)
```

---

## 2. The four concepts

### 2.1 Kitchen Command — `kitchen-command`, 16:9

> The wall by the fridge: something playing, the day's shape beside it, and
> the list everyone actually argues about.

| role | label | class | kind | suggestions | tunedPreset | audio | touch | settings |
|---|---|---|---|---|---|---|---|---|
| `hero` | Video hero | `16:9·XL` | video-hero | netflix, hulu, youtube, twitch | — | exclusive | full | `keepPresentation: true`, `tapAction: "promote"`, `intermission: pack:cosmos` |
| `weather` | Weather | `4:3·M` | utility | weather | `current-conditions` | mute | scroll | — |
| `agenda` | Calendar | `4:3·M` | utility | prism-agenda | `agenda` | mute | scroll | pre-resolved |
| `chores` | Chores & notes | `4:3·M` | utility | prism-chores | — | mute | full | pre-resolved |
| `ticker` | News ticker | `8:1-ticker·M` | news | — | `headline-river` | mute | scroll | — |

Blueprint (canvas fractions): `hero {0, 0, 0.75, 0.8}` ·
`ticker {0, 0.8, 0.75, 0.2}` · `weather {0.75, 0, 0.25, 0.34}` ·
`agenda {0.75, 0.34, 0.25, 0.33}` · `chores {0.75, 0.67, 0.25, 0.33}`.

Blurb (ships in the wizard, verbatim): *"A video hero with the weather, the
week, the family list and a news ticker around it. Personal calendars connect
today — **work calendars: coming to Merge**."*

*Decision (2026-09-05) — the Calendar role suggests `prism-agenda` alone, so the
wizard pre-resolves it exactly like Chores & notes.* Found in the audit: the role
suggested `merge` (in no catalog — a permanently disabled chip) and
`google-calendar` (a Google sign-in inside a WebView2, which Google routinely
refuses), and never offered the first-party Agenda micro-facet CS-10.5 built —
the one the Parkers' week already lives in. A household that wants Google
Calendar still gets it: *Choose a different app → Any app… → From the catalog*.
Same ruling for Family Hub's `agenda` and Kitchen Classic's `calendar`. The blurb
above is unchanged — it ships verbatim and the maintainer owns its words.

**Known gap (do not block on it):** ICS subscription (work calendars) is a
Merge roadmap item, not Prism. The blurb names it; the template ships without
it.

### 2.2 Sports Multiview — `sports-multiview`, 16:9

> A main game with two beside it, one set of speakers, and the two you aren't
> listening to keep moving.

| role | label | class | kind | suggestions | audio | touch | settings |
|---|---|---|---|---|---|---|---|
| `game1` | Main game | `4:3·XL` | video-hero | youtube, twitch, hulu | exclusive | full | `keepPresentation: true`, `tapAction: "audio"`, `preview: peek/30s/advance` |
| `game2`–`game3` | Game 2–3 | `3:2·M` | video-hero | youtube, twitch, hulu | mute | full | `tapAction: "audio"`, `preview: peek/30s/advance` |
| `scores` | Scores ticker | `8:1-ticker·M` | news | — | mute | scroll | `tunedPreset: headline-river` |

Blueprint: `game1 {0, 0, 0.665, 0.84}` · `game2 {0.665, 0, 0.335, 0.42}` ·
`game3 {0.665, 0.42, 0.335, 0.42}` · `scores {0, 0.84, 1, 0.16}`.

This is the concept that needs both pull-forwards: **peek** keeps the two
silent games advancing (§4), and **audio-follows-tap** moves the sound to the
game you touched without promoting it out of the grid (§5). Peek is set on
all three roles deliberately — the scheduler never peeks a playing slot, so
the setting is self-managing as the audio moves around.

*Decision (CS-10.2, 2026-09-03):* the template shipped as a **2×2 of four
equal games** and is now **hero-plus-two** (Appendix A.1 and mock 3, which
were always hero-plus-secondaries). The reason is not composition but
capacity: four concurrent playing games exceeded **§18's concurrent-playing
budget on every build but the mini PC**, so the fourth game was a slot most
households could not actually drive. A household whose build can drive a
fourth adds the slot itself in the layout editor — the template no longer
promises it. The blurb says so.

*Decision (CS-10.2, 2026-09-03) — why these classes are not `16:9`:* §1
requires a role's class to equal `classifyRect(rect, canvas)`, and on a 16:9
canvas a **16:9 slot needs equal w/h fractions** (the inverse of the CS-7
trap in §2.5.1). So a true-16:9 hero-plus-two-stacked tiling closes only at
hero `{0,0,⅔,⅔}` with `⅓×⅓` secondaries — which leaves **a third of the wall
for the ticker**, and a 33 %-height scores strip is not a scores strip. This
blueprint stretches the games to fill 84 % of the height and keeps a 16 %
ticker, and takes the classes that geometry derives: `game1` is
**`4:3·XL`** (ratio 1.4074, 55.9 % of the canvas) and `game2`/`game3` are
**`3:2·M`** (ratio 1.4180, 14.1 %) — the two game sizes straddle the 4:3/3:2
boundary at √2 ≈ 1.4142 despite looking alike, which is why they bucket
differently. **The rects are the design; the classes are derived truth.**
Consequence to know: `facetFitsSlot` requires an *exact* aspect-bucket match
(only the tier tolerates one step), so a facet already cut `16:9·XL` for
another template is **not** offered in these slots. Nothing in the catalog is
pinned to 16:9 for these Apps — youtube/twitch/hulu declare no `facetPresets`
at all — and the wizard cuts a new facet at the role's own class
(`presetFacet(..., slotClass)`), which fits exactly, so the wizard is never
empty here.

Blurb: *"A main game with two beside it. Tap one to move the sound to it; the
others keep advancing as though you were watching. Add a fourth in the layout
editor if your build can drive it."*

*Decision (CS-10.2, 2026-09-03) — the §14 chips say what §14 can do.* The
chips render **who is listening privately and the slot they are hearing**, and
**every listener names the same slot**: §14 streams the *frame's own* audio —
one capture of system output (WASAPI loopback on Windows, the PipeWire monitor
on Pi) — so a private listener hears whatever owns audio under §3. Mock 3 had
shown two people on two different games (`Alex ▸ Game 1`, `Sam ▸ Game 2`), which
§14 as specified cannot do: that needs per-surface capture — the B-25
process-loopback upgrade — plus a source field on `ListenerInfo`, a §14
amendment and a way for the remote to choose a slot. The maintainer chose to
**draw what §14 supports rather than imply a capability it has not got**, and
the mockup was redrawn (both chips on the audio owner, one shown paused).

The label is the **paired device's** name (`PairedDevice.name`, the same
human-readable string the pairing flow derives — never a User-Agent, never an
account); a listener whose token we no longer hold a device for still gets a
chip, reading "a phone", because somebody *is* hearing the wall and hiding that
would be the dishonest half. A paused listener keeps its chip: the speakers are
being held muted on its behalf, which is exactly when the room needs to know.
**The pairing token never reaches a chip** — it is the chip's identity in code
and nothing rendered, logged or sent carries it (§22).

### 2.3 Movie Night — `movie-night`, 16:9

> One thing, edge to edge, and paintings during the ad breaks.

| role | label | class | kind | suggestions | audio | touch | settings |
|---|---|---|---|---|---|---|---|
| `screen` | The movie | `16:9·XL` | video-hero | netflix, hulu, primevideo, peacock, paramountplus | exclusive | full | `keepPresentation: true`, `onEnd: "none"`, `tapAction: "promote"`, `intermission: pack:gallery` |

Blueprint: `screen {0, 0, 1, 1}`.

*Decision:* one role. A template cannot carry floating or hidden extras
(those are scene-level, scene-model spec §5), so Movie Night ships as the
full-canvas hero with the settings that make a movie behave — presentation
kept across ad boundaries, nothing restarting at the end, the Gallery pack on
the veil. Anything else a household wants (a clock in the corner, a music
facet hidden for the credits) is added in the scene builder afterwards.

*Decision (2026-09-19):* Movie Night is the household's **Video player** and Music Lounge its
**Music player**; the Prism menu switches between them. When the wall goes to the Video player,
the lounge's hidden music sources are carried into the Movie Night scene's `hidden` list (same
facets, same audio policies) so the switch keeps them warm: the music plays on until a video
takes the sound, and the way back resumes it. The template itself stays one role; the carried
sources are scene-level, written by the switch and kept in step with the lounge on every switch.

*Decision (2026-09-19, VP-3):* the Video player is **one player for every video service**, like
the lounge is for music: its screen slot holds whichever service is up, *Watch on* re-assigns the
slot to another service's facet, and a Continue Watching pick from any service switches the
screen to it and plays. Each service keeps its own library and resume point, so its shelf lists
while another service is up. Profile gates ("Who's watching?") are read by the adapter and
answered from the wall; "always watch as" is a standing instruction of the household.

*Decision (2026-09-22):* **Watch is the Video player's home**, as the lounge's own face is the
Music player's. The wall arriving at the Video player (a switch, the boot) opens the Watch page;
a pick closes it and the service's player comes up on top; when that title closes (the service's
player left, or the title ended onto its browse page) the wall goes back to Watch. The service's
own page is reached only when chosen from Watch, and is left alone while nothing plays on it.
Watch has no close corner over nothing: it closes only onto a title that is up ("Back to <title>",
Esc, Back, or the corner), and a service's browse page playing its own billboard trailer is not a
title.

Blurb: *"One screen, edge to edge. Ad breaks become paintings; the player's
fullscreen is put back the way you left it."*

### 2.4 Family Hub — `family-hub`, 9:16 portrait

> The hallway panel: faces, the day, the list, and a timer that isn't a phone.

| role | label | class | kind | suggestions | tunedPreset | audio | touch |
|---|---|---|---|---|---|---|---|
| `photos` | Photos | `4:3·XL` | any | — (any app) | — | mute | none |
| `agenda` | Calendar | `1:1·M` | utility | prism-agenda | `agenda` | mute | scroll |
| `chores` | Chores & notes | `1:1·M` | utility | prism-chores | — | mute | full |
| `timer` | Timer | `16:9·M` | utility | prism-timer | — | mix | full |
| `weather` | Weather | `16:9·M` | utility | weather | `current-conditions` | mute | scroll |
| `ticker` | News ticker | `8:1-ticker·M` | news | — | `headline-river` | mute | scroll |

Blueprint: `photos {0, 0, 1, 0.40}` · `agenda {0, 0.40, 0.5, 0.32}` ·
`chores {0.5, 0.40, 0.5, 0.32}` · `timer {0, 0.72, 0.5, 0.16}` ·
`weather {0.5, 0.72, 0.5, 0.16}` · `ticker {0, 0.88, 1, 0.12}`.

*Decision:* `timer` is the one role with `audio: "mix"` — a countdown chime
that cannot be heard is not a timer. It is still not the exclusive owner:
Family Hub has **no** exclusive role, so `templateAudioOwner` returns null,
and that is legal for a template with no video hero. CS-1 states this in a
test rather than treating null as a bug.

Photos has no first-party app yet (Prism Photos is phase two): the role takes
any app, and the demo household fills it with a placeholder hero.

Blurb: *"A portrait panel for the hallway: photos, the week, the family list,
a timer and the weather."*

### 2.5 Music Lounge — `music-lounge`, 16:9 (work order of 2026-09-02, additive)

> The whole wall is the music: a white beam enters a prism and leaves as the
> brand's four bands, bending with what is playing.

**Provenance note.** The order references `prototypes/prism-website-mockups.jsx`
mock 4, which is not in the repo, any branch, or the maintainer's folders; the
order's own composition list (§2.5.2) is therefore the reference, written here
so the renderer and the fixtures answer to one text.

#### 2.5.1 Template

| role | placement | class | kind | suggestions | audio | touch | settings |
|---|---|---|---|---|---|---|---|
| `stage` | slot `{0, 0, 1, 1}` | `16:9·XL` | visualization | — (style `prism-beams`, artwork `backdrop`) | mute | full | `tapAction: "promote"` (= reveal, §6a for music) |
| `source` | **hidden** | — | music | spotify, apple-music, pandora, any app | exclusive | — | — |

Variant slot-set **"Lounge + clock"** (`music-lounge-clock`): `stage
{0, 0, 1, 1}` plus `clock {0.83, 0.04, 0.14, 0.25}` → `1:1·S`, kind utility,
suggestions `prism-timer` (its clock preset) — the timer micro-facet already
knows how to be a clock face. Both variants share the hidden `source` role.

*Decision (CS-7, 2026-09-02):* the clock rect above was written `0.14, 0.14`.
A slot's class comes from its **pixel** aspect on the canvas (spec §9), so
equal canvas fractions on 16:9 are a 16:9 box, not a square: `0.14 × 0.14`
classes `16:9·S`. The class is the normative half — a clock face is square and
the facet is cut for `1:1` — so the height follows it (`0.14 × 0.25` of a 16:9
canvas is 1:1), and §1's rule that a role's class equals
`classifyRect(rect, canvas)` holds for this template like every other.

*Note (CS-7):* `prism-adapters/catalog/prism-timer.json` had no clock preset;
CS-7 added `clock` to its `focusPresets` and a `1:1` `facetPresets` entry
(selector `timer-remaining`, the numeral stage, cut square). The preset is
catalog data and complete; the clock **face** — those numerals showing the
time of day rather than a countdown — is still the timer page's to grow
(CS-3 owns `Assets/tiles/timer`), and until it does the role resolves to the
countdown.

*Decision (schema):* templates gain **hidden roles** and **visualization
roles** — see §7a. The `stage` role resolves to a Visualization sourced to
the facet the `source` role resolves to; `instantiateTemplate` writes
`scene.visualizations[0] = { id, source: <hidden facet>, style, artwork }`,
`scene.assign.stage = <visualization id>`, and `scene.hidden = [{ facet,
audio: "exclusive" }]`.

**Wizard flow:** pick the service (suggestions or any app) → App setup mode,
sign in (§2 of the scene-model spec; a HAND-OFF service per the Widevine POC
runs setup in the launched Edge window) → the hidden facet and the
visualization are created **together**, the visualization sourced to the
facet, no second decision. The `stage` role shows as resolved the moment
`source` is. `templateAudioOwner` returns `source` — the one exclusive role
is hidden, which is new and legal.

Blurb: *"The whole wall is the music. Sign in to your service; the beams do
the rest. Tap to bring up the player; tap again to send it back."*

#### 2.5.2 Composition (Prism Beams, normative for the renderer)

*Amended 2026-09-03 by the mock-4 audit (§2.5.4): points 1, 3, 5 and the new
point 8 carry the adopted proposals P1, P4, P5b, P3. The palette is
unchanged — P2 rejected.*

1. **Beams.** A white input beam from the left edge into a prism **centred at
   (0.32, 0.44) of the canvas**; four brand-band beams (`PRISM_BANDS`:
   amber `#F0A83C`, teal `#5CC8C0`, violet `#C86CF0`, rose `#F05C7A`) leave
   to the right, each bent by its band's energy and glowing with it. This is
   the existing `DrawBeams` program, held to the composition below. The four
   bands are the brand's and are not a per-style choice.
2. **Backdrop.** Album art, when the source declares it, blurred and dimmed
   behind the beams with the pack palette tinted toward the art's dominant
   colours (`tintPalette` / `dominantColors`); `artwork: "off"` leaves the
   dark substrate; `"focal"` is unchanged from SM-3.
3. **Metadata block, bottom-left, two lines** (P4):
   - line 1 — **title**, the display face at semibold, `LeInk`, at WALL size
     (34px on a 1080-class canvas): a 13px title was unreadable across a room,
     and a block nobody can read is a block that is not doing its job;
   - line 2 — **`artist · state`**, artist in dim sans, the state in dim
     **monospace**: `hidden facet · ♪ exclusive` while the source owns audio,
     `hidden facet · muted` otherwise.
   Both lines are empty when nothing is playing. A missing artist collapses
   line 2 to the state alone; a missing title leaves line 1 empty rather than
   promoting the artist.
4. **Transport, bottom-right:** prev · play/pause · next — §32 pass-through
   only, each button disabled (never hidden) when the page did not register
   the action.
5. **Style/mode label, top-right:** `PRISM BEAMS · backdrop: album art`
   (style name uppercase, mode spelled out; `backdrop: none` when the source
   declared no art, `focal` / `off` as configured), faint monospace.
   **Visibility (P5b):** it appears for **4 s** after a scene applies and on
   every style or artwork-mode change, then fades out; in edit mode (scene
   builder / rail / layout or facet editor open) it stays pinned. A viewer
   thus learns what they are looking at without the label living on the wall
   for good — and the marketing shot can be taken in the first four seconds.
6. **Idle.** No source, or source not playing: the beams settle into a slow
   ambient drift (the style's `reducedMotion` speed, no beat), the metadata
   block is empty, the backdrop is the substrate. **Never a black screen.**
7. Reduced motion (system setting) applies to everything above.
8. **Spectrum floor** (P3). A low field of band-coloured bars across the
   bottom sixth of the canvas, rising with the audio: **42 bars** spanning
   the middle ~79 % of the width (the mockup's `x 90 → 720` of 800), rounded
   caps, coloured `PRISM_BANDS[i % 4]`, **50 % opacity** so the beams stay
   the subject, heights driven by the same smoothed bands as the beams
   (bar `i` reads band `i · bands / 42`). Idle: the field settles to its
   floor and drifts with the ambient signal — it never flattens to nothing.
   Reduced motion: static at the floor.

*Decision (maintainer, 2026-09-04) — the prism moves to x = 0.32.* P1 adopted
0.50 from mock 4, a static drawing. On a real wall the next day it composed
badly: the white input beam crossed **half the canvas** as one thin line while
all four dispersed bands were crammed into the other half, and a beam using its
full travel ran off the right edge almost immediately. The prism now sits at
**0.32** — a short bright entry, and two thirds of the wall for the dispersion
to open across. The height (0.44) is unchanged, and so is everything else P1
settled. Recorded because P1 was an adopted decision and this reverses half of
it: mock 4 was right about the shape and could not have been right about the
position, having never been seen at wall width.

*Decision (CS-10.1, 2026-09-03) — the numbers point 8 and point 5 left open.*
The adopted text fixes the bar count, span, palette and opacity but not the
bar heights or the label's trigger, so these are now normative:

- **Spectrum floor geometry.** A bar's height is
  `(0.09 + 0.91 × level) × (canvas height ÷ 6) × 0.8` — a floor at 9 % of its
  band and a ceiling at 80 % of the bottom sixth, which reproduces the
  mockup's 14 → 60 px of 450 and keeps the field inside the sixth. Bar width
  is 62 % of its slot, so the caps read as bars and not a solid band. The corner
  radius is half the SHORTER side: a half-width radius turned a short bar into a
  circle, and 42 of those read as a row of dots across the bottom of the room
  rather than a floor under the beams (seen on the wall 2026-09-03, which is also
  why the idle floor came down from 0.22 to 0.09). Bar OPACITY tracks its band
  and reaches P3's adopted 0.5 only when that band is loud: held flat at 0.5 the
  floor did not "settle" at all, and a silent wall carried 42 coloured marks
  along the bottom. The
  floor is why an idle wall still shows a surface: `SpectrumBarHeight` can
  never return 0 (point 8, and point 6's "never a black screen").
- **What starts the label's 4 s.** A scene applying (fresh chrome) and any
  change of style **or** artwork mode. Nothing else — a track change does not
  re-show it, or a lounge would blink its own name all evening.
- **`backdrop: album art` vs `backdrop: none`** is decided by whether the
  SOURCE declared art (core's transport row `Artwork`), never by whether the
  renderer happens to have finished loading it.
- **The faces** are Segoe UI (display/sans) + Consolas (mono) until B-96
  bundles Space Grotesk and IBM Plex Mono, so line 1 is semibold Segoe rather
  than semibold Grotesk and no shot matches pixel-for-pixel yet.

*Decision (2026-09-03) — four additions to the composition, from testing it on a
wall.* §2.5.2 is normative about what is drawn, so these are recorded rather than
slipped in. All four hold the existing rules: `PRISM_BANDS` unchanged (P2 still
rejected), reduced motion honoured, and idle still a drift and never a black
screen.

- **Motes.** Six per band ride each beam outward, speed and brightness following
  that band's energy, so a loud band visibly throws light. Reduced motion parks
  them where they are.
- **A floor wash.** A soft gradient beneath the spectrum bars that swells with
  overall loudness. The bars themselves keep P3's exact 50 % opacity — the wash
  is a **separate element**, so the adopted number is not quietly inflated.
- **A backdrop vignette.** A radial gradient under everything, breathing with the
  low band, so an idle wall has depth instead of flat substrate.
- **Elapsed / remaining.** `2:25 / 4:12` in monospace beside the transport, and a
  3 px progress bar along the bottom edge. A live stream reports no duration:
  the elapsed time still shows and the bar stays **hidden** rather than faking a
  position in a track with no end.

The transport also stops hiding. It rested at 0.4 opacity and dimmed back to 0.4
after three seconds; on a wall across the room that is a control you cannot see,
so it now rests at 0.85 and settles back there. §2.5.2 point 4's rule is
unchanged — disabled, never hidden — this is about the resting state of the row
itself.

*Decision (2026-09-05) — `spill`, per visualization, off by default.* A
visualization is drawn **inside its tile**: the host clips it, so beams never
paint over a neighbouring slot on a shared wall. The maintainer saw the beams
reaching past the stage and liked it, so it is a choice, not a bug: the scene
builder's *Style…* sheet has **Spill past the tile**, stored as
`visualization.spill: true` (absent when off, so existing scenes are
unchanged). Spilling never crosses the wall's edge, and §2.5.2's composition is
otherwise untouched.

*Decision (2026-09-06) — the pack is the household's to change from the wall.*
The transport row carries a **Next visual** control that cycles the four packs
in their shipped order and writes the choice into the scene's visualization,
so it sticks. The builder's *Style…* sheet remains the place to pick one by
name; this is the across-the-room version of the same choice.

*Decision (2026-09-06) — twenty packs, two new families.* The four originals
(Prism Beams, Spectrum, Ribbon, Bloom) are joined by sixteen **tableaus**: composed
scenes whose lights and movement answer the music, never a bar chart. Eight are
**environment** (Aurora Ridge, Moonlit Ocean, Firefly Forest, Rain on the Window,
Snowfall Village, Desert Stars, Storm Front, Sunrise Meadow) and eight are
**community** (Campfire Circle, City Skyline, Lantern Festival, Fireworks Night,
Harbor Lights, Night Train, Street Fair, Stadium Wave). Each is data
(`packages/core/data/visualization-styles/<id>.json`, `program` = the tableau) over
one drawing class in the host (`Tableaus.cs`): every shape built once, every frame
only moved and re-lit, nothing allocated while drawing. The §2.5.2 composition
rules stay Prism Beams' own; a tableau honours reduced motion (drift, no beat) and
point 6 (idle is a slow scene, never a black screen). *Next visual* cycles all
twenty in this order.

*Decision (2026-09-06) — Play resumes.* On a wall where nothing is queued, the
transport's Play goes back to the page the source last **played from** (the
album, playlist or station) and presses that page's own Play control - the one
the adapter names. Prism remembers only what it has seen play, so the first
play of a household still happens on the revealed page; every play after that
is one tap from the wall. This is also the mechanism a future `onActivate:
play` ruling would use, which is why that field stayed unused: a Media Session
handler cannot start what was never queued.

*Decision (2026-09-06) — the cover is shown, and the block stays up.* Point 3's
metadata block gains a third line, the **album**, and no longer empties on pause:
a loaded track stays on the wall with its state word reading *paused*; only
nothing-loaded is an empty block. And because `backdrop` blurs the cover on
purpose, a clear copy of it sits in the **top-right corner** as an artwork card
(a fifth of the tile high, framed), whenever the source declares one. The
style/mode label moves beneath that card.

*Decision (2026-09-06) — a stage's sheet is about music, not facets.* The §6a
context sheet on a music visualization no longer offers *Edit facet* or *Swap
facet in this slot*: the hidden page is never looked at as a facet, and the
reveal already lets a person browse the service. It offers **Choose / Change the
music service…**, **Next visual**, **Visual style…** (the pack, artwork mode and
spill, straight into the builder's sheet), **Open the player (sign in)…**, **App
settings / sign in** and **Mute**. The corner bar during a reveal drops *Edit this
facet* for the same reason. Re-cutting the hidden page stays available under
Facets in the rail. The §6a reach fixture's "editor" for a music item is now the
visual, not the facet.

*Decision (2026-09-06) — the service's name, and quick play.* The metadata block
gains a small spaced line above the title naming the **service** (the App the
hidden facet belongs to). And the transport row gains **Quick play**: the last
**five** collection pages - albums, playlists, stations - this source played
from, one tap each, kept by core from what it saw play (`music:recent`). A pick
goes to that page and presses its own Play; only a page Prism saw play can be
chosen, never an arbitrary address. Labels are the album's name or the page's
slug - what the address says, never a guess.

*Decision (2026-09-06) — the page names the collection; the library on the wall.*
Media Session names the track, never the playlist or station it came from, so a
music adapter may carry three page-side scripts of its own (its `js` stays
null: transport is data): **musicContext** (what collection is playing now -
its name goes on the block's Collection line and into quick play),
**musicLibrary** (the service's playlists and stations, as the page lists them)
and **musicPlay** (queue one by id through the service's own player). Quick
play grows **Playlists** and **Stations** submenus; a pick plays without the
page ever being shown. Only an id the page itself listed can be played - the
remote and the menu can never make a player queue an arbitrary thing.

*Decision (2026-09-07) — one lounge, several services.* A Music Lounge may hold
more than one hidden music source - Apple Music and Spotify and Pandora, each in
its own profile with its own sign-in. **Add a music service…** (the stage's sheet,
and the foot of Quick play) appends a second source; the stage keeps drawing the
current one. Quick play then groups by service: each service is its own submenu
named for it (the one on the stage marked, a signed-out one marked), with its
last five, its playlists and its stations inside. **The visual follows the
music:** a pick on another service plays there and every stage in the scene
moves to that source - in the scene's own record, so the next boot agrees. §3
exclusivity stands: the picked service is audible, the others play silently.
Apple Music plays by id through its player; Spotify and Pandora, with no in-page
player API, list from their own library pages and play by address (the page's
Play, the loading signal in between). The stage follows whichever source is
**audible** (§3's owner), not only a Quick play pick: a play started in the
service's own page - setup, the revealed player - moves the visual and its
transport there; and what a person started in setup carries on when setup
closes (B-129).

*Decision (2026-09-16) — the song playing now, on another service.* "If I hear
something on Spotify and am managing a playlist on Apple, I can add the song (if
available on the Apple service) to my Apple service." Opening a service's Quick
play entry asks THAT service's page for the song the wall is playing now - the
adapter's `musicLookup` script, the service's own catalog API in the person's
own session (Apple Music: MusicKit); nothing leaves the machine but the
service's own requests (§19). Core decides the match, strictly: title AND artist
must agree after normalization (`music-lookup.ts`, tested); several title-only
or artist-only hits are offered as **Which one is it?**, never guessed among - a
wrong "found" puts the wrong track in somebody's playlist. *Amended 2026-09-17
(B-223):* a LONE partial hit is the answer, said with its confidence and no
chooser ("I still don't want them to have to go to the child menu ... just let
the user know the confidence probability"): the head reads *<service> has
<title> · <artist>* with an amber *35%* badge beside it whose tooltip is the
reasons (*35% likely the same song - title matches · artist differs · length
differs*; a press of the row says the same in the pill). Every percent comes from
the rule table in `matchConfidence` (title+artist+album 98, title+artist 90,
title only 55, artist only 25; the playing face's length within 3 s +10, 15 s
or more apart -20), so the number is traceable, not a feel. 90 and up reads as
plain *Found*. The submenu's head reads *Looking
for <song> on <service>…* then *Found on <service>: <title> · <artist>* or *<song>
is not on <service>*; under it two verbs, grey with the reason until they can
act: **Add to a playlist** (the account's own playlists - one the service owns,
Apple's curated ones saved to the library, stays grey and says so) and **Create
station from this song** (a human's pick: it takes the audio and the stage
follows). The answer travels back as a `music-result` event carrying the token
core asked with; only ids the page itself returned or listed are ever sent back
to it. Apple Music first (search, add, station all through MusicKit). *Amended
2026-09-16 (B-218):* the other services have no in-page SDK, so each takes the
page's own route, verified live. **Pandora**: the header search, the song rows,
the row's "Start Station from Song". **Spotify**: the search box, the Songs tab's
rows, the row's More options menu - "Add to playlist" (the playlists the account
owns, found by name; Liked Songs by "Save to your Liked Songs") and "Go to song
radio" (the radio page's own Play). **Amazon Music** (2026-09-17, on the
person's ask - the Unavailable of 09-16 was decided when an API was the only
alternative): the navbar search box, the Songs shelf's rows, the row's own
menu - "Add to Playlist" by the playlist's name in the picker (the account's
lists from /my/playlists and from the picker itself); the station from a song
is the song's own page, which on the free tier is the song MIX ("Loneliness
Mix", "Shuffled With") - the row's title link opens it and starts it, the
page's Shuffle is the fallback press.

*Decision (2026-09-17) - play orders.* "I need some special playlist controls:
normal, shuffle, and reverse order" and "true shuffle would be nice - a lot of
services use an algorithmic shuffle". A playlist opens the normal way (one press
in Quick play); the order is chosen on the transport's **order button** for
whatever is playing ("I hate burying those in the menus"): **In order**,
**Shuffle** (the service's *algorithmic* shuffle - kept, some people want it,
and named for what it is: it comes from the music service, and music services
shuffle with non-transparent algorithms that often weigh listening habits,
track popularity, recent play history and skip rates to curate the queue),
**True shuffle** (Prism's: every track once, in a uniformly random
order, before any repeat; a fresh draw each pass - the rule is published,
nothing is weighted; algorithmic transparency is the point) and **In reverse**. The last two are Prism's
order handed to the player's own queue (spec §32 layer 5); a verb a service
cannot do reads grey with the reason; the standing one is marked. *The spot is
saved:* the player names the track it is on, and a Prism-ordered play keeps its
place ("are we able to save our spot in that playlist?") - the block reads
"Vibes · true shuffle · 412 of 1612", the plain press on that playlist, a Play
with nothing loaded and a switch to the service all carry on from there, and the
order menu offers **Continue**; any order named outright starts afresh ("if the
users hit shuffle or another command again it starts over"). The order and the
spot survive a restart. *And the spot does not move behind your back:* a music
source that loses the audio to another service is paused, not left streaming in
silence ("We shouldn't mute and continue streaming services that aren't
actively playing. They should be paused." - spec §3, amended 2026-09-17), so
every road back lands on the track you left. *Spotify (2026-09-18)* takes the same orders through its page: its own
shuffle and repeat buttons, and for Prism's orders the playlist page's rows read
once and a one-ahead queue (the next track added to Spotify's queue as each one
starts). *Repeat (2026-09-18)* is a switch beside the order, not an order - "one that can
be enabled in addition to the selected order": the service's own repeat-all
under its orders, Prism's next pass under its own (a fresh draw for true shuffle,
the same way round for reverse); the block counts the pass. *And a stalled player is caught
(2026-09-18):* a player that says playing while its clock stands still for ten
seconds - Apple's media source looping on its last fragment after an overnight
pause - is re-queued from the saved spot by the wall itself; a second stall on
the same track skips it, a third stands and the state says so. Apple Music first, verified live on Vibes (1891 entries,
1612 tracks after the catalog check - Apple's own player would refuse the rest
too). *No size cap (2026-09-18):* the whole list is read and ordered; the player
holds a window of four hundred at a time and the next is appended before the
current one runs out. Stations have no order.
*Decision (2026-09-17):* Spotify's Web API was built and withdrawn the next day:
a registered app serves 25 accounts in total until Spotify's review, which it
grants only to organizations, and a per-household registration is a step no
user should be asked to take. No route through a service's API for now; the
page's own controls, or nothing. *English only, for now:* the page-driven
lookups (Spotify, Pandora) find the page's controls by their English labels; a
player set to another language answers "English only for now" in the menu.

*Decision (2026-09-07) — a soundscape instead of silence during ads.* §26's
"ambient audio (opt-in)" is real: when a music service runs its ads the wall
mutes them and, if a person chose one under **Intermission…** on the stage's
sheet, plays a soundscape from a hidden surface beside the source. *Amended
2026-09-08:* the soundscapes are twelve field recordings, every one CC0
(Creative Commons Zero) from Freesound and chosen by the maintainer - The
Bayou, Midwest Forest, Wind & Shutter, Heavy Storm, River, Beach Coast Cave,
City Park Meadow, Wind Chimes at Night, Bustling City, Bees Swarming, Pinball
Arcade, Star Walk - trimmed to loops and BUNDLED under
`Assets/tiles/soundscape/sounds/`, with `docs/soundscape-credits.md` naming each
recordist and source page (the credits live outside the served folder: the
zero-network check reads every text file in it, and source pages are URLs). The first-party page at `tiles.prism/soundscape` plays them with a
crossfaded seam: nothing fetched at runtime, zero network, the same posture as
every other §6 page. (The first cut synthesized crickets, whales, rain, ocean
and wind with Web Audio; the verdict on the crickets was "they're bad". Scenes
saved with those ids map onto the nearest recording; the store is never
rewritten, §10.) It fades in when the break covers the
source, is muted again when the break ends, and the wall's mute covers it like
any other sound (§3). Off by default; the choice is the lounge's and lives on
every music source's placement settings.

*Decision (PENDING — the maintainer's ruling) — `onActivate: "play"`.* A Music
Lounge today loads its hidden source and sits **silent**: the wall shows the
ambient drift until a human reveals the player and presses play. That is the gap
between what §2.5.1's blurb promises ("Sign in to your service; the beams do the
rest") and what the wall does.

`AssignmentSettings.onActivate: "play"` is implemented and **absent from every
shipped template**, so it changes no wall until a placement sets it. When set, it
runs the page's **own registered Media Session play handler** once the placement
has loaded — the same function the OS media keys call, and the same one §32
transport pass-through already uses. It fires at most once per document, so a
reload or an SPA navigation does not fight a human who just paused.

The open question is whether Prism may invoke it without a tap. §32 says
transport is pass-through **on a human action**. The argument for yes: §4
schedules and §24 alarms already start and stop things with nobody in the room,
and choosing a scene is a human action — the delay between the tap and the effect
does not make it autonomous. The argument for no: a scene that starts playing on
apply is a wall that makes noise when someone merely walks past a schedule.

*Recommendation: adopt, and set it on Music Lounge's hidden `source` role only.*
That template exists to play music; the other four have no music source to start.
Until it is ruled, the field ships unused.

#### 2.5.3 Reveal

Tap anywhere on the visualization, or the mapped remote key → the hidden
facet's native player as a **transient overlay** (§32 layer 4), §16 crossfade
in; tap again / Back / the corner affordance → crossfade out to the
visualization, which was **never stopped** — beams resume mid-animation and
the audio is uninterrupted in both directions (the facet is the same surface
throughout; reveal changes its size and visibility, never its playback).

#### 2.5.4 Mock-4 audit (2026-09-03) — proposed amendments, not adopted

`prototypes/prism-website-mockups.jsx` mock 4 (`Visualizer`) reached the repo
after §2.5.2 was written and CS-8 shipped against it. §2.5.2 stays normative.
Diffed point by point; each row is either a confirmation or a **proposal** for
the maintainer to adopt (then CS-8's renderer and CS-9's fixtures change) or
reject (then the mockup is redrawn to match the wall).

| §2.5.2 | Mock 4 shows | Verdict |
|---|---|---|
| 1 Beams — white input beam, prism, four `PRISM_BANDS` beams bent by energy | White line from the left edge to x≈0.47, prism triangle **centred at (0.50, 0.44)**, four beams from x≈0.52 to the right edge, each fanning with a slow sine and pulsing in width | Geometry agrees. **Position differs:** the renderer places the prism at 0.42w (CS-8). *Proposal P1:* make the position normative — prism centred at (0.50, 0.44). |
| 1 Beams — palette | `T.beams = #E8654F · #F0A83C · #8FBF6B · #5B9BD5` (red-orange, amber, green, blue) | **Palette differs** from `PRISM_BANDS` (`#F0A83C · #5CC8C0 · #C86CF0 · #F05C7A`: amber, teal, violet, rose), which SM-3 shipped as the brand's four bands and every style pack, the Veil and the wizard use. *Proposal P2 (recommend reject):* the mockup adopts `PRISM_BANDS`; the brand palette is not changed by a marketing draft. |
| — | **A spectrum floor**: 42 rounded bars along the bottom (x 90→720 of 800, base y=400, heights 14–60, coloured by band, opacity 0.5), rising with the audio | **Missing from §2.5.2.** *Proposal P3:* add point 8 — a low bar field across the bottom sixth, band-coloured at 50 % opacity, driven by the same smoothed bands; idle: settles to its floor with the ambient drift; reduced motion: static at the floor. |
| 2 Backdrop — art blurred and dimmed, palette tinted | Conic-gradient art layer, `blur(38px) brightness(.55) opacity .8`, over a radial base | Agrees; the blur/dim magnitudes are a reasonable default for CS-8's layer. No change. |
| 3 Metadata line — bottom-left, **monospace**, `title — artist`, then dimmer state | **Two lines**: title in Space Grotesk 600 (13 px), then `The Refractions · hidden facet · ♪ exclusive` — artist in dim sans, the state in mono | **Typography and shape differ.** Charter: one mono line. Mock: a two-line block, only the state in mono. *Proposal P4:* adopt the mock — line 1 title (grotesk semibold, `LeInk`), line 2 `artist · state` (artist dim sans, state dim mono). Note the fixture strings in CS-9 (`Aurora Skies — The Refractions`) would become `Aurora Skies` / `The Refractions · hidden facet · ♪ exclusive`. |
| 4 Transport — bottom-right, prev · play/pause · next, pass-through, disabled-not-hidden | `⏮ ⏸ ⏭` bottom-right, the middle glyph brighter | Agrees. No change. |
| 5 Style label — top-right, `Prism Beams · backdrop`, edit mode only | `PRISM BEAMS · backdrop: album art`, mono, faint, top-right — always visible (a static mock cannot show modes) | Placement agrees. *Proposal P5:* label text becomes `PRISM BEAMS · backdrop: album art` (uppercase style name, mode spelled out); and for the **shot** the label must be visible — take it in edit mode, or (P5b) show the label for 4 s after a scene applies and on every style change, then hide. |
| 6 Idle — ambient drift, empty line, substrate, never black | Not depicted (the mock is the playing state) | §2.5.2 stands. |
| 7 Reduced motion | Not depicted | §2.5.2 stands. |
| — Typefaces | Space Grotesk (headings) + IBM Plex Mono (mono) — the design tokens of the site | The host chrome uses **Consolas** (CS-8). *Proposal P6:* bundle the two token faces locally with the host (zero network, §19/§22) and use them in the visualization chrome and the micro-facets; until then Consolas / Segoe UI are the honest fallbacks and the shot will not match pixel-for-pixel. |

**Verdicts (maintainer, 2026-09-03) — ordered as CS-10.**

- *Decision: **P1 adopted.*** The prism is centred at (0.50, 0.44). §2.5.2
  point 1 amended; `DrawBeams` moves off 0.42w.
- *Decision: **P2 rejected.*** `PRISM_BANDS` stays — amber, teal, violet,
  rose are the brand's four bands, shipped across the style packs, the Veil
  and the wizard, and a marketing draft does not move them. **The mockup is
  wrong and gets redrawn** to the brand bands (`T.beams` in
  `prototypes/prism-website-mockups.jsx`).
- *Decision: **P3 adopted.*** The spectrum floor becomes §2.5.2 point 8 —
  42 bars, band-coloured, 50 % opacity, same smoothed bands, idle drifts at
  the floor.
- *Decision: **P4 adopted.*** The metadata block is two lines (title, then
  `artist · state` with only the state in mono). §2.5.2 point 3 amended;
  `DEMO_TRACK.line` (CS-9) gains the split strings and the fixtures follow.
- *Decision: **P5b adopted*** (in preference to plain P5, and better for
  real use than edit-mode-only): the label shows for ~4 s after a scene
  applies and on every style or artwork-mode change, then hides; edit mode
  pins it. §2.5.2 point 5 amended, label text included.
- *Decision: **P6 accepted, separately and low priority*** (ledger **B-96**):
  Space Grotesk and IBM Plex Mono are OFL — bundle them **locally** with the
  host (zero network, §19/§22) and use them in the visualization chrome and
  the first-party micro-facets. Until then Consolas / Segoe UI are the honest
  fallbacks and no shot matches the mockup pixel-for-pixel.

With P1 + P3 + P4 + P5b the wall reproduces mock 4 from the Parkers seed plus
`DEMO_TRACK` — modulo the typefaces (B-96).

---

## 3. Imagery packs (§26/§27)

Two packs ship: **Gallery** (public-domain paintings from open museum
collections — Bierstadt, Church, Cole, Turner and company) and **Cosmos**
(NASA public-domain imagery). Both are offline, served by the host, fetched
never at render time (§26/§27), and **every image carries its provenance**.

### 3.1 Pack format (normative)

A pack is a directory: `packs/<id>/pack.json` plus its image files.

```json
{
  "schema": "prism.imagery-pack/v0.1",
  "id": "gallery",
  "name": "Gallery",
  "blurb": "Public-domain paintings from open museum collections.",
  "source": { "name": "Art Institute of Chicago — Open Access", "url": "https://api.artic.edu/" },
  "images": [{
    "file": "met-10154.jpg",
    "title": "The Rocky Mountains, Lander's Peak",
    "creator": "Albert Bierstadt",
    "date": "1863",
    "credit": "The Metropolitan Museum of Art, Open Access (CC0 1.0)",
    "license": { "id": "public-domain", "name": "Public domain (CC0 1.0)", "url": "https://creativecommons.org/publicdomain/zero/1.0/" },
    "attribution": "Albert Bierstadt, The Rocky Mountains, Lander's Peak (1863) — The Metropolitan Museum of Art, CC0 1.0",
    "sourceUrl": "https://www.metmuseum.org/art/collection/search/10154",
    "sha256": "…", "w": 3811, "h": 2284
  }]
}
```

Required per image, no exceptions: `file`, `title`, `credit`, `attribution`,
`sourceUrl`, `license.{id,name,url}`, `sha256`. Allowed `license.id`:
`public-domain`, `cc0`, `cc-by`, `cc-by-sa` (the last two only with the
attribution text they require). `creator` and `date` are required for Gallery
(a painting has a painter), optional for Cosmos.

*Decision (hosting):* manifests and `LICENSES.md` are tracked repo data;
image bytes are git-ignored and produced by `node scripts/fetch-pack.mjs <id>`
at maintainer time — the same posture as `prototypes/prism-veil-art`, which
enforces its license rule at fetch time and keeps `pool/manifest.json` as the
provenance record. `bundled.txt` pins the subset copied into the host's
`Assets/packs/<id>` at build.

*Decision (CS-10.4, 2026-09-03) — the example above, and why Gallery had no
Bierstadt.* The worked example previously cited AIC artwork **64818** as
Bierstadt's *The Rocky Mountains, Lander's Peak*. Checked against the live
API, 64818 is **Monet's *Stacks of Wheat (End of Summer)*** — the id and the
painting never went together, and the reconstructed charter carried the pair
forward. The example is now a real record: the Met's object 10154, which *is*
Lander's Peak, and which the pack now ships.

Why CS-2 shipped none, recorded so nobody re-runs the search and concludes the
painter is unavailable: **AIC holds exactly two Albert Bierstadt records**, and
its only public-domain painting with an image (*Mountain Brook*, 146701) is
**portrait** at 1832×2250, so it cannot pass the fetcher's landscape filter
("it hangs on a wall"). **The Met's search endpoint returns zero objects for
Bierstadt** under every combination of `q` / `artistOrCulture` /
`isPublicDomain` — yet a direct lookup of 10154 returns the painting, public
domain, with a primary image, landscape at 3811×2284. `fetch-pack.mjs` now
carries a documented `MET_DIRECT_IDS` fallback for exactly this case; the
ids in it still run through every existing check, so nothing bypasses
`isPublicDomain`, the artist match, the aspect or the size floor.

### 3.2 The card corner (§26)

The intermission card renders, in its corner, the current image's `title` —
with `creator` where present — plus `credit` and the license name, and
`sourceUrl` is reachable from the context sheet. In **minimal mode** (the
corner chip) the line collapses to the credit alone; nothing about the image
is ever hidden entirely. Attribution never reaches the network: it is read
from the local manifest (§19/§22).

### 3.3 The gate

`scripts/verify-imagery-packs.mjs`, wired into `scripts/verify.mjs`, FAILS
when: an image entry is missing a required field; `license.id` is outside the
allowlist; a file present on disk has no manifest entry; or a manifest entry
names a file whose sha256 does not match.

*Decision (amended by CS-2, 2026-09-02):* absent image bytes are **PASS with a
report line**, not NOT-YET. The charter first said NOT-YET, but `--require-all`
— the post-SM-6 gate posture — turns NOT-YET into FAIL, which would fail every
fresh clone, since the bytes are git-ignored by design. NOT-YET is therefore
reserved for a pack directory with neither manifest entries nor bytes, and a
manifest-only clone gates green while every run says which packs are unfetched.

Two additive optional fields the packs use: `requiresCreator` (pack-level —
Gallery sets it, so a painting with no painter FAILS; Cosmos does not, because
a NASA plate has no painter) and `creditLine` (per image — the institution's
own donor credit, kept as provenance, never the displayed line).

---

## 4. Pull-forward: §25 living previews

The engine exists (`packages/core/src/preview.ts`: `PeekScheduler`, the
virtual playhead, `PREVIEW_BUDGETS`) and is wired for the legacy tile
document (`tile.preview`). What is missing is the **scene-model surface**: a
scene assignment cannot ask for a peek today, so Sports Multiview cannot
ship.

CS-1 adds `AssignmentSettings.preview` and carries it through `sceneDocument`
to the tile spec the runtime already understands; CS-4 wires the host side
(peek capture through the surface seam, playhead surviving a promote).
Fixtures per the §25 spec block: peak cost is exactly one extra renderer,
round-robin across peek slots, a playing slot is never peeked, peeks are
muted always, `PEEK_TIMEOUT_MS` abort keeps the last still, `playhead: "hold"`
leaves position alone, promotion resumes from the virtual playhead ("unmuting,
not restarting"), and the interval floors at the device budget.

## 5. Pull-forward: audio-follows-tap (normative)

§6a gives single tap one meaning: promote to the full-page experience. In a
multiview that is the wrong verb — the household wants *the sound*, not a
takeover. So a scene assignment carries:

```
tapAction: "promote" | "audio" | "both"     // default "promote" (§6a unchanged)
```

- **`promote`** — today's behavior: the full-page native experience, Back
  returns to the scene.
- **`audio`** — a single tap makes that slot the exclusive audio owner (§3
  audio focus does the actual switching: the previous owner is muted, the
  tapped slot unmutes). The layout does not change; nothing is promoted.
  Tapping the current owner is a no-op, never a mute.
- **`both`** — the tap moves the audio *and* promotes.

Rules: `tapAction: "audio"` on a slot whose scene has no exclusive owner
grants ownership to the tapped slot. Long-press / right-click still opens the
§6a context sheet in every mode, and the sheet's `Mute` is how a household
reaches silence. The switch rides §3 exclusivity — never a second audio path
— and a peeking slot (§4) is never a tap target for it. Fixtures: a tap moves
ownership exactly once, no double-unmute, Back from a `both` promote leaves
the audio where the tap put it, and the remote (§6) tap message carries the
same meaning.

---

## 6. First-party micro-facets

Two plain local pages served by the host, styled to the design tokens, with
**zero network** — no fonts, no CDN, no telemetry (§19/§22). They are Apps in
the catalog (`prism-chores`, `prism-timer`) with a ready-made facet per class
the templates use, so their roles pre-resolve (§1).

- **Chores & notes** (`prism-chores`) — a local list: add, check off, clear
  done, reorder; a free-text notes area beneath. Lists persist in the host
  store (§10 never-wipe) and are **remote-editable** through the existing
  remote API (§6), so a phone can add "milk" from the shop. Check-off is a
  human action only — nothing checks itself.
- **Timer** (`prism-timer`) — countdown and interval modes, presets, and the
  §24 chime at zero (a bundled local tone, volume-respecting, offline-proof;
  the same asset class as the alarm and resume chimes). It runs on device
  time, survives a reload, and says plainly when it was restored after a
  restart.

*Decision (serving):* a virtual host mapping beside the existing ones
(`brain.prism`, `prism-art.local`) — `tiles.prism` → `Assets/tiles`, so the
facets' URLs are `https://tiles.prism/chores/` and
`https://tiles.prism/timer/`. The veil engine is injected into these surfaces
like every other (win-host spec §5 coverage invariant): a first-party page is
not an exception.

## 7. The demo household — "the Parkers"

A reset-able seed (`scripts/seed-demo-household.mjs`, plus a host command
behind the Device rail) that builds one plausible family, so screenshots, the
golden path and CS-5's fixture all describe the same house:

- **Profiles:** the Parkers — two adults, two kids; names appear on the chore
  list and the calendar, nowhere else.
- **Merge events:** a fake week — school run, soccer at 4, dentist Thursday,
  pizza Friday — as local data, never a network call.
- **Chore list:** six items, three done, one assigned to each person.
- **Scenes:** the five templates instantiated with **placeholder heroes** (the
  App-poster placeholder, scene-model spec §5) so no account is needed and no
  logo we do not own is shown. Music Lounge (§2.5) is the plain 16:9 variant,
  not "Lounge + clock" — the clock role would resolve to the timer
  micro-facet's countdown until the page grows a clock face (§2.5.1).

*Decision (CS-9, 2026-09-02): the lounge is seeded IDLE, and the way it is
idle is that its **hidden `source` role takes the same `demo:placeholder`**
every account-needing role takes.* A hidden placement naming a ref that is not
a saved facet produces no hidden tile at all, so nothing loads, nothing could
be signed in, and the visualization sourced to it has no music state:
`visualizationFeed` reports `active: false`, and the stage draws the ambient
drift with an empty metadata line over the dark substrate (§2.5.2 point 6).
`sceneDocument` reports the dangling ref as a note rather than swallowing it,
exactly as it does for a placeholder slot. The alternative the work order
offered — a seed-created App and facet on `https://tiles.prism/…` marked
`music: true` — was rejected: there is no first-party music page, so it would
have to name one that does not exist, load a 404 into a hidden surface and
show it on reveal (§2.5.3). One placeholder ref, one gesture ("assign an app
here"), and `revealMusic` honestly answers `"unknown"` until the household
picks a service.

- **The staged track:** `DEMO_TRACK` — "Aurora Skies" / "The Refractions",
  both fictional — is exported from the seed module as **fixture data**, with
  `artwork: null` (we own no album art, nothing is bundled and nothing is
  fetched). The seed never plays it; the fixtures replay it through the real
  path (`demoTrackEvents()` → `MusicStateModel.onMediaSession` → `feed(...)`),
  which is what makes the marketing shot reproducible from the demo.
- **Reset:** `--reset` removes exactly what the seed added (`demo:*` keys and
  the entities it created), never touching real config (§10). Idempotent:
  running it twice leaves one household.

The seed is the golden-path fixture: SM-5's end-to-end walk can start from the
Parkers instead of from zero when it is testing scenes rather than onboarding.

## 7a. Template schema extension: hidden roles and visualization roles

Music Lounge (§2.5) is the first template whose audio owner is not in a slot.
`SceneTemplate` therefore gains, additively (every existing template is
unchanged and every existing fixture still holds):

```ts
interface TemplateRole {  ...existing...
  /** "visualization": the role resolves to a Visualization, not a facet. */
  kind: TemplateRoleKind;                 // + "visualization"
  /** Visualization roles only: the style and artwork mode the template sets. */
  visualization?: { style: VisualizationStyle; artwork: ArtworkMode; source: string /* a hidden role id */ };
}
interface SceneTemplate {  ...existing...
  /** Roles that resolve to HIDDEN facets (§5 hidden[]): loaded, zero-size, in audio focus. */
  hidden?: TemplateRole[];
}
```

Rules: a `visualization` role is complete when the hidden role it names is
resolved (the wizard never asks for it separately); `templateCompletion`
counts hidden roles; `templateAudioOwner` may return a hidden role's id;
`instantiateTemplate` writes `scene.hidden[]`, `scene.visualizations[]` and
`scene.assign[<viz role>] = <visualization id>`; the untrusted normalizers
drop a malformed `visualization` block rather than throw. A `music` role is
offered only as hidden (§32: music facets are never slot candidates).

---

## 8. Work split

| ID | Deliverable | Owner |
|---|---|---|
| CS-1 | The four templates as repo data + `AssignmentSettings.preview/tapAction/intermission` + the §25 scene-model surface + audio-follows-tap in core, with fixtures | Agent 1 |
| CS-2 | Imagery packs: format, `gallery` + `cosmos` manifests and fetchers, `LICENSES.md`, the §26 card corner, the gate check | Agent 2 |
| CS-3 | First-party micro-facets: chores/notes + timer pages, the `tiles.prism` mapping, catalog entries, remote editing, the §24 chime | Agent 3 |
| CS-4 | Host/runtime wiring of §25 peek and audio-follows-tap (seam, channel, remote parity) | Agent 4 |
| CS-5 | The Parkers seed + reset + golden-path fixture | Agent 5 |
| CS-7 | Music Lounge template (§2.5.1) + the §7a schema extension + the wizard's pick-service → sign-in → facet-and-visualization-together flow | Agent 1 |
| CS-8 | Prism Beams composition parity (§2.5.2) + reveal wiring (§2.5.3) on the host | Agent 3 |
| CS-9 | Music Lounge in the Parkers seed (idle; "Aurora Skies" / "The Refractions" as the synthetic Media Session fixture) + the §2.5 fixtures | Agent 5 |

Gate, unchanged: `node scripts/verify.mjs --no-known-gaps --require-all` must
be PASS on every branch before merge, with the vocabulary audit strict.

---

## Appendix A. The Concept Scenes Library (input of 2026-09-03, folded in)

The maintainer's original authoring draft — *Concept Scenes Library v0.1*,
"demonstrate the product through scenes, find where Entangled products slot
in, and surface the enhancements real scenes demand; the core stays simple,
complexity lives in scene design" — reached the repo on 2026-09-03, after §1–§7
were written from the work order alone. This appendix records what the
charter had already absorbed, what it decided differently, and what it had
never seen, so nothing in the draft is lost and nothing above is rewritten.
Scenes 1, 2, 3 and 6 of the library are the launch templates (§2.1–§2.4);
4 and 5 become templates when their enhancements land; the rest seed the
community gallery.

### A.1 Where the library and the shipped templates diverge

Recorded, not resolved — each is a candidate amendment, and `docs/marketing-shots.md`
shows which ones the website mockups depend on.

| Scene | Library said | Charter shipped | Note |
|---|---|---|---|
| Kitchen Command | calendar `3:4·M`; no chores role; intermission from the family's shared album (Photos phase 1) | calendar `4:3·M` (a three-up right column with chores); `pack:cosmos` | chores was the work order's addition; the album source waits on Prism Photos |
| Sports Multiview | game hero `16:9·XL` + 2–3 secondaries `16:9·M` (living previews) + scoreboard strip + optional fantasy tracker `3:4·M` | hero `4:3·XL` + two secondaries `3:2·M` + scores ticker | **resolved by CS-10.2 (§2.2)** — the library and mock 3 win: hero-plus-two. The 2×2 was the charter's reading of "four games", and four concurrent games broke §18's budget anyway. The classes are the derived ones, not `16:9` — see §2.2 |
| Movie Night | hero + **hidden music facet idle**; pause-after-break on; intermission = family album; night dim scheduled after | one role, `pack:gallery`, keepPresentation | hidden extras are scene-level; the §7a hidden-role schema (CS-7) now makes the idle music facet expressible in a template |
| Family Hub | Merge week `9:16·XL` upper · photos `3:2·M` · weather-to-wear `4:3·S` · chores `3:4·M` | photos `4:3·XL` upper · agenda/chores `1:1·M` · timer/weather `16:9·M` · ticker | the library leads with the calendar; the charter led with photos and added timer + ticker |

### A.2 Library scenes not yet templated

| # | Scene | Roles (library) | Needs (⚠ = not in spec) |
|---|---|---|---|
| 4 | **Security Wall** | 2×2 / 3×2 camera grid (`4:3`/`16:9·M`) · optional Merge agenda or clock | ⚠ local stream gateway (RTSP/ONVIF → WebRTC/HLS on localhost, go2rtc-class, opt-in install, zero cloud); ⚠ event-driven scene actions (`on: "webhook/<name>"` promotes a camera to hero for N seconds, then restores — §4 trigger extension) |
| 5 | **Trader's Desk** | charts hero `16:9·XL` (TradingView embed) · watchlist `3:4·M` · finance news shelf (derived, finance criterion) · earnings/econ calendar `3:4·M` · ticker strip | ⚠ generic feed facets (RSS → ticker/list, ICS → agenda, JSON with a user-supplied URL/key → metric cards): first-party renderers, user-supplied feeds, no Entangled data service, nothing leaves the box — §31 addendum |
| 7 | **Workshop / Garage** | tutorial hero (YouTube) · notes/parts list `3:4·M` (→ `prism-chores`) · driveway cam `4:3·S` · visualization fed by hidden music | keepPresentation + `onEnd: restart` for reference loops; rides scene 4's gateway for the cam; otherwise complete |
| 8 | **Deep Work / Office** | agenda `3:4·M` · tickets/board (Jira/Linear, region-focused) · metric cards (scene 5's feed facets) · visualization (lofi hidden facet) · optional ticker | no video hero — proves scenes aren't TV-shaped; Pomodoro = `prism-timer` (shipped, CS-3) |
| 9 | **Kids' Morning** | big clock + today strip (Merge) · weather-to-wear · lunch menu (school site region facet) · cartoon slot | ⚠ time-window facet locks — a per-assignment schedule ("cartoon slot live 6:45–7:15, then the countdown card"); extends `AssignmentSettings`; doubles as signage dayparting — parental control without building "parental controls" |
| 10 | **Lobby / Shop Signage** (B2B) | promo hero (`onEnd: restart-fullscreen`, shipped) · hours/menu (custom facet) · derived-shelf news or trade feed · weather | runs today on the kiosk profile; fleet management remains the future gap |
| 11 | **Big Event / Election Night** | 2–3 news heroes side by side **from different outlets across the spectrum** (the derived shelf makes multi-perspective the default) · results dashboard (embed or JSON feed cards) · ticker | audio-follows-tap (shipped, CS-1/CS-4); feed cards (scene 5) |
| 12 | **Second Screen / Gaming Companion** | wiki/guide · map · stream chat (Twitch chat embed) · visualization or voice-chat hidden facet | works today; a community-templates category rather than a shipped one |

### A.3 Enhancement ledger (priority order, with status)

| ⚠ Enhancement | Unlocks | Size | Where it lives | Status |
|---|---|---|---|---|
| Generic feed facets (RSS/ICS/JSON → ticker/agenda/cards) | Trader, Office, signage, countless | M | first-party facets, spec §31 addendum | **open** |
| Local stream gateway (RTSP → WebRTC, localhost) | Security, Workshop, shop floors | M | host component, opt-in install | **open** |
| Audio-follows-tap (`tapAction` per assignment) | Sports, Election | S | scene model per-assignment setting (§5 above) | **shipped** — CS-1 core, CS-4 host |
| Event-driven scene actions (`on: webhook/motion` → promote/restore) | Security, doorbell, ops walls | S–M | §4 trigger extension | **open** |
| Time-window facet locks | Kids, signage dayparting | S | per-assignment settings | **open** |
| Timer facet (first-party, local) | Office, Kitchen, Gym | XS | first-party facet | **shipped** — CS-3 (`prism-timer`, §6 above); clock face pending (§2.5.1 note) |
| Merge: external ICS subscriptions (work calendars as overlay lanes) | Kitchen (the killer), Family Hub | M (Merge-side) | Merge roadmap | **Merge roadmap** — named in Kitchen Command's blurb (§2.1) |

**Not doing** (library decision, kept): per-feed sync alignment for
multi-game sports (deep rabbit hole, marginal value v1); any Entangled-hosted
data services — feeds stay user-supplied, nothing phones home.
