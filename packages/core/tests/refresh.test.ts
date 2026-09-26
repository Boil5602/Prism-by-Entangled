import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshEngine } from "../src/refresh.js";

/** Records freeze/navigate/reveal ordering; that ordering IS the §16 contract. */
function fakeSurface() {
  const ops: Array<{ op: string; id: string; ms?: number }> = [];
  return {
    ops,
    surface: {
      navigate: (id: string, _url: string) => void ops.push({ op: "navigate", id }),
      freeze: (id: string) => void ops.push({ op: "freeze", id }),
      reveal: (id: string, ms: number) => void ops.push({ op: "reveal", id, ms }),
    },
  };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function ready(engine: RefreshEngine, id: string) {
  engine.handleEvent({ type: "load-finished", id, ok: true });
  engine.handleEvent({ type: "first-paint", id });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RefreshEngine — readiness (§16)", () => {
  it("reveals only after load + paint + settle window", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(0);
    expect(ops).toEqual([{ op: "navigate", id: "a" }]);

    e.handleEvent({ type: "load-finished", id: "a", ok: true });
    await tick(1000);
    expect(ops.some((o) => o.op === "reveal")).toBe(false); // paint missing

    e.handleEvent({ type: "first-paint", id: "a" });
    await tick(299);
    expect(ops.some((o) => o.op === "reveal")).toBe(false); // settling

    await tick(1);
    expect(ops.at(-1)).toEqual({ op: "reveal", id: "a", ms: 300 });
  });

  it("order of load/paint events doesn't matter", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(0);
    e.handleEvent({ type: "first-paint", id: "a" });
    e.handleEvent({ type: "load-finished", id: "a", ok: true });
    await tick(300);
    expect(ops.at(-1)?.op).toBe("reveal");
  });

  it("adapter-ready short-circuits the settle window", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(0);
    e.handleEvent({ type: "adapter-ready", id: "a" });
    await tick(0);
    expect(ops.at(-1)?.op).toBe("reveal");
  });

  it("hard timeout crossfades regardless (default 10s)", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(9_999);
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
    await tick(1);
    expect(ops.at(-1)?.op).toBe("reveal");
  });
});

describe("RefreshEngine — failure & quiet retry (§16)", () => {
  it("a failed load never reveals; retry backs off exponentially", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { failGraceMs: 0 });
    e.load("a", "https://x.test");
    await tick(0);

    e.handleEvent({ type: "load-finished", id: "a", ok: false });
    await tick(0);
    expect(ops.some((o) => o.op === "reveal")).toBe(false);

    await tick(60_000); // first retry
    expect(ops.filter((o) => o.op === "navigate")).toHaveLength(2);

    e.handleEvent({ type: "load-finished", id: "a", ok: false });
    await tick(60_000); // not yet — backoff doubled
    expect(ops.filter((o) => o.op === "navigate")).toHaveLength(2);
    await tick(60_000);
    expect(ops.filter((o) => o.op === "navigate")).toHaveLength(3);

    // success clears the backoff and finally reveals
    ready(e, "a");
    await tick(300);
    expect(ops.at(-1)?.op).toBe("reveal");
  });

  it("retry delay is capped at retryMaxMs", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { retryMs: 100, retryMaxMs: 250, failGraceMs: 0 });
    e.load("a", "https://x.test");
    await tick(0);
    for (let i = 0; i < 5; i++) {
      e.handleEvent({ type: "load-finished", id: "a", ok: false });
      await tick(250); // ≥ cap always suffices
    }
    expect(ops.filter((o) => o.op === "navigate").length).toBe(6);
  });
});

describe("RefreshEngine — refresh cycle (§16 + §18)", () => {
  it("refresh = freeze → navigate → ready → reveal", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { staggerMs: 0 });
    e.load("a", "https://x.test", 60);
    await tick(0);
    ready(e, "a");
    await tick(300);
    ops.length = 0;

    await tick(60_000); // refresh due
    expect(ops).toEqual([
      { op: "freeze", id: "a" },
      { op: "navigate", id: "a" },
    ]);
    ready(e, "a");
    await tick(300);
    expect(ops.at(-1)).toEqual({ op: "reveal", id: "a", ms: 300 });
  });

  it("a failed refresh keeps the snapshot up and retries without re-freezing", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { staggerMs: 0, failGraceMs: 0 });
    e.load("a", "https://x.test", 60);
    await tick(0);
    ready(e, "a");
    await tick(300);
    ops.length = 0;

    await tick(60_000);
    e.handleEvent({ type: "load-finished", id: "a", ok: false });
    await tick(60_000); // retry fires
    expect(ops.filter((o) => o.op === "freeze")).toHaveLength(1); // only the original
    expect(ops.filter((o) => o.op === "navigate")).toHaveLength(2);
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
  });

  it("serializes concurrent refreshes — one hidden buffer at a time (§18)", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { staggerMs: 0 });
    e.load("a", "https://a.test", 60);
    e.load("b", "https://b.test", 60);
    await tick(0);
    ready(e, "a");
    ready(e, "b");
    await tick(300);
    ops.length = 0;

    await tick(60_000); // both refreshes due at the same instant
    // only ONE tile is mid-refresh; the other waits in the queue
    expect(ops).toEqual([
      { op: "freeze", id: "a" },
      { op: "navigate", id: "a" },
    ]);

    ready(e, "a");
    await tick(300); // a reveals → b starts
    expect(ops.slice(2)).toEqual([
      { op: "reveal", id: "a", ms: 300 },
      { op: "freeze", id: "b" },
      { op: "navigate", id: "b" },
    ]);
  });

  it("staggers first refreshes so intervals don't stack", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { staggerMs: 5_000 });
    e.load("a", "https://a.test", 60);
    e.load("b", "https://b.test", 60);
    await tick(0);
    ready(e, "a");
    ready(e, "b");
    await tick(300);
    ops.length = 0;

    await tick(60_000); // a due (stagger 0); b staggered +5s
    ready(e, "a");
    await tick(300);
    expect(ops.filter((o) => o.op === "navigate").map((o) => o.id)).toEqual(["a"]);

    await tick(5_000);
    expect(ops.filter((o) => o.op === "navigate").map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("refreshNow rides the same path immediately", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(0);
    ready(e, "a");
    await tick(300);
    ops.length = 0;

    e.refreshNow("a");
    await tick(0);
    expect(ops).toEqual([
      { op: "freeze", id: "a" },
      { op: "navigate", id: "a" },
    ]);
  });
});

describe("RefreshEngine — stop", () => {
  it("stop cancels pending refreshes, retries, and in-flight reveals", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface, { staggerMs: 0 });
    e.load("a", "https://x.test", 60);
    await tick(0);
    ready(e, "a");
    await tick(300);
    ops.length = 0;

    e.stop("a");
    await tick(600_000);
    expect(ops).toEqual([]);
  });

  it("events for stopped tiles are ignored", async () => {
    const { ops, surface } = fakeSurface();
    const e = new RefreshEngine(surface);
    e.load("a", "https://x.test");
    await tick(0);
    e.stop("a");
    ready(e, "a");
    await tick(1000);
    expect(ops.some((o) => o.op === "reveal")).toBe(false);
  });
});
