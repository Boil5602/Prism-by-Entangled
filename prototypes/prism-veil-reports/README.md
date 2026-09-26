# prism-veil-reports

The receiver for the extension's **⚑ Report ad** tool. `POST /v1/report` with the
report JSON → stored as one object in the **private** Tigris bucket
`prism-veil-reports` under `reports/YYYY/MM/DD/<site>/<uuid>.json`. Pick them up
with `python ../prism-veil-art/pull-reports.py` (creds in `~/.prism/reports.env`).

- fly.io app `prism-reports` (org entangled-world, iad), scales to zero; the
  bucket is attached to it so the S3 creds are app secrets.
  Deploy: `flyctl deploy --remote-only --ha=false` from here.
- Endpoint: `https://prism-reports.fly.dev/v1/report` (no custom domain needed;
  it is not user-facing).
- Privacy (spec section 19/22): sending is a per-report user choice in the
  extension ("Send to Prism" on the capture toast); the report is shown before
  it is sent. No access log, no IP stored (in-memory rate limit only, salted per
  boot), no cookies, unknown keys stripped server-side, strings truncated.
- Abuse limits: 48 KB body, 6 reports/min per client (burst 20).
