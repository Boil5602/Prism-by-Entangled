# prism-veil-reports

The receiver for ad reports from the Veil extension's **⚑ Report ad** tool and the Windows app's
report. `POST /v1/report` with the report JSON → stored as one object in the **private** Tigris
bucket `prism-veil-reports` under `reports/YYYY/MM/DD/<site>/<uuid>.json`. Pick them up with
`python ../prism-veil-art/pull-reports.py` (add `--purge` to delete them from the bucket after
downloading; creds in `~/.prism/reports.env`).

- **Endpoint:** `https://reports.entangled.world/v1/report` (a Fly certificate on the app; the
  Cloudflare A/AAAA records are DNS only, not proxied). `https://prism-reports.fly.dev/v1/report`
  is the same app, kept for copies of the extension installed before 0.7.181.
- **Fly app** `prism-reports` (org entangled-world, region iad): one always-on `shared-cpu-1x`
  256 MB machine (`auto_stop_machines = "off"`, so a report never waits on a cold start). The
  bucket is attached to it, so the S3 creds are app secrets.
  Deploy: `flyctl deploy --remote-only --ha=false` from here.
- **What is kept:** only the whitelisted fields (see `cleanReport` in `server.mjs`); unknown keys
  are dropped, strings truncated. What the apps send by default: the site's domain, the ad
  element's details, the kind of ad (`video`, `display`, `sponsored`, `popup`, `other`), the note,
  and the version. The full page address and the embedded players' addresses come only when the
  person ticks "Include the full page address".
- **Privacy (spec section 19/22):** sending is a per-report choice ("Send to Prism"), and the apps
  list exactly what will be sent first. No access log, no IP stored (an in-memory rate limit keyed
  by a salted hash that changes on every restart), no cookies.
- **Cross-origin:** CORS is answered for the extension's own origin (`chrome-extension://`,
  `moz-extension://`) and for `https://entangled.world` / `https://www.entangled.world` (a report
  form later). The Windows app sends no Origin. Other web pages get no CORS answer.
- **Abuse limits:** 48 KB body, 6 reports a minute per client (burst 20).
- **Curation page** (`/curate`, the art-pool gallery): **off** unless the `CURATE_ENABLED=1` secret
  is set. Turn it on for a session with `fly secrets set CURATE_ENABLED=1 -a prism-reports`, and
  off again with `fly secrets unset CURATE_ENABLED -a prism-reports`. Its data also needs the
  `CURATE_KEY` secret, sent as the `x-curate-key` header.
- **Cost:** about $2 a month for the machine; the bucket is a few MB.
