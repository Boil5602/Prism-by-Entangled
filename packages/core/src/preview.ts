/**
 * Living previews (spec §25): the video peek cycle.
 *
 * Non-playing video tiles sit warm (§18) showing their last snapshot. On
 * the peek cadence, ONE warm peek tile at a time is revived — muted, hidden
 * behind its own snapshot — reaches readiness (§16), gets a fresh frame
 * captured, and is demoted again. Peeks ride the same serialized
 * single-buffer rule as refreshes, so peak cost is always exactly one extra
 * renderer for a few seconds, round-robin across peek tiles.
 *
 * "As though watching": live streams simply capture now. VOD tiles keep a
 * VIRTUAL PLAYHEAD — last known position plus wall-clock elapsed, bounded by
 * duration — and a peek seeks there before capture, so the still shows
 * where the video *would be* if you'd kept watching. Promoting the tile
 * resumes from the same playhead: tapping in feels like unmuting, not
 * restarting.
 *
 * Peeks are muted always and never touch the audio-focus machinery — the
 * orchestrator enforces both; this module only decides *when* and *whom*.
 */

export interface PeekTileConfig {
  id: string;
  /** Requested cadence in seconds (floored by the device budget). */
  intervalSec: number;
  playhead: "advance" | "hold";
}

export interface PeekHooks {
  /** Is the tile warm right now (only warm tiles are peeked)? */
  isWarm(id: string): boolean;
  /** Is the tile audibly/visibly playing (playing tiles are never peeked)? */
  isPlaying(id: string): boolean;
  /** Perform one peek; resolves when the tile is warm again. */
  peek(id: string): Promise<void>;
  /** A peek overran its budget: demote the tile now, keeping its last still. */
  abortPeek(id: string): Promise<void> | void;
  now(): number;
}

/** Longest a single peek may hold the extra renderer (readiness timeout + capture slack). */
export const PEEK_TIMEOUT_MS = 20_000;

/**
 * Device peek budget (§25): decode cap for concurrently playing video and
 * the minimum peek interval. Mini PC 3+/30s, tablet 2/30s, Pi 1–2/30s,
 * 2GB TV boxes 1/60s.
 */
export interface PreviewBudget {
  maxPlayingVideo: number;
  minPeekIntervalSec: number;
}

export const DEFAULT_PREVIEW_BUDGET: PreviewBudget = {
  maxPlayingVideo: 2,
  minPeekIntervalSec: 30,
};

export const PREVIEW_BUDGETS: Record<string, PreviewBudget> = {
  "mini-pc": { maxPlayingVideo: 3, minPeekIntervalSec: 30 },
  tablet: { maxPlayingVideo: 2, minPeekIntervalSec: 30 },
  pi: { maxPlayingVideo: 1, minPeekIntervalSec: 30 },
  "tv-box-2gb": { maxPlayingVideo: 1, minPeekIntervalSec: 60 },
};

type Timer = ReturnType<typeof setTimeout>;

interface PeekEntry {
  intervalMs: number;
  /** Wall-clock time this tile's still is next due to advance. */
  due: number;
}

export class PeekScheduler {
  private tiles = new Map<string, PeekEntry>();
  private timer: Timer | null = null;
  private inFlight: string | null = null;
  private paused = false;
  private minIntervalSec = DEFAULT_PREVIEW_BUDGET.minPeekIntervalSec;

  constructor(private hooks: PeekHooks) {}

  setBudget(budget: Pick<PreviewBudget, "minPeekIntervalSec">): void {
    this.minIntervalSec = Math.max(1, budget.minPeekIntervalSec);
    for (const [, e] of this.tiles) {
      e.intervalMs = Math.max(e.intervalMs, this.minIntervalSec * 1000);
    }
    this.arm();
  }

  /** Reconcile with the active dashboard's peek tiles; survivors keep their due time. */
  configure(configs: readonly PeekTileConfig[]): void {
    const wanted = new Set(configs.map((c) => c.id));
    for (const id of [...this.tiles.keys()]) if (!wanted.has(id)) this.tiles.delete(id);
    const now = this.hooks.now();
    // Stagger newcomers across the cadence so five tiles don't all advance
    // at once — the wall breathes rather than blinks.
    let index = 0;
    for (const c of configs) {
      const intervalMs = Math.max(c.intervalSec, this.minIntervalSec) * 1000;
      const existing = this.tiles.get(c.id);
      if (existing) {
        existing.intervalMs = intervalMs;
      } else {
        const count = Math.max(1, configs.length);
        this.tiles.set(c.id, {
          intervalMs,
          due: now + Math.round((intervalMs * (index + 1)) / count),
        });
      }
      index += 1;
    }
    this.arm();
  }

  /** §24 low power: no peeks until resume. */
  pause(): void {
    this.paused = true;
    this.disarm();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Everything is due "soon" after a long sleep; keep the stagger by
    // pushing due times relative to now rather than firing all at once.
    const now = this.hooks.now();
    let index = 0;
    const count = Math.max(1, this.tiles.size);
    for (const [, e] of this.tiles) {
      if (e.due < now) e.due = now + Math.round((e.intervalMs * (index + 1)) / count);
      index += 1;
    }
    this.arm();
  }

  stop(): void {
    this.disarm();
    this.tiles.clear();
  }

  /** Next due time, for inspection (§6 state / tests). */
  nextDue(id: string): number | undefined {
    return this.tiles.get(id)?.due;
  }

  get peeking(): string | null {
    return this.inFlight;
  }

  /* ------------------------------------------------------------------ */

  private arm(): void {
    this.disarm();
    if (this.paused || this.inFlight || this.tiles.size === 0) return;
    const now = this.hooks.now();
    let soonest = Infinity;
    for (const [, e] of this.tiles) soonest = Math.min(soonest, e.due);
    if (!Number.isFinite(soonest)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, Math.max(0, soonest - now));
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.paused || this.inFlight) return;
    const now = this.hooks.now();
    // Round-robin: the longest-overdue eligible tile goes first.
    const due = [...this.tiles.entries()]
      .filter(([, e]) => e.due <= now)
      .sort(([, a], [, b]) => a.due - b.due);
    let chosen: string | null = null;
    for (const [id, e] of due) {
      if (this.hooks.isWarm(id) && !this.hooks.isPlaying(id)) {
        chosen = id;
        break;
      }
      // Live or playing tiles already show real motion — their still is
      // trivially current. Re-due on cadence; the peek is simply skipped.
      e.due = now + e.intervalMs;
    }
    if (chosen === null) return this.arm();

    const entry = this.tiles.get(chosen)!;
    this.inFlight = chosen;
    let overran: Timer | null = null;
    try {
      await Promise.race([
        this.hooks.peek(chosen),
        new Promise<void>((resolve) => {
          overran = setTimeout(() => {
            // A load that never reaches readiness must not hold the single
            // buffer forever: drop back to warm, previous still intact.
            void this.hooks.abortPeek(chosen!);
            resolve();
          }, PEEK_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // A failed peek keeps the previous still (§16 failure rule) — nothing
      // to do here but wait for the next cadence.
    } finally {
      if (overran) clearTimeout(overran);
      this.inFlight = null;
    }
    // The tile may have been reconfigured away mid-peek.
    if (this.tiles.get(chosen) === entry) entry.due = this.hooks.now() + entry.intervalMs;
    this.arm();
  }
}

/* ====================================================================== */

interface PlayheadEntry {
  mode: "advance" | "hold";
  /** Position (s) at `at`; null until the adapter has reported one. */
  position: number | null;
  /** Duration (s); null = live stream. */
  duration: number | null;
  at: number;
}

/**
 * Virtual playhead per VOD tile (§25). Fed by adapter `media-position`
 * reports; queried before a peek capture and on promotion.
 */
export class VirtualPlayhead {
  private tiles = new Map<string, PlayheadEntry>();

  constructor(private now: () => number = () => Date.now()) {}

  configure(configs: ReadonlyArray<{ id: string; playhead: "advance" | "hold" }>): void {
    const wanted = new Set(configs.map((c) => c.id));
    for (const id of [...this.tiles.keys()]) if (!wanted.has(id)) this.tiles.delete(id);
    for (const c of configs) {
      const existing = this.tiles.get(c.id);
      if (existing) existing.mode = c.playhead;
      else this.tiles.set(c.id, { mode: c.playhead, position: null, duration: null, at: this.now() });
    }
  }

  /** Adapter position report while the tile is live (playing or peeking). */
  report(id: string, position: number, duration: number | null | undefined): void {
    const e = this.tiles.get(id);
    if (!e) return;
    if (!Number.isFinite(position) || position < 0) return;
    e.position = position;
    e.duration = Number.isFinite(duration as number) && (duration as number) > 0 ? (duration as number) : null;
    e.at = this.now();
  }

  /**
   * Where the video would be now. Null when there is nothing to seek to:
   * unknown tile, no position yet, or a live stream (the still is simply now).
   */
  virtualPosition(id: string): number | null {
    const e = this.tiles.get(id);
    if (!e || e.position === null || e.duration === null) return null;
    if (e.mode === "hold") return Math.min(e.position, e.duration);
    const elapsed = Math.max(0, (this.now() - e.at) / 1000);
    return Math.min(e.position + elapsed, e.duration);
  }
}

/**
 * Seek the page's primary media element without changing its play state.
 * Adapters may override via `window.__prismSeek` for sites with seek
 * quirks (§5 — the adapter repo owns per-site peek recipes).
 */
export function seekJs(positionSec: number): string {
  const t = Math.max(0, Number(positionSec.toFixed(3)));
  return (
    `(function(t){if(window.__prismSeek)return window.__prismSeek(t);` +
    `var m=document.querySelector('video,audio');` +
    `if(m&&isFinite(m.duration)){try{m.currentTime=Math.min(t,m.duration);}catch(e){}}})(${t})`
  );
}

/**
 * Report the primary media element's position back to core as a
 * `media-position` event (posted via the frame bridge established by the
 * §5 prelude). Injected after readiness on preview tiles.
 */
export const REPORT_POSITION_JS = `
(function () {
  if (window.__prismPos) return;
  window.__prismPos = true;
  var last = 0;
  var report = function (force) {
    var m = document.querySelector('video,audio');
    if (!m || !window.frame || !window.frame.position) return;
    var now = Date.now();
    if (!force && now - last < 5000) return;
    last = now;
    window.frame.position(m.currentTime, isFinite(m.duration) ? m.duration : null);
  };
  document.addEventListener('timeupdate', function () { report(false); }, true);
  document.addEventListener('pause', function () { report(true); }, true);
  document.addEventListener('seeked', function () { report(true); }, true);
  report(true);
})();
`.trim();
