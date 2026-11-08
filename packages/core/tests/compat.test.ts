import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompatTracker, toDomain, validateReport } from "../src/compat.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const valid = {
  kind: "adapter-selector-missing",
  domain: "example-news.com",
  adapter: "example-news@2026.08.1",
  shell: "prism-android@0.4.2",
  engine: "webview@126",
  device: "tablet-16x10",
  failCount: 3,
  firstFailed: "2026-08-21",
};

describe("validateReport — the schema is closed (§19)", () => {
  it("accepts the spec's example payload", () => {
    expect(validateReport(valid)).toBe(true);
  });

  it("REJECTS any field beyond the whitelist", () => {
    expect(validateReport({ ...valid, url: "https://example-news.com/private" })).toBe(false);
    expect(validateReport({ ...valid, userId: "abc" })).toBe(false);
    expect(validateReport({ ...valid, note: "" })).toBe(false);
  });

  it("rejects missing fields and bad kinds", () => {
    const { adapter: _a, ...short } = valid;
    expect(validateReport(short)).toBe(false);
    expect(validateReport({ ...valid, kind: "usage-stats" })).toBe(false);
  });

  it("domain must be a bare hostname — paths and queries cannot fit", () => {
    expect(validateReport({ ...valid, domain: "example.com/watch?v=abc" })).toBe(false);
    expect(validateReport({ ...valid, domain: "https://example.com" })).toBe(false);
  });

  it("timestamps are date-granular only", () => {
    expect(validateReport({ ...valid, firstFailed: "2026-08-21T07:14:03Z" })).toBe(false);
  });
});

describe("toDomain", () => {
  it("strips everything personal from URLs", () => {
    expect(toDomain("https://example.com/user/mark?token=s3cret#frag")).toBe("example.com");
    expect(toDomain("EXAMPLE.com")).toBe("example.com");
    expect(toDomain("not a url")).toBeNull();
  });
});

describe("CompatTracker — consent mechanics (§19)", () => {
  const context = { shell: "prism-test@1", engine: "test@1", device: "test" };

  function rig() {
    const kv = new Map<string, string>();
    const store = { get: (k: string) => kv.get(k) ?? null, set: (k: string, v: string) => void kv.set(k, v) };
    return { kv, store, tracker: new CompatTracker(context, store) };
  }

  it("offers only after the threshold, with a valid exact payload", async () => {
    const { tracker } = rig();
    await tracker.record("readiness-timeout", "https://slow.example/page?q=1", "news@1.0");
    await tracker.record("readiness-timeout", "https://slow.example/other", "news@1.0");
    expect(await tracker.pending()).toEqual([]);

    await tracker.record("readiness-timeout", "https://slow.example/", "news@1.0");
    const offers = await tracker.pending();
    expect(offers).toHaveLength(1);
    expect(validateReport(offers[0]!.report)).toBe(true);
    expect(offers[0]!.report).toMatchObject({
      kind: "readiness-timeout",
      domain: "slow.example",
      adapter: "news@1.0",
      failCount: 3,
      firstFailed: "2026-08-24",
    });
  });

  it("declining suppresses that domain+adapter permanently — even across restarts", async () => {
    const { store, tracker } = rig();
    for (let i = 0; i < 3; i++) await tracker.record("tile-render-failure", "https://x.test", null);
    const [offer] = await tracker.pending();
    expect(await tracker.decide(offer!.key, false)).toBeNull();

    for (let i = 0; i < 5; i++) await tracker.record("tile-render-failure", "https://x.test", null);
    expect(await tracker.pending()).toEqual([]);

    const reborn = new CompatTracker(context, store);
    for (let i = 0; i < 5; i++) await reborn.record("tile-render-failure", "https://x.test", null);
    expect(await reborn.pending()).toEqual([]);
  });

  it("sending returns the payload once, then suppresses (no re-nagging)", async () => {
    const { tracker } = rig();
    for (let i = 0; i < 3; i++) await tracker.record("drm-init-failure", "https://vid.test", null);
    const [offer] = await tracker.pending();
    const sent = await tracker.decide(offer!.key, true);
    expect(validateReport(sent!)).toBe(true);
    expect(await tracker.pending()).toEqual([]);
  });

  it("garbage URLs never become incidents", async () => {
    const { tracker } = rig();
    for (let i = 0; i < 5; i++) await tracker.record("tile-render-failure", "::nope::", null);
    expect(await tracker.pending()).toEqual([]);
  });
});

describe("orchestrator §19 wiring", () => {
  const doc: DashboardDocument = {
    schema: "frame.dashboard/v0.1",
    id: "k",
    name: "K",
    layout: { mode: "hero", hero: "news", heroSize: 0.62, satellites: "auto", gap: 8 },
    tiles: [
      {
        id: "news",
        url: "https://example-news.com/top?edition=us",
        adapter: "example-news",
        audio: "mute",
        focus: { selector: "#top", fit: "width" },
      },
    ],
  };

  function rig() {
    const submitted: string[] = [];
    const kv = new Map<string, string>();
    const drivers: Drivers = {
      surface: {
        create: () => {},
        destroy: () => {},
        setRect: () => {},
        setOpacity: () => {},
        setZ: () => {},
        navigate: () => {},
        inject: () => {},
        freeze: () => {},
        reveal: () => {},
        suspend: () => {},
        resume: () => {},
        setMuted: () => {},
      },
      net: { submitCompatReport: (json) => void submitted.push(json) },
      store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    };
    const orchestrator = new Orchestrator(drivers);
    orchestrator.setAdapters({ "example-news": { version: "2026.08.1" } });
    orchestrator.setCompatContext({ shell: "prism-test@1", engine: "wv@126", device: "tablet-16x10" });
    return { submitted, orchestrator };
  }

  it("repeated selector misses become an offer; sending goes via the Net driver", async () => {
    const { submitted, orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });

    for (let i = 0; i < 3; i++) {
      await orchestrator.onSurfaceEvent({ type: "focus-result", id: "news", found: false });
    }
    const offers = await orchestrator.pendingReports();
    expect(offers).toHaveLength(1);
    expect(offers[0]!.report).toMatchObject({
      kind: "adapter-selector-missing",
      domain: "example-news.com",
      adapter: "example-news@2026.08.1",
    });
    expect(JSON.stringify(offers[0]!.report)).not.toContain("edition"); // query never travels

    await orchestrator.decideReport(offers[0]!.key, true);
    expect(submitted).toHaveLength(1);
    expect(validateReport(JSON.parse(submitted[0]!))).toBe(true);
  });

  it("repeated load failures become tile-render-failure incidents", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(doc, { w: 1000, h: 625 });
    for (let i = 0; i < 3; i++) {
      await orchestrator.onSurfaceEvent({ type: "load-finished", id: "news", ok: false });
    }
    const offers = await orchestrator.pendingReports();
    expect(offers.some((o) => o.report.kind === "tile-render-failure")).toBe(true);
  });
});
