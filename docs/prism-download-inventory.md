# Prism download inventory

What this site can do for the Windows download and the update manifest, as of October 5, 2026. Facts come from the repo, the Cloudflare account, and Cloudflare's Pages docs. Nothing in this document is a change; it is a map.

## 1. Hosting and deploy

- **Host:** Cloudflare Pages, project `entangled-world` (account `f1b0f49f74f1e0540536c76f78674e9a`). Custom domains `entangled.world` and `www.entangled.world` (www redirects to the apex by a zone Redirect Rule). The Pages hostname is `entangled-world.pages.dev`.
- **Framework:** Astro 7, `output: 'static'`. Every page is prerendered to HTML at build time. There are no Pages Functions, no Workers, and no server-rendered routes. `build.format: 'file'`, so `/support` is served from `support.html` and `/prism` from `prism.html`.
- **How a deploy happens:** manual, from this machine. The Pages project is direct upload with no git integration, so pushing to `main` does nothing by itself. `npm run deploy` runs `astro build`, the placeholder and punctuation check, then `wrangler pages deploy dist --project-name entangled-world`. Production is the `main` branch of the Pages project; `--branch preview` publishes to `preview.entangled-world.pages.dev` without touching production. Wrangler 4 is logged in on this machine by OAuth as the account owner; there is no API token in the repo.
- **Time to live:** the build takes about one second and the upload a few seconds, since Wrangler only sends changed files. In this session every production deploy was serving on entangled.world within about ten seconds of "Deployment complete". Cloudflare does not edge-cache the HTML (`cf-cache-status: DYNAMIC`), so there is no purge step.
- **Optional check:** `npm run check` opens every page in Chromium against a local `wrangler pages dev` and takes about two minutes. It is not part of `npm run deploy`.

## 2. Static files

- **Fixed-path files:** yes. Anything under `public/` is copied verbatim into `dist/` at build time and served at the same path, so `public/prism/updates/manifest.json` becomes `https://entangled.world/prism/updates/manifest.json`. Pages sets the content type from the extension (`application/json` for `.json`, `application/zip` for `.zip`). Existing examples: `public/_headers`, `public/robots.txt`, `public/fonts/*.woff2`.
- **Size limits on Pages:** 25 MiB per file, 20,000 files per site on the Free plan (the site has about 70). A Windows installer zip over 25 MiB cannot be served from Pages at all.
- **Sensible size for this repo:** the repo is for source and small assets. The whole built site is under 1 MB; the largest files in it are the Prism logo PNG (318 KB) and the Entangled logo JPEG (210 KB). Keep anything added here under about 1 MB. A release zip belongs elsewhere (next point), with only its URL and checksum in the repo. The repo is private on GitHub, and large binaries would bloat every clone.
- **Bucket or CDN:** none that this repo can use. `prism.entangled.world` is a Tigris bucket (DNS-only CNAME to `prism.entangled.world.t3.tigrisbucket.io`) that serves the extension's veil art under `/veil/art/`. The upload tooling and the credentials live in the Prism repo and on this machine (`prototypes/prism-veil-art/upload-pool.py`, `~/.prism/tigris.env`), not here. This repo has no bucket credentials, no S3 or Fly tooling, and no scripts that touch that bucket. The decision on record is that nothing in this repo touches `prism.entangled.world`.
- **Where a zip could live:** the public Prism repo's GitHub Releases (free, versioned, has its own checksums and download counts; the Download page already expects a GitHub release URL), or the Tigris bucket under a new prefix, uploaded from the Prism repo's tooling. Either way the site links to it; it does not host it.

## 3. The existing Prism pages

- **`/prism`:** `src/pages/prism.astro`. Written as an Astro component: HTML with a few shared components (`Demo.astro`, `PromisesStrip.astro`, `PrismWordmark.astro`) and values from `src/site.config.ts`. No CMS, no Markdown on this page. The hero already has the "Windows app coming soon" dashed pill and the Chrome, Edge, and Firefox "soon" pills, with "Watch the GitHub repo for the first release" under them. A **Download for Windows** button would replace the dashed pill in that row, and a **version line** fits where the "Watch the GitHub repo" sentence is. The three "ways to run Prism" lines further down each carry a "Coming soon" tag that would change too.
- **`/prism/download`:** `src/pages/prism/download.astro`. This is the page built for the download. It reads `src/data/releases.json` at build time. While `windows` is `null` it shows a "Coming soon" pill and hides the version, date, size, and SHA-256 rows. When `windows` is an object it shows those rows, a solid **Download for Windows** button pointing at `downloadUrl`, and links to the release notes and the GitHub release. Same for the `box` key. The hero sentence also switches from "Coming soon" to "Check the SHA-256 before you install".
- **Content types used across the section:** Astro components for layout and copy; Markdown for the FAQ, changelog, and roadmap (`src/content/*.md`); JSON for releases and adapters (`src/data/*.json`); one TypeScript config for switches and links.

## 4. Redirects

- **Same-host redirects:** yes, in a `public/_redirects` file, which is copied to `dist/_redirects` and read by Pages. The source must be a path on this site; the destination may be a path or an absolute URL on another domain, with a status code. Example:

  ```
  /prism/download/windows  https://github.com/Boil5602/Prism-by-Entangled/releases/download/v1.0.0/Prism-Setup-1.0.0.zip  302
  ```

  Use 302, not 301, so the target can move with each release without browsers caching the old one. Limits: 2,000 static and 100 dynamic rules. The file does not exist today; it was removed when the www redirect turned out to need a zone rule instead (Pages rejects cross-host sources). Changing a redirect means a deploy.
- **Not possible here:** redirects whose source is a different hostname; those are zone Redirect Rules in the dashboard.

## 5. Build-time and request-time data

- **Build time, already in use:** Astro imports JSON as a module. `download.astro` does `import releases from '../../data/releases.json'` and renders from it. Any JSON file in the repo can be imported the same way, including one under `public/` by relative path (`import manifest from '../../../public/prism/updates/manifest.json'`), so a single manifest can both be served to the app and drive the page. The page updates when the site is rebuilt and deployed, which is the normal release step anyway.
- **Request time:** not available as the site stands. Static output has no server. The two ways to get it would be a Pages Function at a route (not used anywhere yet; it would also sit outside the `_headers` file) or a client-side fetch from the page's own JavaScript. The site's Content Security Policy allows same-origin fetches (`connect-src 'self'`), but the site keeps JavaScript to the demo and the two wordmarks on purpose, so a fetch-on-view version line would be a deliberate exception.
- **Recommendation implied by the above:** keep the manifest as the source of truth, import it at build time, and redeploy on each release.

## 6. Headers and CORS

- **Per-path headers:** yes, in `public/_headers`. Patterns take splats and placeholders. The file today sets the security headers and the Content Security Policy on `/*`, and `Cache-Control: public, max-age=31536000, immutable` on `/fonts/*` and `/_astro/*`. A manifest stanza would look like:

  ```
  /prism/updates/*
    Cache-Control: public, max-age=300
    Access-Control-Allow-Origin: *
  ```

  Limits: 100 rules, 2,000 characters per line. Headers from this file apply to static assets only, which is everything on this site.
- **CORS:** needed only if the manifest is fetched from a browser-like context on another origin (a WebView page). A plain HTTP client in the app does not need it. `Access-Control-Allow-Origin: *` is harmless on a public JSON file either way.
- **The CSP on `/*`** also lands on the JSON response. It does nothing to a JSON body, but if that bothers anyone, a later `/prism/updates/*` stanza can set a different `Content-Security-Policy` value, since a later matching rule overrides the earlier one for that header.
- **Identifying headers:** Pages adds its own `cf-ray` and similar response headers; nothing in this repo adds a cookie, and no request header is required. The site serves the same bytes to everyone.

## 7. What already exists about downloads, releases, and versions

- `src/data/releases.json`: the release record for the Download page. Keys `windows` and `box`, each `null` today. The documented shape (an `_example` key in the file) is `version`, `date` (YYYY-MM-DD), `sizeMb`, `sha256`, `downloadUrl`, `releaseUrl`, `releaseNotesUrl`. The page renders the date as "December 1, 2026".
- `src/pages/prism/download.astro`: the page that consumes it (section 3).
- `src/pages/prism.astro`: the hero pills and the "Three ways to run Prism" lines, all hard-coded "coming soon" today, not yet wired to `releases.json`.
- `src/content/changelog.md`: empty apart from a comment showing the entry format. `/prism/changelog` shows "No releases yet" while it stays empty.
- `src/site.config.ts`: `github.repo` and `github.releases` (the releases listing URL), `stores.chrome/edge/firefox` (empty, so the Extensions page shows "soon"), `reportHost` (`reports.entangled.world`), and the placeholders `minSpec` and `testedMiniPcs` for the Download page's "Needs" rows.
- `docs/PLACEHOLDERS.md`: lists the release fields and the two hardware lines as things to fill in.
- `scripts/check-placeholders.mjs` (runs inside `npm run build`): fails the build on bracket placeholders, on any `<script>`, `<link>`, `<img>`, or similar that loads from another domain, on inline scripts or styles, and on uncommon punctuation. A plain `<a href>` to a GitHub or bucket URL passes. `scripts/check-site.mjs` (`npm run check`) also fails if a page makes any network request to another domain, which a download link does not trigger.
- Environment variables: none. The repo has no `.env`, and no page reads `import.meta.env`. The only credential involved is Wrangler's OAuth login on this machine.
- Versions elsewhere: `package.json` is at `0.1.0` and is not shown anywhere. The extension's own version lives in the Prism repo's manifest, not here.
