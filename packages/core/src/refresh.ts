/**
 * The no-white-frames engine (spec §16, normative) with serialized refresh
 * (§18). Every tile load and refresh follows the same path:
 *
 *   freeze current pixels (refreshes only) → load behind them → crossfade
 *   to live ONLY when the page is ready.
 *
 * Readiness = load event AND first contentful paint AND a paint-settle
 * window (default 300ms) — or an explicit adapter `frame.ready()` — with a
 * hard timeout (default 10s) that crossfades regardless. A failed load never
 * reveals: the frozen snapshot (or dark substrate on first load) stays up
 * and a quiet retry backs off exponentially. A stale calendar beats a white
 * error page on the wall.
 *
 * Refreshes are serialized (§18): at most one hidden buffer loads at a time,
 * and first refreshes are staggered, so peak overhead is always exactly one
 * extra renderer.
 */

import type { SurfaceDriver, SurfaceEvent } from "./drivers.js";

export interface RefreshEngineOptions {
  /** Paint-settle window after load+paint before crossfading. */
  settleMs?: number;
  /** Hard readiness timeout — crossfade regardless. */
  timeoutMs?: number;
  /** How long a failed load-finished waits for a superseding success before it counts (redirect on arrival). */
  failGraceMs?: number;
  /** First quiet-retry delay after a failed load. */
  retryMs?: number;
  /** Retry backoff ceiling. */
  retryMaxMs?: number;
  /** Crossfade duration passed to `reveal`. */
  revealMs?: number;
  /** Spacing added per tile to first refreshes so intervals don't stack. */
  staggerMs?: number;
}

const DEFAULTS: Required<RefreshEngineOptions> = {
  settleMs: 300,
  timeoutMs: 10_000,
  failGraceMs: 2_000,
  retryMs: 60_000,
  retryMaxMs: 600_000,
  revealMs: 300,
  staggerMs: 5_000,
};

type Timer = ReturnType<typeof setTimeout>;
type Outcome = "ready" | "failed";

interface Attempt {
  loadOk: boolean;
  painted: boolean;
  settleTimer: Timer | null;
  timeoutTimer: Timer | null;
  /**
   * A failed load-finished starts this grace: sites that redirect on arrival
   * (peacocktv.com → /watch/home) report the superseded navigation as a
   * failure and the real one as a success moments later - only a failure
   * that nothing better follows counts (§16 failure rule).
   */
  failTimer: Timer | null;
  done: boolean;
  resolve: (outcome: Outcome) => void;
}

interface TileState {
  url: string;
  refreshSec: number | null;
  attempt: Attempt | null;
  refreshTimer: Timer | null;
  retryTimer: Timer | null;
  retries: number;
  /** First refresh already staggered — later ones ride the plain interval. */
  staggered: boolean;
  stopped: boolean;
}

export class RefreshEngine {
  /** Fired after a tile's crossfade to live pixels is issued (§16 reveal). */
  onReveal: ((id: string) => void) | null = null;
  /**
   * Pre-reveal gate (§17 region focus): runs in the hidden buffer after
   * readiness. Return false to treat the load as failed — the previous
   * pixels stay up and the quiet retry takes over.
   */
  beforeReveal: ((id: string) => Promise<boolean>) | null = null;
  /** Readiness reached only via the hard timeout — a §19 incident signal. */
  onReadinessTimeout: ((id: string) => void) | null = null;
  private readonly opts: Required<RefreshEngineOptions>;
  private tiles = new Map<string, TileState>();
  /** §18 serialization: refreshes and retries chain through this queue. */
  private queue: Promise<void> = Promise.resolve();
  private staggerIndex = 0;

  constructor(
    private surface: Pick<SurfaceDriver, "navigate" | "freeze" | "reveal">,
    options?: RefreshEngineOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Initial load: navigate immediately (boot loads run in parallel — the
   * §18 single-buffer rule governs refreshes, not first light), reveal on
   * readiness, then begin the tile's refresh cadence if it has one.
   */
  load(
    id: string,
    url: string,
    refreshSec?: number | null,
    opts: { queued?: boolean } = {},
  ): void {
    this.stop(id);
    const state: TileState = {
      url,
      refreshSec: refreshSec ?? null,
      attempt: null,
      refreshTimer: null,
      retryTimer: null,
      retries: 0,
      staggered: false,
      stopped: false,
    };
    this.tiles.set(id, state);
    // §25 peeks (and other non-boot revivals) ride the single-buffer queue.
    if (opts.queued) this.enqueue(() => this.runLoad(id, state, { freezeFirst: false }));
    else void this.runLoad(id, state, { freezeFirst: false });
  }

  /** One-tap refresh-now (§8 tile chrome) — rides the serialized queue. */
  refreshNow(id: string): void {
    const state = this.tiles.get(id);
    if (!state || state.stopped) return;
    if (state.refreshTimer) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = null;
    }
    this.enqueue(() => this.runLoad(id, state, { freezeFirst: true }));
  }

  handleEvent(event: SurfaceEvent): void {
    if (event.type === "playback") return;
    const attempt = this.tiles.get(event.id)?.attempt;
    if (!attempt || attempt.done) return;

    if (event.type === "load-finished") {
      if (!event.ok) {
        // not final yet: a redirect's superseded navigation reports failure first
        if (!attempt.failTimer && !attempt.loadOk)
          attempt.failTimer = setTimeout(() => this.finish(attempt, "failed"), this.opts.failGraceMs);
        return;
      }
      if (attempt.failTimer) { clearTimeout(attempt.failTimer); attempt.failTimer = null; }
      attempt.loadOk = true;
      this.maybeSettle(attempt);
    } else if (event.type === "first-paint") {
      attempt.painted = true;
      this.maybeSettle(attempt);
    } else if (event.type === "adapter-ready") {
      this.finish(attempt, "ready");
    }
  }

  stop(id: string): void {
    const state = this.tiles.get(id);
    if (!state) return;
    state.stopped = true;
    if (state.attempt) this.finish(state.attempt, "failed");
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    if (state.retryTimer) clearTimeout(state.retryTimer);
    this.tiles.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.tiles.keys()]) this.stop(id);
  }

  /* ------------------------------------------------------------------ */

  private async runLoad(
    id: string,
    state: TileState,
    { freezeFirst }: { freezeFirst: boolean },
  ): Promise<void> {
    if (state.stopped) return;
    if (freezeFirst) await this.surface.freeze(id);
    await this.surface.navigate(id, state.url);
    const outcome = await this.awaitReady(state);
    if (state.stopped) return;

    const gated =
      outcome === "ready" && (!this.beforeReveal || (await this.beforeReveal(id)));
    if (state.stopped) return;

    if (gated) {
      state.retries = 0;
      await this.surface.reveal(id, this.opts.revealMs);
      this.onReveal?.(id);
      this.scheduleRefresh(id, state);
    } else {
      // §16 failure rule: no reveal — last pixels stay — quiet retry.
      const delay = Math.min(
        this.opts.retryMs * 2 ** state.retries,
        this.opts.retryMaxMs,
      );
      state.retries += 1;
      state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        // No re-freeze: whatever was frozen (or the substrate) is still up.
        this.enqueue(() => this.runLoad(id, state, { freezeFirst: false }));
      }, delay);
    }
  }

  private scheduleRefresh(id: string, state: TileState): void {
    if (!state.refreshSec || state.stopped) return;
    const stagger = state.staggered ? 0 : (this.staggerIndex++ % 12) * this.opts.staggerMs;
    state.staggered = true;
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      this.enqueue(() => this.runLoad(id, state, { freezeFirst: true }));
    }, state.refreshSec * 1000 + stagger);
  }

  private awaitReady(state: TileState): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      const attempt: Attempt = {
        loadOk: false,
        painted: false,
        settleTimer: null,
        timeoutTimer: null,
        failTimer: null,
        done: false,
        resolve,
      };
      attempt.timeoutTimer = setTimeout(() => {
        if (!attempt.done) this.onReadinessTimeout?.(this.tileIdOf(state));
        this.finish(attempt, "ready"); // timeout crossfades regardless
      }, this.opts.timeoutMs);
      state.attempt = attempt;
    });
  }

  private tileIdOf(state: TileState): string {
    for (const [id, s] of this.tiles) if (s === state) return id;
    return "";
  }

  private maybeSettle(attempt: Attempt): void {
    if (attempt.done || !attempt.loadOk || !attempt.painted || attempt.settleTimer) return;
    attempt.settleTimer = setTimeout(
      () => this.finish(attempt, "ready"),
      this.opts.settleMs,
    );
  }

  private finish(attempt: Attempt, outcome: Outcome): void {
    if (attempt.done) return;
    attempt.done = true;
    if (attempt.settleTimer) clearTimeout(attempt.settleTimer);
    if (attempt.timeoutTimer) clearTimeout(attempt.timeoutTimer);
    if (attempt.failTimer) clearTimeout(attempt.failTimer);
    attempt.resolve(outcome);
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(() => {});
  }
}
