/**
 * Compatibility reports (spec §19 — opt-in, per-incident, inspectable).
 *
 * There is no ambient telemetry in Prism — nothing phones home, ever. The
 * one exception is user-initiated: when a compatibility failure repeats,
 * the shell may offer — once, quietly, in edit mode — to send an anonymous
 * report so the community can fix it.
 *
 * The payload is a NORMATIVE WHITELIST: anything not listed here cannot be
 * sent. A report is a fact about software (site X broke adapter Y on
 * engine Z), never about a person: domain only (paths and query strings
 * carry personal data), date-granular timestamps, no identifiers of any
 * kind — reports cannot be correlated with each other.
 *
 * Consent is per-incident; there is deliberately no "always send", because
 * standing consent drifts from informed consent. Declining suppresses the
 * offer for that domain+adapter version, permanently.
 */

import type { StoreDriver } from "./drivers.js";

export const REPORT_KINDS = [
  "adapter-selector-missing",
  "tile-render-failure",
  "drm-init-failure",
  "readiness-timeout",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

/** Software identity strings — versions, never serials or install ids. */
export interface CompatContext {
  shell: string;
  engine: string;
  device: string;
}

/** The complete payload. Every field below; no field beyond them. */
export interface CompatReport {
  kind: ReportKind;
  domain: string;
  adapter: string | null;
  shell: string;
  engine: string;
  device: string;
  failCount: number;
  firstFailed: string;
}

const REPORT_FIELDS = [
  "kind",
  "domain",
  "adapter",
  "shell",
  "engine",
  "device",
  "failCount",
  "firstFailed",
] as const;

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict allowlist validation — used by tests, ingest, and anyone auditing.
 * Unknown fields REJECT (the schema is closed); malformed values reject.
 */
export function validateReport(value: unknown): value is CompatReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== REPORT_FIELDS.length) return false;
  if (!REPORT_FIELDS.every((f) => f in record)) return false;
  if (!REPORT_KINDS.includes(record["kind"] as ReportKind)) return false;
  if (typeof record["domain"] !== "string" || !DOMAIN_RE.test(record["domain"])) return false;
  if (record["adapter"] !== null && typeof record["adapter"] !== "string") return false;
  for (const f of ["shell", "engine", "device"] as const) {
    if (typeof record[f] !== "string" || record[f] === "") return false;
  }
  if (!Number.isInteger(record["failCount"]) || (record["failCount"] as number) < 1) return false;
  if (typeof record["firstFailed"] !== "string" || !DATE_RE.test(record["firstFailed"])) return false;
  return true;
}

/** Reduce anything URL-shaped to a bare hostname; null if that fails. */
export function toDomain(urlOrHost: string): string | null {
  try {
    const host = urlOrHost.includes("://") ? new URL(urlOrHost).hostname : urlOrHost;
    return DOMAIN_RE.test(host) ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

const SUPPRESSED_KEY = "compat:suppressed";

interface Incident {
  kind: ReportKind;
  domain: string;
  adapter: string | null;
  count: number;
  firstFailed: string;
}

export interface PendingOffer {
  key: string;
  /** The exact JSON that would be sent — shown to the user, not a summary. */
  report: CompatReport;
}

export class CompatTracker {
  private incidents = new Map<string, Incident>();
  private suppressed = new Set<string>();
  private loaded = false;
  private threshold: number;

  constructor(
    private context: CompatContext,
    private store?: StoreDriver,
    options?: { threshold?: number },
  ) {
    this.threshold = options?.threshold ?? 3;
  }

  setContext(context: CompatContext): void {
    this.context = context;
  }

  /** Record one failure occurrence. Suppressed incidents are not tracked. */
  async record(kind: ReportKind, urlOrHost: string, adapter: string | null): Promise<void> {
    await this.ensureLoaded();
    const domain = toDomain(urlOrHost);
    if (!domain) return; // nothing report-worthy without a clean domain
    const key = `${kind}|${domain}|${adapter ?? "none"}`;
    if (this.suppressed.has(key)) return;
    const existing = this.incidents.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      this.incidents.set(key, {
        kind,
        domain,
        adapter,
        count: 1,
        firstFailed: new Date().toISOString().slice(0, 10),
      });
    }
  }

  /** Offers past the threshold — each with the exact payload to display. */
  async pending(): Promise<PendingOffer[]> {
    await this.ensureLoaded();
    const offers: PendingOffer[] = [];
    for (const [key, incident] of this.incidents) {
      if (incident.count < this.threshold || this.suppressed.has(key)) continue;
      offers.push({
        key,
        report: {
          kind: incident.kind,
          domain: incident.domain,
          adapter: incident.adapter,
          shell: this.context.shell,
          engine: this.context.engine,
          device: this.context.device,
          failCount: incident.count,
          firstFailed: incident.firstFailed,
        },
      });
    }
    return offers;
  }

  /**
   * Per-incident decision. Both outcomes suppress future offers for this
   * domain+adapter (send: it went once; decline: §19 suppression rule).
   * Returns the payload when the user chose to send, else null.
   */
  async decide(key: string, send: boolean): Promise<CompatReport | null> {
    await this.ensureLoaded();
    const offer = (await this.pending()).find((o) => o.key === key);
    this.suppressed.add(key);
    this.incidents.delete(key);
    await this.persist();
    return send && offer ? offer.report : null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.store) return;
    try {
      const raw = await this.store.get(SUPPRESSED_KEY);
      if (raw) this.suppressed = new Set(JSON.parse(raw) as string[]);
    } catch {
      this.suppressed = new Set();
    }
  }

  private async persist(): Promise<void> {
    if (this.store) await this.store.set(SUPPRESSED_KEY, JSON.stringify([...this.suppressed]));
  }
}
