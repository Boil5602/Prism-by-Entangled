import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { layoutDashboard } from "../src/layout.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function fakeDrivers() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", id: opts.id }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: (id, rect) => void calls.push({ op: "setRect", id, rect }),
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: () => {},
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { drivers, calls, kv };
}

const kitchen: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen",
  name: "Kitchen",
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", url: "https://yt.test", aspectHint: "16:9", aspectWeight: 1, audio: "exclusive", persist: true },
    { id: "cal", url: "https://cal.test", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute" },
  ],
};

const reading: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "reading",
  name: "Reading",
  layout: { mode: "hero", hero: "cal", heroSize: 0.7, satellites: "auto", gap: 8 },
  tiles: [
    { id: "cal", url: "https://cal.test", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute" },
    { id: "news", url: "https://news.test", aspectHint: "16:9", aspectWeight: 0.5, audio: "mute" },
  ],
};

const bundle = { dashboards: [kitchen, reading], carousel: { order: ["kitchen", "reading"], wrap: true } };
const VIEWPORT = { w: 1000, h: 625 };

describe("Orchestrator — dashboard bundle & switching (§9)", () => {
  it("loads the first dashboard in carousel order", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(bundle, VIEWPORT);
    expect(o.getState()?.dashboard).toBe("kitchen");
    expect(o.getState()?.dashboards).toEqual(["kitchen", "reading"]);
  });

  it("switchTo keeps shared tiles alive, destroys and creates the rest", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(bundle, VIEWPORT);
    calls.length = 0;

    expect(await o.switchTo("reading")).toBe(true);
    expect(calls.filter((c) => c.op === "destroy").map((c) => c.id)).toEqual(["yt"]);
    expect(calls.filter((c) => c.op === "create").map((c) => c.id)).toEqual(["news"]);
    // cal survives untouched — no re-create, no re-navigate
    expect(calls.filter((c) => c.op === "navigate").map((c) => c.id)).toEqual(["news"]);
    expect(o.rects()).toEqual(layoutDashboard(reading, VIEWPORT));
  });

  it("switchTo an unknown dashboard is refused", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(bundle, VIEWPORT);
    expect(await o.switchTo("nope")).toBe(false);
    expect(o.getState()?.dashboard).toBe("kitchen");
  });

  it("carouselStep wraps in both directions", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(bundle, VIEWPORT);
    expect(await o.carouselStep(1)).toBe("reading");
    expect(await o.carouselStep(1)).toBe("kitchen"); // wrap
    expect(await o.carouselStep(-1)).toBe("reading"); // wrap backwards
  });

  it("carouselStep respects wrap: false at the edges", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(
      { ...bundle, carousel: { order: ["kitchen", "reading"], wrap: false } },
      VIEWPORT,
    );
    expect(await o.carouselStep(-1)).toBeNull();
    expect(await o.carouselStep(1)).toBe("reading");
    expect(await o.carouselStep(1)).toBeNull();
  });

  it("input {action:'layout'} and carousel bindings switch dashboards (§7)", async () => {
    const { drivers } = fakeDrivers();
    const withInputs = {
      ...bundle,
      dashboards: [
        { ...kitchen, inputs: { KEY_2: { action: "layout", value: "reading" } } },
        { ...reading, inputs: { KEY_N: { action: "carousel-next" } } },
      ],
    };
    const o = new Orchestrator(drivers);
    await o.loadBundle(withInputs, VIEWPORT);
    await o.onInput({ key: "KEY_2" });
    expect(o.getState()?.dashboard).toBe("reading");
    await o.onInput({ key: "KEY_N" });
    expect(o.getState()?.dashboard).toBe("kitchen");
  });

  it("per-dashboard hero persistence stays separate (§8 + §9)", async () => {
    const { drivers } = fakeDrivers();
    const o = new Orchestrator(drivers);
    await o.loadBundle(bundle, VIEWPORT);
    await o.promoteHero("cal"); // kitchen now cal-hero
    await o.switchTo("reading");
    await o.promoteHero("news"); // reading now news-hero
    await o.switchTo("kitchen");
    expect(o.rects()).toEqual(layoutDashboard(kitchen, VIEWPORT, { hero: "cal" }));
    await o.switchTo("reading");
    expect(o.rects()).toEqual(layoutDashboard(reading, VIEWPORT, { hero: "news" }));
  });
});
