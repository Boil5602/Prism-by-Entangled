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

export type UpdateChannel = "stable" | "beta";

export interface ReleaseInfo {
  version: string;
  /** Markdown/plain release notes rendered on-frame after install. */
  notes?: string;
  /** Artifact URL the shell fetches; signature verification is shell-side. */
  url?: string;
  sha256?: string;
}

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
}

export interface UpdateConfig {
  /** Running shell version (semver-ish: 1.2.3, 2026.8.1, with optional -pre). */
  currentVersion: string;
  /** Static manifest URL — must be unparameterized. */
  manifestUrl: string;
  channel?: UpdateChannel;
  /** Check cadence; default daily. */
  checkIntervalMs?: number;
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
}

const STORE_KEY = "updates:state";
const DAY_MS = 86_400_000;

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

export function parseManifest(text: string): UpdateManifest | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null) return null;
    const out: UpdateManifest = {};
    for (const ch of ["stable", "beta"] as const) {
      const entry = (raw as Record<string, unknown>)[ch];
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e["version"] !== "string") continue;
      out[ch] = {
        version: e["version"],
        ...(typeof e["notes"] === "string" ? { notes: e["notes"] } : {}),
        ...(typeof e["url"] === "string" ? { url: e["url"] } : {}),
        ...(typeof e["sha256"] === "string" ? { sha256: e["sha256"] } : {}),
      };
    }
    return out;
  } catch {
    return null;
  }
}

type Timer = ReturnType<typeof setTimeout>;

export class UpdateChecker {
  private cfg: Required<Omit<UpdateConfig, "channel">> | null = null;
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
    this.schedule(this.dueIn());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
    };
  }

  /** Edit mode: opt into beta, or back to stable. Re-checks immediately. */
  async setChannel(channel: UpdateChannel): Promise<void> {
    if (this.state.channel === channel) return;
    this.state.channel = channel;
    this.state.available = null;
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
        this.state.available =
          release && compareVersions(release.version, this.cfg.currentVersion) > 0 ? release : null;
      }
    }
    await this.persist();
    this.schedule(this.cfg.checkIntervalMs);
    return this.status();
  }

  /**
   * §24 night window: the shell is idle and the wall is dark — apply a
   * pending release now. A failed apply keeps `available` so the next
   * window retries; the shell's rollback guarantees a wall, not a brick.
   */
  async onNightWindow(): Promise<"applied" | "staged" | "failed" | "none"> {
    const release = this.state.available;
    if (!release || !this.cfg) return this.state.staged ? "staged" : "none";
    let result: "applied" | "staged" | "failed";
    try {
      result = await this.hooks.apply(release);
    } catch {
      result = "failed";
    }
    if (result !== "failed") {
      this.state.staged = release;
      if (release.notes) this.state.notesFor[release.version] = release.notes;
      this.state.available = null;
    }
    await this.persist();
    return result;
  }

  /* ------------------------------------------------------------------ */

  private dueIn(): number {
    if (!this.cfg) return DAY_MS;
    if (!this.state.lastCheck) return 0;
    const elapsed = this.hooks.now() - Date.parse(this.state.lastCheck);
    return Math.max(0, this.cfg.checkIntervalMs - (Number.isFinite(elapsed) ? elapsed : 0));
  }

  private schedule(delayMs: number): void {
    this.stop();
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
