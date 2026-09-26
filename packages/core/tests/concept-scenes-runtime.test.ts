import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { PEEK_TIMEOUT_MS } from "../src/preview.js";
import { COMMAND_SCHEMA, HOST_CALLS } from "../src/win-channel.js";
import { sceneDocument, type App, type AssignmentSettings, type Facet, type Layout, type Scene } from "../src/scene-model.js";
import type { Drivers, TapOutcome } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

/**
 * CS-4 (docs/concept-scenes.md §4 / §5): the RUNTIME wiring of the two
 * pull-forwards — what actually crosses the driver seam for a §25 peek, and
 * what a tap resolves to for the shell and for the §6 remote alike.
 *
 * Everything here is asserted as driver calls, because that is the whole of
 * the contract a shell implements (§23: the shell decides nothing).
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const FHD = { w: 1920, h: 1080 };

const app: App = { id: "hulu", name: "Hulu", baseUrl: "https://www.hulu.com/", profileId: "hulu", setup: { status: "unknown" } };
const facet = (id: string): Facet => ({ id, app: "hulu", url: `https://www.hulu.com/${id}`, slotClass: "16:9·L", label: id });
const layoutOf = (ids: readonly string[]): Layout => ({
  id: "grid", name: "grid", canvas: { aspect: "16:9", ratio: 16 / 9, resolution: "1080-class", orientation: "landscape" },
  slots: ids.map((id, i) => ({ id, rect: { x: (i % 2) * 0.5, y: Math.floor(i / 2) * 0.5, w: 0.5, h: 0.5 }, class: "16:9·L" })),
});

/** The Sports Multiview wall: four games that peek and tap-for-audio, plus a ticker that does neither. */
const sportsDoc = (): DashboardDocument => {
  const ids = ["game1", "game2", "game3", "game4"];
  const peek: AssignmentSettings = { keepPresentation: false, onEnd: "none", audio: "mute", touch: "full", tapAction: "audio", preview: { mode: "peek", interval: 30, playhead: "advance" } };
  const settings: Record<string, AssignmentSettings> = {};
  for (const id of ids) settings[id] = { ...peek };
  settings["game1"] = { ...peek, keepPresentation: true, audio: "exclusive" };
  settings["scores"] = { keepPresentation: false, onEnd: "none", audio: "mute", touch: "scroll" };
  const scene: Scene = {
    id: "sports", name: "Sports", layout: "grid",
    assign: Object.fromEntries([...ids, "scores"].map((id) => [id, `f-${id}`])),
    settings, floating: [], hidden: [], schedule: null,
  };
  return sceneDocument({ scene, layout: layoutOf([...ids, "scores"]), facets: [...ids, "scores"].map((id) => facet(`f-${id}`)), apps: [app] }, "wall", FHD).doc;
};

interface Op { op: string; id?: string; [k: string]: unknown }

function rig(opts: { readinessTimeoutMs?: number } = {}) {
  const ops: Op[] = [];
  const store = new Map<string, string>();
  const taps: Array<{ id: string; result: TapOutcome }> = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {},
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js }),
      freeze: (id) => void ops.push({ op: "freeze", id }),
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: (id) => void ops.push({ op: "suspend", id }),
      resume: (id) => void ops.push({ op: "resume", id }),
      setPeek: (id, peeking) => void ops.push({ op: "setPeek", id, peeking }),
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }),
      setViewport: () => {},
      setChrome: () => {},
    },
    ui: {
      route: (route, source, id) => void ops.push({ op: "ui.route", route, source, id: id ?? null }),
      tapResult: (id, result) => void taps.push({ id, result }),
    },
    store: { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
  };
  const orchestrator = new Orchestrator(drivers, opts.readinessTimeoutMs ? { timeoutMs: opts.readinessTimeoutMs } : undefined);
  return { ops, taps, store, drivers, orchestrator };
}

/** Everything the shell was told to do to one surface, in order. */
const forSurface = (ops: Op[], id: string) => ops.filter((o) => o.id === id).map((o) => o.op + (o.op === "setPeek" ? `:${o.peeking}` : o.op === "setMuted" ? `:${o.muted}` : ""));

/** The seam ops for one whole peek: from the bracket opening to its close (or to the end, if still open). */
function peekBracket(ops: Op[], id: string): string[] {
  const seam = forSurface(ops, id);
  const open = seam.indexOf("setPeek:true");
  if (open < 0) return [];
  const close = seam.indexOf("setPeek:false", open);
  return seam.slice(Math.max(0, open - 1), close < 0 ? seam.length : close + 1);
}

/** Every tile awake with pixels on the wall, so §18 has revealed candidates to demote. */
async function settle(orchestrator: Orchestrator, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await orchestrator.onSurfaceEvent({ type: "load-finished", id, ok: true });
    await orchestrator.onSurfaceEvent({ type: "first-paint", id });
  }
  await vi.advanceTimersByTimeAsync(1_000);
}

const WALL = ["game1", "game2", "game3", "game4", "scores"] as const;

/** The position the §25 pre-reveal seek asked for (seekJs is the only inject naming __prismSeek), or null. */
function seekAt(ops: Op[], id: string): number | null {
  const op = ops.find((o) => o.op === "inject" && o.id === id && String(o.js).includes("__prismSeek"));
  if (!op) return null;
  const m = String(op.js).match(/\)\((\d+(?:\.\d+)?)\)$/);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------- A. the seam

describe("CS-4 §A — the channel carries what the host needs", () => {
  it("the host can ask core to resolve a tap, and core answers with the verdict", () => {
    expect(HOST_CALLS).toContain("tapItem");
    const tapResult = COMMAND_SCHEMA.find((c) => c.op === "ui.tapResult");
    expect(tapResult, "core → host: what the tap did").toBeTruthy();
    expect(tapResult!.m1).toBe(true);
    expect(tapResult!.request).toBeUndefined();      // the tap already happened; nothing to answer
    expect(Object.keys(tapResult!.fields)).toEqual(["id", "action", "did", "audio", "error"]);
  });

  it("the host can be told a peek's bracket, so §16 holds across the revival", () => {
    const setPeek = COMMAND_SCHEMA.find((c) => c.op === "surface.setPeek");
    expect(setPeek).toBeTruthy();
    expect(setPeek!.m1).toBe(true);
    expect(setPeek!.fields).toEqual({ id: "string", peeking: "boolean" });
  });

  it("the playhead feed already crosses as a surface event — nothing new was invented for it", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(sportsDoc(), FHD);
    ops.length = 0;
    // §25 REPORT_POSITION_JS is injected into peek tiles on a fresh document…
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "game2", ok: true });
    expect(ops.some((o) => o.op === "inject" && o.id === "game2" && String(o.js).includes("window.frame.position"))).toBe(true);
    // …and never into a tile that asked for no preview
    ops.length = 0;
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "scores", ok: true });
    expect(ops.some((o) => o.op === "inject" && String(o.js).includes("window.frame.position"))).toBe(false);
    // the report itself is accepted and feeds the virtual playhead
    await orchestrator.onSurfaceEvent({ type: "media-position", id: "game2", position: 120, duration: 3600 });
    expect(orchestrator.getState()!.tiles.some((t) => t.id === "game2")).toBe(true);
  });
});

// ------------------------------------------------------ B. the peek in the host

describe("CS-4 §B — the §25 peek cycle as the shell sees it", () => {
  it("brackets one peek: muted → setPeek true → revive → reveal → capture → demote → setPeek false", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setMaxLiveTiles(1);            // §18: everything but the live tile goes warm
    await orchestrator.load(sportsDoc(), FHD);
    await settle(orchestrator, WALL);
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);
    const peeked = ops.find((o) => o.op === "setPeek" && o.peeking === true)?.id as string | undefined;
    expect(peeked, "a peek should have started").toBeTruthy();
    const seam = peekBracket(ops, peeked!);
    // muted BEFORE the bracket opens (§25: peeks are muted, always), and the
    // bracket closes only after the demotion put the fresh still back up.
    expect(seam[0]).toBe("setMuted:true");
    expect(seam[1]).toBe("setPeek:true");
    expect(seam[seam.length - 1]).toBe("setPeek:false");
    expect(seam.indexOf("resume")).toBeGreaterThan(seam.indexOf("setPeek:true"));
    expect(seam.indexOf("reveal")).toBeGreaterThan(seam.indexOf("resume"));
    expect(seam.indexOf("freeze")).toBeGreaterThan(seam.indexOf("reveal"));
    expect(seam.indexOf("suspend")).toBeGreaterThan(seam.indexOf("freeze"));
    expect(seam.filter((s) => s === "setMuted:false")).toEqual([]);   // a peek never unmutes anything
  });

  it("never opens two brackets at once — peak cost is exactly one extra renderer (§18)", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setMaxLiveTiles(1);
    await orchestrator.load(sportsDoc(), FHD);
    await settle(orchestrator, WALL);
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(180_000);
    let open = 0;
    let most = 0;
    for (const o of ops.filter((x) => x.op === "setPeek")) {
      open += o.peeking ? 1 : -1;
      most = Math.max(most, open);
    }
    expect(most).toBe(1);                        // never two renderers revived at once
    expect(open).toBeLessThanOrEqual(1);         // at most the one still in flight when time stopped
    // round-robin: every game gets its turn, the ticker (no preview) never does
    const turns = ops.filter((o) => o.op === "setPeek" && o.peeking === true).map((o) => o.id);
    expect(new Set(turns)).toEqual(new Set(["game1", "game2", "game3", "game4"]));
    expect(turns.length).toBeGreaterThan(4);
  });

  it("a peek that never reaches readiness closes its bracket AFTER the freeze — the shell keeps the last still", async () => {
    // readiness far beyond PEEK_TIMEOUT_MS: the revival hangs and the peek is abandoned
    const { ops, orchestrator } = rig({ readinessTimeoutMs: PEEK_TIMEOUT_MS * 5 });
    orchestrator.setMaxLiveTiles(1);
    await orchestrator.load(sportsDoc(), FHD);
    await settle(orchestrator, WALL);
    ops.length = 0;
    await vi.advanceTimersByTimeAsync(30_000 + PEEK_TIMEOUT_MS + 2_000);
    const peeked = ops.find((o) => o.op === "setPeek" && o.peeking === true)!.id as string;
    const seam = peekBracket(ops, peeked);
    expect(seam).toContain("setPeek:false");
    expect(seam).not.toContain("reveal");        // nothing ever reached readiness
    // the freeze the demotion issues arrives while the bracket is still OPEN,
    // which is exactly what lets the host keep the previous still (§16).
    expect(seam.indexOf("freeze")).toBeGreaterThan(seam.indexOf("setPeek:true"));
    expect(seam.indexOf("freeze")).toBeLessThan(seam.indexOf("setPeek:false"));
  });

  it("promotion resumes from the virtual playhead — tapping in is unmuting, not restarting", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(sportsDoc(), FHD);
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "game3", ok: true });
    await orchestrator.onSurfaceEvent({ type: "media-position", id: "game3", position: 600, duration: 3600 });
    await vi.advanceTimersByTimeAsync(120_000);   // two minutes of wall clock pass
    ops.length = 0;
    orchestrator.refreshTile("game3");
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "game3", ok: true });
    await orchestrator.onSurfaceEvent({ type: "first-paint", id: "game3" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seekAt(ops, "game3"), "the pre-reveal seek should have been injected").toBeGreaterThanOrEqual(720);
    expect(seekAt(ops, "game3")).toBeLessThanOrEqual(3600);          // never past the duration
  });

  it("\"hold\" leaves the position alone; a live stream seeks nowhere", async () => {
    const { ops, orchestrator } = rig();
    const doc = sportsDoc();
    doc.tiles.find((t) => t.id === "game3")!.preview = { mode: "peek", interval: 30, playhead: "hold" };
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "game3", ok: true });
    await orchestrator.onSurfaceEvent({ type: "media-position", id: "game3", position: 600, duration: 3600 });
    await orchestrator.onSurfaceEvent({ type: "load-finished", id: "game4", ok: true });
    await orchestrator.onSurfaceEvent({ type: "media-position", id: "game4", position: 30, duration: null });  // live
    await vi.advanceTimersByTimeAsync(120_000);
    ops.length = 0;
    for (const id of ["game3", "game4"]) {
      orchestrator.refreshTile(id);
      await orchestrator.onSurfaceEvent({ type: "load-finished", id, ok: true });
      await orchestrator.onSurfaceEvent({ type: "first-paint", id });
    }
    await vi.advanceTimersByTimeAsync(15_000);
    expect(seekAt(ops, "game3")).toBe(600);        // held: exactly where it was
    expect(seekAt(ops, "game4")).toBeNull();       // live: the still is simply now
  });
});

// --------------------------------------------- C/D. the tap verdict + parity

describe("CS-4 §C/§D — one tap verdict for the wall and the phone", () => {
  const wall = async () => {
    const r = rig();
    await r.orchestrator.load(sportsDoc(), FHD);
    await r.orchestrator.onSurfaceEvent({ type: "interaction", id: "game1" });
    await r.orchestrator.onSurfaceEvent({ type: "playback", id: "game1", playing: true });
    r.ops.length = 0;
    r.taps.length = 0;
    return r;
  };

  it("an on-wall tap is reported to the shell exactly as core resolved it", async () => {
    const { taps, orchestrator } = await wall();
    await orchestrator.tapItem("game3");
    expect(taps).toEqual([{ id: "game3", result: { action: "audio", did: "audio", audio: "moved" } }]);
  });

  it("tapping the current owner reports a no-op, never a mute", async () => {
    const { ops, taps, orchestrator } = await wall();
    await orchestrator.tapItem("game1");
    expect(taps[0]!.result).toEqual({ action: "audio", did: "none", audio: "already-owner" });
    expect(ops.filter((o) => o.op === "setMuted")).toEqual([]);
  });

  it("an unknown item is reported as such rather than silently swallowed", async () => {
    const { taps, orchestrator } = await wall();
    await orchestrator.tapItem("nope");
    expect(taps[0]!.result).toEqual({ action: "promote", did: "none", error: "unknown-tile" });
  });

  it("the §6 remote's tap produces the same verdict on the same channel (parity)", async () => {
    const r = await wall();
    const remote = new RemoteApi(r.orchestrator, r.drivers.store);
    const { token } = await remote.mintPairing("http://10.0.0.5:8471");
    const res = await remote.handle({ method: "POST", path: "/items/game4/tap", body: null, token });
    expect(JSON.parse(res.body)).toEqual({ ok: true, did: "audio", audio: "moved" });
    expect(r.taps).toEqual([{ id: "game4", result: { action: "audio", did: "audio", audio: "moved" } }]);
  });

  it("§6 state says who the sound is with and what a tap here would mean", async () => {
    const { orchestrator } = await wall();
    expect(orchestrator.getState()!.audioOwner).toBe("game1");
    await orchestrator.tapItem("game2");
    const st = orchestrator.getState()!;
    expect(st.audioOwner).toBe("game2");                                  // now-playing follows the tap
    expect(st.tiles.find((t) => t.id === "game2")!.tapAction).toBe("audio");
    expect(st.tiles.find((t) => t.id === "scores")!.tapAction).toBeUndefined();   // absent === promote (§6a)
  });

  it("a wall with nothing audible yet reports no owner", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(sportsDoc(), FHD);
    expect(orchestrator.getState()!.audioOwner).toBeNull();
  });
});
