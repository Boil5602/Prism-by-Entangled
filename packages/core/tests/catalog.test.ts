import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPlainTile,
  clampZoom,
  pickerTile,
  validCatalogEntry,
  isServerTemplate,
  ownServerAddress,
  fillServer,
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
      // a self-hosted entry (Jellyfin) is picked with the household's server address; its tile is at that address, never the template
      const tile = pickerTile(e, isServerTemplate(e.url) ? { url: "http://nas:8096" } : {});
      expect(() => assertPlainTile(tile as Record<string, unknown>)).not.toThrow();
      expect(tile.url, e.id).toMatch(/^https?:\/\//);
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

describe("a self-hosted service's address (Jellyfin, 2026-11-03: the household's own server, no fixed address)", () => {
  const jellyfin: CatalogEntry = {
    id: "jellyfin", name: "Jellyfin", url: "{server}/web/#/home", site: "https://jellyfin.org/", address: { ask: "Your Jellyfin server's address", example: "http://192.168.1.20:8096" },
    adapter: "jellyfin", aspectHint: "16:9", audio: "exclusive", poster: { source: "site", fallback: "wordmark" }, zoom: 1.0,
    focusPresets: [{ id: "whole", label: "Whole page", selector: null }],
  };
  it("validates with its template because the entry says what to ask for; a template without the ask does not", () => {
    expect(validCatalogEntry(jellyfin)).toBe(true);
    expect(validCatalogEntry({ ...jellyfin, address: undefined })).toBe(false);
    expect(isServerTemplate(jellyfin.url)).toBe(true);
    expect(isServerTemplate("https://www.netflix.com/browse")).toBe(false);
  });
  it("the pick fills the address the person typed, http on the home network included, with no trailing slash doubled", () => {
    expect(pickerTile(jellyfin, { url: "http://192.168.1.20:8096/" }).url).toBe("http://192.168.1.20:8096/web/#/home");
    expect(pickerTile(jellyfin, { url: "https://jf.example.org" }).url).toBe("https://jf.example.org/web/#/home");
    expect(ownServerAddress("nas:8096")).toBeNull();
    expect(ownServerAddress(" http://nas:8096/web/ ")).toBe("http://nas:8096/web");
    expect(fillServer("https://www.netflix.com/browse", null)).toBe("https://www.netflix.com/browse");
  });
  it("a pick with no address is refused, never a tile at a template", () => {
    expect(() => pickerTile(jellyfin)).toThrow(/needs its server's address/);
    expect(() => pickerTile(jellyfin, { url: "nas" })).toThrow(/needs its server's address/);
  });
});
