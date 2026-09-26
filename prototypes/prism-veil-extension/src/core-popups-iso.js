/* GENERATED copy of core-popups.js for the ISOLATED world - Chromium 151 injects a file listed in two content_scripts entries only once. Do not edit. */
"use strict";
var PrismPopups = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // packages/core/src/popups.ts
  var popups_exports = {};
  __export(popups_exports, {
    FUNCTIONAL_POPUPS: () => FUNCTIONAL_POPUPS,
    MorphCoalescer: () => MorphCoalescer,
    PopupPolicy: () => PopupPolicy,
    aggregateLedger: () => aggregateLedger,
    allowSentence: () => allowSentence,
    allowedSentence: () => allowedSentence,
    popupHost: () => popupHost
  });
  function aggregateLedger(bySite) {
    var _a;
    const map = /* @__PURE__ */ new Map();
    for (const [site, list] of Object.entries(bySite)) {
      for (const e of list) {
        const a = (_a = map.get(e.dest)) != null ? _a : { dest: e.dest, count: 0, sites: [], lastSeen: e.lastSeen, context: e.context };
        a.count += e.count;
        if (!a.sites.includes(site)) a.sites.push(site);
        if (e.lastSeen > a.lastSeen) {
          a.lastSeen = e.lastSeen;
          a.context = e.context;
        }
        map.set(e.dest, a);
      }
    }
    return Array.from(map.values()).sort((x, y) => y.count - x.count || y.lastSeen.localeCompare(x.lastSeen));
  }
  var POLICY_KEY = "popups:policy";
  var LEDGER_KEY = "popups:ledger";
  var PREFS_KEY = "popups:prefs";
  var LEDGER_CAP_PER_SITE = 200;
  var FUNCTIONAL_POPUPS = [
    { name: "sign-in (Google)", test: /(^|\.)accounts\.google\.com$/i },
    { name: "sign-in (Microsoft)", test: /(^|\.)(login\.microsoftonline\.com|login\.live\.com)$/i },
    { name: "sign-in (Apple)", test: /(^|\.)appleid\.apple\.com$/i },
    { name: "sign-in (GitHub)", test: /^github\.com$/i },
    { name: "sign-in (Facebook)", test: /^(www\.)?facebook\.com$/i },
    { name: "sign-in (Auth0/Okta)", test: /(^|\.)(auth0\.com|okta\.com)$/i },
    { name: "payment (Stripe)", test: /(^|\.)(checkout\.stripe\.com|js\.stripe\.com)$/i },
    { name: "payment (PayPal)", test: /(^|\.)paypal\.com$/i },
    { name: "payment (Shop Pay)", test: /(^|\.)(shop\.app|checkout\.shopify\.com)$/i },
    { name: "payment (Google Pay)", test: /(^|\.)pay\.google\.com$/i },
    { name: "payment (Apple Pay)", test: /(^|\.)apple-pay-gateway\.apple\.com$/i }
  ];
  function popupHost(url) {
    if (!url || /^about:/i.test(url)) return "";
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (e) {
      return "";
    }
  }
  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return "";
    }
  }
  var MULTI_PART_TLD = /\.(co|com|org|net|gov|edu|ac|or|ne)\.[a-z]{2}$/i;
  function registrableDomain(host) {
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return host;
    return parts.slice(MULTI_PART_TLD.test(host) ? -3 : -2).join(".");
  }
  function sameSite(site, dest) {
    if (!site || !dest) return false;
    const a = registrableDomain(site.toLowerCase()), b = registrableDomain(dest.toLowerCase());
    return !!a && a === b;
  }
  function allowSentence(site, dest) {
    return `Always open ${dest} popups from ${site}`;
  }
  function allowedSentence(site, dest) {
    return `${site} may open ${dest}`;
  }
  var PopupPolicy = class {
    constructor(store, opts = {}) {
      __publicField(this, "store", store);
      __publicField(this, "state", { global: "intercept", sites: {} });
      __publicField(this, "ledgerBySite", {});
      __publicField(this, "prefsBySite", {});
      __publicField(this, "listeners", /* @__PURE__ */ new Set());
      __publicField(this, "listMatch");
      __publicField(this, "now");
      var _a, _b;
      this.listMatch = (_a = opts.listMatch) != null ? _a : (() => null);
      this.now = (_b = opts.now) != null ? _b : (() => Date.now());
    }
    async load() {
      var _a, _b;
      if (!this.store) return;
      const [p, l, f] = await Promise.all([this.store.get(POLICY_KEY), this.store.get(LEDGER_KEY), this.store.get(PREFS_KEY)]);
      try {
        if (p) {
          const st = JSON.parse(p);
          this.state = { global: (_a = st.global) != null ? _a : "intercept", sites: (_b = st.sites) != null ? _b : {} };
        }
      } catch (e) {
      }
      try {
        if (l) this.ledgerBySite = JSON.parse(l);
      } catch (e) {
      }
      try {
        if (f) this.prefsBySite = JSON.parse(f);
      } catch (e) {
      }
    }
    persist() {
      if (!this.store) return;
      void this.store.set(POLICY_KEY, JSON.stringify(this.state));
      void this.store.set(LEDGER_KEY, JSON.stringify(this.ledgerBySite));
      void this.store.set(PREFS_KEY, JSON.stringify(this.prefsBySite));
    }
    on(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    emit(e) {
      this.listeners.forEach((l) => {
        try {
          l(e);
        } catch (e2) {
        }
      });
    }
    /** A snapshot a main-world hook can evaluate against synchronously. */
    snapshot() {
      return JSON.parse(JSON.stringify(this.state));
    }
    replace(state) {
      this.state = state;
    }
    // ---------------------------------------------------------------- automatic tier
    /**
     * Decide one attempt. Synchronous and pure over the current state, so a
     * `window.open` interception can return a real or stub window at once.
     * Order: human policy first (their decision beats every heuristic), then
     * the burst rule, functional popups, click consistency, attributed lists,
     * and finally the global default (unknowns are intercepted, §30).
     */
    evaluate(a) {
      var _a;
      const dest = popupHost(a.url);
      const site = this.state.sites[a.site];
      if (site == null ? void 0 : site.allowed[dest]) return { action: "allow", reason: "allowed by you" };
      if (site == null ? void 0 : site.blockAll) return { action: "intercept", reason: "you block all popups here" };
      if (a.gesture && a.gesture.windowsThisGesture > 1) return { action: "intercept", reason: `burst: window ${a.gesture.windowsThisGesture} from one click` };
      if (!dest) return { action: "intercept", reason: "blank window (bounce)" };
      const fn = FUNCTIONAL_POPUPS.find((f) => f.test.test(dest));
      if (fn) return { action: "allow", reason: `functional: ${fn.name}` };
      if ((_a = a.gesture) == null ? void 0 : _a.url) {
        if (a.gesture.url === a.url || originOf(a.gesture.url) === originOf(a.url)) return { action: "allow", reason: "matches your click" };
      }
      const list = this.listMatch(dest);
      if (list) return { action: "intercept", reason: `list: ${list}`, list };
      if (sameSite(a.site, dest)) return { action: "allow", reason: "same site as this page" };
      if (this.state.global === "allow" && a.gesture) return { action: "allow", reason: "your default: allow" };
      return { action: "intercept", reason: a.gesture ? "unknown destination" : "opened without a click" };
    }
    /** Record an attempt's outcome (interceptions go to the ledger; allows are not logged — nothing to act on). */
    record(a, d) {
      var _a, _b, _c;
      if (d.action !== "intercept") return null;
      const dest = popupHost(a.url) || "(blank)";
      const list = (_c = (_a = this.ledgerBySite)[_b = a.site]) != null ? _c : _a[_b] = [];
      let e = list.find((x) => x.dest === dest);
      const iso = new Date(this.now()).toISOString();
      if (!e) {
        e = { site: a.site, dest, count: 0, lastSeen: iso, lastUrl: a.url, context: d.reason, opens: 0, nudgeDismissed: 0 };
        list.unshift(e);
        if (list.length > LEDGER_CAP_PER_SITE) list.length = LEDGER_CAP_PER_SITE;
      }
      e.count += 1;
      e.lastSeen = iso;
      e.lastUrl = a.url || e.lastUrl;
      e.context = d.reason;
      this.persist();
      this.emit({ type: "intercepted", site: a.site, dest, url: a.url, reason: d.reason, list: d.list, entry: e });
      return e;
    }
    // ---------------------------------------------------------------- human tier
    ledger(site) {
      var _a;
      return ((_a = this.ledgerBySite[site]) != null ? _a : []).slice();
    }
    /** Every site's ledger (for the cross-site summary). */
    ledgerAll() {
      return JSON.parse(JSON.stringify(this.ledgerBySite));
    }
    /** Sites with anything in the ledger, most intercepted first. */
    sites() {
      return Object.keys(this.ledgerBySite).filter((s) => this.ledgerBySite[s].length).sort((a, b) => this.totalIntercepted(b) - this.totalIntercepted(a));
    }
    /** Forget the ledger (allowances are policy and stay). */
    clearLedger() {
      this.ledgerBySite = {};
      this.persist();
      this.emit({ type: "policy", site: "*" });
    }
    totalIntercepted(site) {
      var _a;
      return ((_a = this.ledgerBySite[site]) != null ? _a : []).reduce((n, e) => n + e.count, 0);
    }
    /**
     * Deliberate open — the functionality guarantee. Returns the URL to open
     * NOW, visibly, and whether to show the one-line "Open these automatically
     * next time?" nudge (after a deliberate open, and again on the second open
     * of the same destination; never once allowed; stops after two dismissals).
     */
    open(site, dest) {
      var _a, _b;
      const e = ((_a = this.ledgerBySite[site]) != null ? _a : []).find((x) => x.dest === dest);
      if (!e) return null;
      e.opens += 1;
      const alreadyAllowed = !!((_b = this.state.sites[site]) == null ? void 0 : _b.allowed[dest]);
      const nudge = !alreadyAllowed && e.nudgeDismissed < 2;
      this.persist();
      this.emit({ type: "opened", site, dest, url: e.lastUrl, nudge });
      return { url: e.lastUrl, nudge };
    }
    dismissNudge(site, dest) {
      var _a;
      const e = ((_a = this.ledgerBySite[site]) != null ? _a : []).find((x) => x.dest === dest);
      if (e) {
        e.nudgeDismissed += 1;
        this.persist();
      }
    }
    /** "Always allow": scoped site→destination; honored by evaluate() from now on. */
    allow(site, dest) {
      var _a, _b;
      const s = (_b = (_a = this.state.sites)[site]) != null ? _b : _a[site] = { allowed: {} };
      s.allowed[dest] = { since: new Date(this.now()).toISOString() };
      this.persist();
      this.emit({ type: "allowed", site, dest });
      this.emit({ type: "policy", site });
    }
    /** Remove an allowance: interception resumes immediately. */
    remove(site, dest) {
      const s = this.state.sites[site];
      if (!s || !s.allowed[dest]) return;
      delete s.allowed[dest];
      this.persist();
      this.emit({ type: "removed", site, dest });
      this.emit({ type: "policy", site });
    }
    /** "Popups you've allowed" — plain sentences, one Remove per row. */
    listAllowed() {
      const rows = [];
      for (const [site, s] of Object.entries(this.state.sites)) {
        for (const [dest, v] of Object.entries(s.allowed)) rows.push({ site, dest, since: v.since, sentence: allowedSentence(site, dest) });
      }
      return rows.sort((a, b) => (a.site + a.dest).localeCompare(b.site + b.dest));
    }
    setBlockAll(site, on) {
      var _a, _b;
      const s = (_b = (_a = this.state.sites)[site]) != null ? _b : _a[site] = { allowed: {} };
      s.blockAll = on || void 0;
      this.persist();
      this.emit({ type: "policy", site });
    }
    blockAll(site) {
      var _a;
      return !!((_a = this.state.sites[site]) == null ? void 0 : _a.blockAll);
    }
    setGlobal(action) {
      this.state.global = action;
      this.persist();
      this.emit({ type: "policy", site: "*" });
    }
    global() {
      return this.state.global;
    }
    // ---------------------------------------------------------------- the button
    prefs(site) {
      var _a;
      return { ...(_a = this.prefsBySite[site]) != null ? _a : {} };
    }
    setCollapsed(site, collapsed) {
      this.setPrefs(site, { collapsed: collapsed || void 0 });
    }
    setHidden(site, hidden) {
      this.setPrefs(site, { hidden: hidden || void 0 });
    }
    setPrefs(site, patch) {
      var _a;
      const p = { ...(_a = this.prefsBySite[site]) != null ? _a : {}, ...patch };
      if (!p.collapsed) delete p.collapsed;
      if (!p.hidden) delete p.hidden;
      if (Object.keys(p).length) this.prefsBySite[site] = p;
      else delete this.prefsBySite[site];
      this.persist();
      this.emit({ type: "prefs", site, prefs: { ...p } });
    }
  };
  var MorphCoalescer = class {
    constructor(opts = {}) {
      __publicField(this, "opts", opts);
      __publicField(this, "pending", 0);
      __publicField(this, "lastMorphAt", -Infinity);
    }
    get hold() {
      var _a;
      return (_a = this.opts.hold) != null ? _a : 3e3;
    }
    get minGap() {
      var _a;
      return (_a = this.opts.minGap) != null ? _a : 1e4;
    }
    add(count = 1) {
      this.pending += count;
    }
    /** The morph due now, if any: { label, until } — `until` is when the pill reverts. */
    next(now) {
      if (this.pending <= 0) return null;
      if (now - this.lastMorphAt < this.minGap) return null;
      const n = this.pending;
      this.pending = 0;
      this.lastMorphAt = now;
      return { label: `${n} popup${n === 1 ? "" : "s"} blocked`, until: now + this.hold, count: n };
    }
    /** Ms until the next morph could fire (0 = now); Infinity if nothing pending. */
    wait(now) {
      if (this.pending <= 0) return Infinity;
      return Math.max(0, this.minGap - (now - this.lastMorphAt));
    }
  };
  return __toCommonJS(popups_exports);
})();
try { window.PrismPopups = PrismPopups; } catch (e) {}
