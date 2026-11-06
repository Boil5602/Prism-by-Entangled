import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { focusFramingJs } from "../src/focus.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: () => {},
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id) => void ops.push({ op: "navigate", id }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: (id) => void ops.push({ op: "freeze", id }),
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
    },
    store: { get: () => null, set: () => {} },
  };
  return { ops, orchestrator: new Orchestrator(drivers) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "f",
  name: "F",
  layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    {
      id: "news",
      url: "https://news.test",
      audio: "mute",
      focus: { selector: "#top-stories", pad: 12, fit: "width" },
    },
    { id: "plain", url: "https://plain.test", audio: "mute" },
  ],
};

async function ready(o: Orchestrator, id: string) {
  await o.onSurfaceEvent({ type: "load-finished", id, ok: true });
  await o.onSurfaceEvent({ type: "first-paint", id });
  await vi.advanceTimersByTimeAsync(300); // settle
}

const revealed = (ops: Array<Record<string, unknown>>, id: string) =>
  ops.some((o) => o.op === "reveal" && o.id === id);

describe("region focus (§17)", () => {
  it("framing script targets the selector with pad and fit", () => {
    const js = focusFramingJs({ selector: "#scoreboard", pad: 12, fit: "contain" });
    expect(js).toContain('"#scoreboard"');
    expect(js).toContain("var pad = 12");
    expect(js).toContain('"contain"');
    expect(js).toContain("notifyFocusResult");
    expect(js).toContain("transformOrigin");
  });

  it("frames in the hidden buffer, then reveals only on focus success", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    ops.length = 0;

    await ready(orchestrator, "news");
    // framing injected, no reveal yet — waiting on the verdict
    expect(ops.some((o) => o.op === "inject" && String(o.js).includes("notifyFocusResult"))).toBe(true);
    expect(revealed(ops, "news")).toBe(false);

    await orchestrator.onSurfaceEvent({ type: "focus-result", id: "news", found: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(revealed(ops, "news")).toBe(true);
  });

  it("missing selector keeps the snapshot and quietly retries (§16 failure rule)", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    ops.length = 0;

    await ready(orchestrator, "news");
    await orchestrator.onSurfaceEvent({ type: "focus-result", id: "news", found: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(revealed(ops, "news")).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000); // quiet retry
    expect(ops.filter((o) => o.op === "navigate" && o.id === "news")).toHaveLength(1);
  });

  it("a silent framing bridge fails open after 2s", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    ops.length = 0;

    await ready(orchestrator, "news");
    expect(revealed(ops, "news")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(revealed(ops, "news")).toBe(true);
  });

  it("tiles without focus reveal ungated", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    ops.length = 0;
    await ready(orchestrator, "plain");
    expect(revealed(ops, "plain")).toBe(true);
  });

  it("dashboard switches apply or clear framing on surviving tiles (§9 × §17)", async () => {
    const { ops, orchestrator } = rig();
    const unfocused: DashboardDocument = {
      ...doc,
      id: "g",
      tiles: doc.tiles.map((t) => {
        const { focus: _drop, ...rest } = t;
        return rest;
      }),
    };
    await orchestrator.loadBundle({ dashboards: [doc, unfocused] }, { w: 1000, h: 625 });

    ops.length = 0;
    await orchestrator.switchTo("g");
    expect(
      ops.some((o) => o.op === "inject" && o.id === "news" && String(o.js).includes('transform = ""')),
    ).toBe(true);

    ops.length = 0;
    await orchestrator.switchTo("f");
    expect(
      ops.some((o) => o.op === "inject" && o.id === "news" && String(o.js).includes("notifyFocusResult")),
    ).toBe(true);
  });

  it("re-frames after SPA navigation", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    ops.length = 0;
    await orchestrator.onSurfaceEvent({ type: "navigated", id: "news" });
    expect(
      ops.filter((o) => o.op === "inject" && String(o.js).includes("notifyFocusResult")),
    ).toHaveLength(1);
  });
});
