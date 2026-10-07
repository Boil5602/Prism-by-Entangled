# PRISM by Entangled — Claude Code briefing

Open-source dashboard frames: DIY hardware builds running web-tile dashboards.
No ads, no subscriptions, no telemetry, no data sales. Everything is open source;
self-hosting is always the escape hatch.

## Read first

- `docs/prism-project-map.md` — the whole project on one page (names, layers, principles)
- `docs/dashboard-schema.md` — **the spec, 28 sections. This is the source of truth.**
  Behavior questions are answered here before writing any code.
- `docs/win-host-spec.md` — **Prism for Windows host shell spec (Phase-1 flagship). Current build target.**
- `docs/scene-model-spec.md` — **configuration model (App/Slot/Layout/Facet/Scene), quick actions, IA. Build this natively from day one. Its §7 Migration applies to the pre-scene-model store (`%LOCALAPPDATA%\Prism\store.json`: tiles, shortcuts, master layouts, scenes v0): never deletes source data (§10), writes a review report, is round-trip tested on a COPY of a real config, and the data folder is backed up before the migration merge.**
- `docs/concept-scenes.md` — **the concept-scenes charter: the shipped Scene Templates (Kitchen Command, Sports Multiview, Movie Night, Family Hub, Music Lounge), the imagery-pack format, the first-party micro-facets, the Parkers demo household, and Appendix A's scene library + enhancement ledger. Its *Decision:* lines are where a correction lands.**
- `docs/features/tmdb-account.md` — the person's TMDB account linked once for ratings from the wall (their own key, no corporate key, no guests)
- `docs/features/phone.md` — the phone: pair by QR, a keyboard for the wall, private listening
- `docs/features/updates.md` — the Windows download and updates: one signed manifest in the bucket, a configurable server address and key for forks, the publish script
- `docs/network.md` — every connection Prism makes and the one it accepts; a new fetch or listener is added here in the same commit
- `docs/roadmap.md` — what is deferred and why (household sync of sign-ins, the phone keyboard, tracker blocklist); add here, never build from a chat alone
- `docs/bugs/LEDGER.md` — bugs + the WORK section (Scene Model work order: task · owner · status · branch)
- `docs/veil-release-checklist.md` — **the browser extension's release gate** (Edge / Chrome / Firefox): freeze, pre-flight, privacy and art gates, the site matrix walked on both browsers, store assets, submissions. Extension only; the host is in development.
- `docs/marketing-shots.md` — the six website shots as composition references, each tied to a template + the Parkers seed (reference code: `prototypes/prism-website-mockups.jsx`)
- `docs/test-scripts.md` — hand-run walkthroughs (Do → Expect, one per concept scene) with a verification mark per step; the audit notes at its end are the open UX gaps
- `docs/third-party-services-policy.md` — **how Prism treats the services it shows**: no credentials, no DRM, page actions only, a person's pace, respect a block, no disguises, ads covered not blocked; a legal notice goes to Entangled Labs LLC
- `docs/windows-hardware-baselines.md` — Phase-1 hardware requirements (Windows)
- `docs/window-orchestrator-sketch.md` — multi-window fallback design (extension-only path)
- `docs/hardware-builds.md` — original five-build lineup (long arc; Android parked, Pi pending)
- `docs/prism-photos-concept.md` — phase two/three companion (not current work)

## Prototypes (working reference code)

- `prototypes/frame-editor.jsx` — the dashboard editor. **Contains the reference
  layout solver (`solveHero`)** implementing spec §8. Solver behavior is law:
  all ports must produce identical rects for identical inputs.
- `prototypes/prism-build-wizard.jsx` — the site's build wizard (tesseract picker,
  parts sourcing, build guide). Design tokens here + editor define the visual language.

## Architecture (spec §23 — one brain, thin hands)

- `prism-core` (TypeScript): ALL behavior — solver, audio focus (§3), tile
  lifecycle (§16/§18), region focus (§17), adapters runtime (§5), remote API +
  pairing (§6), schedules/alarms (§4/§24), sharing (§15/§20), intermission (§26/§27).
- Shells implement only the driver seam (Surface/Display/Input/Media/Net/Store)
  and decide nothing:
  - Android shell (Kotlin/Compose + WebViews) — tablets & TV boxes
  - PrismOS daemon (Node/Bun + Chromium DevTools + Wayland + PipeWire) — Pi/mini PC
  - Windows recipe — same daemon, Edge drivers (community)
- Conformance kit defines "is a Prism": solver-identical rects, no white frames
  (§16 timings), audio exclusivity, storage persistence across restart (§10).

## Build order (revised Aug 2026 — see spec §29)

1. Browser extension (Phase 1a) — §26/§27/§30 engine; in progress
2. **Prism for Windows host shell** (`docs/win-host-spec.md`) — WebView2
   tiles + prism-core + compositor-level veil; the flagship. Milestones M1–M6.
3. Remote PWA (shares core + design tokens)
4. PrismOS daemon + image (Phase 2, pending validation)
Android shell: parked, a dead end (WebView DRM — see docs/reports). Left in the tree
for the record; new features owe it nothing — no compatibility work, no shared-contract
changes held back for it (decision 2026-09-09).

## Vocabulary (canonical — UI strings, type names, files, docs)

App (identity+session) · Slot (classed region in a Layout) · Layout
(slots for a canvas class) · Facet (one face of an App: page+region+zoom
cut for a slot class) · Scene (Layout + facet assignments + floating/
hidden + visualizations) · Canvas class (aspect+resolution bucket) ·
Visualization (placeable audio-reactive surface, source = hidden music
facet) · **Frame = the physical device only.** "frame" in code for
anything else is review-rejectable (the SM-6 rename commit landed:
model + UI + docs in one; `node scripts/verify.mjs` runs the vocabulary
audit strict by default). `frame.dashboard/v0.1` / `frame.layout-share/v0.1`
and the page-side `window.frame` adapter API are schema/contract
identifiers, not vocabulary — they keep their names; a stored tile
`kind: "frame"` is read as `"slot"` forever (never rewritten, §10); the
§17 verb "framing" (`startFraming`/`finishFraming`) stays. "whitelist"
never appears in UI strings (the human verbs are Open / Always allow).

## Editing files with scripts (learned the hard way, twice)

A shell heredoc collapses \\ to \ before your script sees it. So a
Python patch written as `"...\\n"` or `"\\u00B7"` reaches the interpreter as
`"\n"` / `"\u00B7"` and produces a REAL newline or a raw middot — not the
two-character escape the source file needs. This has now bitten twice:

- `VisualizationChrome.cs` was written with raw UTF-8 where its own header
  requires `\uXXXX` escapes (the host's sources are mixed cp1252/UTF-8, so an
  encoding round-trip could silently change what the wall says);
- five `host.log` write sites silently did not match, because the match string
  held a newline where the C# source holds backslash-n.

Rules:

- **Build escape sequences with `chr(92)`**, never a literal `\\` in a heredoc.
- **Verify the bytes after every scripted edit — never trust the success
  print.** `grep` the changed line, or count what you expect
  (`sum(1 for x in open(p,'rb').read() if x > 127)` for the ASCII-only files).
  A `str.replace` that matches nothing "succeeds" and writes an unchanged file.
- **One edit per process, and close the file explicitly.** An `assert` that
  fires later in the same script can leave an earlier `io.open(...).write(...)`
  unflushed, so the edit is reported as done and is not on disk.
- Detect per file before patching: core sources are mixed cp1252/UTF-8 with
  CRLF in places, and `VisualizationChrome.cs` must stay pure ASCII.

## Host UI contrast (win-host-spec §5)

Text the host draws is read from across a room. Never render an informational row in a
control's *disabled* state to make it inert (disabled grey on the dark menu surface is
unreadable - reported 2026-09-16); give labels their own template or a TextBlock. Light ink
`#E8ECF2` for information, amber `#F2B14C` for the thing to notice, `#8A93A2` only for a
secondary line under a primary one. A verb that cannot act may be disabled, with the reason
in its tooltip.

A host Button with a background colour of its own is made with `Chip()` or has `OwnHover(button)`
called on it (MainWindow.VideoHub.cs) - WinUI's own hover fades a coloured button to near-clear and
drops it ("lights up then turns off", reported 2026-09-25). `node scripts/audit-button-hover.mjs`
(a verify step) fails on any that don't.

## Non-negotiables (do not code around these)

- §10 storage persistence: never wipe profile/session storage for any reason
- §16 no white frames: snapshot → hidden load → crossfade on readiness, dark substrate
- §19/§22 privacy: no identifiers in any network call; update checks unparameterized
- §26 detection safety: observe-only, cover-slow/uncover-fast, degrade to nothing
- Every filter/label traceable to a named source; no unlabeled truth filters (§5)
