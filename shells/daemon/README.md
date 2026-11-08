# prism-daemon

Build-order step 4's brain-on-a-PC (spec §23): prism-core running directly
in Node — no bridge — driving one Chromium window per tile over the DevTools
Protocol. On Linux under a Wayland compositor, this daemon plus an image
build is **PrismOS**. On Windows with Chrome/Edge it is the **Build 5
community recipe**, which is where it runs today.

## Run

```
npm install && npm run build
node shells/daemon/dist/main.js --dashboard shells/android/app/src/main/assets/dashboard.json
```

Options: `--port` (remote API, default 8471) · `--width/--height` (virtual
wall) · `--origin-x/--origin-y` (wall position on screen) · `--browser`
(Chromium executable) · `--max-live` (§18 budget) · `--data-dir`.

The pairing URL prints at startup; the phone remote and the conformance kit
both work against it:

```
node packages/conformance/dist/cli.js http://localhost:8471 <token> <bundle.json>
```

Status: **passes all 8 conformance checks** (verified 2026-08-24 against
Chrome 151 on Windows 11 — rects bit-identical to the reference solver).

## Transport note

Modern Chromium (Chrome 136+ hardening, and current builds generally) no
longer honors `--remote-debugging-port`; the daemon speaks CDP over
`--remote-debugging-pipe` (fd 3/4, NUL-delimited JSON) with flat sessions —
see `src/cdp-pipe.ts`. No sockets, no port races, no third-party CDP client.

## Honest v0 gaps (recipe-grade, tracked)

- **§16 freeze/crossfade are no-ops**: OS windows can't overlay each other's
  pixels the way the Android snapshot layer does; on real PrismOS the
  Wayland compositor owns this. Hidden-until-reveal is approximated by
  keeping windows minimized until core reveals them.
- **§10 storage**: the core store (pairing tokens, hero overrides, synced
  blocklists) persists as JSON in the data dir, and every tile profile is its
  own Chromium process with a persistent `user-data-dir` under
  `<data-dir>/profiles/<profile>` — cookies, localStorage, IndexedDB, and
  service workers survive restarts; nothing is ever cleared. Isolation between
  profiles is process isolation, so a dashboard with many distinct profiles
  runs many browsers (mini-PC territory; share a profile string where a shared
  session is what you want).
- **Window chrome**: tiles are normal Chrome windows (title bars, tab strip)
  and z-order under other desktop windows isn't managed — kiosk polish is
  compositor/platform work.
- Audio mute is JS-injected per page rather than per-stream (PipeWire owns
  this on PrismOS).
