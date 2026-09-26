/**
 * The derived news shelf (dashboard-schema §31 "News defaults", normative):
 * the news picker's default shelf is DERIVED, not curated — sources meeting a
 * stated criterion on a named public dataset. v1: rated "generally reliable"
 * on Wikipedia's Perennial Sources list (CC BY-SA 4.0, methodology public).
 *
 * Inputs are repo data: a snapshot of the list
 * (packages/core/data/perennial-sources.<revision>.json) and the criterion
 * (packages/core/data/news-shelf-criterion.json). This builder is pure and
 * deterministic; scripts/regen-news-shelf.mjs runs it to write the shipped
 * shelf (src/news-shelf.data.ts), and tests/news-shelf.test.ts fails when the
 * shipped shelf differs from the builder's output — no hand edits can land.
 * Entangled adds and removes nothing by hand.
 */

export type PerennialStatus = "gr" | "nc" | "gu" | "d" | "m";

/** One row of the list as the snapshot records it (the table's real columns). */
export interface PerennialSourceRow {
  /** The row's anchor id on the list page (its `id` attribute). */
  id: string;
  /** Source cell, plain text. */
  source: string;
  /** Article the source cell links to, when it links one. */
  article?: string;
  /** Status column: the legend codes on the row (gr / nc / gu / d / m), in order. */
  status: PerennialStatus[];
  /** Status column: blacklisted (edit-filter) flag. */
  blacklisted?: boolean;
  /** "Last" column: year of the most recent discussion. */
  last?: number;
  /** "Last" column: the list marks the consensus as possibly stale. */
  stale?: boolean;
  /** Summary column, plain text. */
  summary: string;
  /** "Use" column: the domains the list associates with the source. */
  uses: string[];
  /** Shortcut names the row carries (WP:RSPNYT …). */
  shortcuts?: string[];
}

export interface PerennialSourcesSnapshot {
  dataset: {
    name: string;
    url: string;
    license: string;
    licenseUrl: string;
    /** Revision id of the list page the snapshot was taken from. */
    revision: number;
    retrieved: string;
    subpages: Array<{ title: string; revision: number }>;
  };
  legend: Record<PerennialStatus, string>;
  rows: PerennialSourceRow[];
}

export interface NewsShelfCriterion {
  id: string;
  label: string;
  /** The rule, stated for the picker's attribution line. */
  statement: string;
  /** Rows qualify when their status codes are exactly these (order-insensitive). */
  status: PerennialStatus[];
  /** Rows carrying the blacklist flag never qualify. */
  excludeBlacklisted: boolean;
  /** Rows without a usable domain in the Use column cannot open, so they are left out. */
  requireDomain: boolean;
}

export interface NewsShelfEntry {
  id: string;
  name: string;
  /** The first usable domain, as an https URL. */
  url: string;
  domains: string[];
  attribution: {
    dataset: string;
    license: string;
    licenseUrl: string;
    rating: string;
    /** Link to the rating rationale (the row on the list page). */
    ratingUrl: string;
    summary: string;
    lastReviewed: number | null;
    stale: boolean;
  };
  /** Catalog defaults for a news facet: a muted, scroll-only, 16:9 page. */
  catalog: { aspectHint: "16:9"; audio: "mute"; touch: "scroll" };
}

export interface NewsShelf {
  schema: "prism.news-shelf/v0.1";
  derivedFrom: { dataset: string; url: string; revision: number; retrieved: string; license: string; licenseUrl: string };
  criterion: NewsShelfCriterion;
  /** The line the picker shows above the shelf. */
  attributionLine: string;
  entries: NewsShelfEntry[];
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

/** A usable domain from the Use column: a bare host (with an optional path), no scheme, no wildcard. */
export function usableDomain(d: string): string | null {
  const s = d.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!s || /\s/.test(s) || s.startsWith("*")) return null;
  const host = s.split("/")[0]!;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) return null;
  return s;
}

function rowQualifies(row: PerennialSourceRow, c: NewsShelfCriterion): boolean {
  if (c.excludeBlacklisted && row.blacklisted) return false;
  const have = [...row.status].sort().join(",");
  const want = [...c.status].sort().join(",");
  if (have !== want) return false;
  if (c.requireDomain && !row.uses.some((u) => usableDomain(u))) return false;
  return true;
}

/** Pure, deterministic: the shelf a snapshot + criterion produce (entries sorted by id). */
export function buildNewsShelf(snapshot: PerennialSourcesSnapshot, criterion: NewsShelfCriterion): NewsShelf {
  const rating = criterion.status.map((s) => snapshot.legend[s] ?? s).join(" / ");
  const seen = new Set<string>();
  const entries: NewsShelfEntry[] = [];
  for (const row of snapshot.rows) {
    if (!rowQualifies(row, criterion)) continue;
    const domains = row.uses.map(usableDomain).filter((d): d is string => !!d);
    let id = slugify(row.id);
    for (let n = 2; seen.has(id); n++) id = `${slugify(row.id)}-${n}`;
    seen.add(id);
    entries.push({
      id,
      name: row.source,
      url: `https://${domains[0]!}/`.replace(/\/\/$/, "/"),
      domains,
      attribution: {
        dataset: snapshot.dataset.name,
        license: snapshot.dataset.license,
        licenseUrl: snapshot.dataset.licenseUrl,
        rating,
        ratingUrl: `${snapshot.dataset.url}#${encodeURIComponent(row.id).replace(/%20/g, "_")}`,
        summary: row.summary,
        lastReviewed: row.last ?? null,
        stale: !!row.stale,
      },
      catalog: { aspectHint: "16:9", audio: "mute", touch: "scroll" },
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schema: "prism.news-shelf/v0.1",
    derivedFrom: {
      dataset: snapshot.dataset.name,
      url: snapshot.dataset.url,
      revision: snapshot.dataset.revision,
      retrieved: snapshot.dataset.retrieved,
      license: snapshot.dataset.license,
      licenseUrl: snapshot.dataset.licenseUrl,
    },
    criterion,
    attributionLine: `${criterion.statement} — from ${snapshot.dataset.name} (${snapshot.dataset.license}), revision ${snapshot.dataset.revision} of ${snapshot.dataset.retrieved.slice(0, 10)}. Entangled adds and removes nothing by hand.`,
    entries,
  };
}
