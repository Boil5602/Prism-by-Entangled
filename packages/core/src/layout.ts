/**
 * Dashboard layout: dispatches a document to the right engine (grid lattice
 * §1 or hero solver §8) and produces final device rects.
 *
 * Gap model: partition rects fill the canvas edge-to-edge; the visual gap is
 * applied uniformly as a gap/2 inset on every rect (matching the reference
 * editor, which pads every tile block equally). Solver golden fixtures are
 * gap-free partition rects; the inset happens after.
 */

import type { DashboardDocument, TileSpec } from "./types.js";
import { parseAspectHint } from "./types.js";
import type { Rect, SolvedRects, SolverTile } from "./solver.js";
import { solveHero } from "./solver.js";

export interface Viewport {
  w: number;
  h: number;
}

/** Prototype defaults: unknown tiles solve as flexible 16:9. */
export const DEFAULT_ASPECT_HINT = 16 / 9;
export const DEFAULT_ASPECT_WEIGHT = 0.5;

export function tileToSolverTile(tile: TileSpec): SolverTile {
  const hint =
    (tile.aspectHint ? parseAspectHint(tile.aspectHint) : null) ?? DEFAULT_ASPECT_HINT;
  return {
    id: tile.id,
    hint,
    weight: tile.aspectWeight ?? DEFAULT_ASPECT_WEIGHT,
  };
}

/** Parse a CSS grid-area string "rowStart / colStart / rowEnd / colEnd". */
export function parseArea(
  area: string,
): { rowStart: number; colStart: number; rowEnd: number; colEnd: number } | null {
  const parts = area.split("/").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 1)) return null;
  const [rowStart, colStart, rowEnd, colEnd] = parts as [number, number, number, number];
  if (rowEnd <= rowStart || colEnd <= colStart) return null;
  return { rowStart, colStart, rowEnd, colEnd };
}

function solveGrid(doc: DashboardDocument, viewport: Viewport): SolvedRects {
  const cols = doc.grid?.cols ?? 1;
  const rows = doc.grid?.rows ?? 1;
  const cellW = viewport.w / cols;
  const cellH = viewport.h / rows;
  const rects: SolvedRects = {};
  for (const tile of doc.tiles) {
    const a = tile.area ? parseArea(tile.area) : null;
    if (!a) continue; // grid tiles without a valid area are not placed
    rects[tile.id] = {
      x: (a.colStart - 1) * cellW,
      y: (a.rowStart - 1) * cellH,
      w: (a.colEnd - a.colStart) * cellW,
      h: (a.rowEnd - a.rowStart) * cellH,
    };
  }
  return rects;
}

export interface HeroOverride {
  hero?: string;
  heroSize?: number;
  /** Solo layout: the tile currently on screen (persisted per frame). */
  solo?: string;
}

/**
 * Produce gap-free partition rects for a document at a viewport.
 * `override` carries runtime hero promotion / resize state (§8) without
 * mutating the document.
 */
export function layoutDashboard(
  doc: DashboardDocument,
  viewport: Viewport,
  override?: HeroOverride,
): SolvedRects {
  // §32: floating tiles are not solver input - they hover above the wall at
  // their own place; adding or removing one never reflows the wall.
  if (doc.tiles.some((t) => t.kind === "floating")) doc = { ...doc, tiles: doc.tiles.filter((t) => t.kind !== "floating") };
  if (doc.layout?.mode === "hero") {
    const named = override?.hero ?? doc.layout.hero;
    const heroId = doc.tiles.some((t) => t.id === named) ? named : doc.tiles[0]?.id ?? named;
    const heroSize = clampHeroSize(override?.heroSize ?? doc.layout.heroSize);
    const order =
      doc.layout.satellites === "auto" || !Array.isArray(doc.layout.satellites)
        ? doc.tiles
        : orderTiles(doc.tiles, doc.layout.satellites, heroId);
    return solveHero(order.map(tileToSolverTile), heroId, heroSize, viewport.w, viewport.h);
  }
  if (doc.layout?.mode === "fixed") {
    // Scene model: normalized rects scale exactly to the viewport (spec §3).
    const out: SolvedRects = {};
    for (const t of doc.tiles) {
      const r = doc.layout.rects[t.id];
      if (r) out[t.id] = { x: r.x * viewport.w, y: r.y * viewport.h, w: r.w * viewport.w, h: r.h * viewport.h };
    }
    return out;
  }
  if (doc.layout?.mode === "solo") {
    // Every tile at full size, stacked; the chosen one is raised on top
    // (orchestrator.fullscreen). Pages stay laid out for the whole screen, so
    // ◀ ▶ is instant. The phone draws its own strip for this mode.
    return Object.fromEntries(doc.tiles.map((t) => [t.id, { x: 0, y: 0, w: viewport.w, h: viewport.h }]));
  }
  return solveGrid(doc, viewport);
}

/** heroSize is spec-bounded to 0.3–0.85 (§8). */
export function clampHeroSize(size: number): number {
  if (!Number.isFinite(size)) return 0.62;
  return Math.min(0.85, Math.max(0.3, size));
}

/** Stable satellite ordering: hero first, then the declared order, then rest. */
function orderTiles(tiles: TileSpec[], satellites: string[], heroId: string): TileSpec[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const out: TileSpec[] = [];
  const hero = byId.get(heroId);
  if (hero) out.push(hero);
  for (const id of satellites) {
    const t = byId.get(id);
    if (t && !out.includes(t)) out.push(t);
  }
  for (const t of tiles) if (!out.includes(t)) out.push(t);
  return out;
}

/** Apply the uniform gap/2 inset that turns partition rects into device rects. */
export function insetRects(rects: SolvedRects, gap: number): SolvedRects {
  const half = gap / 2;
  const out: SolvedRects = {};
  for (const [id, r] of Object.entries(rects)) {
    out[id] = insetRect(r, half);
  }
  return out;
}

function insetRect(r: Rect, inset: number): Rect {
  // Never invert a rect: tiny slots keep at least a 1-unit box, centered.
  const w = Math.max(1, r.w - 2 * inset);
  const h = Math.max(1, r.h - 2 * inset);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
