Imagery packs for the intermission (spec section 26) and the gallery veil (section 27).

Layout:  packs/<pack>/<image>.jpg|png|webp     e.g. packs/cosmos/m31.jpg
Served:  https://appassets.androidplatform.net/assets/packs/<pack>/<image>   (WebViewAssetLoader — never the web)
Source:  "pack:<pack>" in a tile's intermission/veil config.

Packs are public-domain / openly licensed (NASA image libraries and the like),
attributed per image in packs/<pack>/ATTRIBUTION.txt, and land with the imagery
pipeline. An empty pack degrades to a textured fill — never a broken page.

SUPERSEDED (concept-scenes section 3). The pack format is now
prism.imagery-pack/v0.1: packs/<id>/pack.json carries per-image provenance
(title, creator, credit, licence, source url, sha256) instead of a plain
ATTRIBUTION.txt, node scripts/fetch-pack.mjs <id> builds it, and
node scripts/verify-imagery-packs.mjs gates it. The cosmos/ files here are the
old Android-era pull, kept because this shell is parked (docs/reports); they
are not the shipping pack and are not covered by the gate. Rebuild from
repo-root packs/ when the Android shell is unparked.
