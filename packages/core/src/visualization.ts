/**
 * Visualizations (dashboard-schema §32, layer 1): placeable audio-reactive
 * content whose source is a hidden music facet. ONE renderer in every shell,
 * driven by style packs (data under packages/core/data/visualization-styles):
 * Prism Beams · Spectrum · Ribbon · Bloom. This module holds what is shared —
 * the pack schema and its validation, the artwork-mode rules, the §16
 * crossfade timing, the reduced-motion posture, the palette tint from album
 * art, and the deterministic development signal every renderer can be
 * exercised against without audio.
 *
 * The audio itself is the shell's: a WASAPI loopback FFT (SM-4) feeds
 * `bands(n)` frames; the renderer never touches a page.
 *
 * Seam (ledger B-50, for SM-4): `VisualizationDriver` is the surface op a
 * shell implements so core can place, feed and remove visualizations exactly
 * like web surfaces. Until it lands the host renders into a plain canvas
 * from the same contract.
 */

import type { ArtworkMode, VisualizationStyle } from "./scene-model.js";
import type { VisualizationFeed } from "./music-state.js";
import type { Rect } from "./solver.js";

/** The brand's four bands (prism-build-wizard.jsx tokens): the default palette when no art tints it. */
export const PRISM_BANDS: readonly string[] = ["#F0A83C", "#5CC8C0", "#C86CF0", "#F05C7A"];

export const VISUALIZATION_STYLE_IDS: readonly VisualizationStyle[] = ["prism-beams", "spectrum", "ribbon", "bloom", "aurora-ridge", "ocean-moon", "forest-fireflies", "rain-window", "snow-village", "desert-stars", "storm-front", "sunrise-meadow", "campfire-circle", "city-skyline", "lantern-festival", "fireworks-night", "harbor-lights", "night-train", "street-fair", "stadium-wave"];

/** The sixteen tableau programs (a pack's `program` names the tableau it draws); the four originals are beams / bars / ribbon / particles. */
export const TABLEAU_PROGRAMS: readonly string[] = ["aurora-ridge", "ocean-moon", "forest-fireflies", "rain-window", "snow-village", "desert-stars", "storm-front", "sunrise-meadow", "campfire-circle", "city-skyline", "lantern-festival", "fireworks-night", "harbor-lights", "night-train", "street-fair", "stadium-wave"];

export const ARTWORK_MODES: readonly ArtworkMode[] = ["off", "backdrop", "focal"];

export interface StyleMotion {
  /** Base animation speed, 1 = the pack's design speed. */
  speed: number;
  /** Per-frame decay of a band's level toward the live value (0–1, higher = snappier). */
  attack: number;
  release: number;
  /** Beat sensitivity for pulse-driven packs (0 = ignore beats). */
  beat: number;
}

export interface StylePack {
  id: VisualizationStyle | string;
  name: string;
  blurb: string;
  /** Renderer program the pack selects — the shell has exactly these four. */
  program: string;   // "beams" | "bars" | "ribbon" | "particles" | one of TABLEAU_PROGRAMS
  /** Number of bands the pack asks the audio source for. */
  bands: number;
  /** Default palette (CSS hex), tinted by album art in backdrop mode. */
  palette: string[];
  /** Background; "transparent" lets the scene show through (§32: transparent background). */
  background: string;
  motion: StyleMotion;
  /** What the pack does under reduced motion: levels move gently, nothing flies. */
  reducedMotion: { speed: number; beat: number };
  /** Pack-specific knobs the program reads (beam count, bar gap, trail length, particle cap…). */
  params: Record<string, number>;
}

export const DEFAULT_MOTION: Readonly<StyleMotion> = { speed: 1, attack: 0.55, release: 0.12, beat: 0.6 };

const HEX = /^#[0-9a-fA-F]{6}$/;
const PROGRAMS = new Set(["beams", "bars", "ribbon", "particles", ...TABLEAU_PROGRAMS]);

/** Validate an untrusted pack file (a community pack is data; a malformed one is refused, never guessed). */
export function normalizeStylePack(input: unknown): StylePack | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const m = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const id = str(m.id), program = str(m.program);
  if (!id || !/^[a-z0-9-]+$/.test(id) || !program || !PROGRAMS.has(program)) return null;
  const palette = Array.isArray(m.palette) ? (m.palette as unknown[]).filter((c): c is string => typeof c === "string" && HEX.test(c)) : [];
  const motionIn = (m.motion && typeof m.motion === "object" ? m.motion : {}) as Record<string, unknown>;
  const rmIn = (m.reducedMotion && typeof m.reducedMotion === "object" ? m.reducedMotion : {}) as Record<string, unknown>;
  const params: Record<string, number> = {};
  if (m.params && typeof m.params === "object") for (const [k, v] of Object.entries(m.params as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
  const background = str(m.background);
  return {
    id,
    name: str(m.name) ?? id,
    blurb: str(m.blurb) ?? "",
    program: program as StylePack["program"],
    bands: Math.round(num(m.bands, 4, 128, 32)),
    palette: palette.length ? palette : [...PRISM_BANDS],
    background: background && (background === "transparent" || HEX.test(background)) ? background : "transparent",
    motion: {
      speed: num(motionIn.speed, 0.1, 4, DEFAULT_MOTION.speed),
      attack: num(motionIn.attack, 0.01, 1, DEFAULT_MOTION.attack),
      release: num(motionIn.release, 0.01, 1, DEFAULT_MOTION.release),
      beat: num(motionIn.beat, 0, 2, DEFAULT_MOTION.beat),
    },
    reducedMotion: { speed: num(rmIn.speed, 0, 1, 0.25), beat: num(rmIn.beat, 0, 1, 0) },
    params,
  };
}

/** §16: track changes crossfade the art; reduced motion keeps the dissolve, drops the drift. */
export const ARTWORK_CROSSFADE_MS = 400;

export interface ArtworkPresentation {
  mode: ArtworkMode;
  /** The url to show, or null (off / none declared / not playing). */
  url: string | null;
  /** Backdrop: blur radius as a fraction of the short side; focal: 0. */
  blur: number;
  /** Backdrop dims the art so the visualization reads; focal keeps it sharp. */
  dim: number;
  /** Slow drift on the backdrop (Ken Burns); static under reduced motion. */
  drift: boolean;
  crossfadeMs: number;
}

/** What the renderer does with the feed's artwork under the placement's mode (§32 artwork modes). */
export function artworkPresentation(feed: Pick<VisualizationFeed, "artwork" | "artworkMode" | "active">, reducedMotion: boolean): ArtworkPresentation {
  const base = { crossfadeMs: ARTWORK_CROSSFADE_MS };
  if (feed.artworkMode === "off" || !feed.active || !feed.artwork) return { mode: feed.artworkMode, url: null, blur: 0, dim: 0, drift: false, ...base };
  if (feed.artworkMode === "focal") return { mode: "focal", url: feed.artwork, blur: 0, dim: 0.1, drift: false, ...base };
  return { mode: "backdrop", url: feed.artwork, blur: 0.06, dim: 0.55, drift: !reducedMotion, ...base };
}

/* --------------------------------------------------------- palette ---- */

export interface Rgb { r: number; g: number; b: number }

export function hexToRgb(hex: string): Rgb | null {
  if (!HEX.test(hex)) return null;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase();
}

/**
 * Tint a pack's palette toward the art's dominant colors (backdrop mode):
 * each band moves `amount` of the way toward the dominant color it is
 * paired with (round-robin when the art has fewer). Focal and off keep the
 * pack's palette; no art → the default palette (§32).
 */
export function tintPalette(palette: readonly string[], dominant: readonly string[] | null | undefined, amount = 0.6): string[] {
  const doms = (dominant ?? []).map(hexToRgb).filter((c): c is Rgb => !!c);
  if (!doms.length) return [...palette];
  const a = Math.min(1, Math.max(0, amount));
  return palette.map((hex, i) => {
    const base = hexToRgb(hex);
    if (!base) return hex;
    const d = doms[i % doms.length]!;
    return rgbToHex({ r: base.r + (d.r - base.r) * a, g: base.g + (d.g - base.g) * a, b: base.b + (d.b - base.b) * a });
  });
}

/**
 * Dominant colors by coarse quantization of sampled pixels (RGBA bytes):
 * 4 bits per channel buckets, the top `count` buckets by weight, skipping
 * near-black/near-white so the tint has hue. Deterministic; the shell
 * samples a downscaled bitmap and hands the bytes over.
 */
export function dominantColors(rgba: Uint8Array | number[], count = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!, a = rgba[i + 3]!;
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 40 || (min > 215 && max - min < 30)) continue; // near-black / near-white
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  return [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, count)
    .map((e) => rgbToHex({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }));
}

/* ---------------------------------------------------- audio source ---- */

/** What a renderer reads each frame: `n` band levels in 0–1, low to high. The shell's FFT feed implements it. */
export interface VisualizationAudioSource {
  bands(n: number): number[];
  /** True while a source is producing signal (a silent feed idles the visualization dark). */
  active(): boolean;
}

/** Idle: a visualization with no playing source idles dark (§32). */
export const SILENT_SOURCE: VisualizationAudioSource = { bands: (n) => new Array<number>(Math.max(0, n)).fill(0), active: () => false };

/**
 * Deterministic development signal, identical in every port (the C# twin
 * is Visualizations/TestSignalAudioSource.cs): a slow sweep across the bands,
 * a 120 bpm pulse on the low bands, and a shimmer on the high ones. `t` is
 * seconds. Pure, so renderers can be tested frame-for-frame.
 */
export function testSignal(t: number, n: number): number[] {
  const out: number[] = [];
  if (n <= 0) return out;
  const beat = Math.pow(Math.max(0, Math.cos(((t % 0.5) / 0.5) * Math.PI * 2)), 4); // 120 bpm
  const sweep = (Math.sin(t * 0.7) + 1) / 2; // 0–1 across the band range
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i / (n - 1);
    const hump = Math.exp(-Math.pow((x - sweep) * 3.2, 2));
    const low = x < 0.25 ? beat * (1 - x / 0.25) : 0;
    const shimmer = x > 0.7 ? 0.15 * (Math.sin(t * 9 + i * 1.7) + 1) / 2 : 0;
    out.push(Math.min(1, Math.max(0, 0.08 + 0.6 * hump + 0.5 * low + shimmer)));
  }
  return out;
}

/* ------------------------------------------------------------- idle ---- */

/**
 * Idle floor and swing of the ambient signal. concept-scenes §2.5.2 point 6:
 * with no source, or a source that is not playing, the visualization settles
 * into a slow ambient drift — **never a black screen**. The floor is what
 * guarantees that: every band of every ambient frame is >= AMBIENT_FLOOR.
 */
export const AMBIENT_FLOOR = 0.05;
export const AMBIENT_SWING = 0.07;

/**
 * The idle signal a renderer draws when its source is silent: one slow wave
 * travelling across the bands, no beat, amplitude a fraction of the live
 * feed's. `t` is seconds. Pure and identical in every port (the C# twin is
 * Visualizations/TestSignalAudioSource.cs `AmbientSignal.Sample`), so the
 * "never a black screen" assertion is the same assertion everywhere.
 *
 * Reduced motion needs no separate curve: the pack's `reducedMotion.speed`
 * already scales the renderer's clock, and this signal carries no beat.
 */
export function ambientSignal(t: number, n: number): number[] {
  const out: number[] = [];
  if (n <= 0) return out;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i / (n - 1);
    const wave = (Math.sin(t * 0.18 + x * Math.PI * 1.6) + 1) / 2;
    out.push(AMBIENT_FLOOR + AMBIENT_SWING * wave);
  }
  return out;
}

/* ----------------------------------------------------------- base64 ---- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decode base64 to bytes without `atob` / `Buffer` — core runs in a WebView,
 * in node and in vitest, and a shell hands artwork pixels across the channel
 * as base64 (§32 backdrop tint: the SHELL samples, CORE derives the colors).
 * Malformed input yields the bytes decoded so far rather than throwing.
 */
export function decodeBase64Bytes(b64: string): Uint8Array {
  const clean = (b64 ?? "").replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, acc = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Smooth band levels toward the live frame with the pack's attack/release (per frame, pure). */
export function smoothBands(previous: readonly number[], live: readonly number[], motion: StyleMotion, reducedMotion: boolean): number[] {
  const n = live.length;
  const out = new Array<number>(n);
  const attack = reducedMotion ? Math.min(motion.attack, 0.2) : motion.attack;
  const release = reducedMotion ? Math.min(motion.release, 0.08) : motion.release;
  for (let i = 0; i < n; i++) {
    const p = previous[i] ?? 0, l = live[i] ?? 0;
    out[i] = l > p ? p + (l - p) * attack : p + (l - p) * release;
  }
  return out;
}

/* --------------------------------------------------------------- seam ---- */

export interface VisualizationCreateOptions {
  id: string;
  style: VisualizationStyle | string;
  artwork: ArtworkMode;
  /** The hidden music facet feeding it (audio + Media Session state). */
  source: string;
  rect: Rect;
  z: number;
}

/**
 * The seam op a shell implements for visualizations (ledger B-50; SM-4 wires
 * it into the channel beside surface.*). Same lifecycle verbs as a web
 * surface so core places, moves, fades and removes them uniformly; `setFeed`
 * carries the Media Session state (artwork, playing) the renderer presents.
 */
export interface VisualizationDriver {
  create(opts: VisualizationCreateOptions): void;
  setRect(id: string, rect: Rect): void;
  setZ(id: string, z: number): void;
  setOpacity(id: string, opacity: number): void;
  setFeed(id: string, feed: VisualizationFeed): void;
  /** §16: fade in over `durationMs` from dark; the shell never shows a partial frame. */
  reveal(id: string, durationMs: number): void;
  destroy(id: string): void;
}
