# Prism Photos — Concept (phase two)

*The first landing of ENTANGLED's values inside Prism: own your bytes, share deliberately, read your algorithms.*

## Why photos first

Photo storage is where the extraction model is most visible: libraries mined for ad graphs and model training, storage tiers engineered as pressure, frames charging rent for a folder. It's also where the alternative is cheapest to prove — wholesale object storage exists at ~$5–6/TB/month retail (S3-compatible: Backblaze B2, Cloudflare R2, Hetzner) and self-hosting costs hardware only. The platform take *is* the product gap.

## Principles (inherited, non-negotiable)

1. **Entangled never holds the bytes.** Client-side encryption; sync targets the user's own S3-compatible bucket or NAS. Optional at-cost resale of wholesale storage with the margin published, like the filter-list attributions: "storage costs us $X/TB, you pay $X + stated margin." No tiers, no scarcity dark patterns, no "storage full" upsells.
2. **Deliberate sharing only.** No feed, no public-by-default, no engagement surface. Sharing is an intentional act to named people or circles. Unshared is the default state forever.
3. **Legible algorithms.** Chronological is the default. Any ranking beyond it (highlights, "on this day," clustering) runs client-side, open source, inspectable, and swappable — an algorithm store instead of the algorithm. The sorting of your attention is code you can read and replace.

## Architecture sketch

- **Library client:** PWA + the Prism photos tile. Import from phone camera roll; encrypt (per-user key, per-album shared keys); chunked upload to the configured backend. Local thumbnail index; originals fetched on demand.
- **Backends:** any S3-compatible endpoint · WebDAV/NAS · Entangled at-cost hosted (same client code, different endpoint) · local-only mode for a frame with a big SD card.
- **Sharing:** album-level shared keys wrapped to recipients' keys (recipients are Merge/Prism identities — the pairing infrastructure already exists). Revocation = key rotation forward; already-downloaded copies are honestly outside anyone's control, and the docs say so.
- **The frame as endpoint:** shared albums appear as photo tiles on recipients' frames via the standard slot mechanism (§15). "Send to grandma's kitchen" is the flagship gesture — Skylight's entire subscription feature as a free consequence of the architecture.
- **Client-side intelligence:** face/scene clustering and highlights via on-device models only (never server-side, never on unencrypted bytes off-device). Every model and ranking function versioned in the open repo.

## The hard problem, named

Key management for non-technical families is the real engineering risk — not storage, not sync. Losing keys must not mean losing a life's photos, and recovery must not become a backdoor. Design space: family-circle social recovery (k-of-n among trusted members), printed recovery codes in the physical build tradition, optional escrow the user explicitly chooses with the tradeoff stated. This decides the product's viability and deserves its own design cycle before any code.

## Business model

Same shape as everything else: client and protocol open source; self-host free forever; hosted convenience at published cost-plus; no subscription for software, only pass-through for bytes actually stored. Shutdown promise inherits Merge's: notice period, export always (originals are just encrypted files in *your* bucket — export is `rclone`), server open-sourced if hosting ever ends.

## The storage pool (cooperative economics)

Individuals can't reach wholesale's best tier — committed-volume rates below list price open only at aggregate scale. The hosted option is therefore structured as a **buying pool**: members' encrypted bytes are aggregated under negotiated committed-volume contracts, and the price advantage created by pooling flows back to members. The management fee is compensation for labor, not a platform take.

**Mechanics:**

- **Ciphertext only.** The pool holds encrypted blobs it cannot read — aggregation is compatible with "Entangled never holds the bytes" because what's held is a vault of locked boxes. (Legal posture for encrypted-intermediary status — abuse policy, DMCA — gets counsel review before launch; Proton/Tarsnap are precedent.)
- **Open books, itemized bills.** Every invoice shows the actual pooled wholesale rate and the management fee as separate lines: e.g. "Storage: $X.XX/TB (pooled rate, contract published) + Management: $Y/month." The fee is priced as labor (sync infrastructure, support, provider management), stated as such, and changes only in public.
- **The rate is a formula, not a price.** Members are billed from a published formula, recomputed each billing cycle:

```
member rate ($/TB/mo) = provider cost + DR overhead + capex amortization
                        (each itemized)          + management fee (flat, separate)
```

- **Reductions pass through automatically.** When a provider cuts rates or the pool crosses a cheaper committed tier, the formula's provider term drops and every member's next bill drops with it — no announcement required, no discretion involved. The formula updating *is* the announcement.
- **Increases only through named cost categories.** The rate can rise only when a real, itemized storage cost enters the formula — e.g., adding disaster-recovery replication (a second provider/region for the pool's ciphertext) adds a DR line at its actual cost. New categories are proposed with their numbers, adopted by member vote, and appear as their own line on every bill thereafter.
- **Storage-related capex is amortized in the open.** A one-time hardware or infrastructure purchase (only if directly storage-related — cache nodes, transfer appliances) enters the formula as straight-line amortization over its stated useful life, with the invoice and schedule published. When the term expires, it leaves the formula and the rate drops. Nothing amortizes forever.
- **Scope fence:** general Entangled costs (development, other products, marketing) can never enter the storage formula. The only non-formula component is the management fee, which is flat, labor-priced, and changes only by the governance process above.
- **Auditability:** the formula, current inputs, provider contracts, and capex schedules live in the open books; any member can recompute their own bill from published inputs.

**Member governance with teeth.** Members vote on: provider selection and migration, disposition of surplus when the pool crosses a cheaper committed tier (rate cut vs. development fund), and fee changes. Migration votes are credible because the client speaks S3-generic — a vote to move providers is executable, not theater.
- **Exit is always unilateral.** Any member points their client at their own bucket and leaves the pool instantly, ciphertext in hand. A cooperative people can freely leave is the only kind whose membership means anything.
- **Entity structure, decided deliberately:** launch as governance-shaped (Entangled operating with open books and binding member votes); charter a formal cooperative that owns the storage contracts if the pool grows large — at which point the pool's assets survive Entangled itself, the ultimate extension of the shutdown promise.

## iOS sync path

A PWA cannot read the iPhone photo library (no PhotoKit on the web, no share-sheet registration), so iOS photo flows are staged:

**Now (ships with Prism v1): iCloud Shared Albums.** Shared Albums have public web URLs; a photos tile pointed at one (standard §15 slot) renders the family's album, and everyone adds photos through the native Photos app they already use. Apple carries the sync; Prism just displays. This covers the core frame use case with zero new code and zero native surface.

**Noted for later (not committed):**
- *Share extension:* a minimal free iOS companion app adding "Send to Prism" to the share sheet — per-photo deliberate push, encrypted to the family backend. Small native surface, fits the deliberate-sharing philosophy exactly; free app, sells nothing (stays inside the safe App Store pattern).
- *Full library sync:* the companion grown up — PhotoKit + change tracking + client-side encryption. iOS's background execution limits mean honest UX is "syncs when opened, background catch-up when allowed"; Android's companion can do true background sync. The asymmetry gets documented, not hidden.

## Phasing

1. **Now (Prism v1):** photos tile reads existing sources (folder, shared album URL slot). Nothing new built.
2. **Phase two:** library client + BYO-bucket sync + album sharing to frames.
3. **Phase three:** algorithm store, on-device clustering, and the storage pool (cooperative at-cost hosting with member governance).
4. **Beyond:** this layer is the bridge — Prism frames as the first ENTANGLED terminals in people's homes. The multiverse arrives to a device already on the kitchen wall, already trusted, already speaking its values.
