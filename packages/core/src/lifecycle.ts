/**
 * Tile lifecycle (spec §18, normative): live → warm → (cold later).
 *
 * The device profile sets maxLiveTiles; beyond it, the least-recently-
 * interacted non-persist, non-audible tiles demote to warm: refresh stops,
 * pixels freeze, the renderer is released. A warm tile looks identical on
 * the wall and revives through the §16 crossfade on interaction or on its
 * refresh cadence (revive → load → fresh pixels → possibly demoted again by
 * the next enforcement pass — which is also the §25 peek shape).
 *
 * Only tiles that have actually revealed content are demotion candidates —
 * a tile that never painted has no pixels worth freezing, so it stays live
 * until first light.
 */

export interface LifecycleTileSpec {
  id: string;
  url: string | null;
  persist: boolean;
  refreshSec: number | null;
}

export interface LifecycleHooks {
  freeze(id: string): unknown;
  suspend(id: string): unknown;
  resume(id: string): unknown;
  /** Start the §16 load path (navigate → ready → reveal). `queued` = ride the §18 single-buffer queue. */
  startLoad(id: string, url: string, refreshSec: number | null, queued: boolean): void;
  /** Stop the tile's refresh cadence. */
  stopLoad(id: string): void;
  isPlaying(id: string): boolean;
}

type Timer = ReturnType<typeof setTimeout>;

interface Entry {
  url: string | null;
  persist: boolean;
  refreshSec: number | null;
  status: "live" | "warm";
  lastTouch: number;
  revealed: boolean;
  reviveTimer: Timer | null;
  /** §25: this revival is a peek — demote again as soon as fresh pixels land. */
  peeking: boolean;
}

export class LifecycleManager {
  private max = Infinity;
  private counter = 0;
  private tiles = new Map<string, Entry>();

  constructor(private hooks: LifecycleHooks) {}

  setMaxLive(max: number): void {
    this.max = Number.isFinite(max) && max >= 1 ? Math.floor(max) : Infinity;
  }

  /** Reconcile with a dashboard's tile set; survivors keep their state. */
  track(specs: readonly LifecycleTileSpec[]): void {
    const wanted = new Set(specs.map((s) => s.id));
    for (const id of [...this.tiles.keys()]) {
      if (!wanted.has(id)) this.drop(id);
    }
    for (const spec of specs) {
      const existing = this.tiles.get(spec.id);
      if (existing) {
        existing.url = spec.url;
        existing.persist = spec.persist;
        existing.refreshSec = spec.refreshSec;
      } else {
        this.tiles.set(spec.id, {
          url: spec.url,
          persist: spec.persist,
          refreshSec: spec.refreshSec,
          status: "live",
          lastTouch: ++this.counter,
          revealed: false,
          reviveTimer: null,
          peeking: false,
        });
      }
    }
  }

  drop(id: string): void {
    const e = this.tiles.get(id);
    if (!e) return;
    if (e.reviveTimer) clearTimeout(e.reviveTimer);
    this.cancelPeek(id, e);
    this.tiles.delete(id);
  }

  status(id: string): "live" | "warm" | undefined {
    return this.tiles.get(id)?.status;
  }

  isPeeking(id: string): boolean {
    return this.tiles.get(id)?.peeking ?? false;
  }

  /** A tile revealed real pixels — it is now a legitimate demotion candidate. */
  async onRevealed(id: string): Promise<void> {
    const e = this.tiles.get(id);
    if (!e) return;
    e.revealed = true;
    if (e.peeking) {
      // §25: the fresh frame is on the wall — the peek is over.
      e.peeking = false;
      await this.demote(id, e, { scheduleRevive: false });
      this.peekWaits.get(id)?.();
      this.peekWaits.delete(id);
      return;
    }
    await this.enforce();
  }

  private peekWaits = new Map<string, () => void>();

  /**
   * §25 peek: revive a warm tile through the serialized queue, let it reach
   * readiness, and demote it the moment its fresh frame is revealed. The
   * returned promise settles when the tile is warm again (or at once if the
   * tile is not a peek candidate). Callers keep peeks muted and off the
   * audio-focus machinery.
   */
  async peek(id: string): Promise<void> {
    const e = this.tiles.get(id);
    if (!e || e.status !== "warm" || !e.url || e.peeking) return;
    if (e.reviveTimer) {
      clearTimeout(e.reviveTimer);
      e.reviveTimer = null;
    }
    const done = new Promise<void>((resolve) => this.peekWaits.set(id, resolve));
    e.status = "live";
    e.revealed = false;
    e.peeking = true;
    // A peek is not an interaction: recency is untouched, so the tile stays
    // the LRU candidate it was.
    await this.hooks.resume(id);
    this.hooks.startLoad(id, e.url, e.refreshSec, true);
    await done;
  }

  /** §25 peek overran: back to warm with the previous still (no reveal happened). */
  async abandonPeek(id: string): Promise<void> {
    const e = this.tiles.get(id);
    if (!e || !e.peeking) return;
    this.cancelPeek(id, e);
    if (e.status === "live") await this.demote(id, e, { scheduleRevive: false });
  }

  /** Abandon an in-flight peek (tile dropped, low power, user touched it). */
  private cancelPeek(id: string, e: Entry): void {
    if (!e.peeking) return;
    e.peeking = false;
    this.peekWaits.get(id)?.();
    this.peekWaits.delete(id);
  }

  /** Interaction/playback recency; touching a warm tile revives it (§18). */
  async touch(id: string): Promise<void> {
    const e = this.tiles.get(id);
    if (!e) return;
    e.lastTouch = ++this.counter;
    // Touching a peeking tile promotes it: the revival already under way
    // becomes an ordinary one (no auto-demote on reveal).
    this.cancelPeek(id, e);
    if (e.status === "warm") await this.revive(id);
  }

  async revive(id: string): Promise<void> {
    const e = this.tiles.get(id);
    if (!e || e.status !== "warm") return;
    if (e.reviveTimer) {
      clearTimeout(e.reviveTimer);
      e.reviveTimer = null;
    }
    e.status = "live";
    e.revealed = false; // becomes a candidate again only after fresh pixels
    e.lastTouch = ++this.counter;
    await this.hooks.resume(id);
    if (e.url) this.hooks.startLoad(id, e.url, e.refreshSec, false);
  }

  /** Demote LRU candidates until the live count fits the device budget. */
  async enforce(): Promise<void> {
    for (;;) {
      const live = [...this.tiles.entries()].filter(([, e]) => e.status === "live");
      if (live.length <= this.max) return;
      const candidates = live
        .filter(([id, e]) => e.revealed && !e.persist && !this.hooks.isPlaying(id))
        .sort(([, a], [, b]) => a.lastTouch - b.lastTouch);
      const victim = candidates[0];
      if (!victim) return; // everyone exempt — stay over budget rather than blank a tile
      await this.demote(victim[0], victim[1]);
    }
  }

  /**
   * Solo layout: exactly one live tile. Everything else goes warm — persist
   * and playback notwithstanding — with no scheduled revival; the kept tile
   * is touched (revived if it was warm).
   */
  async soloKeep(keep: string): Promise<void> {
    for (const [id, e] of this.tiles) {
      if (id === keep) continue;
      this.cancelPeek(id, e);
      if (e.status === "live") await this.demote(id, e, { scheduleRevive: false });
    }
    await this.touch(keep);
  }

  /** §24 low power: everything to warm, no cadence revivals until wake. */
  async demoteAll(): Promise<void> {
    for (const [id, e] of this.tiles) {
      this.cancelPeek(id, e);
      if (e.status === "live") await this.demote(id, e, { scheduleRevive: false });
    }
  }

  /** §24 wake: revive everything through the §16 crossfade. */
  async reviveAll(): Promise<void> {
    for (const [id, e] of this.tiles) {
      if (e.status === "warm") await this.revive(id);
    }
    await this.enforce(); // the device budget still applies after wake
  }

  private async demote(
    id: string,
    e: Entry,
    opts: { scheduleRevive: boolean } = { scheduleRevive: true },
  ): Promise<void> {
    this.hooks.stopLoad(id);
    await this.hooks.freeze(id);
    await this.hooks.suspend(id);
    e.status = "warm";
    // §18: warm tiles revive on their refresh cadence for fresh pixels.
    // (§24 low power passes scheduleRevive: false — the scheduler pauses.)
    if (opts.scheduleRevive && e.refreshSec && e.url) {
      e.reviveTimer = setTimeout(() => {
        e.reviveTimer = null;
        void this.revive(id);
      }, e.refreshSec * 1000);
    }
  }
}
