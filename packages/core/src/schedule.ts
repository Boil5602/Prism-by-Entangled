/**
 * Schedule engine (spec §4): time-based behaviors — dim, sleep, wake, and
 * layout swaps at "HH:MM" local time, re-armed daily. Trigger-based entries
 * (`on: "motion"` etc.) arrive with the sensor drivers in a later milestone;
 * entries without a valid `at` are ignored here.
 */

import type { ScheduleEntry } from "./types.js";

export interface ScheduleActions {
  dim(value: number): unknown;
  sleep(): unknown;
  wake(): unknown;
  layout(dashboardId: string): unknown;
  /** Scene model (scene-model-spec §5): the wall becomes the named scene. */
  scene(sceneId: string): unknown;
  /** §24 night mode: dim to a floor + low power. */
  night(brightnessFloor: number): unknown;
  /** §24 explicit low power: all tiles warm, refresh paused. */
  lowpower(): unknown;
  /** §24 alarm clock: begin the wake sequence. */
  alarm(): unknown;
}

type Timer = ReturnType<typeof setTimeout>;

/** Milliseconds from `now` until the next local occurrence of "HH:MM". */
export function msUntil(at: string, now: Date): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(at.trim());
  if (!m) return null;
  const next = new Date(now);
  next.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export class ScheduleEngine {
  private timers: Timer[] = [];
  private entries: ScheduleEntry[] = [];

  constructor(private actions: ScheduleActions) {}

  /** Replace the active schedule (called on every dashboard switch). */
  start(entries: readonly ScheduleEntry[]): void {
    this.stop();
    this.entries = [...entries];
    for (const entry of entries) {
      if (entry.at) this.arm(entry);
    }
  }

  /** Fire trigger-based entries — e.g. `on: "alarm-dismissed"` (§24). */
  trigger(name: string): void {
    for (const entry of this.entries) {
      if (entry.on === name) this.run(entry);
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.entries = [];
  }

  private arm(entry: ScheduleEntry): void {
    const delay = msUntil(entry.at!, new Date());
    if (delay === null) return;
    const timer = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== timer);
      this.run(entry);
      this.arm(entry); // next occurrence is now ~24h out
    }, delay);
    this.timers.push(timer);
  }

  private run(entry: ScheduleEntry): void {
    switch (entry.action) {
      case "dim":
        if (typeof entry.value === "number") this.actions.dim(entry.value);
        break;
      case "sleep":
        this.actions.sleep();
        break;
      case "wake":
        this.actions.wake();
        break;
      case "layout":
        if (typeof entry.value === "string") this.actions.layout(entry.value);
        break;
      case "scene":
        if (typeof entry.value === "string") this.actions.scene(entry.value);
        break;
      case "night":
        this.actions.night(typeof entry.value === "number" ? entry.value : 0.1);
        break;
      case "lowpower":
        this.actions.lowpower();
        break;
      case "alarm":
        this.actions.alarm();
        break;
    }
  }
}
