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

/**
 * How a window's break looks (2026-10-07, "In watch settings, lets add 3 options for Video Ads: Show, Muted (Picture visible) and Veiled
 * and Muted. Default to Veiled."): veil = the scenery and the mute (§26 as written); mute = the ad's picture with its sound off, and an
 * Unmute on the window ("If an ad is muted only, I should have the option to unmute it"); show = the ad as it plays. The break is kept in
 * every look (covered, its backstop, its card state), so the shell can say a break is on and a look changed later applies at the next one.
 */
export type AdLook = "veil" | "mute" | "show";

export interface IntermissionHooks {
  show(id: string, source: string, look?: AdLook): unknown;
  hide(id: string): unknown;
  setMuted(id: string, muted: boolean): unknown;
  /** §26 ambient audio (opt-in): start (on) or fade out (off) the tile's soundscape for the break the audio is muted for. */
  ambient?(id: string, sound: string, on: boolean): unknown;
  /** §26 pass-through: show/hide the real Skip chip on the scenery. */
  setSkip?(id: string, available: boolean, target?: string | null): unknown;
  /** The look for this window's next break (absent: veil). */
  look?(id: string): AdLook;
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

/** The backstop past a break the page still counts: its clock's end and this much (B-336). */
const EXTEND_MARGIN_MS = 15_000;
/** ... and never further than this from now. */
const MAX_EXTENDED_MS = 10 * 60_000;

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
  /** When an extended backstop falls (B-336); unset for the plain one. */
  safetyDue?: number | undefined;
  /** The break clock at the last extension: only a clock still counting down extends (a stuck one lets the backstop fall). */
  clockAt?: number | undefined;
  /** The service's own backstop (adapter adBackstopMs): a break no page counts that runs past two minutes - a live channel's
   *  three-to-four-minute break, read off the picture (YouTube TV, 2026-10-06). The signal's end still uncovers at once. */
  backstopMs?: number | undefined;
  /** The look this break was put up with. */
  look: AdLook;
  /** A muted-only break the person unmuted: its sound stays on until the break ends. */
  unmuted: boolean;
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
    // a re-apply keeps a break that is on (B-346, 2026-10-06, "Ad on paramount displayed": the playback doctor renewed Twitch's window, the
    // document was applied again, and every tile was dropped - Paramount+'s cover came down 75 s into a 3-minute break). A tile still here
    // keeps its cover, mute and timers with its new config; a tile gone or turned off is dropped (uncovered) as before
    const keep = new Set(configs.filter((c) => c.enabled).map((c) => c.id));
    for (const id of [...this.tiles.keys()]) if (!keep.has(id)) this.drop(id);
    for (const config of configs) {
      const had = config.enabled ? this.tiles.get(config.id) : undefined;
      if (had) { had.config = config; continue; }
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
          look: "veil",
          unmuted: false,
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

  onAdBreak(id: string, active: boolean, sustainedMs = 0, backstopMs?: number): void {
    const tile = this.tiles.get(id);
    if (!tile) return; // not intermission-enabled — signals are inert
    tile.backstopMs = backstopMs && backstopMs > 0 ? Math.min(backstopMs, MAX_EXTENDED_MS) : undefined;

    if (!active) {
      // Uncover fast: end signal OR doubt drops the overlay immediately.
      this.releaseHeldMute(id, tile);
      this.uncover(id, tile);
      return;
    }
    if (tile.covered || tile.debounceTimer) return;
    const look = this.hooks.look?.(id) ?? "veil";
    // Mute fast (2026-09-15): the sound goes now, on the first sign - the errors are not equal here either, and a
    // wrong mute is a one-second dip in a song, lifted the moment the signal drops (below, in the !active branch)
    if (tile.config.audio === "mute" && !tile.fastMuted && look !== "show") { tile.fastMuted = true; void this.hooks.setMuted(id, true); }
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
    tile.look = this.hooks.look?.(id) ?? "veil";
    tile.unmuted = false;
    if (tile.look === "show") {
      // the ad as it plays: a fast mute the look changed under is lifted, nothing drawn - the break is still kept (above)
      if (tile.fastMuted && tile.config.audio === "mute") void this.hooks.setMuted(id, false);
      tile.fastMuted = false;
    } else {
      if (tile.config.audio === "mute" && !tile.fastMuted) void this.hooks.setMuted(id, true);   // already silent since the first sign
      tile.fastMuted = false;   // from here the cover owns the mute (uncover lifts it, the backstop holds it)
      // the soundscape is the scenery's: a muted-only break shows the ad's own picture in silence
      if (tile.look === "veil" && tile.config.audio === "mute" && tile.config.ambient) void this.hooks.ambient?.(id, tile.config.ambient, true);   // instead of silence
    }
    void this.hooks.show(id, tile.config.source, tile.look);
    if (tile.skipAvailable) void this.hooks.setSkip?.(id, true, tile.skipTarget);
    this.armSafety(id, tile, Math.max(this.opts.safetyTimeoutMs, tile.backstopMs ?? 0));
  }
  private armSafety(id: string, tile: TileState, ms: number): void {
    if (tile.safetyTimer) clearTimeout(tile.safetyTimer);
    tile.safetyTimer = setTimeout(() => {
      tile.safetyTimer = null;
      // §26 backstop - never trapped behind scenery. B-175 (2026-09-09): but a page still saying "ad" is not unmuted into the
      // room (Spotify's stalled break came back at full volume this way); the mute waits for the page's own end signal, and a
      // person's unmute - the wall's switch - still wins at once.
      if (tile.config.audio === "mute" && tile.look !== "show" && !tile.unmuted) tile.muteHeld = true;
      this.uncover(id, tile, tile.look !== "show" && !tile.unmuted);
    }, ms);
  }
  /**
   * The page's own break clock says the break goes on (B-336, 2026-10-06, "Sent report of ad on my screen right now": a three-minute
   * Paramount+ break counting down from 179 s lost its cover at the two-minute backstop with a minute still to run). A covered tile's
   * backstop is moved to the clock's end and a margin - never shortened, never past MAX_EXTENDED_MS from now - so a break the page
   * still counts stays covered, and a clock that stops counting still lets the backstop fall.
   */
  extend(id: string, remainingSec: number): void {
    const tile = this.tiles.get(id);
    if (!tile?.covered || !tile.safetyTimer || !(remainingSec > 0) || !isFinite(remainingSec)) return;
    if (tile.clockAt !== undefined && remainingSec >= tile.clockAt) return;   // not counting down: no extension
    tile.clockAt = remainingSec;
    const want = Math.min(remainingSec * 1000 + EXTEND_MARGIN_MS, MAX_EXTENDED_MS);
    const due = tile.safetyDue ?? 0;
    if (Date.now() + want <= due) return;
    tile.safetyDue = Date.now() + want;
    this.armSafety(id, tile, want);
  }

  /**
   * A break whose end the shell knows (B-364, 2026-10-10: a paid programme said so on the screen and was covered "to the end of its
   * half hour" - and the five-minute backstop took the cover off at 04:05 with the break watch still saying break, so FX's
   * infomercials played uncovered until morning). The backstop is moved to that end and a margin, as extend() moves it for a page's
   * clock, without the counting-down test: the shell says it afresh at every look that still finds the break. Never shortened, never
   * past MAX_EXTENDED_MS from now - a shell that stops looking stops saying it, and the backstop falls as it always did.
   */
  hold(id: string, remainingSec: number): boolean {
    const tile = this.tiles.get(id);
    if (!tile?.covered || !tile.safetyTimer || !(remainingSec > 0) || !isFinite(remainingSec)) return false;
    const want = Math.min(remainingSec * 1000 + EXTEND_MARGIN_MS, MAX_EXTENDED_MS);
    if (Date.now() + want <= (tile.safetyDue ?? 0)) return true;
    tile.safetyDue = Date.now() + want;
    this.armSafety(id, tile, want);
    return true;
  }

  /** A muted-only break's Unmute (on) and Mute again (off): the person's word for this break; the break's end clears it. */
  unmute(id: string, on: boolean): boolean {
    const tile = this.tiles.get(id);
    if (!tile?.covered || tile.look !== "mute") return false;
    tile.unmuted = on;
    void this.hooks.setMuted(id, !on);
    return true;
  }

  /** The look a covered window's break was put up with (null when no break is on). */
  lookOf(id: string): AdLook | null {
    const tile = this.tiles.get(id);
    return tile?.covered ? tile.look : null;
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
    tile.unmuted = false;
    tile.safetyDue = undefined; tile.clockAt = undefined;
    // Restore audio BEFORE the fade completes (§26 asymmetry).
    if (tile.config.audio === "mute" && !keepMute) void this.hooks.setMuted(id, false);
    if (tile.config.ambient) void this.hooks.ambient?.(id, tile.config.ambient, false);
    void this.hooks.setSkip?.(id, false);
    void this.hooks.hide(id);
  }
}
