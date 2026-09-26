/**
 * VPN support (spec §21): device-level WireGuard, user-supplied.
 *
 * Every renderer, adapter fetch, and update check rides the tunnel — the
 * only honest version of the feature (no per-tile split tunneling). Core
 * validates and stores the user's `.conf`, drives the shell's Net driver
 * (always-on + lockdown on Android device-owner; kernel wg + firewall
 * kill-switch on PrismOS), and reports status with the honest notes the
 * settings UI must show. No providers bundled, none recommended.
 */

import type { MaybePromise, StoreDriver } from "./drivers.js";

export interface VpnHooks {
  configure?(wireguardConf: string): MaybePromise<void>;
  clear?(): MaybePromise<void>;
  status?(): MaybePromise<"up" | "down" | "unconfigured">;
}

export interface VpnStatus {
  supported: boolean;
  configured: boolean;
  state: "up" | "down" | "unconfigured";
  /** Peer endpoint host:port from the stored config — what the UI shows. */
  endpoint: string | null;
  /** §21: local traffic stays outside lockdown so the remote and private listening keep working. */
  lanExempt: true;
  notes: readonly string[];
}

/** Honest notes, shown in the settings UI verbatim (§21). */
export const VPN_NOTES: readonly string[] = [
  "A VPN changes your apparent location, and streaming services with geo-blocks may object.",
  "The LAN remote and private listening keep working: local traffic is exempted from lockdown by an explicit rule you can see here.",
  "Your VPN provider sees what any ISP would. Choose one you trust.",
  "Every renderer, adapter fetch, and update check goes through the tunnel. There is no per-tile split tunneling.",
];

const STORE_KEY = "vpn:conf";

export interface ParsedWireGuard {
  privateKey: string;
  address: string | null;
  peerPublicKey: string;
  endpoint: string | null;
  allowedIps: string | null;
}

/** Minimal WireGuard `.conf` validation — enough to refuse garbage early. */
export function parseWireGuardConf(text: string): ParsedWireGuard | null {
  let section = "";
  const iface: Record<string, string> = {};
  const peer: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, "").trim();
    if (!line) continue;
    const m = /^\[(\w+)\]$/.exec(line);
    if (m) {
      section = m[1]!.toLowerCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) return null;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (section === "interface") iface[key] = value;
    else if (section === "peer") peer[key] = value;
    else return null;
  }
  if (!iface["privatekey"] || !peer["publickey"]) return null;
  if (!isBase64Key(iface["privatekey"]) || !isBase64Key(peer["publickey"])) return null;
  return {
    privateKey: iface["privatekey"],
    address: iface["address"] ?? null,
    peerPublicKey: peer["publickey"],
    endpoint: peer["endpoint"] ?? null,
    allowedIps: peer["allowedips"] ?? null,
  };
}

function isBase64Key(s: string): boolean {
  return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(s);
}

export class VpnManager {
  private endpoint: string | null = null;
  private configured = false;
  private loaded = false;

  constructor(
    private hooks: VpnHooks,
    private store?: StoreDriver,
  ) {}

  get supported(): boolean {
    return typeof this.hooks.configure === "function";
  }

  /** Boot: re-apply a stored config so the tunnel is up before any tile loads. */
  async restore(): Promise<void> {
    await this.load();
    if (!this.configured || !this.supported || !this.store) return;
    const conf = await this.store.get(STORE_KEY);
    if (conf) {
      try {
        await this.hooks.configure!(conf);
      } catch {
        /* status() will say "down"; the user sees it, nothing leaks silently */
      }
    }
  }

  /** Paste/import/QR of a standard `.conf`. Returns false on invalid input. */
  async configure(conf: string): Promise<"ok" | "invalid" | "unsupported"> {
    if (!this.supported) return "unsupported";
    const parsed = parseWireGuardConf(conf);
    if (!parsed) return "invalid";
    await this.hooks.configure!(conf);
    this.configured = true;
    this.endpoint = parsed.endpoint;
    if (this.store) await this.store.set(STORE_KEY, conf);
    await this.persistMeta();
    return "ok";
  }

  async clear(): Promise<void> {
    if (this.hooks.clear) await this.hooks.clear();
    this.configured = false;
    this.endpoint = null;
    if (this.store) await this.store.set(STORE_KEY, "");
    await this.persistMeta();
  }

  async status(): Promise<VpnStatus> {
    await this.load();
    let state: VpnStatus["state"] = "unconfigured";
    if (this.configured) {
      try {
        state = (await this.hooks.status?.()) ?? "down";
      } catch {
        state = "down";
      }
    }
    return {
      supported: this.supported,
      configured: this.configured,
      state,
      endpoint: this.endpoint,
      lanExempt: true,
      notes: VPN_NOTES,
    };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    try {
      const meta = await this.store.get(`${STORE_KEY}:meta`);
      if (meta) {
        const m = JSON.parse(meta) as { configured?: boolean; endpoint?: string | null };
        this.configured = m.configured ?? false;
        this.endpoint = m.endpoint ?? null;
      }
    } catch {
      /* fresh */
    }
  }

  private async persistMeta(): Promise<void> {
    if (!this.store) return;
    await this.store.set(
      `${STORE_KEY}:meta`,
      JSON.stringify({ configured: this.configured, endpoint: this.endpoint }),
    );
  }
}
