# Golden path — Kitchen Classic from a zero-entity install (SM-5 test plan)

A human runs this at the machine. Budget: **≤ 5 minutes of user steps** from
first launch to a playing scene. Pass = every step's observation matches and
the timer says ≤ 5:00 at step 12. Owner of the plan: Agent 5 (SM-5). The
build under test: the SM-3 branch (Scene Template wizard) merged over SM-1 +
SM-4 — until then the plan is a script waiting for its UI.

Spec anchors: scene-model-spec §6 (golden path is top-down via one wizard),
§6a (Back returns to the scene); dashboard-schema §31 (Scene Templates name
slot ROLES, never apps; audio defaults: hero `exclusive`, utility roles `mute`
+ `scroll`); §16 (no white frames); §10 (sessions persist).

Video service for the hero role: **Hulu** (the test account has it; it is the
§26 intermission demo service and the Widevine tier is recorded per
docs/reports). Substitute YouTube if Hulu's login is in a bad state — note it.

## Setup (not timed)

1. Close Prism if running. Back up the data folder: copy `%LOCALAPPDATA%\Prism`
   to `%LOCALAPPDATA%\Prism-goldenpath-<date>`.
2. Zero-entity install: rename `%LOCALAPPDATA%\Prism\store.json` to
   `store.json.pre-golden` (**never delete**; profiles stay - §10 says sessions
   persist, and the Hulu profile keeping its sign-in is part of what we test).
3. Open `%LOCALAPPDATA%\Prism\diagnostics\host.log` in a tail viewer
   (`Get-Content -Wait -Tail 50`). Note the line count; everything below is
   relative to launch.
4. Start a stopwatch at the moment you launch PrismHost.

## Steps (timed)

| # | User step | Expected observation | host.log proof |
|---|---|---|---|
| 1 | Launch PrismHost | Dark substrate, no white flash (§16). The **Scenes** rail item is selected; the scene grid is empty; **+ New Scene** is the only affordance that matters. No "add a frame" wording anywhere (vocabulary). | `brain ready` → `core init (WxH)` → no `<- surface.create` yet (zero entities) |
| 2 | Tap **+ New Scene** | The template wizard opens with **Kitchen Classic** first: four roles listed — *video hero* 16:9·XL, *calendar* 3:4·M, *weather* 4:3·M, *news ticker* 8:1. Each role shows catalog suggestions + "any app". No role is pre-filled with an app. | `call {"fn":"<SM-3 names it: template.start>", ...,"template":"kitchen-classic"}` |
| 3 | Video hero → choose **Hulu** | App setup mode opens **full-screen in a normal browsing view** in the `hulu` profile. If the profile is still signed in (§10), the Hulu home shows immediately; otherwise sign in here — this is the only place sign-in happens. | `<- surface.create hulu` (profile `hulu`), `<- surface.navigate hulu`, `-> {"type":"first-paint","id":"hulu"}`, `-> {"type":"load-finished","id":"hulu","ok":true}` |
| 4 | Tap **Done** (setup) | App card for Hulu shows **signed-in**. The wizard proposes the role's tuned facet for 16:9·XL (Hulu · Live guide preset or Home); accept it. | `call {"fn":"<SM-3: facet.save>",...,"slotClass":"16:9·XL"}` |
| 5 | Calendar → **Merge agenda** (or any calendar URL) | Same in-place flow: setup (sign-in if needed) → facet preset for 3:4·M → back to the wizard with the role resolved. | `<- surface.create <calendar-app>`; `call {"fn":"<facet.save>",...,"slotClass":"3:4·M"}` |
| 6 | Weather → the catalog weather entry | Facet preset for 4:3·M (region-focused on current conditions). Role resolved. | `call {"fn":"<facet.save>",...,"slotClass":"4:3·M"}` |
| 7 | News ticker → the **derived shelf** | The picker shows the attribution line verbatim: *"sources rated generally reliable on Wikipedia's Perennial Sources"*, each entry with a rationale link. Pick any wire service. Facet preset for 8:1. | `call {"fn":"<facet.save>",...,"slotClass":"8:1·S"}` |
| 8 | Wizard shows **all four roles resolved** → tap **Create scene** | The wizard was **never** instantiable before this point (a role left unresolved keeps Create disabled — verify by trying at step 6). Name defaults to "Kitchen Classic". | `call {"fn":"<SM-3: scene.save>"...}` and the layout it created `call {"fn":"<layout.save>"...,"canvasClass":"16:9 @ 1080-class"}` (or the wall's real class) |
| 9 | Scene applies | Four slots crossfade in from dark (§16) — no white, no partial page flash. Hulu is the hero. Audio: Hulu owns audio (`exclusive`); the three utility facets are muted and scroll. | `<- surface.setRect` ×4, `<- surface.setMuted hulu` (false), `<- surface.setMuted <others>` (true), `<- surface.reveal` ×4 |
| 10 | Stop the stopwatch | **≤ 5:00.** Record the time in the ledger row. | — |
| 11 | Press **Esc** / Back | Nothing to close: you are on the scene. (Back from any wizard screen earlier returned to the scene, not to a rail page — spot-check once during steps 3–7.) | no `call` line; no surface churn |
| 12 | Close Prism (window close, not kill) and relaunch | The scene is back within ~2s from persisted snapshots (§16 boot experience), then live tiles revive behind crossfades. Hulu still signed in (§10). | `brain ready`, `core init`, `<- surface.create` ×4 with the SAME profile ids as before, `-> {"type":"load-finished",...,"ok":true}` ×4, no `RENDERER FAILED` |

## Pass / fail

- FAIL if any step needs a trip to a rail page the wizard did not open itself
  (scene-model-spec §6: "no flow dead-ends into 'go configure that elsewhere first'").
- FAIL if any UI string on the path says "frame" for a slot/facet or
  "whitelist" anywhere (`node scripts/audit-vocabulary.mjs --strict` must also
  be green on the branch).
- FAIL if a white/blank frame is seen at steps 1, 9, or 12.
- FAIL if the timer exceeds 5:00 with a warm (signed-in) Hulu profile. With a
  cold sign-in, note the sign-in time separately and judge the rest.
- FAIL if step 12 shows a different profile id for Hulu (the migration or the
  scene builder must reuse the App's profile, never mint one).

## Restore (not timed)

Rename `store.json.pre-golden` back to `store.json` (or keep the golden
store and archive the pre-golden one — your call; both are kept either way).

## Starting from the Parkers instead of from zero (CS-5)

The walk above tests **onboarding**: a zero-entity install builds its first
scene. When what is under test is *scenes* — the wizard's later screens, peek,
audio-follows-tap, the veil, a schedule — starting from zero wastes four
minutes on sign-ins that prove nothing. For those runs, seed the demo
household (`docs/concept-scenes.md` §7) instead of doing the Setup steps:

```
cd packages/core && npx tsc -p tsconfig.json     # the seed reads core's dist
node scripts/seed-demo-household.mjs --print     # dry run: what it would write
node scripts/seed-demo-household.mjs --live      # the real store (backs store.json up first)
node scripts/seed-demo-household.mjs --live --reset
```

What you get: the Parkers (two adults, two kids), a week of local calendar
data, a six-item chore list, and the four concept templates as four Scenes —
`demo-kitchen-command` (active), `demo-sports-multiview`, `demo-movie-night`,
`demo-family-hub` (portrait). Every role that would need an account is the
**App-poster placeholder** (scene-model spec §5), so nothing is signed in and
no logo we do not own is on screen: tapping a placeholder is the assign step,
which is exactly the interaction most scene tests want to start from.

Rules for a Parkers-started run:

- Say so in the ledger row. A Parkers run **never** substitutes for the timed
  onboarding walk above — the ≤ 5:00 number only means anything from zero.
- `--live` backs `store.json` up to `%LOCALAPPDATA%\Prism-backup-<timestamp>`
  before it writes; profiles and snapshots are never touched (§10).
- `--reset` removes exactly what the seed created (its receipt, `demo:seed`,
  records every id) and refuses on a store it never seeded. Anything you
  changed after seeding is left standing, and the run says which.
- The screenshots in a report should come from a seeded machine, not a real
  household's config — the Parkers are the only family we publish.

## Placeholders to fill at review

The `call {"fn":…}` names in steps 2, 4–8 are SM-3/SM-4's to name; Agent 5
fills them in from the branch's `win-channel.ts` HOST_CALLS when the branch
arrives, and the flight recorder must show every one of them (ledger SM-4:
"flight recorder covers every new message").
