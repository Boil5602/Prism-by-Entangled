/**
 * Music state (dashboard-schema §32, layer 2): what each hidden music facet's
 * page publishes through `navigator.mediaSession` — title / artist / album /
 * artwork / playback state — the same data services maintain for lock
 * screens, so no per-service scraping. Visualizations (§32 placement model)
 * read their feed from here: a visualization whose source is not playing
 * idles dark.
 *
 * Reveal/collapse (§32 "reveal is transient") is runtime state here too —
 * never a placement, never persisted: the native player is a visitor.
 */

import type { Visualization } from "./scene-model.js";
import { PRISM_BANDS, dominantColors, tintPalette } from "./visualization.js";

export type MediaPlaybackState = "none" | "paused" | "playing";

export interface MediaSessionMetadata {
  title?: string;
  artist?: string;
  album?: string;
  /** The largest artwork URL the page declared; null = none. */
  artwork?: string | null;
}

/** What the injected Media Session observer posts, per hidden music facet. */
export type MediaSessionEvent =
  | { type: "metadata"; metadata: MediaSessionMetadata }
  | { type: "playbackState"; state: MediaPlaybackState }
  | { type: "position"; position: number | null; duration: number | null }
  | { type: "actions"; actions: string[] }
  | { type: "gone" };

export interface MusicSourceState {
  facet: string;
  playbackState: MediaPlaybackState;
  metadata: MediaSessionMetadata;
  position: number | null;
  duration: number | null;
  /** Media Session actions the page registered — what transport may offer (disabled otherwise, never hidden). */
  actions: string[];
  updatedAt: number;
}

export const TRANSPORT_ACTIONS = ["play", "pause", "previoustrack", "nexttrack"] as const;
export type TransportAction = (typeof TRANSPORT_ACTIONS)[number];

/** What a visualization renders from: active only while its source plays. */
export interface VisualizationFeed {
  visualization: string;
  source: string;
  /** false = idle dark (no source, or the source is not playing). */
  active: boolean;
  playbackState: MediaPlaybackState;
  metadata: MediaSessionMetadata | null;
  /** Artwork the placement's mode allows: null when off or none declared. */
  artwork: string | null;
  artworkMode: Visualization["artwork"];
  style: Visualization["style"];
  /**
   * §32 / concept-scenes §2.5.2 point 2: the style pack's palette, tinted
   * toward the art's dominant colours in `backdrop` mode. CORE computes it
   * (`tintPalette` over `dominantColors`) so no shell re-derives a palette of
   * its own; a renderer paints these hex strings and asks no questions.
   */
  palette: string[];
  /** The dominant colours core derived from the art (backdrop only), or null. */
  dominant: string[] | null;
  /**
   * §3 audio focus: this feed's hidden source owns audio right now. The
   * metadata line reads "♪ exclusive" when true and "muted" when false — a shell never guesses this
   * (2026-09-08: the "hidden facet" prefix went - "seems unnecessary").
   */
  audioOwner: boolean;
}

/** What a shell/orchestrator knows about a feed beyond its source's Media Session state. */
export interface VisualizationFeedContext {
  /** How far the backdrop tint may pull the palette toward the artwork (0..1; default 0.6). */
  artTint?: number;
  /** The style pack's palette (a shell registers its loaded packs); PRISM_BANDS when unknown. */
  basePalette?: readonly string[];
  /** Dominant colours of the current artwork, derived by core from the shell's pixel sample. */
  dominant?: readonly string[] | null;
  /** The tile/facet that owns audio focus (§3) right now. */
  audioOwner?: string | null;
}

export interface RevealState {
  /** The hidden facet whose native player is showing as a transient overlay, or null. */
  facet: string | null;
  mode: "panel" | "hero" | "window";
}

export function emptySource(facet: string, at = 0): MusicSourceState {
  return { facet, playbackState: "none", metadata: {}, position: null, duration: null, actions: [], updatedAt: at };
}

/** Pure reducer: one observer event onto one source's state. */
export function reduceSource(state: MusicSourceState, event: MediaSessionEvent, at: number): MusicSourceState {
  switch (event.type) {
    case "metadata": {
      const m: MediaSessionMetadata = {};
      if (typeof event.metadata.title === "string") m.title = event.metadata.title;
      if (typeof event.metadata.artist === "string") m.artist = event.metadata.artist;
      if (typeof event.metadata.album === "string") m.album = event.metadata.album;
      if (event.metadata.artwork === null || typeof event.metadata.artwork === "string") m.artwork = event.metadata.artwork;
      return { ...state, metadata: m, updatedAt: at };
    }
    case "playbackState":
      return { ...state, playbackState: event.state === "playing" || event.state === "paused" ? event.state : "none", updatedAt: at };
    case "position":
      return { ...state, position: event.position, duration: event.duration, updatedAt: at };
    case "actions":
      return { ...state, actions: event.actions.filter((a) => typeof a === "string"), updatedAt: at };
    case "gone":
      return emptySource(state.facet, at);
  }
}

/** The feed a visualization gets from its source (idle dark without a playing source). */
export function visualizationFeed(viz: Visualization, source: MusicSourceState | undefined, ctx: VisualizationFeedContext = {}): VisualizationFeed {
  const playing = source?.playbackState === "playing";
  const art = source?.metadata.artwork ?? null;
  const base = ctx.basePalette && ctx.basePalette.length ? ctx.basePalette : PRISM_BANDS;
  // §32: only `backdrop` tints — focal and off keep the pack's palette, and a track with no art keeps it too.
  const tinting = viz.artwork === "backdrop" && playing && !!art;
  const dominant = tinting && ctx.dominant && ctx.dominant.length ? [...ctx.dominant] : null;
  return {
    visualization: viz.id,
    source: viz.source,
    active: playing,
    playbackState: source?.playbackState ?? "none",
    metadata: source && playing ? source.metadata : null,
    artwork: viz.artwork === "off" || !playing ? null : art,
    artworkMode: viz.artwork,
    style: viz.style,
    palette: dominant ? tintPalette(base, dominant, ctx.artTint ?? 0.6) : [...base],
    dominant,
    audioOwner: !!ctx.audioOwner && ctx.audioOwner === viz.source,
  };
}

/** Transport a control may offer for a source: registered actions enable, the rest render disabled (never hidden). */
export function transportAvailability(source: MusicSourceState | undefined): Record<TransportAction, boolean> {
  const set = new Set(source?.actions ?? []);
  return {
    play: set.has("play") || source?.playbackState === "paused",
    pause: set.has("pause") || source?.playbackState === "playing",
    previoustrack: set.has("previoustrack"),
    nexttrack: set.has("nexttrack"),
  };
}

/**
 * Runtime holder: sources keyed by hidden facet id, feeds for the scene's
 * visualizations, and the transient reveal. Nothing here is a placement.
 */
export class MusicStateModel {
  private sources = new Map<string, MusicSourceState>();
  private reveal: RevealState = { facet: null, mode: "panel" };
  /** style id → the pack's palette, as the shell that loaded the pack declared it. */
  private palettes = new Map<string, string[]>();
  /** facet → the dominant colours core derived for the artwork currently on that source. */
  private art = new Map<string, { url: string; dominant: string[] }>();

  /** Which facets are music sources right now (a scene's hidden music facets). */
  configure(facets: readonly string[]): void {
    const keep = new Set(facets);
    for (const id of [...this.sources.keys()]) if (!keep.has(id)) this.sources.delete(id);
    for (const id of this.art.keys()) if (!keep.has(id)) this.art.delete(id);
    for (const id of facets) if (!this.sources.has(id)) this.sources.set(id, emptySource(id));
    if (this.reveal.facet && !keep.has(this.reveal.facet)) this.reveal = { facet: null, mode: "panel" };
  }

  /**
   * A shell declares the palettes of the style packs it loaded (`{styleId: ["#RRGGBB", …]}`).
   * Core keeps them so IT can tint (§32 backdrop) instead of every shell writing its own
   * `tintPalette`. Unknown styles fall back to PRISM_BANDS. Returns how many were accepted;
   * a malformed entry is dropped, never guessed at.
   */
  /**
   * A pack's palette, and how far the §32 backdrop tint may pull it toward the artwork (`artTint`,
   * 0..1, default 0.6). A tableau names 0.2: a muted album cover must not turn a street fair beige
   * (2026-09-06). Accepts the old shape (a bare hex list) and the new ({palette, artTint}).
   */
  registerStylePalettes(map: Record<string, unknown> | null | undefined): number {
    if (!map || typeof map !== "object") return 0;
    let n = 0;
    for (const [style, value] of Object.entries(map)) {
      const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { palette?: unknown }).palette) ? (value as { palette: unknown[] }).palette : null;
      if (!style || !list) continue;
      const hexes = (list as unknown[]).filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c));
      if (!hexes.length) continue;
      this.palettes.set(style, hexes.map((h) => h.toUpperCase()));
      const tint = !Array.isArray(value) ? (value as { artTint?: unknown }).artTint : undefined;
      if (typeof tint === "number" && Number.isFinite(tint)) this.tints.set(style, Math.min(1, Math.max(0, tint))); else this.tints.delete(style);
      n++;
    }
    return n;
  }

  private readonly tints = new Map<string, number>();
  /** How far this style's palette may be tinted toward the artwork (0..1). */
  styleTint(style: string): number { return this.tints.get(style) ?? 0.6; }

  stylePalette(style: string): string[] {
    return this.palettes.get(style) ?? [...PRISM_BANDS];
  }

  /**
   * §32 backdrop tint, one rule for every port: the shell samples the artwork
   * bitmap and hands over RGBA bytes; CORE derives the dominant colours. The
   * sample is remembered against the artwork url, so a stale sample never
   * tints the next track (a track change with no sample yet renders on the
   * pack's palette until one arrives).
   */
  noteArtworkColors(facet: string, url: string, rgba: Uint8Array | number[]): string[] | null {
    if (!this.sources.has(facet) || !url) return null;
    const dominant = dominantColors(rgba, 4);
    if (!dominant.length) { this.art.delete(facet); return null; }
    this.art.set(facet, { url, dominant });
    return dominant;
  }

  /** The dominant colours core holds for the artwork now on `facet`, or null (none sampled, or sampled for another track). */
  artworkColors(facet: string): string[] | null {
    const held = this.art.get(facet);
    if (!held) return null;
    return held.url === (this.sources.get(facet)?.metadata.artwork ?? null) ? held.dominant : null;
  }

  onMediaSession(facet: string, event: MediaSessionEvent, at: number = Date.now()): MusicSourceState | null {
    const prev = this.sources.get(facet);
    if (!prev) return null; // not a configured source: inert
    const next = reduceSource(prev, event, at);
    this.sources.set(facet, next);
    return next;
  }

  source(facet: string): MusicSourceState | undefined {
    return this.sources.get(facet);
  }

  sourcesPlaying(): string[] {
    return [...this.sources.values()].filter((s) => s.playbackState === "playing").map((s) => s.facet);
  }

  /** `audioOwner` is §3's focused media id (the orchestrator's `audio.focusedMedia`), never a guess. */
  feed(viz: Visualization, audioOwner: string | null = null): VisualizationFeed {
    return visualizationFeed(viz, this.sources.get(viz.source), {
      basePalette: this.stylePalette(viz.style), artTint: this.styleTint(viz.style),
      dominant: this.artworkColors(viz.source),
      audioOwner,
    });
  }

  feeds(visualizations: readonly Visualization[], audioOwner: string | null = null): VisualizationFeed[] {
    return visualizations.map((v) => this.feed(v, audioOwner));
  }

  /** §32 reveal: the hidden facet's native player as a temporary overlay. A visualization reveals its source. */
  revealSource(facet: string, mode: RevealState["mode"] = "panel"): RevealState {
    if (this.sources.has(facet)) this.reveal = { facet, mode };
    return this.reveal;
  }

  revealVisualization(viz: Visualization, mode: RevealState["mode"] = "panel"): RevealState {
    return this.revealSource(viz.source, mode);
  }

  collapse(): RevealState {
    this.reveal = { facet: null, mode: "panel" };
    return this.reveal;
  }

  revealed(): RevealState {
    return this.reveal;
  }
}
