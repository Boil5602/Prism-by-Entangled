# Presentation keeping — scripted-Esc test on the host (SM-5 test plan)

A human runs this at the machine against the host build that carries the
SM-1 keeper wired through SM-4's channel (`presentation` / `user-input` events
in, `enterFullscreen` / `enterTheater` / `play` actions out). It is the
live counterpart of `packages/core/tests/fixtures/presentation-keeping/*.json`
(the same cases, with a real player and a real Esc key).

Spec: dashboard-schema §26 "Presentation keeping" — restore only when the
drop correlates with an ad-break / ended signal; a drop that follows user
input (Esc, back, a click) is the human's intent — never fought; keeping
resumes only after the human re-enters; presentation actions exist only under
a standing instruction; never during an ad.

Two invariants this plan proves on the wall:
- **user-exit never fought** (fixtures `user-esc-no-restore`, `re-enter-resumes`)
- **presentation actions unreachable without a standing instruction**
  (fixture `no-standing-instruction`)

Log tail: `Get-Content $env:LOCALAPPDATA\Prism\diagnostics\host.log -Wait -Tail 80`.
Today the host has no handler for `ContainsFullScreenElementChanged`
(SM-4's auto-grant is pending), so "fullscreen" in this plan means the
player's own fullscreen state inside its WebView2 ("Fill slot" on the HUD
card forwards a human tap to the player's control). Once the auto-grant
lands, repeat E1 with the element-fullscreen variant.

## Scene under test

A Hulu facet in the hero slot with **keepPresentation: true**, `onEnd: none`
(set in the scene builder's per-assignment settings). A second scene,
identical except **keepPresentation: false**, for E3. Hulu free tier (ads)
or YouTube without Premium - any service whose adapter posts `ad-break`.

## E1 — Site drop at an ad boundary is restored (baseline)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Start a show; put the player in fullscreen via the player's own control (or Fill slot) | Fullscreen; the keeper records the human's state | `-> {"type":"presentation","state":"fullscreen","id":"hulu"}` (the observer's event name per SM-4) |
| 2 | Wait for an ad break | Veil covers; if the site drops fullscreen at the ad start, nothing happens yet | `-> {"type":"ad-break","active":true,"id":"hulu"}`, `intermission up: hulu`, possibly `-> {"type":"presentation","state":"none",…}` — and **no** `enterFullscreen` while the break is live |
| 3 | Ad ends | Veil lifts; fullscreen comes back on its own within the fade | `-> {"type":"ad-break","active":false,…}` → the action line SM-4 names, e.g. `<- surface.presentation hulu enterFullscreen` (or `surface.evaluate hulu` invoking the adapter's named action) → `-> {"type":"presentation","state":"fullscreen",…}` |

## E2 — Esc is the human's intent: never fought

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | From E1 step 3 (fullscreen, content playing), **press Esc** with the page focused | Player leaves fullscreen and **stays** out | `-> {"type":"user-input",…}` (or the host's `interaction`/key event SM-4 maps) immediately followed by `-> {"type":"presentation","state":"none",…}`; **no** `enterFullscreen` afterwards - watch for 60 s |
| 2 | Wait through the next ad break, still not fullscreen | Veil covers and lifts; **no restore** - the human left, keeping is off | `ad-break true` … `ad-break false` with **zero** presentation actions between or after |
| 3 | Press Esc a second time (nothing to leave) | Nothing changes; no action | no `presentation` event, no action |
| 4 | Re-enter fullscreen yourself (player control / Fill slot) | Keeping re-arms silently | `-> {"type":"presentation","state":"fullscreen",…}` with no preceding action line (it was the human) |
| 5 | Next ad break: site drops fullscreen at the boundary, ad ends | **Restored** again - keeping resumed only after the human re-entered | as E1 step 3 |
| 6 | Variant: click the player's own exit-fullscreen button instead of Esc; repeat 1–2 | Identical: click is user input | `interaction` / `user-input` precedes the `presentation none` by < 1 s; no action |
| 7 | Variant: press Esc **during** an ad while the site has already dropped fullscreen | The pending restore is cancelled; when the ad ends nothing is restored | `user-input` during the break → `ad-break false` → **no** action |

FAIL if any presentation action appears after a `user-input` that precedes
the drop, before the human re-enters. That is the shell fighting a person.

## E3 — No standing instruction, no action (the synthetic-interaction ban)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Switch to the scene with **keepPresentation: false**; go fullscreen; let an ad drop it; let the ad end | Fullscreen is **not** restored | `ad-break false` → **no** presentation action for the rest of the session |
| 2 | With that scene active, grep the whole session | No presentation action ever reached the surface | `Select-String host.log -Pattern 'enterFullscreen|enterTheater|presentation .* play'` returns only lines from E1/E2 timestamps (the other scene) |
| 3 | Flip the setting to true in the scene builder without reloading the facet; repeat E1 | Restore works from the next boundary on - the instruction is live per assignment | `call {"fn":"<SM-3: scene.settings>",…,"keepPresentation":true}` then E1 step 3 lines |

## E4 — Ended (onEnd)

| # | Step | Expected | host.log proof |
|---|---|---|---|
| 1 | Set `onEnd: restart-fullscreen`; play a short video (YouTube) to its end in fullscreen | It replays and returns to fullscreen | `-> {"type":"ended",…}` → `play` action → (site drop) → `enterFullscreen` action within ~1.5 s |
| 2 | Set `onEnd: none`, keep true; play to the end | Whatever the site does at end, no `play` is ever sent | `ended` with no `play` action |

## Recording

Ledger row SM-5 notes: E1 pass/fail, E2 (steps 1–7) pass/fail, E3 pass/fail,
E4 pass/fail, plus the exact action line names SM-4 chose (fill them into
this file so the next run needs no guessing).
