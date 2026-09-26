# Prism Veil (extension)

Turns video **ad breaks** into chosen imagery (spec §26/§27). Observe-only: nothing
is clicked and no ad is blocked from loading — the ad plays underneath while art,
an "Intermission" card, and a mute cover it, lifting the instant your show returns.

## What it covers (measured, not guessed)

Video ad-break detection matches the site's ad-delivery family:

- **Client-side IMA** and **Google DAI** (server-stitched *with* the SDK) — hooked
  via `ima-hook.js`. Covers Paramount+ (DAI, verified), CBS, and IMA-driven players.
- **Custom SSAI** (server-stitched, one continuous stream, no ad events) — detected
  per-player by the player's own ad-mode class. Registry: `SSAI_AD_SOURCES` in
  `src/video.js`. Ships with **Hulu** (`.AdPlayer` shown), **Peacock** (`adBreakActive-*`),
  **CNN / Warner Bros Discovery "bolt"** (`.fave-player-container.fave-ad`), and
  **Paramount+** self-promo ads (the "Advertisement" label).

A `gampad`/doubleclick request does **not** prove a hookable break — many sites ping
it yet stitch server-side. The real discriminator is whether the content pauses / an
ad event fires. See the `veil-adtech-families` note for the full map.

Display/banner ads are best-effort only (a filter-list problem); this extension's job
is the **video break**.

## Load it in Chrome (one time)

Chrome 137+ ignores `--load-extension` on the command line, so load it unpacked:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`prototypes/prism-veil-extension`).
4. It's on. Open any supported video site and let an ad play.

After editing any file here, click the extension's **reload** icon on
`chrome://extensions` to pick up changes.

## Layout

Classic content scripts sharing one namespace (`PV`), loaded in this order:

| File | Owns |
|---|---|
| `src/art.js` | GENERATED bundled art subset list (`python ../prism-veil-art/fetch-art.py --regen`) |
| `src/dom.js` | visibility, shadow-crossing parents, root collection, `mainVideo` |
| `src/rules.js` | **detection**: `SLOT_SELECTORS`, `SITE_RULES` (per-site rows), label walker, dedupe → `collectTargets()` |
| `src/covers.js` | display covers: placement modes, sweep, row-shared art, sticky-bar clip, mute-under |
| `src/video.js` | video breaks: `SSAI_AD_SOURCES` registry, Intermission card, Skip hole, the fixed veil |
| `src/report.js` | the ⚑ Report ad chip (names the rule that placed a veil) |
| `src/main.js` | observers, timers, Escape / hold-to-reveal, start |

`ima-hook.js` (main world, `document_start`) is unchanged: it publishes the IMA/DAI SDK's
own ad events to `<html data-prism-ad>`.

## Tests

Detection rules have a fixture suite (happy-dom; layout is faked explicitly with
`data-rect="x,y,w,h"` on every element that matters):

```
npx vitest run --config prototypes/prism-veil-extension/tests/vitest.config.mjs
```

Add a fixture whenever a rule is added or a site's markup is re-measured - the
fixture IS the record of what was measured.

## Adding another SSAI player

One traceable row in `src/video.js` → `SSAI_AD_SOURCES`:

```js
{ source: "<name of the player / owner>", host: /(^|\.)site\.com$/i, container: "<player root>", adClass: "<class added only during an ad>" | adSelector: "<present only during an ad>", authoritative: true }
```

Find `container`/`adClass` by inspecting the player while an ad runs: the container
gains an ad-mode class (like bolt's `fave-ad`). Only add a source you've verified —
every filter must trace to a named source (spec §5).

## Safety behavior

- **Escape** rips down every cover, restores audio, and holds off 6s — you can always
  get straight back to your show.
- A **watchdog** (`ima-hook.js`) and an independent **5-minute ceiling** (`src/video.js`)
  guarantee the veil can never stick if an "ad ended" event is missed.
- Prior mute state is restored on uncover; the veil never forces audio on.
- House bumpers / brand intros are classified out and left uncovered.

## Intermission art

The photo pool lives in `../prism-veil-art/` (see its README). Every photo is
Wikimedia Commons **CC0 / public domain only** - free for commercial use, no
attribution burden - with its Commons page, author and license recorded in
`pool/manifest.json`. Nothing without a license record ships anywhere.

Two consumers, two delivery paths:

- **Ad covers** (`src/art.js` -> `art/*.jpg`): a GENERATED 32-photo subset,
  downscaled to 1200px (~7 MB), bundled inside the extension. Covers must be
  extension-local: a hot-linked image would be fetched from the page's context,
  sending the current site as `Referer` to the image host (spec section 19/22), and
  strict `img-src` CSPs would block it.
- **Start page wallpaper** (`ntp.js`): streams the full pool from
  `https://prism.entangled.world/veil/art/` (`list.json` + files, a plain
  unparameterized GET; extension pages send no Referer). The bundled subset is
  the offline fallback, and the only pool when the "Online photo pool" setting
  is off.

Regenerate both after changing the pool: `python ../prism-veil-art/fetch-art.py --regen`.

## Start page (New Tab override)

Edge refuses extensions on its MSN New Tab origin, so the extension replaces the
page (`ntp.html`). Everything on it is local except three opt-in fetches, each
`no-referrer`, no cookies, to exactly the host the user configured:

- **Weather** - Open-Meteo, keyless; sends only a lat/lon rounded to ~1 km; 15-min cache.
- **Today** - the user's own `.ics` feed URL (kept in `chrome.storage.local`, never in the repo); 10-min cache.
- **Prism frames** - the user's paired frames (`Name | http://ip:8471 | token`), spec section 6 API:
  `GET /state` every 20 s while visible, play/pause on the audible tile, sleep/wake, send a URL to a web tile.

Each configured origin is granted individually via `optional_host_permissions` when saved.

## Popups (spec section 30)

Ads that play get veiled; pages that spawn get blocked. `window.open` is
intercepted in the main world (`popup-hook.js`) and returns a stub
WindowProxy - the popup is never loaded, offscreen or otherwise. The policy
is prism-core's (`packages/core/src/popups.ts`, bundled to
`src/core-popups.js` by `npm run build:veil`): click consistency, the
one-window-per-gesture burst rule, attributed-list classification, a named
functional allowlist (sign-in brokers, payment processors), then the human's
own per-destination / per-site / global decisions. Unknowns are intercepted
into a local per-site ledger.

The **Prism button** (`src/popups-ui.js`, Shadow DOM, bottom-right) is a
subscriber to core's events: it morphs to "N popups blocked" (bursts
coalesce, one morph per ~10 s, ~3 s hold, aria-live, dissolve under reduced
motion), collapses to an edge tab per site, hides in fullscreen/PiP, dodges
fixed bottom bars, and opens the **Control Center**: ledger rows with exactly
two verbs, **Open** and **Always allow**, the post-open "Open these
automatically next time?" nudge, "Popups you've allowed" with Remove, block
all here, and hide the button here (the toolbar badge from `bg.js` stays as
the fallback surface). No UI string says "whitelist".

Fixtures: core (`packages/core/tests/popups.test.ts` - burst coalescing,
morph rate limit, per-site collapse persistence, allow-flow round trip) and
the hook end to end (`tests/popup-hook.test.mjs`).

## Browser targets — Chromium and Firefox (kept in sync)

The repo folder **is** the Chromium/Edge extension: load it unpacked as-is
(`edge://extensions` / `chrome://extensions` → Load unpacked → this folder).

The **Firefox** copy is derived from the same source, never forked. Run:

```
node build-firefox.mjs
```

This writes `dist/firefox/` and `dist/chromium/` + a zip each (git-ignored); `chromium` is identical to this folder loaded unpacked. One package per browser. The start page ships inside it but is **off until you flip "Use Prism as my new-tab page" in the extension popup**: there is no `chrome_url_overrides` in the manifest (it cannot be toggled at runtime in any browser); instead `bg.js` routes newly created new-tab pages to `ntp.html` only while the switch is on, and never touches the browser's own new tab otherwise. Weather hosts (Open-Meteo) are optional permissions requested the first time a location is set. Every behavior file (`src/*`,
`ima-hook.js`, `popup-hook.js`, `ntp.*`, `popup.*`, `art/*`) copied verbatim,
and a Firefox manifest **derived** from `manifest.json` so version,
permissions, `content_scripts`, and `web_accessible_resources` never drift.
Only the browser-level differences are transformed:

- **Background** — Chromium runs a service worker (`background.service_worker`);
  Firefox MV3 runs an event page (`background.scripts`). Same `bg.js`.
- **`browser_specific_settings.gecko`** — Firefox needs a stable add-on id and
  a `strict_min_version` of `128.0`, because the page-context hooks
  (`ima-hook.js`, `popup-hook.js`) use `world: "MAIN"` content scripts, which
  Firefox supports from 128 (July 2024). Below 128 those hooks wouldn't inject
  (popup interception + IMA/DAI video-ad detection would go missing) — so we
  pin 128 and Firefox behaves identically to Chromium.

Load it: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** →
pick `dist/firefox/manifest.json`. (Temporary until restart; for a permanent install run `sign-firefox.cmd` - AMO unlisted signing, credentials in `~/.prism/amo.env` - and share the resulting `dist/*.xpi`, which installs by opening it in Firefox. A permanent install
needs AMO signing.)

What works where: the **display-ad veils** (`rules.js`/`covers.js`) and
**SSAI commercial-break veils** (`video.js` — Hulu, Peacock, CNN, Paramount+)
run in the isolated world and are fully cross-browser. **IMA/DAI** video-ad
detection and **popup interception** ride the `world: "MAIN"` hooks, so they
need Firefox 128+. Every `chrome.*` API the extension uses is supported in
Firefox via the `chrome` namespace alias — no Chromium-only calls.

To keep them in sync: edit `src/` once, then re-run `node build-firefox.mjs`.

## Known issues

- **YouTube: occasional full page reload during an ad break** (since 0.7.40).
  The ad `<video>` is set to `opacity:0` while veiled - the only measure that
  stopped the ad's first frames flashing through (Chrome composites the video
  on a hardware overlay plane during the stream swap, above any DOM stacking).
  YouTube's player sometimes treats the transparent ad video as hidden and
  recovers with a reload. A 0.001deg rotation (0.7.42) avoided the reload but
  brought the flash back; the flash was judged worse (2026-08-29).
