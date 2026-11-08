/**
 * Popup doctrine (spec §30): ads that play get veiled; pages that spawn get
 * blocked. A popup is code, so it is intercepted UNEXECUTED — never loaded
 * offscreen, never run invisibly — and every interception lands in a local
 * per-site ledger the human can act on with one tap.
 *
 * Core owns ALL of the policy: the automatic tier (click consistency, burst
 * rule, attributed list classification, functional allowlist), the human
 * tier (per-destination allow, per-site block-all, global default), the
 * ledger, the deliberate-open nudge, the button's per-site preferences, and
 * the pill's morph pacing. Shells/extensions only intercept `window.open`
 * with a stub WindowProxy, render the pill/panel as subscribers to
 * `on(listener)`, and open windows the human asked for. UI never computes
 * policy.
 *
 * Wording rule (§30): no "whitelist" anywhere — the sentences a UI shows
 * come from `allowSentence()` / `allowedSentence()` below.
 */

import type { StoreDriver } from "./drivers.js";

export type PopupAction = "allow" | "intercept";

export interface PopupGesture {
  /** URL the human visibly activated (an anchor's href), if any. */
  url?: string;
  /** How many windows this same gesture has tried to open so far (1 = first). */
  windowsThisGesture: number;
}

export interface PopupAttempt {
  /** The page doing the opening (its hostname). */
  site: string;
  /** Requested popup URL (absolute); "" or about:blank for a bounce. */
  url: string;
  gesture?: PopupGesture;
}

export interface PopupDecision {
  action: PopupAction;
  /** Plain-language reason, ledger-ready ("matches your click", "list: EasyList", ...). */
  reason: string;
  /** Name of the attributed list whose rule matched, when one did (§5). */
  list?: string;
}

export interface LedgerEntry {
  site: string;
  dest: string;
  count: number;
  /** ISO time of the most recent attempt. */
  lastSeen: string;
  /** Most recent full URL, so a deliberate Open reaches exactly what was asked. */
  lastUrl: string;
  /** Why the automatic tier intercepted it. */
  context: string;
  /** Deliberate opens by the human. */
  opens: number;
  /** Times the human dismissed the "open automatically?" nudge. */
  nudgeDismissed: number;
}

/** One destination across every site (the toolbar summary). */
export interface AggregateRow {
  dest: string;
  count: number;
  sites: string[];
  lastSeen: string;
  context: string;
}

/** Aggregate a per-site ledger by destination: counts summed, sites listed, newest first within ties. Pure. */
export function aggregateLedger(bySite: Record<string, LedgerEntry[]>): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const [site, list] of Object.entries(bySite)) {
    for (const e of list) {
      const a = map.get(e.dest) ?? { dest: e.dest, count: 0, sites: [], lastSeen: e.lastSeen, context: e.context };
      a.count += e.count;
      if (!a.sites.includes(site)) a.sites.push(site);
      if (e.lastSeen > a.lastSeen) { a.lastSeen = e.lastSeen; a.context = e.context; }
      map.set(e.dest, a);
    }
  }
  return Array.from(map.values()).sort((x, y) => (y.count - x.count) || y.lastSeen.localeCompare(x.lastSeen));
}

export interface AllowedRow {
  site: string;
  dest: string;
  since: string;
  sentence: string;
}

export interface SitePolicy {
  blockAll?: boolean | undefined;
  allowed: Record<string, { since: string }>;
}
export interface PopupPolicyState {
  global: PopupAction;
  sites: Record<string, SitePolicy>;
}
export interface ButtonPrefs {
  collapsed?: boolean | undefined;
  hidden?: boolean | undefined;
}

export type PopupEvent =
  | { type: "intercepted"; site: string; dest: string; url: string; reason: string; list?: string | undefined; entry: LedgerEntry }
  | { type: "opened"; site: string; dest: string; url: string; nudge: boolean }
  | { type: "allowed"; site: string; dest: string }
  | { type: "removed"; site: string; dest: string }
  | { type: "policy"; site: string }
  | { type: "prefs"; site: string; prefs: ButtonPrefs };

const POLICY_KEY = "popups:policy";
const LEDGER_KEY = "popups:ledger";
const PREFS_KEY = "popups:prefs";
const LEDGER_CAP_PER_SITE = 200;

/**
 * Structurally legitimate popups (§30 "functional allowlist"): sign-in
 * brokers, payment processors, print previews. Named so the ledger/decision
 * can say which one applied.
 */
export const FUNCTIONAL_POPUPS: Array<{ name: string; test: RegExp }> = [
  { name: "sign-in (Google)", test: /(^|\.)accounts\.google\.com$/i },
  { name: "sign-in (Microsoft)", test: /(^|\.)(login\.microsoftonline\.com|login\.live\.com)$/i },
  { name: "sign-in (Apple)", test: /(^|\.)(appleid|idmsa)\.apple\.com$/i },   // idmsa: the Apple ID popup music.apple.com opens
  { name: "sign-in (GitHub)", test: /^github\.com$/i },
  { name: "sign-in (Facebook)", test: /^(www\.)?facebook\.com$/i },
  { name: "sign-in (Auth0/Okta)", test: /(^|\.)(auth0\.com|okta\.com)$/i },
  { name: "payment (Stripe)", test: /(^|\.)(checkout\.stripe\.com|js\.stripe\.com)$/i },
  { name: "payment (PayPal)", test: /(^|\.)paypal\.com$/i },
  { name: "payment (Shop Pay)", test: /(^|\.)(shop\.app|checkout\.shopify\.com)$/i },
  { name: "payment (Google Pay)", test: /(^|\.)pay\.google\.com$/i },
  { name: "payment (Apple Pay)", test: /(^|\.)apple-pay-gateway\.apple\.com$/i },
];

/** Hostname of a URL, or "" for about:blank / unparsable (a bounce). */
export function popupHost(url: string): string {
  if (!url || /^about:/i.test(url)) return "";
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ""; }
}
// Approximate registrable domain (eTLD+1). No PSL, so a small set of common
// two-part TLDs is special-cased; good enough to tell "same site" from "third
// party" for the popup heuristic.
const MULTI_PART_TLD = /\.(co|com|org|net|gov|edu|ac|or|ne)\.[a-z]{2}$/i;
function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(MULTI_PART_TLD.test(host) ? -3 : -2).join(".");
}
/** Same registrable domain: a self-referred popup (e.g. msn.com opening msn.com). */
function sameSite(site: string, dest: string): boolean {
  if (!site || !dest) return false;
  const a = registrableDomain(site.toLowerCase()), b = registrableDomain(dest.toLowerCase());
  return !!a && a === b;
}

/** "Always open checkout.example.com popups from shop.com" */
export function allowSentence(site: string, dest: string): string {
  return `Always open ${dest} popups from ${site}`;
}
/** "shop.com may open checkout.example.com" (the allowed-list row) */
export function allowedSentence(site: string, dest: string): string {
  return `${site} may open ${dest}`;
}

export class PopupPolicy {
  private state: PopupPolicyState = { global: "intercept", sites: {} };
  private ledgerBySite: Record<string, LedgerEntry[]> = {};
  private prefsBySite: Record<string, ButtonPrefs> = {};
  private listeners = new Set<(e: PopupEvent) => void>();
  private readonly listMatch: (host: string) => string | null;
  private readonly now: () => number;

  constructor(
    private readonly store: StoreDriver | null,
    opts: {
      /** Attributed-list lookup: the name of the list whose popup/host rule matches, else null (§5). */
      listMatch?: (host: string) => string | null;
      now?: () => number;
    } = {},
  ) {
    this.listMatch = opts.listMatch ?? (() => null);
    this.now = opts.now ?? (() => Date.now());
  }

  async load(): Promise<void> {
    if (!this.store) return;
    const [p, l, f] = await Promise.all([this.store.get(POLICY_KEY), this.store.get(LEDGER_KEY), this.store.get(PREFS_KEY)]);
    try { if (p) { const st = JSON.parse(p) as Partial<PopupPolicyState>; this.state = { global: st.global ?? "intercept", sites: st.sites ?? {} }; } } catch { /* keep defaults */ }
    try { if (l) this.ledgerBySite = JSON.parse(l) as Record<string, LedgerEntry[]>; } catch { /* keep */ }
    try { if (f) this.prefsBySite = JSON.parse(f) as Record<string, ButtonPrefs>; } catch { /* keep */ }
  }
  private persist(): void {
    if (!this.store) return;
    void this.store.set(POLICY_KEY, JSON.stringify(this.state));
    void this.store.set(LEDGER_KEY, JSON.stringify(this.ledgerBySite));
    void this.store.set(PREFS_KEY, JSON.stringify(this.prefsBySite));
  }
  on(listener: (e: PopupEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(e: PopupEvent): void { this.listeners.forEach((l) => { try { l(e); } catch { /* subscriber bug is not our failure */ } }); }

  /** A snapshot a main-world hook can evaluate against synchronously. */
  snapshot(): PopupPolicyState { return JSON.parse(JSON.stringify(this.state)) as PopupPolicyState; }
  replace(state: PopupPolicyState): void { this.state = state; }

  // ---------------------------------------------------------------- automatic tier
  /**
   * Decide one attempt. Synchronous and pure over the current state, so a
   * `window.open` interception can return a real or stub window at once.
   * Order: human policy first (their decision beats every heuristic), then
   * the burst rule, functional popups, click consistency, attributed lists,
   * and finally the global default (unknowns are intercepted, §30).
   */
  evaluate(a: PopupAttempt): PopupDecision {
    const dest = popupHost(a.url);
    const site = this.state.sites[a.site];
    if (site?.allowed[dest]) return { action: "allow", reason: "allowed by you" };
    if (site?.blockAll) return { action: "intercept", reason: "you block all popups here" };
    if (a.gesture && a.gesture.windowsThisGesture > 1) return { action: "intercept", reason: `burst: window ${a.gesture.windowsThisGesture} from one click` };
    if (!dest) return { action: "intercept", reason: "blank window (bounce)" };
    const fn = FUNCTIONAL_POPUPS.find((f) => f.test.test(dest));
    if (fn) return { action: "allow", reason: `functional: ${fn.name}` };
    if (a.gesture?.url) {
      if (a.gesture.url === a.url || originOf(a.gesture.url) === originOf(a.url)) return { action: "allow", reason: "matches your click" };
    }
    const list = this.listMatch(dest);
    if (list) return { action: "intercept", reason: `list: ${list}`, list };
    // Self-referred: a site opening its OWN registrable domain is almost always
    // a deliberate navigation (MSN opening an MSN article), not the third-party
    // ad-popup pattern. Allow it - but only AFTER the ad-list check above, so a
    // same-site URL that IS on a filter list still gets intercepted.
    if (sameSite(a.site, dest)) return { action: "allow", reason: "same site as this page" };
    if (this.state.global === "allow" && a.gesture) return { action: "allow", reason: "your default: allow" };
    return { action: "intercept", reason: a.gesture ? "unknown destination" : "opened without a click" };
  }

  /** Record an attempt's outcome (interceptions go to the ledger; allows are not logged — nothing to act on). */
  record(a: PopupAttempt, d: PopupDecision): LedgerEntry | null {
    if (d.action !== "intercept") return null;
    const dest = popupHost(a.url) || "(blank)";
    const list = (this.ledgerBySite[a.site] ??= []);
    let e = list.find((x) => x.dest === dest);
    const iso = new Date(this.now()).toISOString();
    if (!e) {
      e = { site: a.site, dest, count: 0, lastSeen: iso, lastUrl: a.url, context: d.reason, opens: 0, nudgeDismissed: 0 };
      list.unshift(e);
      if (list.length > LEDGER_CAP_PER_SITE) list.length = LEDGER_CAP_PER_SITE;
    }
    e.count += 1; e.lastSeen = iso; e.lastUrl = a.url || e.lastUrl; e.context = d.reason;
    this.persist();
    this.emit({ type: "intercepted", site: a.site, dest, url: a.url, reason: d.reason, list: d.list, entry: e });
    return e;
  }

  // ---------------------------------------------------------------- human tier
  ledger(site: string): LedgerEntry[] { return (this.ledgerBySite[site] ?? []).slice(); }
  /** Every site's ledger (for the cross-site summary). */
  ledgerAll(): Record<string, LedgerEntry[]> { return JSON.parse(JSON.stringify(this.ledgerBySite)) as Record<string, LedgerEntry[]>; }
  /** Sites with anything in the ledger, most intercepted first. */
  sites(): string[] { return Object.keys(this.ledgerBySite).filter((s) => this.ledgerBySite[s]!.length).sort((a, b) => this.totalIntercepted(b) - this.totalIntercepted(a)); }
  /** Forget the ledger (allowances are policy and stay). */
  clearLedger(): void { this.ledgerBySite = {}; this.persist(); this.emit({ type: "policy", site: "*" }); }
  totalIntercepted(site: string): number { return (this.ledgerBySite[site] ?? []).reduce((n, e) => n + e.count, 0); }

  /**
   * Deliberate open — the functionality guarantee. Returns the URL to open
   * NOW, visibly, and whether to show the one-line "Open these automatically
   * next time?" nudge (after a deliberate open, and again on the second open
   * of the same destination; never once allowed; stops after two dismissals).
   */
  open(site: string, dest: string): { url: string; nudge: boolean } | null {
    const e = (this.ledgerBySite[site] ?? []).find((x) => x.dest === dest);
    if (!e) return null;
    e.opens += 1;
    const alreadyAllowed = !!this.state.sites[site]?.allowed[dest];
    const nudge = !alreadyAllowed && e.nudgeDismissed < 2;
    this.persist();
    this.emit({ type: "opened", site, dest, url: e.lastUrl, nudge });
    return { url: e.lastUrl, nudge };
  }
  dismissNudge(site: string, dest: string): void {
    const e = (this.ledgerBySite[site] ?? []).find((x) => x.dest === dest);
    if (e) { e.nudgeDismissed += 1; this.persist(); }
  }
  /** "Always allow": scoped site→destination; honored by evaluate() from now on. */
  allow(site: string, dest: string): void {
    const s = (this.state.sites[site] ??= { allowed: {} });
    s.allowed[dest] = { since: new Date(this.now()).toISOString() };
    this.persist();
    this.emit({ type: "allowed", site, dest });
    this.emit({ type: "policy", site });
  }
  /** Remove an allowance: interception resumes immediately. */
  remove(site: string, dest: string): void {
    const s = this.state.sites[site];
    if (!s || !s.allowed[dest]) return;
    delete s.allowed[dest];
    this.persist();
    this.emit({ type: "removed", site, dest });
    this.emit({ type: "policy", site });
  }
  /** "Popups you've allowed" — plain sentences, one Remove per row. */
  listAllowed(): AllowedRow[] {
    const rows: AllowedRow[] = [];
    for (const [site, s] of Object.entries(this.state.sites)) {
      for (const [dest, v] of Object.entries(s.allowed)) rows.push({ site, dest, since: v.since, sentence: allowedSentence(site, dest) });
    }
    return rows.sort((a, b) => (a.site + a.dest).localeCompare(b.site + b.dest));
  }
  setBlockAll(site: string, on: boolean): void {
    const s = (this.state.sites[site] ??= { allowed: {} });
    s.blockAll = on || undefined;
    this.persist();
    this.emit({ type: "policy", site });
  }
  blockAll(site: string): boolean { return !!this.state.sites[site]?.blockAll; }
  setGlobal(action: PopupAction): void { this.state.global = action; this.persist(); this.emit({ type: "policy", site: "*" }); }
  global(): PopupAction { return this.state.global; }

  // ---------------------------------------------------------------- the button
  prefs(site: string): ButtonPrefs { return { ...(this.prefsBySite[site] ?? {}) }; }
  setCollapsed(site: string, collapsed: boolean): void { this.setPrefs(site, { collapsed: collapsed || undefined }); }
  setHidden(site: string, hidden: boolean): void { this.setPrefs(site, { hidden: hidden || undefined }); }
  private setPrefs(site: string, patch: ButtonPrefs): void {
    const p = { ...(this.prefsBySite[site] ?? {}), ...patch };
    if (!p.collapsed) delete p.collapsed;
    if (!p.hidden) delete p.hidden;
    if (Object.keys(p).length) this.prefsBySite[site] = p; else delete this.prefsBySite[site];
    this.persist();
    this.emit({ type: "prefs", site, prefs: { ...p } });
  }
}

/**
 * Pacing for the pill's status morph (§30): event-driven, bursts coalesce
 * into ONE count, at most one morph per `minGap` ms, each held `hold` ms.
 * Pure state machine: feed events with `add(now)`, poll `next(now)` from a
 * timer; it hands back the label to show (or null) and when to revert.
 */
export class MorphCoalescer {
  private pending = 0;
  private lastMorphAt = -Infinity;
  constructor(private readonly opts: { hold?: number; minGap?: number } = {}) {}
  get hold(): number { return this.opts.hold ?? 3000; }
  get minGap(): number { return this.opts.minGap ?? 10000; }
  add(count = 1): void { this.pending += count; }
  /** The morph due now, if any: { label, until } — `until` is when the pill reverts. */
  next(now: number): { label: string; until: number; count: number } | null {
    if (this.pending <= 0) return null;
    if (now - this.lastMorphAt < this.minGap) return null;
    const n = this.pending;
    this.pending = 0;
    this.lastMorphAt = now;
    return { label: `${n} popup${n === 1 ? "" : "s"} blocked`, until: now + this.hold, count: n };
  }
  /** Ms until the next morph could fire (0 = now); Infinity if nothing pending. */
  wait(now: number): number {
    if (this.pending <= 0) return Infinity;
    return Math.max(0, this.minGap - (now - this.lastMorphAt));
  }
}
