# The report flag

2026-10-06: "Can we add a bug report mechanism to the app? Preferably under a little flag icon that appears in the same spot
consistently. People need to be able to report if ads are on their screen, or if a bug is found inside the application as there will
likely be many. They should also be able to report bugs by a specific adapter, and whether on the music or video screen." Then: "And we
need to catch those reports in a queue online."

## Where it is

A small flag in the top-right corner of the window, on both players, always the same spot. The Music | Video grip sits one place to
its left. It fades with the other grips while a video plays and comes back with them. (`MainWindow.ReportFlag.cs`.)

## The form

- **What is it?** Ads are on my screen / Something isn't working / An idea or an improvement / Something else (ideas since 2026-10-06,
  "make this window flexible enough to accept enhancement requests": the question under it becomes "What would you like Prism to do?"). With *Ads*, a link offers Veil's own report
  instead: point at the ad on the wall and its structure goes to the ad reports, so Veil can learn to cover it (Prism menu, Veil,
  Report an ad).
- **Where?** The Music player / The Video player / Somewhere else in Prism. The player on now is chosen.
- **Which service?** Prism itself, or one of the services of the player chosen above: the Music player's for music, the Video
  player's for video, every one for elsewhere (2026-10-06, "filter the service list depending on if it is a music or video player item");
  the one on the screen (Video) or playing (Music) chosen.
- **What did you see? What were you doing?** The person's words. Send stays off until there are some.
- **Include the page's address** (on by default when the service has a page open): its origin and path only, never the query or the
  fragment. The inbox strips them again whatever it is sent.
- **Include Prism's recent log** (off by default): about the last 24 KB of host.log, each line passed through the redactor again
  (passwords, tokens and keys are never written to it).
- **What is sent** shows the exact report before Send. Underneath: it goes to Entangled's report inbox, which keeps no name, account,
  IP address or device id.

What a report carries: kind, player, service, its adapter and the adapter's version, Prism's version and update track, the Windows
edition and build (Windows 11 named as such; it reports itself as 10.0), the WebView2 runtime version, the words, and the two optional parts. Core gathers the context (`reportContext`); the
host draws the form and sends.

## The queue online

`POST https://reports.entangled.world/v1/app-report` (kinds ad, bug, idea, other) (the `prism-reports` app, `prototypes/prism-veil-reports/server.mjs`): the
shape whitelisted, strings capped (words 2,000, log 30,000), no IP stored, the same per-client rate limit as the ad reports. Each
report is filed **open** in the private bucket at `app-reports/open/<yyyy>/<mm>/<dd>/<kind>/<service>/<uuid>.json`.

`python scripts/reports/app-reports.py` works the queue: lists the open reports newest first (kind, player, service, first line),
`show <n>` prints one with its log, `done <n>...` closes them (moved to `app-reports/done/`, never deleted), `pull` copies the open
ones into `scripts/reports/inbox/` (git-ignored).

A report that cannot be sent (offline, the inbox down) waits in the data folder's `outbox/` and goes a minute after the next start or
within half an hour, oldest first. Nothing else is ever sent: no report is made without the person pressing Send.

## Not built

- The phone companion has no flag yet.
- A screenshot: a service's video is DRM and draws black in any capture; the page address and the log say more.
