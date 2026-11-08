# Imagery packs (`prism.imagery-pack/v0.1`)

The pictures a Prism shows instead of an ad break (dashboard-schema §26) and in
place of a display-ad slot (§27). Two ship:

| Pack | `source` id | What |
|---|---|---|
| [`gallery`](gallery/) | `pack:gallery` | Public-domain paintings from open museum collections — the Hudson River School / luminist register: Bierstadt, Church, Cole, Inness, Moran, Gifford, Kensett, Heade. |
| [`cosmos`](cosmos/) | `pack:cosmos` | Public-domain deep-space and Earth imagery from NASA's image library. |

Format and rules: `docs/concept-scenes.md` §3 (normative). Types and the
validator: `packages/core/src/imagery-pack.ts`.

## What is tracked and what is not

```
packs/<id>/pack.json      TRACKED   the manifest - the provenance record a device reads
packs/<id>/LICENSES.md    TRACKED   the human-readable roll-up: every image, creator, licence, source link
packs/<id>/bundled.txt    TRACKED   the subset copied into the host at build (edit by hand)
packs/<id>/*.jpg          IGNORED   the bytes - maintainer-fetched, never committed
```

A fresh clone therefore has the whole provenance record and none of the
pictures, which is exactly the posture `prototypes/prism-veil-art` keeps for
the Veil pool. The gate is green on that clone: absent bytes are reported, not
failed.

## Refresh

```
node scripts/fetch-pack.mjs gallery     # or cosmos, or all
node scripts/verify-imagery-packs.mjs   # 0 PASS · 1 FAIL · 2 NOT-YET
```

The fetcher runs at **maintainer time only** — a frame never fetches imagery
(§26 "fetched never", §27 "never fetched from the web at render time"). It is
polite (~1 request/second), sends no identifiers and no API key, and it never
invents metadata: an object whose title, rights statement or image it cannot
read is skipped with a line on stdout. A smaller pack is always better than a
fabricated attribution.

If a re-run drops an image, its bytes stay on disk as an orphan; the fetcher
names them and the gate fails until they are deleted. That is the rule doing
its job: **unlabelled imagery never ships** (§5).

## The card corner (§26)

The intermission card renders the current image's title (with its creator),
credit and licence name, and the object page stays reachable. In minimal mode
the line collapses to the credit alone — collapsed, never hidden. Every word of
it comes from the local `pack.json`; nothing about an image is ever looked up
over the network (§19/§22).
