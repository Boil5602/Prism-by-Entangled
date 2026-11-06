import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Orchestrator } from "../src/orchestrator.js";
import { CORRELATION_MS, USER_INPUT_MS } from "../src/presentation-keeper.js";
import { facetTile } from "../src/scene-model.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument, TileSpec } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const here = dirname(fileURLToPath(import.meta.url));
const FULLSCREEN = ".ytp-fullscreen-button";

function rig() {
  const injects: Array<{ id: string; js: string | null }> = [];
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {},
      inject: (id, _css, js) => void injects.push({ id, js }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
    },
    store: { get: () => null, set: () => {} },
  };
  const orchestrator = new Orchestrator(drivers);
  orchestrator.setAdapters({
    youtube: { match: ["youtube.com"], presentation: { enterFullscreen: FULLSCREEN, enterTheater: ".ytp-size-button", play: ".ytp-play-button" } },
    plainsite: { match: ["plain.test"] },
  });
  return { injects, orchestrator, restores: () => injects.filter((i) => i.js?.includes(FULLSCREEN)) };
}

function doc(hero: Partial<TileSpec> = {}): DashboardDocument {
  return {
    schema: "frame.dashboard/v0.1", id: "k", name: "K",
    layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
    tiles: [
      { id: "yt", url: "https://youtube.com/watch?v=x", adapter: "youtube", audio: "exclusive", ...hero },
      { id: "plain", url: "https://plain.test", adapter: "plainsite", audio: "mute" },
    ],
  };
}

async function settle() { await vi.advanceTimersByTimeAsync(0); }

describe("§26 presentation keeping wired into the orchestrator", () => {
  it("a site-initiated drop under keepPresentation restores at the break's end through the adapter's named control - once", async () => {
    const { orchestrator, restores } = rig();
    await orchestrator.load(doc({ presentation: { keepPresentation: true, onEnd: "none" } }), { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });   // the human established fullscreen
    vi.advanceTimersByTime(60_000);
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: false });  // the site dropped it at the break
    expect(restores()).toHaveLength(0);                                                           // never during the ad
    vi.advanceTimersByTime(30_000);
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    expect(restores()).toHaveLength(1);
    expect(restores()[0]!.id).toBe("yt");
    expect(restores()[0]!.js).toContain(".click()");
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });   // our restore landed
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    expect(restores()).toHaveLength(1);                                                           // no second press
  });

  it("the human's exit (input within 1 s of the drop) is never fought, even across an ad boundary", async () => {
    const { orchestrator, restores } = rig();
    await orchestrator.load(doc({ presentation: { keepPresentation: true, onEnd: "none" } }), { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });
    vi.advanceTimersByTime(30_000);
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "yt" });                            // Esc / a click
    vi.advanceTimersByTime(USER_INPUT_MS / 2);
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: false });
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    vi.advanceTimersByTime(20_000);
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    await vi.advanceTimersByTimeAsync(CORRELATION_MS * 2);
    expect(restores()).toHaveLength(0);
  });

  it("a drop with no signal either way is doubt: the tick settles it and nothing is injected", async () => {
    const { orchestrator, restores, injects } = rig();
    await orchestrator.load(doc({ presentation: { keepPresentation: true, onEnd: "none" } }), { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });
    vi.advanceTimersByTime(10_000);
    const before = injects.length;
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: false });
    await vi.advanceTimersByTimeAsync(CORRELATION_MS * 3);
    expect(restores()).toHaveLength(0);
    expect(injects.length).toBe(before);
  });

  it("without a standing instruction the same site drop produces nothing", async () => {
    const { orchestrator, restores, injects } = rig();
    await orchestrator.load(doc(), { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });
    vi.advanceTimersByTime(60_000);
    const before = injects.length;
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: false });
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "yt", active: false });
    await vi.advanceTimersByTimeAsync(CORRELATION_MS * 3);
    expect(restores()).toHaveLength(0);
    expect(injects.slice(before).filter((i) => i.js?.includes(".click()"))).toHaveLength(0);
  });

  it("an adapter without the named control degrades to nothing - no generic fullscreen hunt", async () => {
    const { orchestrator, injects } = rig();
    const d = doc();
    d.tiles[1] = { ...d.tiles[1]!, presentation: { keepPresentation: true, onEnd: "none" } };
    await orchestrator.load(d, { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "plain", contains: true });
    vi.advanceTimersByTime(10_000);
    const before = injects.length;
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "plain", active: true });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "plain", contains: false });
    await orchestrator.onSurfaceEvent({ type: "ad-break", id: "plain", active: false });
    expect(injects.slice(before).filter((i) => i.js?.includes(".click()") || i.js?.includes("requestFullscreen"))).toHaveLength(0);
  });

  it("onEnd: restart replays at the media's ended signal; restart-fullscreen also restores the dropped presentation", async () => {
    const { orchestrator, injects, restores } = rig();
    await orchestrator.load(doc({ presentation: { keepPresentation: false, onEnd: "restart-fullscreen" } }), { w: 1000, h: 625 });
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: true });
    vi.advanceTimersByTime(5_000);
    await orchestrator.onSurfaceEvent({ type: "fullscreen-element", id: "yt", contains: false });   // the site left fullscreen at the end
    await orchestrator.onSurfaceEvent({ type: "playback", id: "yt", playing: false, ended: true });
    expect(injects.filter((i) => i.js?.includes(".ytp-play-button"))).toHaveLength(1);           // the adapter's own play control
    expect(restores()).toHaveLength(1);
  });

  it("the scene materializer carries the assignment's standing instruction onto the tile (and nothing without one)", () => {
    const facet = { id: "f", app: "youtube", url: "https://www.youtube.com/", slotClass: "16:9·XL", label: "Home" };
    expect(facetTile("hero", facet, undefined, { keepPresentation: true, onEnd: "none" }).presentation).toEqual({ keepPresentation: true, onEnd: "none" });
    expect(facetTile("hero", facet, undefined, { keepPresentation: false, onEnd: "restart" }).presentation).toEqual({ keepPresentation: false, onEnd: "restart" });
    expect(facetTile("hero", facet, undefined, { keepPresentation: false, onEnd: "none" }).presentation).toBeUndefined();
    expect(facetTile("hero", facet, undefined, undefined).presentation).toBeUndefined();
  });

  it("only the keeper path can reach an adapter's presentation control: one handler in the orchestrator, one resolver in core", () => {
    const src = join(here, "../src");
    const orchestratorSrc = readFileSync(join(src, "orchestrator.ts"), "utf8");
    expect(orchestratorSrc.match(/this\.keeper\.handle\(/g)).toHaveLength(1);
    expect(orchestratorSrc.match(/applyPresentationAction\(/g)).toHaveLength(2);   // the declaration + the one call in feedKeeper
    for (const f of readdirSync(src).filter((x) => x.endsWith(".ts"))) {
      const text = readFileSync(join(src, f), "utf8");
      const calls = text.match(/resolvePresentationAction\(/g) ?? [];
      // declared + called exactly once, both inside adapters-presentation.ts
      expect(calls.length, f).toBe(f === "adapters-presentation.ts" ? 2 : 0);
    }
  });
});
