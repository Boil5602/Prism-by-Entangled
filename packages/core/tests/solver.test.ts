import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aspectCost, fitQuality, solveHero } from "../src/solver.js";
import type { SolverTile } from "../src/solver.js";
import { parseAspectHint } from "../src/types.js";
// @ts-expect-error plain-JS oracle, no types on purpose
import { solveHero as referenceSolveHero } from "./reference-solver.mjs";
// @ts-expect-error plain-JS shared fixture enumeration
import { buildCases, DEVICES, HERO_SIZES, PALETTE } from "./fixture-cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));

interface FixtureCase {
  name: string;
  tiles: SolverTile[];
  heroId: string;
  heroSize: number;
  W: number;
  H: number;
  rects: Record<string, { x: number; y: number; w: number; h: number }>;
}

const golden = JSON.parse(
  readFileSync(join(here, "golden", "solver-fixtures.json"), "utf8"),
) as { cases: FixtureCase[] };

describe("solveHero — golden fixtures (normative, spec §8)", () => {
  it("has fixtures for every enumerated case", () => {
    expect(golden.cases.length).toBe(buildCases().length);
  });

  for (const c of golden.cases) {
    it(c.name, () => {
      // toEqual on raw numbers = bit-exact match; JSON round-trips doubles
      // losslessly, so any numeric drift in the port fails here.
      expect(solveHero(c.tiles, c.heroId, c.heroSize, c.W, c.H)).toEqual(c.rects);
    });
  }
});

describe("solveHero — cross-check against verbatim prototype solver", () => {
  it("matches the oracle on a dense parameter sweep", () => {
    for (const device of DEVICES) {
      const W = 1000;
      const H = (1000 * device.h) / device.w;
      for (let n = 1; n <= PALETTE.length; n++) {
        const tiles = PALETTE.slice(0, n);
        for (let hs = 0.3; hs <= 0.851; hs += 0.05) {
          for (const hero of tiles) {
            expect(solveHero(tiles, hero.id, hs, W, H)).toEqual(
              referenceSolveHero(tiles, hero.id, hs, W, H),
            );
          }
        }
      }
    }
  });
});

describe("solveHero — contract properties", () => {
  const tiles: SolverTile[] = PALETTE.slice(0, 5);

  it("is deterministic: identical inputs produce identical rects", () => {
    const a = solveHero(tiles, "youtube", 0.62, 1000, 625);
    const b = solveHero(tiles, "youtube", 0.62, 1000, 625);
    expect(a).toEqual(b);
  });

  it("returns an empty result for an empty tile list", () => {
    expect(solveHero([], "x", 0.5, 1000, 625)).toEqual({});
  });

  it("gives a lone tile the full canvas", () => {
    expect(solveHero(tiles.slice(0, 1), "youtube", 0.3, 1000, 625)).toEqual({
      youtube: { x: 0, y: 0, w: 1000, h: 625 },
    });
  });

  it("falls back to the first tile when heroId is unknown", () => {
    expect(solveHero(tiles, "missing", 0.62, 1000, 625)).toEqual(
      solveHero(tiles, "youtube", 0.62, 1000, 625),
    );
  });

  it("assigns a rect to every tile", () => {
    for (const c of buildCases() as Array<{
      tiles: SolverTile[]; heroId: string; heroSize: number; W: number; H: number;
    }>) {
      const rects = solveHero(c.tiles, c.heroId, c.heroSize, c.W, c.H);
      for (const t of c.tiles) {
        expect(rects[t.id], `missing rect for ${t.id}`).toBeDefined();
      }
    }
  });

  it("keeps every rect inside the canvas", () => {
    for (const c of buildCases() as Array<{
      tiles: SolverTile[]; heroId: string; heroSize: number; W: number; H: number;
    }>) {
      const rects = solveHero(c.tiles, c.heroId, c.heroSize, c.W, c.H);
      for (const [id, r] of Object.entries(rects)) {
        expect(r.x, `${id} x`).toBeGreaterThanOrEqual(0);
        expect(r.y, `${id} y`).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, `${id} right`).toBeLessThanOrEqual(c.W + 1e-6);
        expect(r.y + r.h, `${id} bottom`).toBeLessThanOrEqual(c.H + 1e-6);
      }
    }
  });

  it("snaps the hero to full cross-axis when the leftover strip would be a sliver", () => {
    // 1:1 hero at heroSize 0.62 on 16:10 → natural height 620 of 625 leaves
    // <15% — the sliver rule snaps it to 625.
    const rects = solveHero(
      [
        { id: "square", hint: 1, weight: 0.5 },
        { id: "cal", hint: 3 / 4, weight: 0.6 },
      ],
      "square",
      0.62,
      1000,
      625,
    );
    expect(rects["square"]!.h).toBe(625);
  });
});

describe("aspectCost / fitQuality", () => {
  it("is zero at a perfect aspect match", () => {
    expect(aspectCost(160, 90, 16 / 9, 1)).toBe(0);
  });

  it("returns Infinity for degenerate slots", () => {
    expect(aspectCost(0, 90, 16 / 9, 1)).toBe(Infinity);
    expect(aspectCost(160, -1, 16 / 9, 1)).toBe(Infinity);
  });

  it("scales linearly with weight", () => {
    const full = aspectCost(100, 100, 16 / 9, 1);
    expect(aspectCost(100, 100, 16 / 9, 0.5)).toBeCloseTo(full / 2, 12);
    expect(aspectCost(100, 100, 16 / 9, 0)).toBe(0);
  });

  it("fitQuality is 1 at perfect fit and 0 at 3× off", () => {
    expect(fitQuality({ x: 0, y: 0, w: 160, h: 90 }, 16 / 9)).toBe(1);
    expect(fitQuality({ x: 0, y: 0, w: 300, h: 100 }, 1)).toBeCloseTo(0, 12);
    expect(fitQuality(undefined, 1)).toBe(0);
    expect(fitQuality({ x: 0, y: 0, w: 0, h: 10 }, 1)).toBe(0);
  });
});

describe("parseAspectHint", () => {
  it("parses spec-style hints", () => {
    expect(parseAspectHint("16:9")).toBeCloseTo(16 / 9, 12);
    expect(parseAspectHint("3:4")).toBeCloseTo(0.75, 12);
    expect(parseAspectHint("8:1")).toBe(8);
    expect(parseAspectHint(" 1 : 1 ")).toBe(1);
  });

  it("rejects malformed or non-positive hints", () => {
    expect(parseAspectHint("")).toBeNull();
    expect(parseAspectHint("16x9")).toBeNull();
    expect(parseAspectHint("0:9")).toBeNull();
    expect(parseAspectHint("-16:9")).toBeNull();
    expect(parseAspectHint("16:")).toBeNull();
  });
});
