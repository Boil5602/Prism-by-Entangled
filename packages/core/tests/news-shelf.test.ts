import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildNewsShelf, slugify, usableDomain, type NewsShelfCriterion, type PerennialSourcesSnapshot } from "../src/news-shelf.js";
import { NEWS_SHELF, NEWS_SHELF_SNAPSHOT_FILE } from "../src/news-shelf.data.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../data");
const snapshot = JSON.parse(readFileSync(join(dataDir, NEWS_SHELF_SNAPSHOT_FILE), "utf8")) as PerennialSourcesSnapshot;
const criterion = JSON.parse(readFileSync(join(dataDir, "news-shelf-criterion.json"), "utf8")) as NewsShelfCriterion;

describe("§31 derived news shelf — reproducibility", () => {
  it("the shipped shelf IS the builder's output for the committed snapshot + criterion (no hand edits)", () => {
    expect(NEWS_SHELF).toEqual(buildNewsShelf(snapshot, criterion));
  });
  it("the criterion is repo data and says what it filters on", () => {
    expect(criterion).toEqual({
      id: "wp-rsp-generally-reliable",
      label: "Generally reliable on Wikipedia's Perennial Sources list",
      statement: 'Sources rated "generally reliable" on Wikipedia\'s Perennial Sources list',
      status: ["gr"],
      excludeBlacklisted: true,
      requireDomain: true,
    });
  });
  it("the snapshot names its dataset, license and revision, and keeps the list's real columns", () => {
    expect(snapshot.dataset.license).toBe("CC BY-SA 4.0");
    expect(snapshot.dataset.url).toBe("https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources");
    expect(snapshot.dataset.revision).toBeGreaterThan(0);
    expect(snapshot.rows.length).toBeGreaterThan(400);
    for (const r of snapshot.rows) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.source).toBe("string");
      expect(Array.isArray(r.status) && r.status.length > 0).toBe(true);
      expect(typeof r.summary).toBe("string");
      expect(Array.isArray(r.uses)).toBe(true);
    }
    // the shelf spans wire services and outlets of differing perspectives — a few known rows, unedited
    for (const id of ["Associated Press", "Reuters", "The New York Times", "The Wall Street Journal", "BBC", "Al Jazeera"]) {
      expect(snapshot.rows.find((r) => r.id === id)?.status, id).toEqual(["gr"]);
    }
  });
  it("every shipped entry carries attribution, a rationale link, and an https URL from the Use column", () => {
    expect(NEWS_SHELF.entries.length).toBeGreaterThan(100);
    expect(NEWS_SHELF.attributionLine).toMatch(/CC BY-SA 4\.0/);
    expect(NEWS_SHELF.attributionLine).toMatch(/adds and removes nothing by hand/);
    for (const e of NEWS_SHELF.entries) {
      expect(e.url).toMatch(/^https:\/\/[a-z0-9.-]+/i);
      expect(e.attribution.license).toBe("CC BY-SA 4.0");
      expect(e.attribution.rating).toBe("Generally reliable");
      expect(e.attribution.ratingUrl.startsWith(NEWS_SHELF.derivedFrom.url + "#")).toBe(true);
      expect(e.catalog).toEqual({ aspectHint: "16:9", audio: "mute", touch: "scroll" });
    }
    const ids = NEWS_SHELF.entries.map((e) => e.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("§31 derived news shelf — builder rules", () => {
  const mini: PerennialSourcesSnapshot = {
    dataset: { name: "D", url: "https://d.example/list", license: "CC BY-SA 4.0", licenseUrl: "https://cc/", revision: 7, retrieved: "2026-09-01T00:00:00Z", subpages: [] },
    legend: { gr: "Generally reliable", nc: "No consensus", gu: "Generally unreliable", d: "Deprecated", m: "Mixed" },
    rows: [
      { id: "Wire B", source: "Wire B", status: ["gr"], last: 2024, summary: "ok", uses: ["wireb.example", "b.example/en"] },
      { id: "Wire A", source: "Wire A", status: ["gr"], last: 2020, stale: true, summary: "ok", uses: ["https://wirea.example/"] },
      { id: "Split", source: "Split", status: ["gr", "nc"], summary: "topic-dependent", uses: ["split.example"] },
      { id: "Bad", source: "Bad", status: ["gu"], summary: "no", uses: ["bad.example"] },
      { id: "Listed", source: "Listed", status: ["gr"], blacklisted: true, summary: "odd", uses: ["listed.example"] },
      { id: "No site", source: "No site", status: ["gr"], summary: "category", uses: [] },
      { id: "Wildcard", source: "Wildcard", status: ["gr"], summary: "x", uses: ["*.example", "not a domain"] },
    ],
  };
  const c: NewsShelfCriterion = { id: "t", label: "t", statement: "Rated gr", status: ["gr"], excludeBlacklisted: true, requireDomain: true };

  it("keeps exactly the rows meeting the criterion; sorts by id; derives the URL from the Use column", () => {
    const shelf = buildNewsShelf(mini, c);
    expect(shelf.entries.map((e) => e.id)).toEqual(["wire-a", "wire-b"]);
    expect(shelf.entries[0]).toMatchObject({ url: "https://wirea.example/", domains: ["wirea.example"], attribution: { lastReviewed: 2020, stale: true, ratingUrl: "https://d.example/list#Wire_A" } });
    expect(shelf.entries[1]).toMatchObject({ url: "https://wireb.example/", domains: ["wireb.example", "b.example/en"] });
    expect(shelf.attributionLine).toBe("Rated gr — from D (CC BY-SA 4.0), revision 7 of 2026-09-01. Entangled adds and removes nothing by hand.");
  });
  it("is deterministic and pure", () => {
    expect(buildNewsShelf(mini, c)).toEqual(buildNewsShelf(mini, c));
    expect(JSON.stringify(mini.rows[0])).toContain('"Wire B"'); // input untouched
  });
  it("a different criterion is a different shelf, still traceable", () => {
    const shelf = buildNewsShelf(mini, { ...c, status: ["gu"], statement: "Rated gu" });
    expect(shelf.entries.map((e) => e.id)).toEqual(["bad"]);
    expect(shelf.entries[0]!.attribution.rating).toBe("Generally unreliable");
  });
  it("domain + slug helpers", () => {
    expect(usableDomain("https://dw.com/en/")).toBe("dw.com/en");
    expect(usableDomain("*.example")).toBeNull();
    expect(usableDomain("not a domain")).toBeNull();
    expect(slugify("Burke's Peerage")).toBe("burke-s-peerage");
    expect(slugify("Le Monde (Éditions)")).toBe("le-monde-editions");
  });
});
