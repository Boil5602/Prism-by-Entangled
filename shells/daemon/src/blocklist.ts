/**
 * Content blocking lists (§5) for the daemon — same asset format as the
 * Android shell (shells/android/app/src/main/assets/blocklists), so both
 * shells read one attributed set: sources.json + <id>.hosts (+ cosmetic
 * rules for the §27 veil). Every blocked host traces to a named list.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BlockSourceSpec, CosmeticSourceSpec } from "prism-core";

export interface BlockSource {
  id: string;
  name: string;
  maintainer: string;
  url: string;
  license: string;
  syncedAt: string;
  defaultOn: boolean;
  hosts: Set<string>;
  cosmeticAsset: string | null;
  /** Upstream wire format (§5 sync). */
  format: "abp" | "hosts";
}

export class BlockList {
  readonly sources: BlockSource[] = [];
  private hostsAssets = new Map<string, string>();

  constructor(
    private dir: string,
    private store: { get(key: string): string | null },
  ) {
    const manifest = join(dir, "sources.json");
    if (!existsSync(manifest)) {
      console.warn(`[prism-daemon] no blocklists at ${dir} — nothing blocked`);
      return;
    }
    const raw = JSON.parse(readFileSync(manifest, "utf8")) as Array<Record<string, unknown>>;
    for (const s of raw) {
      this.sources.push({
        id: String(s["id"]),
        name: String(s["name"]),
        maintainer: String(s["maintainer"] ?? "unknown"),
        url: String(s["url"] ?? ""),
        license: String(s["license"] ?? "unknown"),
        syncedAt: String(s["syncedAt"] ?? "unknown"),
        defaultOn: s["default"] !== false,
        hosts: this.readHosts(String(s["hosts"] ?? "")),
        cosmeticAsset: typeof s["cosmetic"] === "string" ? s["cosmetic"] : null,
        format: s["format"] === "hosts" ? "hosts" : s["format"] === "abp" || typeof s["cosmetic"] === "string" ? "abp" : "hosts",
      });
      if (typeof s["hosts"] === "string") this.hostsAssets.set(String(s["id"]), s["hosts"]);
    }
    console.log(
      "[prism-daemon] blocklists: " + this.sources.map((s) => `${s.name}(${s.hosts.size})`).join(", "),
    );
  }

  isEnabled(src: BlockSource): boolean {
    const v = this.store.get(`blocking:${src.id}`);
    return v === null ? src.defaultOn : v === "on";
  }

  /** Synced host sets pushed by core (`applyBlockHosts`); replace the bundled set per source. */
  private synced = new Map<string, { name: string; hosts: Set<string> }>();

  applySynced(sourceId: string, name: string, hosts: string[]): void {
    this.synced.set(sourceId, { name, hosts: new Set(hosts) });
    console.log(`[prism-daemon] list '${name}' applied: ${hosts.length} hosts`);
  }

  /** §5 source specs for core, carrying the bundled baseline text. */
  specs(): BlockSourceSpec[] {
    return this.sources.map((src) => {
      // Bundled baseline in the source's own wire format: ABP sources get
      // their cosmetic rules plus the hosts baseline as ||host^ lines; hosts
      // sources carry the hosts file verbatim.
      let bundled = "";
      if (src.format === "abp") {
        bundled = "[Adblock Plus 2.0]\n";
        const cos = src.cosmeticAsset ? join(this.dir, src.cosmeticAsset) : null;
        if (cos && existsSync(cos)) bundled += readFileSync(cos, "utf8") + "\n";
        for (const h of src.hosts) bundled += `||${h}^\n`;
      } else {
        const asset = this.hostsAssets.get(src.id);
        const path = asset ? join(this.dir, asset) : null;
        if (path && existsSync(path)) bundled = readFileSync(path, "utf8");
      }
      return {
        id: src.id,
        name: src.name,
        maintainer: src.maintainer,
        url: src.url,
        license: src.license,
        format: src.format,
        defaultOn: src.defaultOn,
        ...(bundled ? { bundled, bundledSyncedAt: src.syncedAt } : {}),
      };
    });
  }

  /** The list that blocks this host, or null — synced set wins, bundled is the baseline. */
  blockedBy(host: string | undefined): BlockSource | null {
    if (!host) return null;
    for (const src of this.sources) {
      const synced = this.synced.get(src.id);
      if (!synced && !this.isEnabled(src)) continue;
      const hosts = synced ? synced.hosts : src.hosts;
      let probe = host.toLowerCase();
      for (;;) {
        if (hosts.has(probe)) return src;
        const dot = probe.indexOf(".");
        if (dot < 0) break;
        probe = probe.slice(dot + 1);
      }
    }
    return null;
  }

  /** §27 attributed cosmetic sources for core. */
  cosmeticSources(): CosmeticSourceSpec[] {
    const out: CosmeticSourceSpec[] = [];
    for (const src of this.sources) {
      if (!src.cosmeticAsset || !this.isEnabled(src)) continue;
      const path = join(this.dir, src.cosmeticAsset);
      if (!existsSync(path)) continue;
      out.push({
        attribution: {
          name: src.name,
          maintainer: src.maintainer,
          url: src.url,
          license: src.license,
          syncedAt: src.syncedAt,
        },
        text: readFileSync(path, "utf8"),
      });
    }
    return out;
  }

  private readHosts(asset: string): Set<string> {
    const out = new Set<string>();
    if (!asset) return out;
    const path = join(this.dir, asset);
    if (!existsSync(path)) return out;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.split("#")[0]!.trim().toLowerCase();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const host = parts.length >= 2 && /^[\d.]+$/.test(parts[0]!) ? parts[1]! : parts[0]!;
      out.add(host);
    }
    return out;
  }
}
