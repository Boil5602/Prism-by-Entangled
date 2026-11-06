import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismModelEval } from "../src/model-eval.js";
import { HOST_CALLS } from "../src/win-channel.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// B-40: the editors' evaluation helpers are real PrismRuntime host calls with
// the PrismModelEval.* signatures, so Agent 2's ModelEvalAsync (which probes
// PrismRuntime.<fn> first) retires its brain-side stub by itself.
const here = dirname(fileURLToPath(import.meta.url));
const runtimeSrc = readFileSync(join(here, "../src/runtime.ts"), "utf8");

const MAP: Array<[string, keyof typeof PrismModelEval]> = [
  ["modelClassifyLayout", "classifyLayout"], ["modelNearestBucket", "nearestBucket"], ["modelRepresentativeRect", "representativeRect"],
  ["modelClassRatio", "classRatio"], ["modelFacetPresets", "facetPresets"], ["modelPresetFacet", "presetFacet"],
  ["modelLoginRedirect", "loginRedirect"], ["modelFacetPickerJs", "facetPickerJs"], ["modelFacetPickPollJs", "facetPickPollJs"],
  ["modelFacetPickStopJs", "facetPickStopJs"], ["modelPickPollJs", "facetPickPollJs"], ["modelPickStopJs", "facetPickStopJs"], ["modelSelectorRectJs", "selectorRectJs"],
];

describe("B-40 model-eval host calls", () => {
  it("every PrismModelEval helper the editors use is a HOST_CALLS entry implemented on PrismRuntime", () => {
    for (const [fn, evalFn] of MAP) {
      expect(HOST_CALLS, fn).toContain(fn);
      expect(runtimeSrc, fn).toMatch(new RegExp(`\\b${fn}\\b[^\\n]*PrismModelEval\\.${evalFn}\\(`));
    }
    expect(HOST_CALLS).toContain("modelOpenAppSurface");
    expect(HOST_CALLS).toContain("modelCloseAppSurface");
  });
  it("the helpers answer as sync JSON", () => {
    expect(JSON.parse(PrismModelEval.nearestBucket(16 / 9)).bucket).toBe("16:9");
    expect(JSON.parse(PrismModelEval.classRatio("16:9·XL"))).toBeCloseTo(16 / 9);
    expect(PrismModelEval.classifyLayout("not json")).toBe("null");
    expect(JSON.parse(PrismModelEval.loginRedirect("https://www.hulu.com/login", "https://www.hulu.com/login", "https://www.hulu.com")).redirect).toBe("login");
    expect(typeof PrismModelEval.facetPickerJs()).toBe("string");
  });
});

// B-41: App setup / facet previews get a surface OUTSIDE the wall.
function rig() {
  const ops: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind ?? null, profile: o.profile }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {}, setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: () => {}, reveal: (id) => void ops.push({ op: "reveal", id }), suspend: () => {}, resume: () => {},
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }),
    },
  };
  return { ops, orchestrator: new Orchestrator(drivers) };
}
const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1", id: "wall", name: "Wall",
  layout: { mode: "grid" }, grid: { cols: 1, rows: 1 },
  tiles: [{ id: "a", url: "https://a.test", audio: "mute" }],
} as unknown as DashboardDocument;

describe("B-41 App preview / setup surfaces live outside the wall", () => {
  it("openAppSurface creates a kind=preview surface in the App's profile, loads it on the §16 path, and close destroys it", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1920, h: 1080 });
    ops.length = 0;
    const id = orchestrator.openAppSurface("hulu", "hulu-profile", "https://www.hulu.com/", null);
    expect(id).toBe("app:hulu:preview");
    await vi.advanceTimersByTimeAsync(0);
    expect(ops.find((o) => o.op === "create" && o.id === id)).toMatchObject({ kind: "preview", profile: "hulu-profile" });
    expect(ops.some((o) => o.op === "setZ" && o.id === id && o.z === 900)).toBe(true);
    expect(ops.some((o) => o.op === "navigate" && o.id === id && o.url === "https://www.hulu.com/")).toBe(true);
    expect(ops.some((o) => o.op === "reveal" && o.id === id)).toBe(false);          // hidden until it loaded (§16)
    await orchestrator.onSurfaceEvent({ type: "load-finished", id, ok: true });
    expect(ops.some((o) => o.op === "inject" && o.id === id)).toBe(true);           // the adapter prelude reaches it
    expect(ops.some((o) => o.op === "reveal" && o.id === id)).toBe(true);
    // not a wall tile: no layout rect, no state entry, no audio-focus command
    expect(orchestrator.rects()[id]).toBeUndefined();
    expect(orchestrator.getState()!.tiles.some((t) => t.id === id)).toBe(false);
    expect(ops.some((o) => o.op === "setMuted" && o.id === id)).toBe(false);
    expect(orchestrator.previewSurfaces()).toEqual([{ id, app: "hulu" }]);
    // reopening navigates the same surface
    ops.length = 0;
    expect(orchestrator.openAppSurface("hulu", "hulu-profile", "https://www.hulu.com/live", null)).toBe(id);
    expect(ops.some((o) => o.op === "create")).toBe(false);
    expect(ops.some((o) => o.op === "navigate" && o.url === "https://www.hulu.com/live")).toBe(true);
    expect(orchestrator.closeAppSurface(id)).toBe(true);
    expect(ops.some((o) => o.op === "destroy" && o.id === id)).toBe(true);
    expect(orchestrator.closeAppSurface(id)).toBe(false);
  });
});
