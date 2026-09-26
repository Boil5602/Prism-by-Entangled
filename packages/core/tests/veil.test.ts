import { describe, expect, it } from "vitest";
import {
  CLEAR_VEIL_JS,
  CosmeticRegistry,
  VEIL_ATTR,
  parseCosmeticRules,
  veilJs,
} from "../src/veil.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

const EASYLIST_SAMPLE = `
[Adblock Plus 2.0]
! Title: EasyList (sample)
||doubleclick.net^
##.ad-banner
##div[id^="google_ads_"]
example.com##.sidebar-promo
news.example.com,other.org##.sponsored
~example.com##.generic-but-not-here
#@#.ad-banner-exception
example.com#@#.ad-banner
site.test#?#.foo:has-text(Ad)
site.test##.bar:-abp-contains(x)
`;

const ATTR = {
  name: "EasyList",
  maintainer: "EasyList community",
  url: "https://easylist.to/easylist/easylist.txt",
  license: "GPL-3.0 / CC BY-SA 3.0",
  syncedAt: "2026-08-24",
};

describe("parseCosmeticRules (§27 × §5 attribution)", () => {
  it("keeps only plain element-hiding rules, scoped and generic, with exceptions", () => {
    const p = parseCosmeticRules(EASYLIST_SAMPLE);
    expect([...p.generic]).toEqual([".ad-banner", 'div[id^="google_ads_"]', ".generic-but-not-here"]);
    expect([...p.byDomain.get("example.com")!]).toEqual([".sidebar-promo"]);
    expect([...p.byDomain.get("news.example.com")!]).toEqual([".sponsored"]);
    expect([...p.byDomain.get("other.org")!]).toEqual([".sponsored"]);
    expect([...p.exceptGeneric]).toEqual([".ad-banner-exception"]);
    expect([...p.exceptByDomain.get("example.com")!]).toEqual([".generic-but-not-here", ".ad-banner"]);
    // Network rules and procedural cosmetics are never selectors.
    expect(p.entryCount).toBe(7);
  });
});

describe("CosmeticRegistry", () => {
  it("resolves selectors per hostname (subdomain chain) and names the contributing sources", () => {
    const reg = new CosmeticRegistry();
    reg.register({ attribution: ATTR, text: EASYLIST_SAMPLE });
    reg.register({
      attribution: { ...ATTR, name: "Custom", maintainer: "me", url: "file:///mine.txt", license: "n/a" },
      text: "mine.example##.house-ad",
    });

    const news = reg.selectorsFor("news.example.com");
    expect(news.sources).toEqual(["EasyList"]);
    // .ad-banner and .generic-but-not-here are excepted on example.com
    expect([...news.selectors].sort()).toEqual([".sidebar-promo", ".sponsored", 'div[id^="google_ads_"]'].sort());

    const elsewhere = reg.selectorsFor("www.other.org");
    expect(elsewhere.selectors).toContain(".ad-banner");
    expect(elsewhere.selectors).toContain(".sponsored");
    expect(elsewhere.selectors).not.toContain(".sidebar-promo");

    const mine = reg.selectorsFor("mine.example");
    expect(mine.sources).toEqual(["EasyList", "Custom"]);
    expect(mine.selectors).toContain(".house-ad");
  });

  it("lists every source with attribution and entry count for the UI", () => {
    const reg = new CosmeticRegistry();
    reg.register({ attribution: ATTR, text: EASYLIST_SAMPLE });
    expect(reg.list()).toEqual([{ ...ATTR, entryCount: 7 }]);
    reg.unregister("EasyList");
    expect(reg.list()).toEqual([]);
    expect(reg.selectorsFor("example.com")).toEqual({ selectors: [], sources: [] });
  });
});

describe("veilJs", () => {
  it("embeds config, marks veiled slots, and carries the safety rules", () => {
    const js = veilJs({ selectors: [".ad"], images: ["https://appassets.androidplatform.net/veil/1.jpg"] });
    expect(js).toContain('"selectors":[".ad"]');
    expect(js).toContain("androidplatform.net/veil/1.jpg");
    expect(js).toContain(VEIL_ATTR);
    expect(js).toContain("minSlotPx"); // collapsed slots are left alone
    expect(js).toContain("catch (e) { continue; }"); // a bad selector never disables the rest
    expect(js).toContain("window.__prismVeil.update(cfg)"); // idempotent re-injection
    expect(js).toContain("\\u25D0"); // the glyph marks veiled slots
    expect(CLEAR_VEIL_JS).toContain("clear()");
  });
});

/* ------------------------ Orchestrator wiring ------------------------- */

function rig(opts: { imagery?: string[] | "throw" } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void calls.push({ op: "create", ...o }),
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: () => {},
      inject: (id, css, js) => void calls.push({ op: "inject", id, css, js }),
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
      ...(opts.imagery !== undefined
        ? {
            veilImagery: (source: string) => {
              calls.push({ op: "veilImagery", source });
              if (opts.imagery === "throw") throw new Error("no store");
              return opts.imagery as string[];
            },
          }
        : {}),
    },
  };
  const o = new Orchestrator(drivers);
  o.setCosmeticSources([{ attribution: ATTR, text: EASYLIST_SAMPLE }]);
  const injectsFor = (id: string) =>
    calls.filter((c) => c.op === "inject" && c.id === id).map((c) => String(c.js ?? ""));
  return { o, calls, injectsFor };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d",
  name: "D",
  layout: { mode: "grid" },
  tiles: [
    { id: "news", url: "https://news.example.com/", area: "1 / 1 / 2 / 2", veil: { mode: "block+art" } },
    { id: "wall", url: "https://other.org/", area: "1 / 2 / 2 / 3", veil: { mode: "veil-only", source: "pack:nature" } },
    { id: "plain", url: "https://other.org/", area: "2 / 1 / 3 / 3" },
  ],
};

describe("Orchestrator veil (§27)", () => {
  it("resolves blocking per tile: default on, veil-only forces off", async () => {
    const { o, calls } = rig();
    await o.load(doc, { w: 1000, h: 600 });
    const creates = Object.fromEntries(calls.filter((c) => c.op === "create").map((c) => [c.id, c.blocking]));
    expect(creates).toEqual({ news: true, wall: false, plain: true });
  });

  it("installs the veil on fresh documents with shell imagery, and updates on SPA navigation", async () => {
    const { o, calls, injectsFor } = rig({ imagery: ["local:/veil/a.jpg", "local:/veil/b.jpg"] });
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "load-finished", id: "news", ok: true });
    const veils = injectsFor("news").filter((js) => js.includes("__prismVeil"));
    expect(veils).toHaveLength(1);
    expect(veils[0]).toContain(".sponsored");
    expect(veils[0]).not.toContain(".ad-banner\""); // excepted on example.com
    expect(veils[0]).toContain("local:/veil/a.jpg");
    expect(calls.find((c) => c.op === "veilImagery")).toMatchObject({ source: "pack:cosmos" });

    await o.onSurfaceEvent({ type: "navigated", id: "news" });
    expect(injectsFor("news").filter((js) => js.includes("__prismVeil"))).toHaveLength(2);

    // veil-only tile: its own source, still veiled in-page
    await o.onSurfaceEvent({ type: "load-finished", id: "wall", ok: true });
    expect(calls.filter((c) => c.op === "veilImagery").map((c) => c.source)).toContain("pack:nature");
  });

  it("degrades: no imagery hook → textured fill; throwing hook → same; no veil → nothing injected", async () => {
    const plain = rig();
    await plain.o.load(doc, { w: 1000, h: 600 });
    await plain.o.onSurfaceEvent({ type: "load-finished", id: "news", ok: true });
    const js = plain.injectsFor("news").find((s) => s.includes("__prismVeil"))!;
    expect(js).toContain('"images":[]');

    const broken = rig({ imagery: "throw" });
    await broken.o.load(doc, { w: 1000, h: 600 });
    await broken.o.onSurfaceEvent({ type: "load-finished", id: "news", ok: true });
    expect(broken.injectsFor("news").some((s) => s.includes('"images":[]'))).toBe(true);

    await plain.o.onSurfaceEvent({ type: "load-finished", id: "plain", ok: true });
    expect(plain.injectsFor("plain").some((s) => s.includes("__prismVeil"))).toBe(false);
  });

  it("injects nothing when no list matches — a selector set of zero does zero", async () => {
    const { o, injectsFor } = rig();
    o.setCosmeticSources([]);
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "load-finished", id: "news", ok: true });
    expect(injectsFor("news").some((s) => s.includes("__prismVeil"))).toBe(false);
  });

  it("reports mode, blocking, and contributing sources in remote state", async () => {
    const { o } = rig();
    await o.load(doc, { w: 1000, h: 600 });
    const tiles = Object.fromEntries(o.getState()!.tiles.map((t) => [t.id, t.veil]));
    expect(tiles.news).toEqual({ mode: "block+art", blocking: true, sources: ["EasyList"] });
    expect(tiles.wall).toEqual({ mode: "veil-only", blocking: false, sources: ["EasyList"] });
    expect(tiles.plain).toBeUndefined();
    expect(o.cosmeticSources()).toEqual([{ ...ATTR, entryCount: 7 }]);
  });
});
