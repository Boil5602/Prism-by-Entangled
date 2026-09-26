import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPlainTile,
  clampZoom,
  pickerTile,
  validCatalogEntry,
  type CatalogEntry,
} from "../src/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = join(here, "../../../prism-adapters/catalog");

function loadEntries(): CatalogEntry[] {
  return readdirSync(catalogDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(readFileSync(join(catalogDir, f), "utf8")) as CatalogEntry);
}

const netflix: CatalogEntry = {
  id: "netflix", name: "Netflix", url: "https://www.netflix.com/browse",
  adapter: "netflix", aspectHint: "16:9", audio: "exclusive",
  poster: { source: "site", fallback: "wordmark" }, zoom: 1.0,
  focusPresets: [
    { id: "whole", label: "Whole page", selector: null },
    { id: "continue", label: "Continue watching", selector: "continue-watching" },
  ],
};

describe("picker output (§31: plain tile schema, nothing picker-specific persists)", () => {
  it("a plain pick carries only whitelisted fields", () => {
    const tile = pickerTile(netflix);
    expect(() => assertPlainTile(tile as Record<string, unknown>)).not.toThrow();
    expect(tile).toEqual({
      id: "netflix", url: "https://www.netflix.com/browse", adapter: "netflix",
      aspectHint: "16:9", audio: "exclusive", profile: "netflix", persist: true,
      intermission: { enabled: true },
      veil: { mode: "veil-only" },
    });
  });

  it("a preset resolves through the ADAPTER's named-selector table", () => {
    const tile = pickerTile(netflix, { presetId: "continue" },
      { "continue-watching": ".lolomoRow[data-list-context='continueWatching']" });
    expect(tile.focus).toEqual({ selector: ".lolomoRow[data-list-context='continueWatching']", pad: 12 });
  });

  it("an unresolvable preset degrades to whole page — no dangling names persist", () => {
    const noTable = pickerTile(netflix, { presetId: "continue" });
    expect(noTable.focus).toBeUndefined();
    const unknown = pickerTile(netflix, { presetId: "nope" }, { x: ".x" });
    expect(unknown.focus).toBeUndefined();
  });

  it("second tile of the same service isolates its profile unless shared", () => {
    const second = pickerTile(netflix, { tileId: "netflix-2" });
    expect(second.profile).toBe("netflix-2");
    const shared = pickerTile(netflix, { tileId: "netflix-2", profile: "netflix" });
    expect(shared.profile).toBe("netflix");
  });

  it("zoom clamps to §31 bounds and default 1 is omitted", () => {
    expect(pickerTile(netflix).zoom).toBeUndefined();
    expect(pickerTile(netflix, { zoom: 9 }).zoom).toBe(3);
    expect(clampZoom(0.1)).toBe(0.5);
  });

  it("assertPlainTile rejects a stray picker field", () => {
    expect(() => assertPlainTile({ id: "x", url: "https://x", posterCache: "…" }))
      .toThrow(/picker-only fields/);
  });
});

describe("the shipped catalog entries", () => {
  it("all validate and produce plain tiles", () => {
    const entries = loadEntries();
    expect(entries.length).toBeGreaterThanOrEqual(4);
    for (const e of entries) {
      expect(validCatalogEntry(e), e.id).toBe(true);
      const tile = pickerTile(e);
      expect(() => assertPlainTile(tile as Record<string, unknown>)).not.toThrow();
    }
  });

  it("every entry's first preset is whole-page and names, not CSS, follow", () => {
    for (const e of loadEntries()) {
      const presets = e.focusPresets ?? [];
      expect(presets[0]?.selector, e.id).toBeNull();
      for (const p of presets.slice(1))
        if (p.selector !== null) expect(p.selector, `${e.id}/${p.id}`).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });
});
