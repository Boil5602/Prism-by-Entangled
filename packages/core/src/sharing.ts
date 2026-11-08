/**
 * Layout sharing (spec §15) and compatibility validation (§20).
 *
 * Dashboards are just schema documents, so they're inherently shareable —
 * but a shared layout is never a raw dump. Export sanitizes: profiles and
 * anything session-shaped never travel; personal URLs become slot
 * placeholders; custom URLs are reduced to their origin. Import is the
 * reverse: fill the slots from the importer's own tiles.
 *
 * Validation (§20 geometry check): because the solver is deterministic,
 * fit is computable — a normalized aspect-cost score per device profile,
 * with degenerate results (sliver tiles) flagged.
 */

import type {
  AudioSpec,
  DashboardDocument,
  GridSpec,
  InputMap,
  LayoutSpec,
  ScheduleEntry,
  ThemeSpec,
  TileSpec,
} from "./types.js";
import { fitQuality } from "./solver.js";
import { layoutDashboard, tileToSolverTile } from "./layout.js";

export const SHARE_SCHEMA = "frame.layout-share/v0.1";

/** Slot names auto-recognized in first-party-ish URLs (path/host segments). */
export const KNOWN_SLOTS = [
  "calendar",
  "photos",
  "weather",
  "notes",
  "chores",
  "radio",
  "news",
  "ticker",
] as const;

export interface SharedTile extends Omit<TileSpec, "profile" | "url"> {
  /** Public URL kept only for adapter-bound tiles, query/hash stripped. */
  url?: string;
  /** Slot placeholder: a known type ("calendar") or "custom". */
  slot?: string;
  /** For custom slots: origin only — never paths or query strings. */
  suggestedUrl?: string;
}

export interface SharedLayout {
  schema: typeof SHARE_SCHEMA;
  name: string;
  layout?: LayoutSpec;
  grid?: GridSpec;
  theme?: ThemeSpec;
  audio?: AudioSpec;
  schedule?: ScheduleEntry[];
  inputs?: InputMap;
  /** Attribution chain ("remixed from…"), §15. */
  remixOf?: string;
  tiles: SharedTile[];
}

export interface ExportOptions {
  /** Override slot detection; return a slot name, "custom", or null (keep public URL). */
  slotFor?: (tile: TileSpec) => string | null;
  remixOf?: string;
}

function detectSlot(url: URL): string | null {
  const haystack = [
    ...url.pathname.toLowerCase().split("/"),
    ...url.hostname.toLowerCase().split("."),
  ];
  for (const slot of KNOWN_SLOTS) {
    if (haystack.includes(slot)) return slot;
  }
  return null;
}

/** §15 export sanitization (normative). */
export function exportLayout(doc: DashboardDocument, opts?: ExportOptions): SharedLayout {
  const tiles: SharedTile[] = doc.tiles.map((tile) => {
    //

    const { profile: _profile, url, ...rest } = tile;
    const shared: SharedTile = { ...rest };
    if (!url) return shared; // launch/urlless tiles carry nothing personal

    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      /* malformed URL — treat as custom below */
    }

    const slot = opts?.slotFor ? opts.slotFor(tile) : parsed ? detectSlot(parsed) : "custom";

    if (slot === null && tile.adapter && parsed) {
      // Public adapter-bound site: transferable, but query/hash never travel.
      shared.url = parsed.origin + parsed.pathname;
      return shared;
    }
    if (slot && slot !== "custom") {
      shared.slot = slot;
      return shared;
    }
    shared.slot = "custom";
    if (parsed) shared.suggestedUrl = parsed.origin; // domain only (§15)
    return shared;
  });

  return {
    schema: SHARE_SCHEMA,
    name: doc.name,
    ...(doc.layout !== undefined ? { layout: doc.layout } : {}),
    ...(doc.grid !== undefined ? { grid: doc.grid } : {}),
    ...(doc.theme !== undefined ? { theme: doc.theme } : {}),
    ...(doc.audio !== undefined ? { audio: doc.audio } : {}),
    ...(doc.schedule !== undefined ? { schedule: doc.schedule } : {}),
    ...(doc.inputs !== undefined ? { inputs: doc.inputs } : {}),
    ...(opts?.remixOf !== undefined ? { remixOf: opts.remixOf } : {}),
    tiles,
  };
}

export interface SlotPrompt {
  tile: string;
  slot: string;
  suggestedUrl?: string;
}

/** What the importer must fill: one prompt per slot tile (§15 "fill the slots"). */
export function importPlan(shared: SharedLayout): SlotPrompt[] {
  return shared.tiles
    .filter((t) => t.slot)
    .map((t) => ({
      tile: t.id,
      slot: t.slot!,
      ...(t.suggestedUrl !== undefined ? { suggestedUrl: t.suggestedUrl } : {}),
    }));
}

export interface ImportResult {
  doc: DashboardDocument;
  /** Slot tiles the importer didn't fill — excluded from the document. */
  missing: string[];
}

/**
 * Build a dashboard from a shared layout. `fills` maps slot-tile ids to the
 * importer's own URLs. Profiles never travel (§15) — tiles get the §10
 * implicit per-tile profile unless the importer assigns one later.
 */
export function importLayout(
  shared: SharedLayout,
  id: string,
  fills: Record<string, string>,
): ImportResult {
  const missing: string[] = [];
  const tiles: TileSpec[] = [];
  for (const t of shared.tiles) {
    const { slot, suggestedUrl: _s, ...rest } = t;
    if (!slot) {
      tiles.push({ ...rest });
      continue;
    }
    const url = fills[t.id];
    if (!url) {
      missing.push(t.id);
      continue;
    }
    tiles.push({ ...rest, url });
  }
  return {
    doc: {
      schema: "frame.dashboard/v0.1",
      id,
      name: shared.name,
      ...(shared.layout !== undefined ? { layout: shared.layout } : {}),
      ...(shared.grid !== undefined ? { grid: shared.grid } : {}),
      ...(shared.theme !== undefined ? { theme: shared.theme } : {}),
      ...(shared.audio !== undefined ? { audio: shared.audio } : {}),
      ...(shared.schedule !== undefined ? { schedule: shared.schedule } : {}),
      ...(shared.inputs !== undefined ? { inputs: shared.inputs } : {}),
      tiles,
    },
    missing,
  };
}

/* ------------------------- §20 geometry check ------------------------- */

export interface DeviceProfileSpec {
  id: string;
  w: number;
  h: number;
}

/** The gallery's standard device sweep (editor's device set). */
export const DEVICE_PROFILES: DeviceProfileSpec[] = [
  { id: "tablet", w: 16, h: 10 },
  { id: "tv", w: 16, h: 9 },
  { id: "portrait", w: 9, h: 16 },
  { id: "monitor", w: 4, h: 3 },
];

export interface FitReportEntry {
  profile: string;
  /** Mean fitQuality across tiles: 1 = every tile at its ideal aspect. */
  score: number;
  grade: "excellent" | "good" | "poor";
  /** Tiles below minimum readable size — degenerate results (§20). */
  sliverTiles: string[];
}

const SLIVER_FRACTION = 0.12; // of the short axis — below this is unreadable

export function fitReport(
  doc: DashboardDocument,
  profiles: DeviceProfileSpec[] = DEVICE_PROFILES,
): FitReportEntry[] {
  return profiles.map((p) => {
    const W = 1000;
    const H = (1000 * p.h) / p.w;
    const rects = layoutDashboard(doc, { w: W, h: H });
    const minSize = Math.min(W, H) * SLIVER_FRACTION;
    let total = 0;
    let counted = 0;
    const sliverTiles: string[] = [];
    for (const tile of doc.tiles) {
      const rect = rects[tile.id];
      if (!rect) continue;
      counted += 1;
      total += fitQuality(rect, tileToSolverTile(tile).hint);
      if (rect.w < minSize || rect.h < minSize) sliverTiles.push(tile.id);
    }
    const score = counted ? total / counted : 0;
    const grade: FitReportEntry["grade"] =
      sliverTiles.length > 0 ? "poor" : score > 0.75 ? "excellent" : score > 0.5 ? "good" : "poor";
    return { profile: p.id, score, grade, sliverTiles };
  });
}
