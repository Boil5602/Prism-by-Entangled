/**
 * Content-blocking lists (spec §5): named categories bound to ATTRIBUTED
 * upstream lists, synced independently of shell releases.
 *
 * Core owns the policy: which sources exist, whether each is enabled, when
 * to sync, how to parse, what the UI must show (name, maintainer, URL,
 * license, last sync, entry count). Shells own the wire: they fetch exactly
 * the URL core hands over (no query string, no identifiers — a sync reveals
 * nothing but "someone synced", §22) and apply the resulting host set at
 * the network layer. Synced text persists in the §10 store so the frame
 * comes back with its lists after a restart, offline or not.
 *
 * Never an unlabeled truth filter: every entry traces to the list the user
 * enabled, and the shell's blocked-request log names it.
 */

import type { MaybePromise, StoreDriver } from "./drivers.js";
import type { CosmeticSourceSpec } from "./veil.js";

export interface BlockSourceSpec {
  id: string;
  name: string;
  maintainer: string;
  url: string;
  license: string;
  /** Wire format of the upstream list. */
  format: "abp" | "hosts";
  /** Enabled unless the user turns it off (scam-disinfo ships off). */
  defaultOn: boolean;
  /** Bundled baseline text (offline) — used until the first sync lands. */
  bundled?: string;
  bundledSyncedAt?: string;
}

export interface BlockSourceStatus {
  id: string;
  name: string;
  maintainer: string;
  url: string;
  license: string;
  format: "abp" | "hosts";
  enabled: boolean;
  syncedAt: string | null;
  /** "bundled" until a sync has landed. */
  origin: "bundled" | "synced" | "none";
  entryCount: number;
  lastResult: "ok" | "unreachable" | "invalid" | null;
}

export interface BlockingHooks {
  /** Fetch exactly this URL (unparameterized); throw on failure. */
  fetchStatic(url: string): MaybePromise<string>;
  /** Install the host set for a source at the network layer (empty = disabled). */
  applyHosts(sourceId: string, name: string, hosts: string[]): MaybePromise<void>;
  /** §27: cosmetic rules changed — re-register with the veil. */
  cosmeticsChanged(sources: CosmeticSourceSpec[]): MaybePromise<void>;
  now(): number;
}

/** Default shipped set (§5 table). Shells may bundle baseline text per source. */
export const DEFAULT_BLOCK_SOURCES: BlockSourceSpec[] = [
  {
    id: "ads",
    name: "EasyList",
    maintainer: "EasyList community",
    url: "https://easylist.to/easylist/easylist.txt",
    license: "GPL-3.0 / CC BY-SA 3.0",
    format: "abp",
    defaultOn: true,
  },
  {
    id: "trackers",
    name: "EasyPrivacy",
    maintainer: "EasyList community",
    url: "https://easylist.to/easylist/easyprivacy.txt",
    license: "GPL-3.0 / CC BY-SA 3.0",
    format: "abp",
    defaultOn: true,
  },
  {
    id: "scam-disinfo",
    name: "StevenBlack fakenews",
    maintainer: "Steven Black (community)",
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-only/hosts",
    license: "MIT",
    format: "hosts",
    defaultOn: false,
  },
];

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,}$/i;

/**
 * Host-level subset of an ABP list: `||host^` rules with no path and no
 * options that would scope them below the host (only `third-party`,
 * `3p`, and resource-type options are accepted). Everything else — path
 * rules, exceptions, cosmetics — is not a host block and is left out.
 */
export function parseAbpHosts(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("||")) continue;
    const m = /^\|\|([^/^*|$?&#]+)\^?(?:\$([a-z0-9,~=-]+))?$/i.exec(line);
    if (!m) continue;
    const host = m[1]!.toLowerCase();
    if (!HOST_RE.test(host)) continue;
    const opts = m[2]?.split(",") ?? [];
    const scoped = opts.some((o) => !/^(third-party|3p|script|image|xmlhttprequest|subdocument|object|media|font|other|ping|websocket|stylesheet)$/i.test(o));
    if (scoped) continue;
    out.add(host);
  }
  return out;
}

/** hosts-file format: `0.0.0.0 host` / `127.0.0.1 host` / bare host lines. */
export function parseHostsFile(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0]!.trim().toLowerCase();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const host = parts.length >= 2 && /^[\d.:]+$/.test(parts[0]!) ? parts[1]! : parts[0]!;
    if (host === "localhost" || host.endsWith(".localdomain") || host === "broadcasthost") continue;
    if (HOST_RE.test(host)) out.add(host);
  }
  return out;
}

export function parseHosts(text: string, format: "abp" | "hosts"): Set<string> {
  return format === "abp" ? parseAbpHosts(text) : parseHostsFile(text);
}

interface SourceState {
  spec: BlockSourceSpec;
  text: string | null;
  origin: "bundled" | "synced" | "none";
  syncedAt: string | null;
  lastResult: BlockSourceStatus["lastResult"];
  entryCount: number;
}

const DAY_MS = 86_400_000;
type Timer = ReturnType<typeof setTimeout>;

export class BlockListManager {
  private sources = new Map<string, SourceState>();
  private timer: Timer | null = null;
  private intervalMs = DAY_MS;
  private loaded = false;

  constructor(
    private hooks: BlockingHooks,
    private store?: StoreDriver,
  ) {}

  /** Boot: adopt specs, restore synced text (§10), apply everything, start the cadence. */
  async start(specs: BlockSourceSpec[], opts: { intervalMs?: number } = {}): Promise<void> {
    this.intervalMs = opts.intervalMs ?? DAY_MS;
    for (const spec of specs) {
      const state: SourceState = {
        spec,
        text: spec.bundled ?? null,
        origin: spec.bundled ? "bundled" : "none",
        syncedAt: spec.bundledSyncedAt ?? null,
        lastResult: null,
        entryCount: 0,
      };
      this.sources.set(spec.id, state);
    }
    await this.load();
    for (const state of this.sources.values()) {
      state.entryCount = state.text ? parseHosts(state.text, state.spec.format).size : 0;
      await this.applyOne(state);
    }
    await this.hooks.cosmeticsChanged(this.cosmeticSources());
    this.schedule(this.dueIn());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  isEnabled(id: string): boolean {
    const state = this.sources.get(id);
    if (!state) return false;
    const v = this.store ? this.enabledCache.get(id) : undefined;
    return v ?? state.spec.defaultOn;
  }

  private enabledCache = new Map<string, boolean>();

  /** Users can disable any category (§5). Applies immediately. */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const state = this.sources.get(id);
    if (!state) return false;
    this.enabledCache.set(id, enabled);
    if (this.store) await this.store.set(`blocking:${id}`, enabled ? "on" : "off");
    await this.applyOne(state);
    await this.hooks.cosmeticsChanged(this.cosmeticSources());
    return true;
  }

  /** Add a user list URL (§5) — attributed to the user, format guessed by extension. */
  async addCustom(spec: Omit<BlockSourceSpec, "defaultOn"> & { defaultOn?: boolean }): Promise<boolean> {
    if (!/^https?:\/\//.test(spec.url) || spec.url.includes("?")) return false;
    this.sources.set(spec.id, {
      spec: { ...spec, defaultOn: spec.defaultOn ?? true },
      text: null,
      origin: "none",
      syncedAt: null,
      lastResult: null,
      entryCount: 0,
    });
    await this.syncOne(spec.id);
    return true;
  }

  async remove(id: string): Promise<void> {
    const state = this.sources.get(id);
    if (!state) return;
    this.sources.delete(id);
    await this.hooks.applyHosts(id, state.spec.name, []);
    if (this.store) await this.store.set(`blocking:text:${id}`, "");
    await this.hooks.cosmeticsChanged(this.cosmeticSources());
  }

  status(): BlockSourceStatus[] {
    return [...this.sources.values()].map((s) => ({
      id: s.spec.id,
      name: s.spec.name,
      maintainer: s.spec.maintainer,
      url: s.spec.url,
      license: s.spec.license,
      format: s.spec.format,
      enabled: this.isEnabled(s.spec.id),
      syncedAt: s.syncedAt,
      origin: s.origin,
      entryCount: s.entryCount,
      lastResult: s.lastResult,
    }));
  }

  /** Which enabled source blocks a host (for logs/UI); shells do the fast path themselves. */
  blockedBy(host: string): string | null {
    const h = host.toLowerCase();
    for (const s of this.sources.values()) {
      if (!this.isEnabled(s.spec.id) || !s.text) continue;
      const hosts = this.hostCache(s);
      let probe = h;
      for (;;) {
        if (hosts.has(probe)) return s.spec.name;
        const dot = probe.indexOf(".");
        if (dot < 0) break;
        probe = probe.slice(dot + 1);
      }
    }
    return null;
  }

  /** Sync every source now (edit-mode "Sync lists"); never throws. */
  async syncAll(): Promise<BlockSourceStatus[]> {
    for (const id of this.sources.keys()) await this.syncOne(id);
    await this.hooks.cosmeticsChanged(this.cosmeticSources());
    this.schedule(this.intervalMs);
    return this.status();
  }

  /** §27: ABP sources double as cosmetic sources for the veil. */
  cosmeticSources(): CosmeticSourceSpec[] {
    const out: CosmeticSourceSpec[] = [];
    for (const s of this.sources.values()) {
      if (s.spec.format !== "abp" || !s.text || !this.isEnabled(s.spec.id)) continue;
      out.push({
        attribution: {
          name: s.spec.name,
          maintainer: s.spec.maintainer,
          url: s.spec.url,
          license: s.spec.license,
          syncedAt: s.syncedAt ?? "bundled",
        },
        text: s.text,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */

  private hostSets = new WeakMap<SourceState, { text: string; hosts: Set<string> }>();

  private hostCache(s: SourceState): Set<string> {
    const cached = this.hostSets.get(s);
    if (cached && cached.text === s.text) return cached.hosts;
    const hosts = parseHosts(s.text ?? "", s.spec.format);
    this.hostSets.set(s, { text: s.text ?? "", hosts });
    return hosts;
  }

  private async syncOne(id: string): Promise<void> {
    const state = this.sources.get(id);
    if (!state) return;
    if (state.spec.url.includes("?") || state.spec.url.includes("#")) {
      state.lastResult = "invalid";
      return;
    }
    let text: string | null = null;
    try {
      text = await this.hooks.fetchStatic(state.spec.url);
    } catch {
      text = null;
    }
    if (text === null) {
      state.lastResult = "unreachable";
      return;
    }
    const hosts = parseHosts(text, state.spec.format);
    if (hosts.size === 0 && text.trim().length > 0 && state.spec.format === "abp" && !text.startsWith("[Adblock")) {
      state.lastResult = "invalid"; // not a list — keep what we had
      return;
    }
    state.text = text;
    state.origin = "synced";
    state.syncedAt = new Date(this.hooks.now()).toISOString();
    state.lastResult = "ok";
    state.entryCount = hosts.size;
    if (this.store) {
      await this.store.set(`blocking:text:${id}`, text);
      await this.store.set(`blocking:meta:${id}`, JSON.stringify({ syncedAt: state.syncedAt }));
    }
    await this.applyOne(state);
  }

  private async applyOne(state: SourceState): Promise<void> {
    const hosts = this.isEnabled(state.spec.id) ? [...this.hostCache(state)] : [];
    await this.hooks.applyHosts(state.spec.id, state.spec.name, hosts);
  }

  private dueIn(): number {
    let soonest = 0;
    let any = false;
    for (const s of this.sources.values()) {
      if (!s.syncedAt || s.origin !== "synced") return 0; // never synced — go now
      const elapsed = this.hooks.now() - Date.parse(s.syncedAt);
      const remaining = Math.max(0, this.intervalMs - (Number.isFinite(elapsed) ? elapsed : 0));
      soonest = any ? Math.min(soonest, remaining) : remaining;
      any = true;
    }
    return any ? soonest : this.intervalMs;
  }

  private schedule(delayMs: number): void {
    this.stop();
    if (this.sources.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncAll();
    }, delayMs);
  }

  private async load(): Promise<void> {
    if (this.loaded || !this.store) return;
    this.loaded = true;
    for (const state of this.sources.values()) {
      try {
        const enabled = await this.store.get(`blocking:${state.spec.id}`);
        if (enabled === "on" || enabled === "off") this.enabledCache.set(state.spec.id, enabled === "on");
        const text = await this.store.get(`blocking:text:${state.spec.id}`);
        if (text) {
          state.text = text;
          state.origin = "synced";
          const meta = await this.store.get(`blocking:meta:${state.spec.id}`);
          state.syncedAt = meta ? ((JSON.parse(meta) as { syncedAt?: string }).syncedAt ?? null) : null;
        }
      } catch {
        /* keep bundled */
      }
    }
  }
}
