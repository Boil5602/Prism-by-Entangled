/**
 * Intermission (spec §26, normative): during ad breaks a tile fades to an
 * intermission surface and fades back when content resumes. Nothing is
 * blocked, skipped, or injected — the frame chooses what the wall shows.
 *
 * Detection arrives as adapter `frame.adBreak` signals (passive DOM
 * observation, adapter-repo territory). This controller owns the asymmetric
 * bias — the two errors are not equal:
 *
 * - MUTE FAST (2026-09-15): a tile whose breaks mute is muted on the FIRST
 *   concurrent sign, before any window - a wrong mute costs a one-second dip
 *   in a song and is lifted the moment the signal drops. The two to three
 *   seconds of ad the room heard were the page's sustain plus this window.
 * - COVER SLOW: the scenery (and the soundscape) engage only after the
 *   signal sustains a debounce window (~1s). An ad showing through is free.
 * - UNCOVER FAST: any end signal drops the overlay immediately — audio
 *   restored before the fade. Covering one second of content is the real
 *   failure.
 * - SAFETY TIMEOUT: a missed end-signal can never trap a tile behind
 *   scenery.
 * - Degradation is always "no feature", never "broken video".
 */

import { cardAttribution } from "./imagery-pack.js";
import type { AttributionMode, CardAttribution, PackImage } from "./imagery-pack.js";

export interface IntermissionHooks {
  show(id: string, source: string): unknown;
  hide(id: string): unknown;
  setMuted(id: string, muted: boolean): unknown;
  /** §26 ambient audio (opt-in): start (on) or fade out (off) the tile's soundscape for the break the audio is muted for. */
  ambient?(id: string, sound: string, on: boolean): unknown;
  /** §26 pass-through: show/hide the real Skip chip on the scenery. */
  setSkip?(id: string, available: boolean, target?: string | null): unknown;
}

export interface IntermissionTileConfig {
  id: string;
  enabled: boolean;
  source: string;
  audio: "mute" | "keep";
  /** The soundscape for this tile's breaks, when a person chose one. */
  ambient?: string | null;
}

export interface IntermissionOptions {
  /** Sustained-signal window before covering. */
  debounceMs?: number;
  /** Backstop for a missed end signal. */
  safetyTimeoutMs?: number;
}

const DEFAULTS: Required<IntermissionOptions> = {
  debounceMs: 1_000,
  safetyTimeoutMs: 120_000,
};

type Timer = ReturnType<typeof setTimeout>;

/**
 * The §26 card as core models it. The shell picks the picture (it owns the
 * pack cache); it reports what it put up with `setImagery`, and this is what
 * every shell renders in the corner — one rule, one line, everywhere.
 */
export interface IntermissionCard {
  id: string;
  /** `pack:gallery` / `pack:cosmos` / a photos reference. */
  source: string;
  covered: boolean;
  /** §26 minimal mode: the card collapsed to its corner chip. Persists per tile. */
  minimal: boolean;
  /** The image on screen right now, straight from the local manifest. */
  image: PackImage | null;
  /** The corner line for the current mode; null until the shell names an image. */
  attribution: CardAttribution | null;
}

interface TileState {
  config: IntermissionTileConfig;
  covered: boolean;
  /** B-175: the safety backstop lifted the scenery while the page still said "ad" - the mute waits for the page's own end signal. */
  muteHeld: boolean;
  /** Mute fast (2026-09-15): the tile was muted on the first sign, ahead of the cover; lifted when the signal drops or the break ends. */
  fastMuted: boolean;
  /** §26 minimal mode (card minimize) — the choice persists per tile/site. */
  minimal: boolean;
  /** The pack image the shell is currently showing, for the §26 card corner. */
  image: PackImage | null;
  /** Adapter observed the player's own skip affordance (§26 pass-through). */
  skipAvailable: boolean;
  /** Observed control selector, when the adapter reported one with the signal. */
  skipTarget: string | null;
  debounceTimer: Timer | null;
  safetyTimer: Timer | null;
}

export class IntermissionController {
  private opts: Required<IntermissionOptions>;
  private tiles = new Map<string, TileState>();

  constructor(
    private hooks: IntermissionHooks,
    options?: IntermissionOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Reconcile with the active dashboard; anything covered uncovers. Minimal
   * mode is a persisted per-tile choice (§26) and survives reconfiguration.
   */
  /** Change a tile's soundscape in place - no reset, so a running break keeps its state. */
  setAmbient(id: string, ambient: string | null): boolean {
    const t = this.tiles.get(id);
    if (!t) return false;
    const was = t.config.ambient ?? null;
    t.config = { ...t.config, ambient };
    if (t.covered && t.config.audio === "mute") {
      if (was && !ambient) void this.hooks.ambient?.(id, was, false);
      if (ambient) void this.hooks.ambient?.(id, ambient, true);
    }
    return true;
  }

  configure(configs: readonly IntermissionTileConfig[]): void {
    const minimal = new Map([...this.tiles].map(([id, t]) => [id, t.minimal]));
    for (const id of [...this.tiles.keys()]) this.drop(id);
    for (const config of configs) {
      if (config.enabled) {
        this.tiles.set(config.id, {
          config,
          covered: false,
          minimal: minimal.get(config.id) ?? false,
          image: null,
          skipAvailable: false,
          skipTarget: null,
          debounceTimer: null,
          safetyTimer: null,
          muteHeld: false,
          fastMuted: false,
        });
      }
    }
  }

  isCovered(id: string): boolean {
    return this.tiles.get(id)?.covered ?? false;
  }

  /**
   * §26 card corner: the shell names the image it just put on the scenery,
   * read from the pack's LOCAL manifest. Nothing about the image is ever
   * looked up over the network (§19/§22) — there is no lookup to make.
   */
  setImagery(id: string, image: PackImage | null): void {
    const tile = this.tiles.get(id);
    if (tile) tile.image = image;
  }

  /** §26 minimal mode (card minimize): one tap toggles, the choice persists. */
  setMinimal(id: string, minimal: boolean): void {
    const tile = this.tiles.get(id);
    if (tile) tile.minimal = minimal;
  }

  isMinimal(id: string): boolean {
    return this.tiles.get(id)?.minimal ?? false;
  }

  /** The current card model, or null when this tile is not intermission-enabled. */
  card(id: string): IntermissionCard | null {
    const tile = this.tiles.get(id);
    if (!tile) return null;
    const mode: AttributionMode = tile.minimal ? "minimal" : "card";
    return {
      id,
      source: tile.config.source,
      covered: tile.covered,
      minimal: tile.minimal,
      image: tile.image,
      attribution: tile.image ? cardAttribution(tile.image, mode) : null,
    };
  }

  /** §26: the player's skip control exists right now (observation, not action). */
  isSkipAvailable(id: string): boolean {
    return this.tiles.get(id)?.skipAvailable ?? false;
  }

  /** The covered tile whose skip is available — target of the mapped remote key. */
  skipTarget(): string | null {
    for (const [id, t] of this.tiles) if (t.covered && t.skipAvailable) return id;
    for (const [id, t] of this.tiles) if (t.skipAvailable) return id;
    return null;
  }

  /**
   * Adapter observation of the skip affordance. This NEVER triggers a skip:
   * it only makes the chip reachable through the scenery. The forward
   * happens in the orchestrator, solely on a human action.
   */
  onSkipAvailable(id: string, available: boolean, target?: string): void {
    const tile = this.tiles.get(id);
    if (!tile) return;
    tile.skipTarget = available && target ? target : null;
    if (tile.skipAvailable === available) return;
    tile.skipAvailable = available;
    if (tile.covered) void this.hooks.setSkip?.(id, available, tile.skipTarget);
  }

  /** The observed skip control's selector, if the adapter reported one. */
  skipTargetSelector(id: string): string | null {
    return this.tiles.get(id)?.skipTarget ?? null;
  }

  onAdBreak(id: string, active: boolean, sustainedMs = 0): void {
    const tile = this.tiles.get(id);
    if (!tile) return; // not intermission-enabled — signals are inert

    if (!active) {
      // Uncover fast: end signal OR doubt drops the overlay immediately.
      this.releaseHeldMute(id, tile);
      this.uncover(id, tile);
      return;
    }
    if (tile.covered || tile.debounceTimer) return;
    // Mute fast (2026-09-15): the sound goes now, on the first sign - the errors are not equal here either, and a
    // wrong mute is a one-second dip in a song, lifted the moment the signal drops (below, in the !active branch)
    if (tile.config.audio === "mute" && !tile.fastMuted) { tile.fastMuted = true; void this.hooks.setMuted(id, true); }
    // Cover slow: the scenery and the soundscape wait for the signal to sustain the debounce window.
    // A signal the adapter already sustained page-side (adSignalSustainedMs) has done part of the waiting: the window
    // shortens by that much, never below 200 ms (2026-09-14: Pandora's ad was audible for ~3 s before the cover).
    tile.debounceTimer = setTimeout(() => {
      tile.debounceTimer = null;
      this.cover(id, tile);
    }, Math.max(200, this.opts.debounceMs - Math.max(0, sustainedMs || 0)));
  }

  /** Tile left the dashboard / reloaded — observer lost its footing: doubt. */
  drop(id: string): void {
    const tile = this.tiles.get(id);
    if (tile) { this.releaseHeldMute(id, tile); this.uncover(id, tile); }
    this.tiles.delete(id);
  }

  /** B-175: the page said its break ended (or left) - a mute the backstop held is lifted now. */
  private releaseHeldMute(id: string, tile: TileState): void {
    if (!tile.muteHeld) return;
    tile.muteHeld = false;
    if (tile.config.audio === "mute") void this.hooks.setMuted(id, false);
  }

  private cover(id: string, tile: TileState): void {
    tile.covered = true;
    if (tile.config.audio === "mute" && !tile.fastMuted) void this.hooks.setMuted(id, true);   // already silent since the first sign
    tile.fastMuted = false;   // from here the cover owns the mute (uncover lifts it, the backstop holds it)
    if (tile.config.audio === "mute" && tile.config.ambient) void this.hooks.ambient?.(id, tile.config.ambient, true);   // instead of silence
    void this.hooks.show(id, tile.config.source);
    if (tile.skipAvailable) void this.hooks.setSkip?.(id, true, tile.skipTarget);
    tile.safetyTimer = setTimeout(() => {
      tile.safetyTimer = null;
      // §26 backstop - never trapped behind scenery. B-175 (2026-09-09): but a page still saying "ad" is not unmuted into the
      // room (Spotify's stalled break came back at full volume this way); the mute waits for the page's own end signal, and a
      // person's unmute - the wall's switch - still wins at once.
      if (tile.config.audio === "mute") tile.muteHeld = true;
      this.uncover(id, tile, true);
    }, this.opts.safetyTimeoutMs);
  }

  private uncover(id: string, tile: TileState, keepMute = false): void {
    if (tile.debounceTimer) {
      clearTimeout(tile.debounceTimer);
      tile.debounceTimer = null;
    }
    if (!tile.covered) {
      // a fast mute the signal did not sustain (a flicker, or the break ending inside the window): the sound comes back now
      if (tile.fastMuted) { tile.fastMuted = false; if (tile.config.audio === "mute" && !keepMute) void this.hooks.setMuted(id, false); }
      return;
    }
    if (tile.safetyTimer) {
      clearTimeout(tile.safetyTimer);
      tile.safetyTimer = null;
    }
    tile.covered = false;
    // Restore audio BEFORE the fade completes (§26 asymmetry).
    if (tile.config.audio === "mute" && !keepMute) void this.hooks.setMuted(id, false);
    if (tile.config.ambient) void this.hooks.ambient?.(id, tile.config.ambient, false);
    void this.hooks.setSkip?.(id, false);
    void this.hooks.hide(id);
  }
}
