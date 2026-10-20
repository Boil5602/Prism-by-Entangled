import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * A dead engine (2026-10-19, "I've tried several times to renew a song but it just spins and eventually nothing happens"): the host
 * reports renderer-failed for a page whose browser or render process died. Core has the page made again through the apply path
 * (destroy, create, load), every page of one crash in a single remake; a page that dies as soon as it is made is given up after
 * three remakes in ten minutes, and a press on it answers unavailable instead of going into a page that is not there.
 */
function fakeDrivers() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", ...opts }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      setRect: (id, rect) => void calls.push({ op: "setRect", id, rect }),
      setOpacity: (id, opacity) => void calls.push({ op: "setOpacity", id, opacity }),
      setZ: (id, z) => void calls.push({ op: "setZ", id, z }),
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, css, js) => void calls.push({ op: "inject", id, css, js }),
      freeze: (id) => void calls.push({ op: "freeze", id }),
      reveal: (id, ms) => void calls.push({ op: "reveal", id, ms }),
      suspend: (id) => void calls.push({ op: "suspend", id }),
      resume: (id) => void calls.push({ op: "resume", id }),
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  (drivers.surface as unknown as { createVisualization: (o: unknown) => void }).createVisualization = (o) => void calls.push({ op: "createVisualization", o });
  return { drivers, calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lounge",
  name: "Lounge",
  theme: { background: "#101318" },
  layout: { mode: "grid", cols: 1, rows: 1, gap: 0 },
  tiles: [
    { id: "stage", visualization: { style: "prism-beams", source: "am", artwork: "backdrop" }, audio: "mute", aspectHint: "16:9" },
    { id: "am", url: "https://music.apple.com/", adapter: "apple-music", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
    { id: "pd", url: "https://www.pandora.com/", adapter: "pandora", audio: "exclusive", kind: "floating", float: { x: 0, y: 0, w: 0.3, h: 0.3, hidden: true } },
  ],
};

const ops = (calls: Array<Record<string, unknown>>, op: string) => calls.filter((c) => c.op === op).map((c) => c.id);

describe("renderer-failed: a page whose engine died is made again", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("remakes every page of one crash in a single pass, and a helper process failure changes nothing", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, pandora: { id: "pandora", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    calls.length = 0;

    await o.onSurfaceEvent({ type: "renderer-failed", id: "am", kind: "GpuProcessExited", fatal: false });
    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
    expect(ops(calls, "destroy")).toEqual([]);

    await o.onSurfaceEvent({ type: "renderer-failed", id: "am", kind: "BrowserProcessExited", reason: "Crashed", exitCode: -1, fatal: true });
    await o.onSurfaceEvent({ type: "renderer-failed", id: "pd", kind: "BrowserProcessExited", reason: "Crashed", exitCode: -1, fatal: true });
    expect(o.deadRenderers().sort()).toEqual(["am", "pd"]);
    // a press in the meantime goes nowhere
    expect(await o.tileCommand("am", "play")).toBe("unavailable");
    expect(calls.filter((c) => c.op === "inject" && c.id === "am").length).toBe(0);

    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
    expect(ops(calls, "destroy").sort()).toEqual(["am", "pd"]);
    expect(ops(calls, "create").sort()).toEqual(["am", "pd"]);
    expect(calls.filter((c) => c.op === "navigate" && c.id === "am").pop()?.url).toBe("https://music.apple.com/");
    expect(calls.filter((c) => c.op === "navigate" && c.id === "pd").pop()?.url).toBe("https://www.pandora.com/");
    expect(o.deadRenderers()).toEqual([]);
    // the page is alive again: a press reaches it
    calls.length = 0;
    expect(await o.tileCommand("am", "play")).toBe("ok");
    expect(calls.some((c) => c.op === "inject" && c.id === "am")).toBe(true);
  });

  it("gives up a page that dies as soon as it is made: three remakes in ten minutes, then it stays dead and a press answers unavailable", async () => {
    const { drivers, calls } = fakeDrivers();
    const o = new Orchestrator(drivers);
    o.setAdapters({ "apple-music": { id: "apple-music", controls: { play: ".play" } } as never, pandora: { id: "pandora", controls: { play: ".play" } } as never });
    await o.load(doc, { w: 1000, h: 625 });
    for (let n = 1; n <= Orchestrator.RENDERER_RECOVER_MAX; n++) {
      calls.length = 0;
      await o.onSurfaceEvent({ type: "renderer-failed", id: "am", kind: "RenderProcessExited", fatal: true });
      await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
      expect(ops(calls, "create")).toEqual(["am"]);
    }
    calls.length = 0;
    await o.onSurfaceEvent({ type: "renderer-failed", id: "am", kind: "RenderProcessExited", fatal: true });
    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
    expect(ops(calls, "create")).toEqual([]);
    expect(o.deadRenderers()).toEqual(["am"]);
    expect(await o.tileCommand("am", "play")).toBe("unavailable");
    // the other page is untouched by am's fate
    await o.onSurfaceEvent({ type: "renderer-failed", id: "pd", kind: "RenderProcessExited", fatal: true });
    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
    expect(ops(calls, "create")).toEqual(["pd"]);
    // ... and after the window passes, am may be tried again
    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_WINDOW_MS);
    calls.length = 0;
    await o.onSurfaceEvent({ type: "renderer-failed", id: "am", kind: "RenderProcessExited", fatal: true });
    await vi.advanceTimersByTimeAsync(Orchestrator.RENDERER_RECOVER_SETTLE_MS + 100);
    expect(ops(calls, "create")).toEqual(["am"]);
  });
});
