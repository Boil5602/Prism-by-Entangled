/**
 * Time-reclaimed ledger (spec §26). A local-only receipt of time spent behind
 * a veil: cumulative seconds, shown as three windows — this week · this month ·
 * all time (week starts Monday, ISO; month is the calendar month).
 *
 * Design (per the amendment): store DATED entries and derive the windows at
 * read time. No rolling counters — so what counts as "this week" is decided
 * when you look, and the week/month boundaries move on their own with no
 * migration, ever. Reset clears everything.
 *
 * Counting rules live at the call site (§26): a video ad break adds its
 * measured duration; a display/banner veil adds a flat 30 s per slot, once per
 * page visit; popups add nothing. This module only sums seconds by date.
 */

import type { StoreDriver } from "./drivers.js";

/** One dated contribution of veiled seconds. `day` is a local calendar date "YYYY-MM-DD". */
export interface ReclaimedEntry {
  day: string;
  seconds: number;
}

export interface ReclaimedWindows {
  week: number;   // seconds since Monday 00:00 local (ISO week)
  month: number;  // seconds since the 1st of this calendar month, local
  all: number;    // seconds ever
}

const KEY = "reclaimed:days";

/** Local "YYYY-MM-DD" for a timestamp (ms). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${m < 10 ? "0" : ""}${m}-${day < 10 ? "0" : ""}${day}`;
}

/** "YYYY-MM-DD" of the Monday that starts `ms`'s ISO week (local). */
export function weekStartKey(ms: number): string {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                 // 0=Sun..6=Sat
  const back = (dow + 6) % 7;             // days since Monday (Mon→0 … Sun→6)
  d.setDate(d.getDate() - back);
  return dayKey(d.getTime());
}

/** "YYYY-MM-01" of `ms`'s calendar month (local). */
export function monthStartKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1 < 10 ? "0" : ""}${d.getMonth() + 1}-01`;
}

/**
 * Sum a map of day→seconds into the three windows, relative to `now`.
 * String date comparison works because "YYYY-MM-DD" sorts chronologically.
 * Pure — this is where the fixtures aim.
 */
export function windowsFrom(days: Record<string, number>, now: number): ReclaimedWindows {
  const wk = weekStartKey(now), mo = monthStartKey(now);
  let week = 0, month = 0, all = 0;
  for (const day in days) {
    const s = days[day] || 0;
    all += s;
    if (day >= wk) week += s;
    if (day >= mo) month += s;
  }
  return { week: Math.round(week), month: Math.round(month), all: Math.round(all) };
}

export class ReclaimedLedger {
  private days: Record<string, number> = {};
  private readonly now: () => number;

  constructor(private readonly store: StoreDriver | null, opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  async load(): Promise<void> {
    if (!this.store) return;
    try { const s = await this.store.get(KEY); if (s) this.days = JSON.parse(s) as Record<string, number>; } catch { /* keep empty */ }
  }
  private persist(): void { if (this.store) void this.store.set(KEY, JSON.stringify(this.days)); }

  /** Add veiled seconds, dated `at` (default now). Non-positive is ignored. */
  add(seconds: number, at: number = this.now()): void {
    if (!(seconds > 0)) return;
    const k = dayKey(at);
    this.days[k] = (this.days[k] || 0) + seconds;
    this.persist();
  }

  /** The three windows as of `at` (default now). */
  windows(at: number = this.now()): ReclaimedWindows {
    return windowsFrom(this.days, at);
  }

  /** Clear every window (the §26 reset control). */
  reset(): void { this.days = {}; this.persist(); }

  /** Raw dated entries (for inspection/export). */
  entries(): ReclaimedEntry[] {
    return Object.keys(this.days).sort().map((day) => ({ day, seconds: this.days[day]! }));
  }
}
