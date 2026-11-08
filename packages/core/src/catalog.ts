/**
 * Site catalog & tile picker output (spec §31).
 *
 * The catalog is DATA in prism-adapters/catalog (one JSON per optimized
 * site); this module is the logic both pickers (editor, host) share:
 * validating entries and turning a pick into a PLAIN tile — §31's rule that
 * nothing picker-specific persists is enforced here by construction: the
 * output is built field-by-field from a whitelist, and `assertPlainTile`
 * exists so tests (and shells, cheaply) can prove no stray field slipped in.
 *
 * Focus presets carry adapter selector NAMES, not CSS (catalog entries stay
 * stable while selector drift lives in the adapter repo). Resolution happens
 * at pick time against the adapter's named-selector table; an unresolvable
 * preset degrades to whole-page rather than persisting a dangling name.
 */

import type { FloatSpec, TileSpec } from "./types.js";

export interface CatalogPreset {
  id: string;
  label: string;
  /** Adapter selector NAME (resolved at pick time); null = whole page. */
  selector: string | null;
}

export interface CatalogEntry {
  id: string;
  name: string;
  url: string;
  adapter?: string;
  aspectHint: string;
  audio: "exclusive" | "mix" | "mute";
  poster: { source: "site"; fallback: "wordmark" };
  drm?: { "windows-host"?: "hardware" | "software" | "none"; evidence?: string };
  zoom?: number;
  focusPresets?: CatalogPreset[];
  notes?: string;
  /** §32: picking this adds a floating player (Prism's own control up, the page beneath), not a wall slot. */
  kind?: "slot" | "floating";
  /** Default place for a floating entry (wall fractions); core's default when absent. */
  float?: FloatSpec;
  /**
   * A service the household runs itself (Jellyfin, 2026-11-03): it has no fixed address, so `url` is a template holding `{server}`
   * ("{server}/web/#/home") and the shell asks for the server's address when the service is added (`ask`, with `example` as the box's
   * hint). The App's home and its pages are that address filled in; an adapter's page addresses are written against `{home}`.
   */
  address?: { ask: string; example?: string };
  /** The service's own public website, for its icon and mark when `url` is a template (nothing to fetch from a `{server}`). */
  site?: string;
}

/** The token a self-hosted entry's `url` carries where the household's own server address goes. */
export const SERVER_TOKEN = "{server}";

/** Whether an entry's address waits for the household's server (`{server}/...`). */
export function isServerTemplate(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(SERVER_TOKEN);
}

/**
 * The household's server address as typed, made into the one the template takes: http(s), absolute, no trailing slash
 * ("http://nas:8096/" -> "http://nas:8096"). null for anything else (a bare host is not guessed at: the shell asks again).
 */
export function ownServerAddress(typed: string | null | undefined): string | null {
  if (!typed) return null;
  let u: URL;
  try { u = new URL(typed.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:" || !u.hostname) return null;
  u.hash = ""; u.search = "";
  return u.toString().replace(/\/+$/, "");
}

/** A `{server}` template with the household's address in it; a plain address is returned as it is. */
export function fillServer(template: string, server: string | null | undefined): string | null {
  if (!isServerTemplate(template)) return template;
  const s = ownServerAddress(server);
  return s ? s + template.slice(SERVER_TOKEN.length) : null;
}

export interface PickerChoices {
  /** A self-hosted entry's server address (`address` in the entry), as the person typed it; required for such an entry, ignored otherwise. */
  url?: string;
  /** Chosen focus preset id; absent/whole → no focus. */
  presetId?: string;
  /** Zoom override (0.5–3); defaults to the entry's. */
  zoom?: number;
  /** §10 profile: named isolated profile, or share an existing tile's. */
  profile?: string;
  /** Tile id override (default: entry id, deduped by the caller). */
  tileId?: string;
  /** Region padding when a preset resolves (§17). */
  pad?: number;
}

/** The only fields a picker may write — §31: plain tile schema. */
export const PICKER_TILE_FIELDS = new Set([
  "id", "url", "adapter", "focus", "zoom", "profile", "aspectHint", "audio", "persist", "intermission", "veil",
  "kind", "float",
]);

/**
 * Build the tile a catalog pick produces. `selectorTable` is the adapter's
 * named-selector map (name → CSS); without it, presets degrade to whole page.
 */
export function pickerTile(
  entry: CatalogEntry,
  choices: PickerChoices = {},
  selectorTable?: Record<string, string>,
): TileSpec {
  const url = fillServer(entry.url, choices.url);
  if (!url) throw new Error(entry.name + " needs its server's address first");
  const tile: TileSpec = {
    id: choices.tileId ?? entry.id,
    url,
    aspectHint: entry.aspectHint,
    audio: entry.audio,
    profile: choices.profile ?? choices.tileId ?? entry.id,
    // an audible service tile survives layout churn (§16 warm cache posture)
    persist: entry.audio !== "mute",
  };
  if (entry.adapter) tile.adapter = entry.adapter;
  if (entry.kind === "floating") {
    // §32: a floating player - Prism's control up, the page beneath, no wall slot
    tile.kind = "floating";
    if (entry.float) tile.float = { ...entry.float };
  }
  // §26 on by default for catalog services: the wall shows what you choose.
  // Detection is adapter data; a service without detection simply never covers.
  tile.intermission = { enabled: true };
  // §27 gallery veil, default on. veil-only, stated honestly: the Windows
  // host has no network blocking yet, so ads load and the slots are visually
  // replaced; flips to block+art when the host implements §5 blocking.
  tile.veil = { mode: "veil-only" };

  const zoom = choices.zoom ?? entry.zoom;
  if (typeof zoom === "number" && zoom !== 1) tile.zoom = clampZoom(zoom);

  if (choices.presetId) {
    const preset = (entry.focusPresets ?? []).find((p) => p.id === choices.presetId);
    const css = preset?.selector ? selectorTable?.[preset.selector] : undefined;
    if (css) tile.focus = { selector: css, pad: choices.pad ?? 12 };
    // no table / unknown name → whole page; never persist a dangling name
  }
  return tile;
}

/**
 * §31 step 2 — "any website": the plain tile a URL becomes. No adapter, no
 * detection (it never covers), gallery veil on like every picked tile, and
 * an id/profile derived from the host ("news.ycombinator.com" → "news-ycombinator").
 * Returns null for anything but an http(s) URL. Callers dedupe the id.
 */
export function customTile(url: string, choices: PickerChoices = {}): TileSpec | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const id = choices.tileId ?? hostSlug(parsed.hostname);
  const tile: TileSpec = {
    id,
    url: parsed.toString(),
    audio: "mix",
    profile: choices.profile ?? id,
    persist: true,
  };
  tile.veil = { mode: "veil-only" };
  if (typeof choices.zoom === "number" && choices.zoom !== 1) tile.zoom = clampZoom(choices.zoom);
  return tile;
}

/** "www.example.co.uk" → "example-co"; "cnn.com" → "cnn"; never empty. */
export function hostSlug(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  const kept = labels.length >= 2 ? labels.slice(0, -1) : labels;
  const slug = kept.join("-").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "site";
}

/** §31 zoom bounds (0.5×–3×). */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(3, Math.max(0.5, zoom));
}

/**
 * Throws when a tile carries anything outside the picker whitelist — the
 * "no picker-only fields persist" guarantee as an assertion.
 */
export function assertPlainTile(tile: Record<string, unknown>): void {
  const strays = Object.keys(tile).filter((k) => !PICKER_TILE_FIELDS.has(k));
  if (strays.length) throw new Error("picker-only fields must not persist: " + strays.join(", "));
}

/** Minimal entry validation shared by pickers (the repo validator is stricter). */
export function validCatalogEntry(e: unknown): e is CatalogEntry {
  if (!e || typeof e !== "object") return false;
  const c = e as CatalogEntry;
  const ownServer = isServerTemplate(c.url) && typeof c.address?.ask === "string" && c.address.ask.length > 0;
  return typeof c.id === "string" && typeof c.name === "string" &&
    (/^https:\/\//.test(c.url ?? "") || ownServer) && typeof c.aspectHint === "string" &&
    (c.audio === "exclusive" || c.audio === "mix" || c.audio === "mute") &&
    c.poster?.source === "site" && c.poster?.fallback === "wordmark";
}
