# Prism Veil art pool

The photos the Veil shows over ads and on the start page. Nature only.

**License rule:** only Wikimedia Commons files whose recorded license is CC0 or
public domain — free for commercial use, no attribution required. `fetch-art.py`
enforces this at fetch time and again at `--regen`; a file with no manifest
entry never ships. Source page, author and license for every photo are in
`pool/manifest.json` (spec §5: every image traceable to a named source).

| Path | What |
|---|---|
| `pool/*.jpg` | full-res photos (77) — **upload this folder verbatim** |
| `pool/manifest.json` | provenance: Commons page, author, license per file |
| `hosted/` | GENERATED, git-ignored: re-encoded pool + `list.json` (sha256 per file) + `list.sig` + `manifest.json` - what gets uploaded |
| `bundle.txt` | the pinned 24 photos that ship inside the extension (edit by hand) |
| `unverified/` | 46 NASA-library images from the early pool with **no per-image provenance**; not hosted, not bundled. Restore one by adding a manifest entry with its source + license. |
| `fetch-art.py` | pulls more Commons photos (polite, 1 req/s) and regenerates everything |
| `sign-list.mjs` | signs `hosted/list.json` with the offline key (`--keygen` once) |
| `upload-pool.py` | syncs `hosted/` to the Tigris bucket |
| `verify-hosted.mjs` | does what the extension does against the live host; run after every upload |
| `fetch-rsp.py` | builds `hosted-cred/list.json` from Wikipedia's Perennial Sources (CC BY-SA): 5 ordinal tiers, domains per entry, RfC year |
| `fetch-cred.py` | builds `hosted-cred/iffy.json` (Iffy Index via MBFC, CC BY 4.0; colour = MBFC factual rating) and `hosted-cred/sb.json` (Steven Black fakenews hosts, MIT; listed = red) |
| `hosted-cred/` | GENERATED, git-ignored: the three source-reliability lists + `.sig` each -> `veil/credibility/` (`list` = RSP, `iffy`, `sb`) |
| `refresh-pool.cmd` | fetch more -> regen -> sign -> upload, one command (weekly is plenty) |

## Hosting (Tigris object storage, no machine)

`hosted/` (the re-encoded pool, 1920px / q82 - about 3x smaller than the
originals) is synced to the public Tigris bucket **`prism.entangled.world`**
under `veil/art/`, so `https://prism.entangled.world/veil/art/list.json` and
`.../<file>.jpg` resolve. Cost: ~$0.02 per GB stored, egress free, served from
Tigris' global edge. The bucket is attached to the fly.io app `prism-entangled`
(org entangled-world) purely as its owner; the app runs **no machines**.

- DNS (Cloudflare, DNS-only): `CNAME prism.entangled.world -> prism.entangled.world.t3.tigrisbucket.io` (registered with `fly storage update <bucket> --custom-domain prism.entangled.world`)
  TLS for the domain is issued by Tigris.
- Credentials: `~/.prism/tigris.env` on the publishing machine (from `fly storage create`;
  never in git). `python upload-pool.py --cors` once to set CORS, then plain
  `python upload-pool.py` (or `refresh-pool.cmd`) to sync.
- Photos are uploaded with `Cache-Control: public, max-age=31536000, immutable`;
  `list.json` / `list.sig` / `manifest.json` with `max-age=300`.
- Nothing about the requester is logged by us; the request carries no
  identifiers and the extension sends no Referer (spec section 19/22).

## Source reliability list

`https://prism.entangled.world/veil/credibility/list.json` (spec section 5,
"Credibility labeling"). Built by `fetch-rsp.py` from Wikipedia's Perennial
Sources table - chosen because it is public (every status links to the RfC that
decided it), community-engineered, and CC BY-SA, so the derived list can be
republished. Ordinal, not numeric: gr / nc / gu / d / b (+ m = mixed), with the
legend colours Wikipedia itself uses. Signed with the same key as the art pool;
the start page verifies it, marks quick links, and links every mark to its
discussion. Off by default, never hides anything, unlisted != unreliable.
Community overrides belong in prism-adapters as labelled data, never blended in.

Two more lists sit beside it (`fetch-cred.py`, same signing key, same
schema: `{v, source, legend, scale, entries[{id,name,status,domains,why}]}`):
`iffy.json` (Iffy Index, CC BY 4.0 - ~2,000 sites MBFC rates low credibility,
colour from MBFC's factual-reporting rating, `why` = the MBFC review) and
`sb.json` (Steven Black fakenews hosts, MIT - a bare domain list: red when
listed, grey otherwise, `why` = the list itself). The extension shows the
three as a stacked three-disk cylinder (RSP / Iffy / SB, top to bottom), each
disk red / yellow / green on its own scale, grey = no information, hollow =
switched off; sources are individually switchable.

## The host is untrusted

The extension treats prism.entangled.world as hostile. `hosted/list.json` lists each
photo with its SHA-256; `list.sig` is an ECDSA P-256 signature over the exact
bytes of `list.json`, made with a private key that lives only at
`~/.prism/veil-art-signing.pem` on the publishing machine (never in git, never on Fly).
The extension ships the public key (`ART_PUBKEY` in `ntp.js`), verifies the
signature, fetches each image with `no-referrer`, checks its hash and shows it
as a blob. Anything that fails verification is dropped and the bundled photos
are used instead. A compromised host, DNS or Fly account therefore cannot put a
single foreign pixel on a start page. Rotating the key = new keypair, paste the
new public JWK into `ntp.js`, re-sign, ship a new extension version.

## Regenerate

```
python fetch-art.py --regen     # hosted/ (re-encode + hashes) + the extension's bundled subset
python fetch-art.py             # fetch more Commons photos up to TARGET_TOTAL, then regen
node sign-list.mjs              # hosted/list.sig - ALWAYS after regen, before upload
python upload-pool.py           # sync to the bucket
node verify-hosted.mjs          # prove the live host verifies
```

The bundle (32 photos, 1200px, ~7 MB → `../prism-veil-extension/art/` and
`src/art.js`) is what ad covers use and the start page's offline fallback.

## Curating new photos (hosted gallery)

`fetch-candidates.py` pulls CC0 / public-domain candidates (Commons Featured,
US agencies via Commons) and `--upload` pushes them to the curation gallery at
**https://prism-reports.fly.dev/curate/** (off unless `fly secrets set CURATE_ENABLED=1 -a prism-reports` - unset it again after; same fly app as the report inbox;
key = the `CURATE_KEY` fly secret, kept in `~/.prism/curate.key`). In the
gallery: **A** approve, **X** reject, **U** undo, arrows move, **Enter** shows
it large; decisions save as you go to the private bucket (`curate/`), so any
browser can continue. Then `python fetch-candidates.py --accept` downloads the
approved originals into `pool/` with manifest entries, and the usual
`fetch-art.py --regen` + `refresh-pool.cmd` publish them. Rejected candidates
never resurface in later pulls.
