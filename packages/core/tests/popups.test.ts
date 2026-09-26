import { describe, expect, it } from "vitest";
import { MorphCoalescer, PopupPolicy, aggregateLedger, allowSentence, allowedSentence, popupHost } from "../src/popups.js";
import type { StoreDriver } from "../src/drivers.js";

function memStore(): StoreDriver & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}
const T0 = Date.parse("2026-08-27T12:00:00Z");

describe("automatic tier", () => {
  it("allows a popup that matches the human's click (same URL or origin)", () => {
    const p = new PopupPolicy(null);
    expect(p.evaluate({ site: "shop.com", url: "https://shop.com/help", gesture: { url: "https://shop.com/help", windowsThisGesture: 1 } }).action).toBe("allow");
    expect(p.evaluate({ site: "shop.com", url: "https://shop.com/other", gesture: { url: "https://shop.com/help", windowsThisGesture: 1 } }).reason).toBe("matches your click");
  });
  it("intercepts gesture laundering: click on X opens unrelated Y", () => {
    const p = new PopupPolicy(null);
    const d = p.evaluate({ site: "shop.com", url: "https://tracker.example/land", gesture: { url: "https://shop.com/help", windowsThisGesture: 1 } });
    expect(d).toEqual({ action: "intercept", reason: "unknown destination" });
  });
  it("intercepts every window after the first from one gesture", () => {
    const p = new PopupPolicy(null);
    const g = { url: "https://shop.com/x", windowsThisGesture: 2 };
    expect(p.evaluate({ site: "shop.com", url: "https://shop.com/x", gesture: g }).reason).toMatch(/^burst/);
  });
  it("intercepts blank bounces and no-gesture opens", () => {
    const p = new PopupPolicy(null);
    expect(p.evaluate({ site: "shop.com", url: "about:blank", gesture: { windowsThisGesture: 1 } }).reason).toBe("blank window (bounce)");
    expect(p.evaluate({ site: "shop.com", url: "https://x.example/" }).reason).toBe("opened without a click");
  });
  it("names the attributed list whose rule matched (spec section 5)", () => {
    const p = new PopupPolicy(null, { listMatch: (h) => (h === "ads.example" ? "EasyList" : null) });
    const d = p.evaluate({ site: "shop.com", url: "https://ads.example/pop", gesture: { url: "https://shop.com/", windowsThisGesture: 1 } });
    expect(d).toEqual({ action: "intercept", reason: "list: EasyList", list: "EasyList" });
  });
  it("lets structurally legitimate popups through by name", () => {
    const p = new PopupPolicy(null);
    const d = p.evaluate({ site: "shop.com", url: "https://checkout.stripe.com/pay/cs_1", gesture: { url: "https://shop.com/cart", windowsThisGesture: 1 } });
    expect(d).toEqual({ action: "allow", reason: "functional: payment (Stripe)" });
  });
  it("global default 'allow' still requires a gesture", () => {
    const p = new PopupPolicy(null);
    p.setGlobal("allow");
    expect(p.evaluate({ site: "a.com", url: "https://b.com/", gesture: { windowsThisGesture: 1 } }).action).toBe("allow");
    expect(p.evaluate({ site: "a.com", url: "https://b.com/" }).action).toBe("intercept");
  });
  it("allows a self-referred (same registrable domain) popup, even without a gesture", () => {
    const p = new PopupPolicy(null);
    const d = p.evaluate({ site: "www.msn.com", url: "https://www.msn.com/en-us/news/article" });
    expect(d).toEqual({ action: "allow", reason: "same site as this page" });
    // across subdomains too
    expect(p.evaluate({ site: "www.msn.com", url: "https://assets.msn.com/x" }).action).toBe("allow");
  });
  it("still intercepts a same-site popup that is on an ad list (list beats same-site)", () => {
    const p = new PopupPolicy(null, { listMatch: (h) => (h === "ad.msn.com" ? "EasyList" : null) });
    const d = p.evaluate({ site: "www.msn.com", url: "https://ad.msn.com/pop" });
    expect(d.action).toBe("intercept");
    expect(d.reason).toBe("list: EasyList");
  });
  it("does not treat a different registrable domain as same-site", () => {
    const p = new PopupPolicy(null);
    expect(p.evaluate({ site: "www.msn.com", url: "https://notmsn.com/" }).action).toBe("intercept");
    expect(p.evaluate({ site: "msn.com", url: "https://msn.com.evil.com/" }).action).toBe("intercept");
  });
});

describe("allow flow round-trip", () => {
  it("allow -> auto-open -> remove -> intercepted again, with persistence", async () => {
    const store = memStore();
    let t = T0;
    const p = new PopupPolicy(store, { now: () => t });
    const events: string[] = [];
    p.on((e) => events.push(e.type));
    const attempt = { site: "shop.com", url: "https://checkout.example.com/x", gesture: { url: "https://shop.com/cart", windowsThisGesture: 1 } };

    // 1. unknown destination is intercepted into the ledger
    const d1 = p.evaluate(attempt);
    expect(d1.action).toBe("intercept");
    const entry = p.record(attempt, d1)!;
    expect(entry.count).toBe(1);
    expect(p.ledger("shop.com")[0]).toMatchObject({ dest: "checkout.example.com", context: "unknown destination", opens: 0 });

    // 2. deliberate Open: the exact URL, and the nudge fires
    const o1 = p.open("shop.com", "checkout.example.com")!;
    expect(o1).toEqual({ url: "https://checkout.example.com/x", nudge: true });
    // second open nudges again
    expect(p.open("shop.com", "checkout.example.com")!.nudge).toBe(true);
    // two dismissals silence it
    p.dismissNudge("shop.com", "checkout.example.com"); p.dismissNudge("shop.com", "checkout.example.com");
    expect(p.open("shop.com", "checkout.example.com")!.nudge).toBe(false);

    // 3. Always allow -> next attempt is auto-allowed
    p.allow("shop.com", "checkout.example.com");
    expect(p.evaluate(attempt)).toEqual({ action: "allow", reason: "allowed by you" });
    expect(p.listAllowed()).toEqual([{ site: "shop.com", dest: "checkout.example.com", since: new Date(T0).toISOString(), sentence: "shop.com may open checkout.example.com" }]);
    // scoped: another site opening the same destination is still intercepted
    expect(p.evaluate({ ...attempt, site: "other.com" }).action).toBe("intercept");
    // ...and after allowing, opening no longer nudges
    expect(p.open("shop.com", "checkout.example.com")!.nudge).toBe(false);

    // 4. persistence: a fresh instance over the same store sees the allowance
    const p2 = new PopupPolicy(store);
    await p2.load();
    expect(p2.evaluate(attempt).action).toBe("allow");
    expect(p2.ledger("shop.com")[0].count).toBe(1);

    // 5. Remove -> intercepted again, immediately, in both instances
    p2.remove("shop.com", "checkout.example.com");
    expect(p2.evaluate(attempt).action).toBe("intercept");
    expect(p2.listAllowed()).toEqual([]);
    const p3 = new PopupPolicy(store); await p3.load();
    expect(p3.evaluate(attempt).action).toBe("intercept");

    expect(events).toEqual(["intercepted", "opened", "opened", "opened", "allowed", "policy", "opened"]);
  });
  it("block-all on a site beats everything but an explicit allowance", () => {
    const p = new PopupPolicy(null);
    p.setBlockAll("shop.com", true);
    expect(p.evaluate({ site: "shop.com", url: "https://shop.com/help", gesture: { url: "https://shop.com/help", windowsThisGesture: 1 } }).reason).toBe("you block all popups here");
    p.allow("shop.com", "shop.com");
    expect(p.evaluate({ site: "shop.com", url: "https://shop.com/help" }).action).toBe("allow");
  });
  it("never says 'whitelist' in any sentence", () => {
    expect(allowSentence("shop.com", "checkout.example.com")).toBe("Always open checkout.example.com popups from shop.com");
    expect(allowedSentence("shop.com", "checkout.example.com")).toBe("shop.com may open checkout.example.com");
    for (const s of [allowSentence("a", "b"), allowedSentence("a", "b")]) expect(s.toLowerCase()).not.toContain("whitelist");
  });
  it("popupHost", () => {
    expect(popupHost("https://A.Example/x?y")).toBe("a.example");
    expect(popupHost("about:blank")).toBe("");
    expect(popupHost("")).toBe("");
  });
});

describe("the pill: morph pacing", () => {
  it("coalesces a burst into one count", () => {
    const m = new MorphCoalescer();
    for (let i = 0; i < 5; i++) m.add();
    expect(m.next(T0)).toEqual({ label: "5 popups blocked", until: T0 + 3000, count: 5 });
    expect(m.next(T0 + 10)).toBeNull();
  });
  it("morphs at most once per 10s; later events wait, then show their own total", () => {
    const m = new MorphCoalescer();
    m.add();
    expect(m.next(T0)!.label).toBe("1 popup blocked");
    m.add(); m.add();
    expect(m.next(T0 + 2000)).toBeNull();
    expect(m.wait(T0 + 2000)).toBe(8000);
    expect(m.next(T0 + 9999)).toBeNull();
    expect(m.next(T0 + 10000)!.label).toBe("2 popups blocked");
    expect(m.wait(T0 + 10000)).toBe(Infinity);
  });
  it("honors custom hold/gap", () => {
    const m = new MorphCoalescer({ hold: 1000, minGap: 500 });
    m.add();
    expect(m.next(T0)!.until).toBe(T0 + 1000);
    m.add();
    expect(m.next(T0 + 500)!.count).toBe(1);
  });
});

describe("the button: per-site preferences persist", () => {
  it("collapse and hide are remembered per site across instances", async () => {
    const store = memStore();
    const p = new PopupPolicy(store);
    const seen: Array<{ site: string; prefs: unknown }> = [];
    p.on((e) => { if (e.type === "prefs") seen.push({ site: e.site, prefs: e.prefs }); });
    p.setCollapsed("news.example", true);
    p.setHidden("loud.example", true);
    expect(p.prefs("news.example")).toEqual({ collapsed: true });
    expect(p.prefs("loud.example")).toEqual({ hidden: true });
    expect(p.prefs("other.example")).toEqual({});
    const p2 = new PopupPolicy(store); await p2.load();
    expect(p2.prefs("news.example")).toEqual({ collapsed: true });
    p2.setCollapsed("news.example", false);
    expect(p2.prefs("news.example")).toEqual({});
    const p3 = new PopupPolicy(store); await p3.load();
    expect(p3.prefs("news.example")).toEqual({});
    expect(p3.prefs("loud.example")).toEqual({ hidden: true });
    expect(seen).toEqual([{ site: "news.example", prefs: { collapsed: true } }, { site: "loud.example", prefs: { hidden: true } }]);
  });
});

describe("the summary: aggregate across sites", () => {
  it("sums a destination's attempts over every site, lists the sites, keeps the newest context", () => {
    let t = T0;
    const p = new PopupPolicy(null, { now: () => t });
    const hit = (site: string, url: string) => { const a = { site, url }; p.record(a, p.evaluate(a)); };
    hit("a.com", "https://ay267.com/?x=1"); hit("a.com", "https://ay267.com/?x=2");
    t += 60_000; hit("b.com", "https://ay267.com/?x=3");
    hit("b.com", "https://other.example/");
    const agg = aggregateLedger(p.ledgerAll());
    expect(agg.map((r) => [r.dest, r.count, r.sites])).toEqual([["ay267.com", 3, ["a.com", "b.com"]], ["other.example", 1, ["b.com"]]]);
    expect(agg[0].lastSeen).toBe(new Date(T0 + 60_000).toISOString());
    expect(p.sites()).toEqual(["a.com", "b.com"]);
    p.clearLedger();
    expect(aggregateLedger(p.ledgerAll())).toEqual([]);
    expect(p.sites()).toEqual([]);
  });
});
