/**
 * Updates (spec §28): no accounts, no tracking, no fear.
 *
 * Core owns the policy; the shell owns the bytes. The checker fetches a
 * STATIC, UNPARAMETERIZED manifest — no device id, no version query,
 * nothing appended — and compares versions locally, so a check reveals
 * nothing but "someone checked" (§19/§22). Installation is deferred to the
 * §24 night window; the shell applies signed releases (device-owner APK on
 * Android, A/B image on PrismOS with automatic rollback) and reports back.
 *
 * Continuity: §10 storage persists across every update (the shell migrates,
 * never wipes); after an update the frame comes back to its last snapshots
 * and the release notes render on-frame — dismissible, never blocking.
 */

import type { MaybePromise, StoreDriver } from "./drivers.js";

/**
 * The tracks a release is published on (2026-10-05, "I would call this current track Alpha. And we'll work toward beta and full"):
 * `alpha` is what ships while Prism is built, `beta` the candidate, `stable` the full release. A shell starts on the track it was
 * built for and follows it; the manifest names a release per track, and a publisher may point two tracks at one release.
 */
export type UpdateChannel = "alpha" | "beta" | "stable";
export const UPDATE_CHANNELS: readonly UpdateChannel[] = ["alpha", "beta", "stable"];
export function asUpdateChannel(v: unknown, fallback: UpdateChannel = "stable"): UpdateChannel {
  return v === "alpha" || v === "beta" || v === "stable" ? v : fallback;
}
/** The track's name as a person reads it: Alpha, Beta, Full. */
export function channelLabel(ch: UpdateChannel): string {
  return ch === "alpha" ? "Alpha" : ch === "beta" ? "Beta" : "Full";
}

export interface ReleaseInfo {
  version: string;
  /** Markdown/plain release notes rendered on-frame after install. */
  notes?: string;
  /** Artifact URL the shell fetches; signature verification is shell-side. */
  url?: string;
  sha256?: string;
  /** The release's file list (2026-10-06, incremental updates): its address, and the SHA-256 its bytes must have. The shell fetches only the
   *  files the running copy lacks; the zip at `url` stays the fallback. Signed with the manifest like everything in it. */
  files?: string;
  filesSha256?: string;
  /** The day it was published (YYYY-MM-DD). */
  date?: string;
  /** The track's recent releases, newest first, this one included (2026-10-07, "can we have the option to see a change log feed on the side of
   *  that modal window"): an incremental update can skip several versions, and the Updates dialog shows what each one changed. Signed with
   *  the manifest; a manifest without it still reads. */
  history?: ChangeEntry[];
}

/** One release's line in the changelog feed. */
export interface ChangeEntry {
  version: string;
  date?: string;
  notes: string;
}

/** The most entries a manifest's history is read to. */
const MAX_HISTORY = 40;

/** The manifest at `<cdn>/manifest.json`: one entry per channel. */
export type UpdateManifest = Partial<Record<UpdateChannel, ReleaseInfo>>;

export interface UpdateHooks {
  /**
   * Fetch the manifest text at exactly this URL. Core guarantees the URL
   * carries no query string or fragment; shells must add none (no UA
   * embellishments, no headers with identifiers).
   */
  fetchManifest(url: string): MaybePromise<string>;
  /** Apply a release now (night window). Resolves when staged/applied or failed. */
  apply(release: ReleaseInfo): MaybePromise<"applied" | "staged" | "failed">;
  now(): number;
  /** Restart the shell into the release it staged (the quiet-moment restart, B-458, 2026-10-30); absent, a staged release waits for the next start. */
  restart?(): MaybePromise<void>;
  /** True while the wall is quiet: nothing playing and nobody about for a while (the shell's orchestrator answers). */
  quiet?(): boolean;
  /** Remove what the shell staged: core let the release go (the track no longer offers it, or the track changed; security review 2026-10-30).
   *  False when the shell could not (a held folder): core keeps the discard pending and asks again at the next check and the next start. */
  discard?(): MaybePromise<boolean | void>;
}

export interface UpdateConfig {
  /** Running shell version (semver-ish: 1.2.3, 2026.8.1, with optional -pre). */
  currentVersion: string;
  /** Static manifest URL — must be unparameterized. */
  manifestUrl: string;
  channel?: UpdateChannel;
  /** Check cadence; default daily. */
  checkIntervalMs?: number;
  /** When the check runs (2026-10-06, "Let the user check for updates at a scheduled time"): a local time of day, every day or one day a
   *  week. Without one the check runs a day after the last. */
  schedule?: UpdateSchedule | null;
  /** False: no check on its own (the person chose Never); Check now still asks. Default true. */
  enabled?: boolean;
  /**
   * Install on its own (B-458, 2026-10-30: the section-28 night window had no door - the silent install hung off a section-24 schedule entry
   * no Prism could make, so every release waited for a press). True (the default): a newer release a check finds is staged at once, and the
   * shell restarts into it at a quiet moment in the three hours after the check's time of day (nothing playing, nobody about), otherwise at
   * its next start. False: the flag waits for a press, as before.
   */
  auto?: boolean;
}

/** A time of day ("HH:MM", the PC's own clock) and, for a weekly check, the day (0 Sunday to 6 Saturday; null or absent every day). */
export interface UpdateSchedule {
  at: string;
  weekday?: number | null;
}

/** The schedule's minutes past midnight, or null when "at" is not a time. */
export function scheduleMinutes(s: UpdateSchedule | null | undefined): number | null {
  const m = s && /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.at.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The scheduled moment at or before `now` (the one a check is owed for), on the PC's own clock. */
export function lastScheduledAt(s: UpdateSchedule, now: number): number | null {
  const min = scheduleMinutes(s);
  if (min === null) return null;
  const d = new Date(now);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  for (let i = 0; i < 8; i++) {
    const okDay = s.weekday === null || s.weekday === undefined || d.getDay() === s.weekday;
    if (okDay && d.getTime() <= now) return d.getTime();
    d.setDate(d.getDate() - 1);
  }
  return null;
}

/** The next scheduled moment after `now`, on the PC's own clock (a daylight-saving day shifts with the clock, as a person's alarm does). */
export function nextScheduledAt(s: UpdateSchedule, now: number): number | null {
  const min = scheduleMinutes(s);
  if (min === null) return null;
  const d = new Date(now);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  for (let i = 0; i < 9; i++) {
    const okDay = s.weekday === null || s.weekday === undefined || d.getDay() === s.weekday;
    if (okDay && d.getTime() > now) return d.getTime();
    d.setDate(d.getDate() + 1);
  }
  return null;
}

export interface UpdateStatus {
  channel: UpdateChannel;
  currentVersion: string;
  available: ReleaseInfo | null;
  lastCheck: string | null;
  lastResult: "ok" | "unreachable" | "invalid" | null;
  /** A release was applied and its notes have not been dismissed yet. */
  pendingNotes: ReleaseInfo | null;
  /** The shell has staged a release that takes effect on the next boot. */
  staged: ReleaseInfo | null;
  /** When the check runs next on its own (ISO), or null when it does not (Never). */
  nextCheck?: string | null;
  /** The schedule in force, and whether checks run on their own. */
  schedule?: UpdateSchedule | null;
  enabled?: boolean;
  /** The track's newest release as the last good check saw it, newer than this Prism or not: the changelog feed's source when up to date. */
  latest?: ReleaseInfo | null;
  /** Install on its own (B-458). */
  auto?: boolean;
  /** How the staged release takes effect: at a quiet moment on its own, or at the next start; null with nothing staged. */
  restart?: "quiet" | "next-start" | null;
  /** A discard the shell could not finish yet (asked again at the next check and start). */
  discardPending?: boolean;
}

const STORE_KEY = "updates:state";
const DAY_MS = 86_400_000;
/** B-458: the quiet-moment restart - three hours from the check's time of day (04:00 without a schedule), looked at once a minute. */
const RESTART_WINDOW_MS = 3 * 3_600_000;
const RESTART_POLL_MS = 60_000;
const DEFAULT_CHECK_MINUTES = 4 * 60;

interface Persisted {
  channel: UpdateChannel;
  lastCheck: string | null;
  lastResult: UpdateStatus["lastResult"];
  available: ReleaseInfo | null;
  staged: ReleaseInfo | null;
  /** Version seen at the previous boot — a change means notes are due. */
  lastBootVersion: string | null;
  pendingNotes: ReleaseInfo | null;
  /** Notes captured for the release we applied/staged, keyed by version. */
  notesFor: Record<string, string>;
  /** The track's entry at the last good check (the changelog feed). */
  latest?: ReleaseInfo | null;
  /** The shell could not remove a staged release core let go: asked again at the next check and the next start (security review 2026-10-30). */
  discardPending?: boolean;
}

/** Semver-ish comparison; numeric segments, pre-release sorts before release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [main, pre] = v.trim().replace(/^v/i, "").split("-", 2);
    return { nums: (main ?? "").split(".").map((n) => parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const A = split(a);
  const B = split(b);
  const len = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < len; i += 1) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;
}

/** §28 privacy: reject any manifest URL that could carry an identifier. */
export function isUnparameterized(url: string): boolean {
  if (url.includes("?") || url.includes("#")) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "file:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** A manifest entry's history: entries with a version and notes, as many as MAX_HISTORY; anything else in the list is skipped. */
export function parseHistory(list: unknown[]): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const h of list) {
    if (out.length >= MAX_HISTORY) break;
    if (typeof h !== "object" || h === null) continue;
    const r = h as Record<string, unknown>;
    if (typeof r["version"] !== "string" || typeof r["notes"] !== "string") continue;
    out.push({ version: r["version"], notes: r["notes"], ...(typeof r["date"] === "string" ? { date: r["date"] } : {}) });
  }
  return out;
}

export function parseManifest(text: string): UpdateManifest | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) return null;
    const out: UpdateManifest = {};
    for (const ch of UPDATE_CHANNELS) {
      const entry = (raw as Record<string, unknown>)[ch];
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e["version"] !== "string") continue;
      out[ch] = {
        version: e["version"],
        ...(typeof e["notes"] === "string" ? { notes: e["notes"] } : {}),
        ...(typeof e["url"] === "string" ? { url: e["url"] } : {}),
        ...(typeof e["sha256"] === "string" ? { sha256: e["sha256"] } : {}),
        ...(typeof e["files"] === "string" && typeof e["filesSha256"] === "string" ? { files: e["files"], filesSha256: e["filesSha256"] } : {}),
        ...(typeof e["date"] === "string" ? { date: e["date"] } : {}),
        ...(Array.isArray(e["history"]) ? { history: parseHistory(e["history"]) } : {}),
      };
    }
    return out;
  } catch {
    return null;
  }
}

type Timer = ReturnType<typeof setTimeout>;

export class UpdateChecker {
  private cfg: { currentVersion: string; manifestUrl: string; checkIntervalMs: number; schedule: UpdateSchedule | null; enabled: boolean; auto: boolean } | null = null;
  private state: Persisted = {
    channel: "stable",
    lastCheck: null,
    lastResult: null,
    available: null,
    staged: null,
    lastBootVersion: null,
    pendingNotes: null,
    notesFor: {},
  };
  private timer: Timer | null = null;
  private loaded = false;

  constructor(
    private hooks: UpdateHooks,
    private store?: StoreDriver,
  ) {}

  /**
   * Boot: adopt config, detect a completed update (version changed since
   * last boot ⇒ release notes due), and begin the check cadence.
   */
  async start(config: UpdateConfig): Promise<void> {
    if (!isUnparameterized(config.manifestUrl)) {
      throw new Error("§28: manifest URL must be static and unparameterized");
    }
    await this.load();
    this.cfg = {
      currentVersion: config.currentVersion,
      manifestUrl: config.manifestUrl,
      checkIntervalMs: config.checkIntervalMs ?? DAY_MS,
      schedule: config.schedule && scheduleMinutes(config.schedule) !== null ? config.schedule : null,
      enabled: config.enabled !== false,
      auto: config.auto !== false,
    };
    if (config.channel) this.state.channel = config.channel;

    const prev = this.state.lastBootVersion;
    if (prev !== null && prev !== config.currentVersion) {
      const notes = this.state.notesFor[config.currentVersion];
      this.state.pendingNotes = { version: config.currentVersion, ...(notes ? { notes } : {}) };
    }
    if (this.state.staged && compareVersions(this.state.staged.version, config.currentVersion) <= 0) {
      this.state.staged = null; // the staged release is now what's running
    }
    if (this.state.available && compareVersions(this.state.available.version, config.currentVersion) <= 0) {
      this.state.available = null;
    }
    this.state.lastBootVersion = config.currentVersion;
    this.state.notesFor = {}; // keep the store small — notes only matter once
    await this.persist();
    await this.retryDiscard();   // the shell's folder held at the last discard: asked again (its start honoured the tombstone meanwhile)
    if (this.cfg.enabled) this.schedule(this.dueIn());
    this.armRestart();   // a release staged before this start and not yet running (a hand-off that did not happen) still gets its quiet moment
  }

  /** The person's choice of when to check (the Updates dialog): taken at once, no restart. Never stops the checks on their own. */
  setSchedule(schedule: UpdateSchedule | null, enabled = true): void {
    if (!this.cfg) return;
    this.cfg.schedule = schedule && scheduleMinutes(schedule) !== null ? schedule : null;
    this.cfg.enabled = enabled;
    if (!enabled) { this.stop(); return; }
    this.schedule(this.dueIn());
    this.armRestart();
  }

  /** The person's switch (the Updates dialog): on, a release already found is staged now and the quiet-moment restart is armed; off, both stop. */
  setAuto(on: boolean): void {
    if (!this.cfg) return;
    this.cfg.auto = on;
    if (on && this.state.available && this.cfg.enabled) void this.onNightWindow();
    this.armRestart();
  }

  /** When the next check runs on its own (epoch ms), or null when it does not. */
  nextCheckAt(): number | null {
    if (!this.cfg?.enabled) return null;
    return this.hooks.now() + this.dueIn();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  status(): UpdateStatus {
    return {
      channel: this.state.channel,
      currentVersion: this.cfg?.currentVersion ?? "unknown",
      available: this.state.available,
      lastCheck: this.state.lastCheck,
      lastResult: this.state.lastResult,
      pendingNotes: this.state.pendingNotes,
      staged: this.state.staged,
      nextCheck: (() => { const n = this.nextCheckAt(); return n === null ? null : new Date(n).toISOString(); })(),
      schedule: this.cfg?.schedule ?? null,
      enabled: this.cfg?.enabled ?? false,
      latest: this.state.latest ?? null,
      auto: this.cfg?.auto ?? true,
      restart: !this.state.staged ? null : this.cfg?.auto && this.hooks.restart ? "quiet" : "next-start",
      discardPending: !!this.state.discardPending,
    };
  }

  /** Edit mode: opt into beta, or back to stable. Re-checks immediately. */
  async setChannel(channel: UpdateChannel): Promise<void> {
    if (this.state.channel === channel) return;
    this.state.channel = channel;
    this.state.available = null;
    this.state.latest = null;
    this.offerGen++;   // an apply of the old track's offer still running is not recorded when it ends
    if (this.state.staged) await this.dropStaged();   // the old track's release: not this track's to start (security review 2026-10-30)
    await this.persist();
    if (this.cfg) await this.check();
  }

  async dismissNotes(): Promise<void> {
    this.state.pendingNotes = null;
    await this.persist();
  }

  /**
   * One check: fetch the static manifest, compare locally. Never throws —
   * an unreachable CDN is a status, not an error on the wall.
   */
  async check(): Promise<UpdateStatus> {
    if (!this.cfg) return this.status();
    await this.retryDiscard();
    const offerBefore = this.state.available?.version ?? null;
    this.state.lastCheck = new Date(this.hooks.now()).toISOString();
    let text: string | null = null;
    try {
      text = await this.hooks.fetchManifest(this.cfg.manifestUrl);
    } catch {
      text = null;
    }
    if (text === null) {
      this.state.lastResult = "unreachable";
    } else {
      const manifest = parseManifest(text);
      const release = manifest?.[this.state.channel] ?? null;
      if (!manifest) {
        this.state.lastResult = "invalid";
      } else {
        this.state.lastResult = "ok";
        this.state.latest = release;
        // a staged release the track no longer offers - withdrawn, or the track moved back - is let go and removed by the shell, on every
        // good check and so before any quiet moment could start it (security review 2026-10-30); a newer one offered replaces it below
        if (this.state.staged && (!release || compareVersions(release.version, this.state.staged.version) < 0)) await this.dropStaged();
        // newer than this Prism, and newer than what is already staged: the staged release is not found again at the next check (B-458)
        const staged = this.state.staged;
        this.state.available =
          release && compareVersions(release.version, this.cfg.currentVersion) > 0 && !(staged && compareVersions(release.version, staged.version) <= 0) ? release : null;
      }
    }
    if ((this.state.available?.version ?? null) !== offerBefore) this.offerGen++;   // the offer moved: an apply of the old one is not recorded when it ends
    await this.persist();
    // B-458 (2026-10-30): a release found is staged at once - the night window had no door - and the quiet-moment restart is armed
    if (this.state.available && this.cfg.auto && this.cfg.enabled) void this.onNightWindow();   // not awaited: a Check now answers at once, the download runs on
    if (this.cfg.enabled) this.schedule(this.cfg.schedule ? Math.max(1000, (nextScheduledAt(this.cfg.schedule, this.hooks.now()) ?? this.hooks.now() + DAY_MS) - this.hooks.now()) : this.cfg.checkIntervalMs);
    return this.status();
  }

  /**
   * §24 night window: the shell is idle and the wall is dark — apply a
   * pending release now. A failed apply keeps `available` so the next
   * window retries; the shell's rollback guarantees a wall, not a brick.
   */
  async onNightWindow(): Promise<"applied" | "staged" | "failed" | "none"> {
    // one apply at a time (security review 2026-10-30): a check, the switch and Install now may all ask; the second asker gets the first's answer
    if (this.applying) return this.applying;
    this.applying = this.applyNow().finally(() => {
      this.applying = null;
      if (this.reapply) { this.reapply = false; void this.onNightWindow(); }   // the offer moved during the apply: the current one in its turn
    });
    return this.applying;
  }
  private applying: Promise<"applied" | "staged" | "failed" | "none"> | null = null;
  private reapply = false;
  /** Moves whenever the offer does (a check that changes or withdraws it, a track change): an apply that started under an older offer is not recorded. */
  private offerGen = 0;
  /** The staged release let go: core's record and the shell's folder, so neither a start nor a quiet moment hands off into it. */
  private async dropStaged(): Promise<void> {
    this.offerGen++;
    this.state.staged = null;
    await this.tryDiscard();
    this.armRestart();
  }
  /**
   * A pending discard asked again - never against a release core records now (a newer one staged since cleared the old folder as it was
   * written, and the pending mark with it), and never while an apply is writing the folder (security review 2026-10-30, the second pass).
   */
  private async retryDiscard(): Promise<void> {
    if (!this.state.discardPending) return;
    if (this.state.staged) { delete this.state.discardPending; await this.persist(); return; }
    if (this.applying) return;
    await this.tryDiscard();
  }
  /** The shell asked to remove what it staged; a shell that could not (a held folder) leaves the discard pending, asked again at the next check and start. */
  private async tryDiscard(): Promise<void> {
    let ok = true;
    try { ok = (await this.hooks.discard?.()) !== false; } catch { ok = false; }
    if (ok) delete this.state.discardPending; else this.state.discardPending = true;
    await this.persist();
  }
  private async applyNow(): Promise<"applied" | "staged" | "failed" | "none"> {
    const release = this.state.available;
    if (!release || !this.cfg) return this.state.staged ? "staged" : "none";
    const gen = this.offerGen;
    let result: "applied" | "staged" | "failed" | "none";
    try {
      result = await this.hooks.apply(release);
    } catch {
      result = "failed";
    }
    if (result !== "failed") {
      if (gen !== this.offerGen) {
        // the offer moved while this one downloaded - withdrawn, the track changed, or a newer one offered (security review 2026-10-30): never
        // recorded as staged; the shell's copy goes; the current offer, if any, is staged in its turn
        await this.tryDiscard();
        if (this.state.available && this.cfg.auto && this.cfg.enabled) this.reapply = true;
        result = "none";
      } else {
        this.state.staged = release;
        if (release.notes) this.state.notesFor[release.version] = release.notes;
        this.state.available = null;
        delete this.state.discardPending;   // the shell cleared the old folder as it staged this one: nothing of the old discard is owed
      }
    } else {
      // a failed apply leaves nothing standing on either side (security review 2026-10-30, the fourth pass): the shell may hold a partial or a
      // late copy of this release, or still the release staged before it - core cannot tell which - so the record is let go and the shell is
      // asked now, behind any apply still writing, to clear its folder; whatever the track offers is found again at the next check
      this.state.staged = null;
      await this.tryDiscard();
    }
    await this.persist();
    this.armRestart();
    return result;
  }

  /** The quiet window: three hours from the check's time of day (04:00 without a schedule), on the PC's own clock. */
  inRestartWindow(now = this.hooks.now()): boolean {
    const start = scheduleMinutes(this.cfg?.schedule) ?? DEFAULT_CHECK_MINUTES;
    const d = new Date(now);
    const minutes = d.getHours() * 60 + d.getMinutes();
    return ((minutes - start + 1440) % 1440) * 60_000 < RESTART_WINDOW_MS;
  }
  private restartTimer: Timer | null = null;
  /** With a release staged, install on its own on and a shell that can restart: look once a minute for the quiet moment. */
  private armRestart(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (!this.cfg?.auto || !this.state.staged || !this.hooks.restart) return;
    const t = setTimeout(() => { this.restartTimer = null; void this.maybeRestart(); }, RESTART_POLL_MS);
    this.restartTimer = t;
    (t as unknown as { unref?: () => void }).unref?.();
  }
  private async maybeRestart(): Promise<void> {
    if (!this.cfg?.auto || !this.state.staged || !this.hooks.restart) return;
    if (this.applying) { this.armRestart(); return; }   // never into a folder an apply is still writing (security review 2026-10-30)
    if (this.inRestartWindow() && (this.hooks.quiet?.() ?? false)) {
      try { await this.hooks.restart(); return; } catch { /* the shell could not: looked at again in a minute */ }
    }
    this.armRestart();
  }

  /* ------------------------------------------------------------------ */

  private dueIn(): number {
    if (!this.cfg) return DAY_MS;
    if (!this.state.lastCheck) return 0;
    if (this.cfg.schedule) {
      // a scheduled time missed while the PC was off is made up at once; otherwise the next one
      const now = this.hooks.now();
      const owed = lastScheduledAt(this.cfg.schedule, now);
      const last = Date.parse(this.state.lastCheck);
      if (owed !== null && (!Number.isFinite(last) || last < owed)) return 0;
      const next = nextScheduledAt(this.cfg.schedule, now);
      return next === null ? DAY_MS : Math.max(0, next - now);
    }
    const elapsed = this.hooks.now() - Date.parse(this.state.lastCheck);
    return Math.max(0, this.cfg.checkIntervalMs - (Number.isFinite(elapsed) ? elapsed : 0));
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);   // the check's own timer alone: a check must not disarm the quiet-moment restart (B-458)
    this.timer = null;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check();
    }, delayMs);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    try {
      const raw = await this.store.get(STORE_KEY);
      if (raw) this.state = { ...this.state, ...(JSON.parse(raw) as Partial<Persisted>) };
    } catch {
      /* fresh state */
    }
  }

  private async persist(): Promise<void> {
    if (this.store) await this.store.set(STORE_KEY, JSON.stringify(this.state));
  }
}
