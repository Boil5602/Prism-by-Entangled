/**
 * Imagery packs (docs/concept-scenes.md §3, dashboard-schema §26/§27).
 *
 * A pack is a directory — `packs/<id>/pack.json` plus its image files —
 * shipped offline and served by the shell. Nothing here ever touches the
 * network: packs are fetched by a maintainer (`scripts/fetch-pack.mjs`) and
 * read from disk at render time (§26/§27 "fetched never"), and the
 * attribution the card shows comes from the local manifest, never a lookup
 * (§19/§22 — no identifiers in any network call, because there is no call).
 *
 * Two rules make a pack shippable:
 *
 * 1. **Every image is traceable to a named source** (§5 doctrine). `file`,
 *    `title`, `credit`, `attribution`, `sourceUrl`, `license.{id,name,url}`
 *    and `sha256` are required, no exceptions. `creator`/`date` are required
 *    for a pack that claims them (Gallery: a painting has a painter).
 * 2. **The licence is one we may actually redistribute under.** Only
 *    `public-domain`, `cc0`, `cc-by`, `cc-by-sa` — the last two only with the
 *    attribution text they require, which is what `attribution` carries.
 *
 * `validateImageryPack` is the whole gate's logic (scripts/verify-imagery-packs.mjs
 * is a thin file-system wrapper around it), and `cardAttribution` is the whole
 * §26 card-corner rule, so every shell renders the same line.
 */

export const IMAGERY_PACK_SCHEMA = "prism.imagery-pack/v0.1";

/** The only licences a pack may ship under (§3.1 allowlist). */
export const IMAGERY_LICENSE_IDS = ["public-domain", "cc0", "cc-by", "cc-by-sa"] as const;
export type ImageryLicenseId = (typeof IMAGERY_LICENSE_IDS)[number];

/** Licences that legally require the attribution text to travel with the image. */
export const ATTRIBUTION_REQUIRED: readonly ImageryLicenseId[] = ["cc-by", "cc-by-sa"];

export interface ImageryLicense {
  id: ImageryLicenseId;
  /** Human name shown on the card ("Public domain (CC0 1.0)"). */
  name: string;
  /** Deed / statement URL. */
  url: string;
}

export interface PackImage {
  /** File name inside the pack directory. */
  file: string;
  title: string;
  /** The painter/photographer. Required for packs that declare `requiresCreator`. */
  creator?: string;
  date?: string;
  /** Who holds/publishes it, as the card says it: "Art Institute of Chicago, Public Domain". */
  credit: string;
  /** The institution's own credit line, where it publishes one (provenance, not display). */
  creditLine?: string;
  license: ImageryLicense;
  /** The single sentence a CC-BY/CC-BY-SA reuse must carry; also the settings line. */
  attribution: string;
  /** The object page — reachable from the context sheet, never fetched by the device. */
  sourceUrl: string;
  /** Lowercase hex SHA-256 of the file's bytes. */
  sha256: string;
  w?: number;
  h?: number;
}

export interface ImageryPack {
  schema: string;
  id: string;
  name: string;
  blurb: string;
  /** The collection the pack was drawn from. */
  source: { name: string; url: string };
  /** True when a missing `creator` is a failure (a painting has a painter). */
  requiresCreator?: boolean;
  images: PackImage[];
}

/** One file found in the pack directory; `sha256` absent = present but not hashed. */
export interface PackDiskFile {
  name: string;
  sha256?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|avif)$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Every problem with a pack, as plain sentences. Empty = the pack is shippable.
 *
 * `disk` is what the pack directory actually holds. Absent bytes are NOT a
 * problem — image files are git-ignored and maintainer-fetched, so a fresh
 * clone validates clean. A file on disk with no manifest entry IS a problem:
 * unlabelled imagery never ships (§5).
 */
export function validateImageryPack(
  pack: unknown,
  disk: readonly PackDiskFile[] = [],
): string[] {
  const problems: string[] = [];
  const P = (m: string) => problems.push(m);

  if (!isObj(pack)) return ["pack.json is not an object"];
  const id = str(pack.id) ?? "<no id>";
  if (pack.schema !== IMAGERY_PACK_SCHEMA) P(`${id}: schema is ${JSON.stringify(pack.schema)}, expected ${JSON.stringify(IMAGERY_PACK_SCHEMA)}`);
  if (!str(pack.id)) P("pack.id is missing");
  if (!str(pack.name)) P(`${id}: pack.name is missing`);
  if (!str(pack.blurb)) P(`${id}: pack.blurb is missing`);
  const source = isObj(pack.source) ? pack.source : null;
  if (!source || !str(source.name) || !str(source.url)) P(`${id}: pack.source must name the collection and its url`);
  const requiresCreator = pack.requiresCreator === true;

  const images = Array.isArray(pack.images) ? pack.images : null;
  if (!images) {
    P(`${id}: pack.images must be an array`);
    return problems;
  }

  const seenFiles = new Set<string>();
  images.forEach((raw, i) => {
    const where = `${id}[${i}]`;
    if (!isObj(raw)) {
      P(`${where}: not an object`);
      return;
    }
    const file = str(raw.file);
    const label = file ? `${id}/${file}` : where;
    if (!file) P(`${where}: file is missing`);
    else {
      if (!SAFE_FILE.test(file)) P(`${label}: file is not a plain image name (letters, digits, . _ - and an image extension)`);
      if (seenFiles.has(file)) P(`${label}: listed twice in the manifest`);
      seenFiles.add(file);
    }
    for (const field of ["title", "credit", "attribution", "sourceUrl"] as const) {
      if (!str(raw[field])) P(`${label}: ${field} is missing`);
    }
    if (requiresCreator && !str(raw.creator)) P(`${label}: creator is required in this pack (a painting has a painter)`);
    const sourceUrl = str(raw.sourceUrl);
    if (sourceUrl && !/^https:\/\/[^\s]+$/i.test(sourceUrl)) P(`${label}: sourceUrl ${JSON.stringify(sourceUrl)} is not an https url`);

    const license = isObj(raw.license) ? raw.license : null;
    if (!license) P(`${label}: license is missing`);
    else {
      const lid = str(license.id);
      if (!lid) P(`${label}: license.id is missing`);
      else if (!(IMAGERY_LICENSE_IDS as readonly string[]).includes(lid)) {
        P(`${label}: license.id ${JSON.stringify(lid)} is outside the allowlist (${IMAGERY_LICENSE_IDS.join(", ")})`);
      } else if (ATTRIBUTION_REQUIRED.includes(lid as ImageryLicenseId) && !str(raw.attribution)) {
        P(`${label}: ${lid} requires the attribution text it mandates`);
      }
      if (!str(license.name)) P(`${label}: license.name is missing`);
      if (!str(license.url)) P(`${label}: license.url is missing`);
    }

    const sha = str(raw.sha256);
    if (!sha) P(`${label}: sha256 is missing`);
    else if (!HEX64.test(sha)) P(`${label}: sha256 ${JSON.stringify(sha)} is not 64 lowercase hex characters`);

    for (const dim of ["w", "h"] as const) {
      const v = raw[dim];
      if (v !== undefined && !(typeof v === "number" && Number.isInteger(v) && v > 0)) P(`${label}: ${dim} must be a positive integer`);
    }
  });

  // Bytes on disk: an orphan file is unlabelled imagery; a mismatch is a swap.
  const byName = new Map<string, PackImage>();
  for (const raw of images) if (isObj(raw) && str(raw.file)) byName.set(raw.file as string, raw as unknown as PackImage);
  for (const f of disk) {
    const entry = byName.get(f.name);
    if (!entry) {
      P(`${id}/${f.name}: on disk with no manifest entry — every image is traceable to a named source or it does not ship`);
      continue;
    }
    if (f.sha256 && entry.sha256 && f.sha256.toLowerCase() !== entry.sha256.toLowerCase()) {
      P(`${id}/${f.name}: sha256 on disk (${f.sha256.slice(0, 12)}…) does not match the manifest (${entry.sha256.slice(0, 12)}…)`);
    }
  }

  return problems;
}

/** Which manifest entries have no bytes on disk yet (reported, never a failure). */
export function unfetchedImages(pack: ImageryPack, disk: readonly PackDiskFile[]): string[] {
  const present = new Set(disk.map((f) => f.name));
  return pack.images.filter((i) => !present.has(i.file)).map((i) => i.file);
}

// ------------------------------------------------------------ the card corner

/** §26 card modes: the full card, or the minimised corner chip. */
export type AttributionMode = "card" | "minimal";

export interface CardAttribution {
  /** Title, with the creator where the pack has one. */
  headline: string;
  credit: string;
  licenseName: string;
  /** The object page. Reachable from the context sheet; never fetched by the device. */
  sourceUrl: string;
  /**
   * The line the corner renders in this mode. `card`: headline · credit ·
   * licence. `minimal`: the credit alone — collapsed, never hidden.
   */
  line: string;
}

/**
 * §3.2, normative: what the intermission card's corner says about the image
 * it is showing. Nothing about the image is ever hidden entirely — minimal
 * mode collapses the line to the credit, it does not remove it.
 */
export function cardAttribution(image: PackImage, mode: AttributionMode = "card"): CardAttribution {
  const headline = image.creator ? `${image.title} · ${image.creator}` : image.title;
  const licenseName = image.license?.name ?? "";
  const parts = [headline, image.credit, licenseName].filter((s) => typeof s === "string" && s.trim() !== "");
  return {
    headline,
    credit: image.credit,
    licenseName,
    sourceUrl: image.sourceUrl,
    line: mode === "minimal" ? image.credit : parts.join(" · "),
  };
}

/** The settings/LICENSES.md sentence for one image (§26 "attributed per image"). */
export function attributionSentence(image: PackImage): string {
  const who = image.creator ? `${image.creator}, ` : "";
  const when = image.date ? ` (${image.date})` : "";
  return `${who}${image.title}${when} — ${image.credit}`;
}
