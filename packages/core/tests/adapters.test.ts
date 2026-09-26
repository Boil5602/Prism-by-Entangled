import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FRAME_PRELUDE_JS } from "../src/adapters.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function rig() {
  const injects: Array<{ id: string; css: string | null; js: string | null }> = [];
  const drivers: Drivers = {
    surface: {
      create: () => {},
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: () => {},
      inject: (id, css, js) => void injects.push({ id, css, js }),
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
    },
    store: { get: () => null, set: () => {} },
  };
  const orchestrator = new Orchestrator(drivers);
  orchestrator.setAdapters({
    youtube: {
      match: ["youtube.com"],
      version: "2026.08.1",
      css: ".promo { display: none }",
      js: "frame.onMediaCommand = function(c) { window.__last = c }",
    },
  });
  return { injects, orchestrator };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "k",
  name: "K",
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", url: "https://youtube.com", adapter: "youtube", audio: "exclusive" },
    { id: "plain", url: "https://plain.test", adapter: null, audio: "mute" },
  ],
};

describe("adapters runtime (§5)", () => {
  it("injects prelude, CSS, and JS when a fresh document is ready", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;

    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "yt", ok: true });
    expect(injects[0]).toEqual({ id: "yt", css: null, js: FRAME_PRELUDE_JS });
    expect(injects[1]).toEqual({
      id: "yt",
      css: ".promo { display: none }",
      js: "frame.onMediaCommand = function(c) { window.__last = c }",
    });
  });

  it("re-injects JS but not CSS on SPA navigation", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;

    await orchestrator.onSurfaceEvent({ type: "navigated", id: "yt" });
    expect(injects).toHaveLength(2);
    expect(injects[0]!.js).toBe(FRAME_PRELUDE_JS);
    expect(injects[1]!.css).toBeNull();
    expect(injects[1]!.js).toContain("onMediaCommand");
  });

  it("adapterless tiles still get the frame prelude, nothing else", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;

    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "plain", ok: true });
    expect(injects).toHaveLength(1);
    expect(injects[0]!.js).toBe(FRAME_PRELUDE_JS);
  });

  it("failed loads inject nothing", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "yt", ok: false });
    expect(injects).toEqual([]);
  });

  it("media commands route through the adapter's page contract", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;

    for (const cmd of ["play", "pause", "next", "prev"]) {
      expect(await orchestrator.tileCommand("yt", cmd)).toBe("ok");
    }
    // §32 routing, page-side: the page's own Media Session handler first,
    // then the adapter's onMediaCommand (__prismMediaCmd), then the element.
    const js = injects.map((i) => i.js ?? "");
    expect(js).toHaveLength(4);
    for (const [i, cmd] of ["play", "pause", "next", "prev"].entries()) {
      expect(js[i]).toContain("__prismMediaAction");
      expect(js[i]).toContain('__prismMediaCmd(c)');
      expect(js[i]).toContain(JSON.stringify(cmd));
    }
    expect(js[2]).toContain('"nexttrack"');
    expect(js[3]).toContain('"previoustrack"');
  });

  it("without an adapter: every media command still reaches the page - the Media Session handler, else the element (play/pause)", async () => {
    const { injects, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    injects.length = 0;

    expect(await orchestrator.tileCommand("plain", "play")).toBe("ok");
    expect(await orchestrator.tileCommand("plain", "pause")).toBe("ok");
    expect(await orchestrator.tileCommand("plain", "next")).toBe("ok");
    expect(await orchestrator.tileCommand("plain", "prev")).toBe("ok");
    expect(injects.every((i) => i.js?.includes("__prismMediaAction"))).toBe(true);
    // the adapter branch is guarded on window.frame.onMediaCommand - a plain page has none
    expect(injects.every((i) => i.js?.includes("window.frame.onMediaCommand"))).toBe(true);
  });
});
