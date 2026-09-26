/**
 * Alarm clock (spec §24, normative rules):
 *
 * - Fires locally and offline-proof: scheduling lives here, the tone lives
 *   on device (shell hook). Network can be down; the alarm still fires.
 * - Wake sequence: brightness ramps from near-black to full over a sunrise
 *   period (default 10 min, can be 0), tiles revive, then sound.
 * - Snooze/dismiss from touch, any key, or the remote; alarms pre-empt low
 *   power (the caller wakes the system before fire()).
 * - Never silently skipped: the caller persists the armed time and surfaces
 *   a missed-alarm condition at next boot.
 */

export interface AlarmHooks {
  setBrightness(value: number): unknown;
  /** Revive tiles / exit low power — runs at sunrise start. */
  wake(): unknown;
  /** Start/stop the local tone (bundled or system default — shell-owned). */
  setTone(playing: boolean): unknown;
  /** Fired on dismiss — drives `on: "alarm-dismissed"` schedule triggers. */
  onDismissed?(): unknown;
}

export interface AlarmOptions {
  /** Sunrise ramp duration; 0 = instant full brightness + sound. */
  sunriseMs?: number;
  /** Brightness steps across the sunrise. */
  rampSteps?: number;
  snoozeMs?: number;
}

const DEFAULTS: Required<AlarmOptions> = {
  sunriseMs: 10 * 60_000,
  rampSteps: 20,
  snoozeMs: 9 * 60_000,
};

type Timer = ReturnType<typeof setTimeout>;

export type AlarmStatus = "idle" | "sunrise" | "ringing";

export class AlarmEngine {
  private opts: Required<AlarmOptions>;
  private timers: Timer[] = [];
  status: AlarmStatus = "idle";

  constructor(
    private hooks: AlarmHooks,
    options?: AlarmOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /** Begin the wake sequence (§24). Idempotent while already active. */
  fire(): void {
    if (this.status !== "idle") return;
    this.status = "sunrise";
    void this.hooks.wake();

    const { sunriseMs, rampSteps } = this.opts;
    if (sunriseMs <= 0) {
      void this.hooks.setBrightness(1);
      this.ring();
      return;
    }
    for (let step = 1; step <= rampSteps; step++) {
      this.timers.push(
        setTimeout(() => {
          if (this.status === "sunrise") void this.hooks.setBrightness(step / rampSteps);
        }, (sunriseMs * step) / rampSteps),
      );
    }
    this.timers.push(setTimeout(() => this.ring(), sunriseMs));
  }

  private ring(): void {
    if (this.status === "idle") return;
    this.status = "ringing";
    void this.hooks.setTone(true);
  }

  /** Quiet for snoozeMs, then ring again (no second sunrise). */
  snooze(): void {
    if (this.status === "idle") return;
    this.clearTimers();
    this.status = "idle";
    void this.hooks.setTone(false);
    this.timers.push(
      setTimeout(() => {
        this.status = "sunrise"; // re-entry: straight to full + ring
        void this.hooks.setBrightness(1);
        this.ring();
      }, this.opts.snoozeMs),
    );
  }

  dismiss(): void {
    if (this.status === "idle" && this.timers.length === 0) return;
    const wasActive = this.status !== "idle" || this.timers.length > 0; // incl. snoozed
    this.clearTimers();
    this.status = "idle";
    void this.hooks.setTone(false);
    void this.hooks.setBrightness(1);
    if (wasActive) void this.hooks.onDismissed?.();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
