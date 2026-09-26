#!/usr/bin/env node
/**
 * Fetch an imagery pack (docs/concept-scenes.md §3, dashboard-schema §26/§27).
 *
 *   node scripts/fetch-pack.mjs gallery [--count=12] [--out=packs]
 *   node scripts/fetch-pack.mjs cosmos  [--count=12]
 *   node scripts/fetch-pack.mjs all
 *
 * MAINTAINER TIME ONLY. A frame never fetches imagery — it serves the bundled
 * files from disk (§26 "fetched never", §27 "never fetched from the web at
 * render time"). This script is how the bytes get into `packs/<id>/` in the
 * first place; the manifest it writes is the provenance record the device
 * reads, and `scripts/verify-imagery-packs.mjs` gates it.
 *
 * Sources, both open-access APIs that publish per-object rights:
 *
 * - **gallery** — Art Institute of Chicago (api.artic.edu; CC0 metadata,
 *   public-domain images). Only `is_public_domain: true` paintings, in the
 *   Hudson River School / luminist register the charter names, landscape
 *   orientation so they read at wall scale. The Met (collectionapi.metmuseum.org,
 *   `isPublicDomain`) tops the pack up when AIC is short.
 * - **cosmos** — NASA Image and Video Library (images-api.nasa.gov), public
 *   domain, skipping anything carrying a third-party credit.
 *
 * Manners and privacy: ~1 request/second, no API key (neither API needs one,
 * and none is ever committed), no identifiers in any request (§19/§22) — the
 * only headers sent are a project User-Agent, plus the `AIC-User-Agent` the
 * Art Institute asks IIIF clients for. Both name the PROJECT, never a person:
 * no email, no machine, nothing that outlives this script.
 *
 * NEVER fabricates metadata. An object missing a title, a rights statement or
 * an image is skipped with a line on stdout; an invented attribution is worse
 * than a smaller pack.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const target = args.find((a) => !a.startsWith("--")) ?? "";
const COUNT = Number(opt("count", "12"));
const OUT = join(root, opt("out", "packs"));

const UA = "PrismImageryPackFetcher/0.1 (+https://github.com/entangled/prism; maintainer tooling, no identifiers)";
// The Art Institute asks IIIF clients to identify the project in this header
// (their docs: "AIC-User-Agent: <app> (<contact>)"); without it the image
// endpoint answers 403. The project, never a person — no email, no key, no
// identifier that survives into anything a device ever sends (§19/§22).
const AIC_HEADERS = { "AIC-User-Agent": "PrismImageryPackFetcher/0.1 (+https://github.com/entangled/prism)" };
const PD = { id: "public-domain", name: "Public domain", url: "https://creativecommons.org/publicdomain/mark/1.0/" };
const CC0 = { id: "public-domain", name: "Public domain (CC0 1.0)", url: "https://creativecommons.org/publicdomain/zero/1.0/" };

let lastRequest = 0;
/** Polite: ~1 request/second, no cookies, no identifiers. */
async function polite(url, { json = true, headers = {} } = {}) {
  const wait = 1000 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "*/*", ...headers }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return json ? res.json() : Buffer.from(await res.arrayBuffer());
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Wall scale: a 1080-class canvas full-bleed. Anything smaller is a thumbnail. */
const MIN_W = 1280;
const MIN_H = 720;

/** JPEG/PNG dimensions from the bytes we actually downloaded — never guessed. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

// --------------------------------------------------------------- gallery

// The register the charter names: Hudson River School / luminist landscape.
/**
 * Met object ids the SEARCH endpoint does not surface for an artist it plainly
 * holds (found by CS-10.4, 2026-09-03): searching "Albert Bierstadt" - with or
 * without artistOrCulture, with or without isPublicDomain - returns 0 objects,
 * while a direct lookup of 10154 returns "The Rocky Mountains, Lander's Peak",
 * public domain with a primary image. AIC has only two Bierstadt records and
 * its one public-domain painting is portrait (1832x2250), so it cannot pass the
 * landscape filter below. Without this the pack ships no Bierstadt at all,
 * which is what happened in CS-2. Each id is still fetched through the SAME
 * checks as a searched one - nothing here bypasses isPublicDomain, the artist
 * match, the aspect or the size floor.
 */
const MET_DIRECT_IDS = {
  "Albert Bierstadt": [10154],
};

const GALLERY_ARTISTS = [
  "Albert Bierstadt", "Frederic Edwin Church", "Thomas Cole", "J. M. W. Turner",
  "George Inness", "Thomas Moran", "Sanford Robinson Gifford", "John Frederick Kensett",
  "Martin Johnson Heade", "Asher Brown Durand", "Jasper Francis Cropsey", "Worthington Whittredge",
];

async function fetchGallery(count) {
  const images = [];
  const seen = new Set();
  const fields = "id,title,artist_title,date_display,is_public_domain,image_id,credit_line,artwork_type_title,thumbnail";

  console.log("gallery · Art Institute of Chicago (api.artic.edu) — is_public_domain paintings only");
  for (const artist of GALLERY_ARTISTS) {
    if (images.length >= count) break;
    let data;
    try {
      const q = new URLSearchParams({ q: artist, limit: "25", fields });
      data = await polite(`https://api.artic.edu/api/v1/artworks/search?${q}`, { headers: AIC_HEADERS });
    } catch (e) {
      console.log(`  skip search ${artist}: ${e.message}`);
      continue;
    }
    const iiif = data?.config?.iiif_url ?? "https://www.artic.edu/iiif/2";
    for (const a of data?.data ?? []) {
      if (images.length >= count) break;
      // Every one of these is a reason the object cannot be attributed or shipped.
      if (a.is_public_domain !== true) continue;
      if (!a.image_id || !a.title || !a.artist_title) continue;
      if (a.artist_title !== artist) continue;                       // "Charles Bierstadt" is not Albert
      if (a.artwork_type_title !== "Painting") continue;
      const th = a.thumbnail ?? {};
      if (!(th.width > 0 && th.height > 0)) continue;
      if (th.width / th.height < 1.15) continue;                     // landscape: it hangs on a wall
      if (seen.has(a.id)) continue;
      seen.add(a.id);

      const url = `${iiif}/${a.image_id}/full/1686,/0/default.jpg`;
      let bytes;
      try { bytes = await polite(url, { json: false, headers: AIC_HEADERS }); } catch (e) { console.log(`  skip aic-${a.id}: ${e.message}`); continue; }
      const size = imageSize(bytes);
      if (size && (size.w < MIN_W || size.h < MIN_H)) { console.log(`  skip aic-${a.id}: ${size.w}x${size.h} is below wall scale`); continue; }
      const date = a.date_display ? String(a.date_display) : undefined;
      const sourceUrl = `https://www.artic.edu/artworks/${a.id}`;
      images.push({
        file: `aic-${a.id}.jpg`,
        title: String(a.title),
        creator: String(a.artist_title),
        ...(date && date !== "n.d." ? { date } : {}),
        credit: "Art Institute of Chicago, Public Domain",
        ...(a.credit_line ? { creditLine: String(a.credit_line) } : {}),
        license: CC0,
        attribution: `${a.artist_title}, ${a.title}${date && date !== "n.d." ? ` (${date})` : ""} — Art Institute of Chicago, public domain`,
        sourceUrl,
        sha256: sha256(bytes),
        ...(size ? { w: size.w, h: size.h } : {}),
        _bytes: bytes,
      });
      console.log(`  aic-${a.id}  ${(bytes.length / 1024).toFixed(0)} KB  ${size ? size.w + "x" + size.h : "?"}  ${a.artist_title} — ${a.title}`);
      break;                                                          // one per artist per pass, so the pack has range
    }
  }

  if (images.length < count) {
    console.log("gallery · topping up from the Met Open Access (collectionapi.metmuseum.org) — isPublicDomain only");
    for (const artist of GALLERY_ARTISTS) {
      if (images.length >= count) break;
      let search;
      try {
        const q = new URLSearchParams({ q: artist, hasImages: "true", medium: "Paintings" });
        search = await polite(`https://collectionapi.metmuseum.org/public/collection/v1/search?${q}`);
      } catch (e) { console.log(`  skip met search ${artist}: ${e.message}`); continue; }
      const candidates = [...(MET_DIRECT_IDS[artist] ?? []), ...(search?.objectIDs ?? []).slice(0, 8)];
      for (const objectId of candidates) {
        if (images.length >= count) break;
        let o;
        try { o = await polite(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`); } catch { continue; }
        if (o?.isPublicDomain !== true) continue;
        if (!o.primaryImage || !o.title || !o.artistDisplayName) continue;
        if (o.artistDisplayName !== artist) continue;
        if (seen.has("met-" + objectId)) continue;
        seen.add("met-" + objectId);
        let bytes;
        try { bytes = await polite(o.primaryImage, { json: false }); } catch (e) { console.log(`  skip met-${objectId}: ${e.message}`); continue; }
        const size = imageSize(bytes);
        if (size && size.w / size.h < 1.15) continue;
        const date = o.objectDate ? String(o.objectDate) : undefined;
        images.push({
          file: `met-${objectId}.jpg`,
          title: String(o.title),
          creator: String(o.artistDisplayName),
          ...(date ? { date } : {}),
          credit: "The Metropolitan Museum of Art, Open Access (CC0 1.0)",
          ...(o.creditLine ? { creditLine: String(o.creditLine) } : {}),
          license: CC0,
          attribution: `${o.artistDisplayName}, ${o.title}${date ? ` (${date})` : ""} — The Metropolitan Museum of Art, CC0 1.0`,
          sourceUrl: o.objectURL || `https://www.metmuseum.org/art/collection/search/${objectId}`,
          sha256: sha256(bytes),
          ...(size ? { w: size.w, h: size.h } : {}),
          _bytes: bytes,
        });
        console.log(`  met-${objectId}  ${(bytes.length / 1024).toFixed(0)} KB  ${size ? size.w + "x" + size.h : "?"}  ${o.artistDisplayName} — ${o.title}`);
        break;
      }
    }
  }

  return {
    schema: "prism.imagery-pack/v0.1",
    id: "gallery",
    name: "Gallery",
    blurb: "Public-domain paintings from open museum collections.",
    source: { name: "Art Institute of Chicago — Open Access", url: "https://api.artic.edu/" },
    requiresCreator: true,
    images,
  };
}

// ---------------------------------------------------------------- cosmos

const COSMOS_QUERIES = [
  "nebula", "galaxy", "aurora from space", "earth limb", "saturn rings", "star cluster",
  "hubble deep field", "jupiter cloud", "solar eclipse", "milky way", "supernova remnant", "mars surface",
];

async function fetchCosmos(count) {
  const images = [];
  const seen = new Set();
  console.log("cosmos · NASA Image and Video Library (images-api.nasa.gov) — public domain, third-party credits skipped");

  for (const q of COSMOS_QUERIES) {
    if (images.length >= count) break;
    let data;
    try { data = await polite(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`); }
    catch (e) { console.log(`  skip search '${q}': ${e.message}`); continue; }
    for (const item of data?.collection?.items ?? []) {
      if (images.length >= count) break;
      const meta = item?.data?.[0];
      if (!meta || !item.href || !meta.nasa_id || !meta.title) continue;
      if (seen.has(meta.nasa_id)) continue;
      const credit = String(meta.secondary_creator ?? meta.center ?? "NASA").trim();
      // A third-party credit means it is not NASA's to place in the public domain.
      if (/getty|shutterstock|copyright|©|\(c\)|all rights reserved/i.test(credit)) continue;
      if (/getty|shutterstock|copyright|©|all rights reserved/i.test(String(meta.description ?? ""))) continue;

      let assets;
      try { assets = await polite(item.href); } catch { continue; }
      const orig = assets.find((u) => /~orig\.(jpg|png)$/i.test(u));
      const large = assets.find((u) => /~large\.jpg$/i.test(u)) ?? assets.find((u) => /~medium\.jpg$/i.test(u));
      const pick = large ?? orig;
      if (!pick) continue;
      seen.add(meta.nasa_id);

      let bytes;
      try { bytes = await polite(pick.replace(/^http:/, "https:"), { json: false }); } catch (e) { console.log(`  skip ${meta.nasa_id}: ${e.message}`); continue; }
      const size = imageSize(bytes);
      if (size && size.w / size.h < 1.15) { console.log(`  skip ${meta.nasa_id}: portrait`); continue; }
      if (size && (size.w < MIN_W || size.h < MIN_H)) { console.log(`  skip ${meta.nasa_id}: ${size.w}x${size.h} is below wall scale`); continue; }
      const id = String(meta.nasa_id).replace(/[^A-Za-z0-9_-]+/g, "_");
      const date = meta.date_created ? String(meta.date_created).slice(0, 10) : undefined;
      const creator = meta.photographer ? String(meta.photographer) : undefined;
      images.push({
        file: `nasa-${id}.jpg`,
        title: String(meta.title),
        ...(creator ? { creator } : {}),
        ...(date ? { date } : {}),
        credit: `${credit}, NASA — Public domain`,
        license: PD,
        attribution: `${meta.title} — ${credit}, NASA (NASA ID ${meta.nasa_id}), public domain`,
        sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`,
        sha256: sha256(bytes),
        ...(size ? { w: size.w, h: size.h } : {}),
        _bytes: bytes,
      });
      console.log(`  nasa-${id}  ${(bytes.length / 1024).toFixed(0)} KB  ${size ? size.w + "x" + size.h : "?"}  ${meta.title}`);
      break;                                                          // one per query, so the pack has range
    }
  }

  return {
    schema: "prism.imagery-pack/v0.1",
    id: "cosmos",
    name: "Cosmos",
    blurb: "Public-domain deep-space and Earth imagery from NASA's image library.",
    source: { name: "NASA Image and Video Library", url: "https://images.nasa.gov/" },
    images,
  };
}

// ----------------------------------------------------------------- write

function licensesMd(pack) {
  const l = [];
  l.push(`# ${pack.name} — licences and attribution`);
  l.push("");
  l.push(`\`pack:${pack.id}\` · ${pack.blurb}`);
  l.push("");
  l.push(`Source collection: [${pack.source.name}](${pack.source.url})`);
  l.push("");
  l.push("Every image below is traceable to a named source (dashboard-schema §5),");
  l.push("and its licence is one of `public-domain` / `cc0` / `cc-by` / `cc-by-sa`");
  l.push("(docs/concept-scenes.md §3.1). Generated by `node scripts/fetch-pack.mjs " + pack.id + "` —");
  l.push("edit the fetcher, never this file. Image bytes are git-ignored; this");
  l.push("manifest roll-up and `pack.json` are the tracked provenance record.");
  l.push("");
  l.push("| File | Title | Creator | Date | Credit | Licence | Source |");
  l.push("|---|---|---|---|---|---|---|");
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  for (const i of pack.images) {
    l.push(`| \`${cell(i.file)}\` | ${cell(i.title)} | ${cell(i.creator ?? "—")} | ${cell(i.date ?? "—")} | ${cell(i.credit)} | [${cell(i.license.name)}](${i.license.url}) | [object page](${i.sourceUrl}) |`);
  }
  l.push("");
  l.push("## Attribution lines (what the §26 card shows)");
  l.push("");
  for (const i of pack.images) l.push(`- \`${i.file}\` — ${cell(i.attribution)}`);
  l.push("");
  if (pack.images.some((i) => i.creditLine)) {
    l.push("## The institutions' own credit lines");
    l.push("");
    for (const i of pack.images) if (i.creditLine) l.push(`- \`${i.file}\` — ${cell(i.creditLine)}`);
    l.push("");
  }
  return l.join("\n");
}

function writePack(pack) {
  const dir = join(OUT, pack.id);
  mkdirSync(dir, { recursive: true });
  const bytesByFile = new Map();
  const manifest = { ...pack, images: pack.images.map(({ _bytes, ...rest }) => { if (_bytes) bytesByFile.set(rest.file, _bytes); return rest; }) };

  for (const [file, bytes] of bytesByFile) writeFileSync(join(dir, file), bytes);
  writeFileSync(join(dir, "pack.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(dir, "LICENSES.md"), licensesMd(manifest));

  // bundled.txt: the subset copied into the host at build. Keep any hand-pinned
  // selection that still exists; otherwise pin everything we have.
  const bundledPath = join(dir, "bundled.txt");
  const known = new Set(manifest.images.map((i) => i.file));
  const kept = existsSync(bundledPath)
    ? readFileSync(bundledPath, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#") && known.has(s))
    : [];
  const bundled = kept.length ? kept : manifest.images.map((i) => i.file);
  writeFileSync(bundledPath, [
    `# ${pack.name} — the subset copied into the host at build (Assets/packs/${pack.id}).`,
    "# One file name per line; every name must have a pack.json entry. Edit by hand.",
    ...bundled,
    "",
  ].join("\n"));

  const onDisk = readdirSync(dir).filter((f) => /\.(jpg|jpeg|png|webp|avif)$/i.test(f));
  console.log(`\n${pack.id}: ${manifest.images.length} manifest entries, ${onDisk.length} image files on disk, ${bundled.length} bundled → ${dir.replace(root, ".")}`);
  const orphans = onDisk.filter((f) => !known.has(f));
  if (orphans.length) {
    console.log(`${pack.id}: ${orphans.length} file(s) from an earlier run now have no manifest entry - delete them or the gate fails (unlabelled imagery never ships):`);
    for (const o of orphans) console.log(`  ${join(dir, o).replace(root, ".")}`);
  }
  return manifest;
}

// ------------------------------------------------------------------ main

const PACKS = { gallery: fetchGallery, cosmos: fetchCosmos };
const ids = target === "all" ? Object.keys(PACKS) : [target];
if (!ids.length || ids.some((i) => !PACKS[i])) {
  console.error(`usage: node scripts/fetch-pack.mjs <${Object.keys(PACKS).join("|")}|all> [--count=12] [--out=packs]`);
  process.exit(2);
}

let failed = false;
for (const id of ids) {
  try {
    const pack = await PACKS[id](COUNT);
    if (!pack.images.length) {
      console.error(`\n${id}: fetched NOTHING — leaving the manifest untouched rather than writing an empty one.`);
      console.error(`${id}: no metadata is ever invented; re-run when the source APIs are reachable.`);
      failed = true;
      continue;
    }
    writePack(pack);
  } catch (e) {
    console.error(`\n${id}: ${e?.stack ?? e}`);
    console.error(`${id}: nothing written — a partial pack is fine, a fabricated one is not.`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
