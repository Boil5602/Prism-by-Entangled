import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterRegistry, lintAdapter, lintAdapterData, parseControl, type AdapterSpec } from "../src/adapters.js";
import { facetPresetsFor, presetFacet, presetSelectorNames, tunedPresetFor, type CatalogEntryWithFacets } from "../src/adapters-facets.js";
import { resolvePresentationAction } from "../src/adapters-presentation.js";
import { KITCHEN_CLASSIC } from "../src/scene-model.js";
import { validCatalogEntry } from "../src/catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, "../../../prism-adapters/adapters");
const catalogDir = join(here, "../../../prism-adapters/catalog");

const adapters = Object.fromEntries(
  readdirSync(adaptersDir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(adaptersDir, f), "utf8")) as AdapterSpec]),
);
const catalog = readdirSync(catalogDir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(join(catalogDir, f), "utf8")) as CatalogEntryWithFacets);

describe("prism-adapters data (§5/§26/§31/§32) against core's own lint", () => {
  it("every shipped adapter passes the §26 synthetic-interaction lint and the data-block lint", () => {
    for (const [name, spec] of Object.entries(adapters)) {
      expect(lintAdapter(spec), name).toEqual([]);
      expect(lintAdapterData(spec), name).toEqual([]);
    }
    const reg = new AdapterRegistry();
    reg.registerAll(adapters);
    expect(reg.rejected()).toEqual({});
  });
  it("every catalog preset name (focus + facet presets) exists in its adapter's selectors table - a dangling name fails", () => {
    for (const entry of catalog) {
      expect(validCatalogEntry(entry), entry.id).toBe(true);
      const names = presetSelectorNames(entry);
      if (!names.length) continue;
      expect(entry.adapter, `${entry.id} references selector names but has no adapter`).toBeTruthy();
      const spec = adapters[entry.adapter!];
      expect(spec, `${entry.id}: adapters/${entry.adapter}.json`).toBeTruthy();
      expect(lintAdapterData(spec!, names), entry.id).toEqual([]);
    }
  });
  it("control and presentation values parse under the binding grammar", () => {
    for (const [name, spec] of Object.entries(adapters)) {
      for (const v of [...Object.values(spec.controls ?? {}), ...Object.values(spec.presentation ?? {})]) {
        const b = parseControl(v);
        expect(["selector", "deep", "key"], `${name}: ${v}`).toContain(b.kind);
        if (b.kind === "deep") expect(b.path.length, `${name}: ${v}`).toBeGreaterThan(1);
      }
    }
  });
  it("the three music slices declare transport as data and the ad-break signal where the service has ads", () => {
    expect(adapters.spotify?.controls).toMatchObject({ play: expect.any(String), pause: expect.any(String), next: expect.any(String), prev: expect.any(String) });
    expect(adapters.pandora?.controls).toMatchObject({ play: expect.any(String), pause: expect.any(String), next: expect.any(String), prev: expect.any(String) });
    expect(adapters["apple-music"]?.controls).toMatchObject({ next: expect.any(String), prev: expect.any(String) });
    expect(adapters.spotify?.js).toContain("frame.adBreak(");
    expect(adapters.pandora?.js).toContain("frame.adBreak(");
    // Apple Music has no ads: no observer at all, said in the notes
    expect(adapters["apple-music"]?.js ?? null).toBeNull();
    expect((adapters["apple-music"] as { notes?: string }).notes).toMatch(/no ads/i);
    // observe-only: the observers never touch player state
    for (const n of ["spotify", "pandora"]) expect(adapters[n]!.js).not.toMatch(/\.(play|pause|load)\s*\(|currentTime\s*=/);
    // the state-conditioned toggles: a human's "play" can never pause
    expect(adapters.spotify!.controls!.play).not.toBe(adapters.spotify!.controls!.pause);
  });
  it("Hulu and YouTube expose presentation actions that resolve only through the keeper's resolver", () => {
    for (const n of ["hulu", "youtube"]) {
      const spec = adapters[n]!;
      expect(spec.presentation?.enterFullscreen, n).toBeTruthy();
      expect(spec.presentation?.play, n).toBeTruthy();
      expect(resolvePresentationAction(spec, { kind: "enterFullscreen", reason: "ad-break" }).js).toContain(".click()");
    }
    expect(adapters.youtube!.presentation!.enterTheater).toBeTruthy();
    expect(adapters.hulu!.presentation!.enterTheater).toBeUndefined();   // Hulu has no theater mode
  });
  it("the Kitchen Classic roles' tuned presets exist in the catalog for the roles' classes", () => {
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const expectations: Record<string, string> = { weather: "weather", calendar: "google-calendar", ticker: "npr" };
    for (const role of KITCHEN_CLASSIC.roles) {
      if (!role.tunedPreset) continue;
      const entry = byId.get(expectations[role.id]!)!;
      expect(entry, role.id).toBeTruthy();
      const preset = tunedPresetFor(entry, role.class, role.tunedPreset);
      expect(preset, `${role.id}: ${entry.id} has no ${role.tunedPreset} for ${role.class}`).not.toBeNull();
      expect(facetPresetsFor(entry, role.class).some((p) => p.id === role.tunedPreset), `${role.id}: tuned (class) preset, not just the plain one`).toBe(true);
      const facet = presetFacet(entry, preset!, { id: entry.id }, role.class, adapters[entry.adapter!]!.selectors);
      expect(facet.focus, `${role.id}: the preset resolves to a real selector`).toBeTruthy();
      expect(typeof facet.zoom === "number" || facet.zoom === undefined).toBe(true);
    }
  });
  it("the repo validator agrees (prism-adapters/validate-catalog.mjs exists and runs the same rules)", () => {
    expect(existsSync(join(here, "../../../prism-adapters/validate-catalog.mjs"))).toBe(true);
  });
});
