import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

function rig() {
  const calls: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: (opts) => void calls.push({ op: "create", id: opts.id, launch: opts.launch ?? null }),
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: (id) => void calls.push({ op: "navigate", id }),
      inject: () => {},
      freeze: () => {},
      reveal: (id) => void calls.push({ op: "reveal", id }),
      suspend: () => {},
      resume: () => {},
      setMuted: () => {},
    },
    media: {
      launch: (pkg, deepLink) => void calls.push({ op: "launch", pkg, deepLink: deepLink ?? null }),
    },
    store: { get: () => null, set: () => {} },
  };
  return { calls, orchestrator: new Orchestrator(drivers) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "tv",
  name: "TV",
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  tiles: [
    { id: "yt", url: "https://yt.test", audio: "exclusive" },
    {
      id: "netflix",
      launch: { package: "com.netflix.ninja", deepLink: "netflix://title/1234" },
      audio: "mute",
      aspectHint: "16:9",
    },
  ],
};

const VIEWPORT = { w: 1000, h: 625 };

describe("launch tiles (§12)", () => {
  it("posters are created with the package, revealed immediately, never navigated", async () => {
    const { calls, orchestrator } = rig();
    await orchestrator.load(doc, VIEWPORT);
    expect(calls.find((c) => c.op === "create" && c.id === "netflix")).toMatchObject({
      launch: "com.netflix.ninja",
    });
    expect(calls.some((c) => c.op === "reveal" && c.id === "netflix")).toBe(true);
    expect(calls.filter((c) => c.op === "navigate").map((c) => c.id)).toEqual(["yt"]);
  });

  it("tapping the poster launches the app with its deep link", async () => {
    const { calls, orchestrator } = rig();
    await orchestrator.load(doc, VIEWPORT);
    calls.length = 0;
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "netflix" });
    expect(calls).toContainEqual({
      op: "launch",
      pkg: "com.netflix.ninja",
      deepLink: "netflix://title/1234",
    });
  });

  it("interaction on web tiles never launches anything", async () => {
    const { calls, orchestrator } = rig();
    await orchestrator.load(doc, VIEWPORT);
    calls.length = 0;
    await orchestrator.onSurfaceEvent({ type: "interaction", id: "yt" });
    expect(calls.some((c) => c.op === "launch")).toBe(false);
  });

  it("the remote launch command works; on web tiles it refuses", async () => {
    const { calls, orchestrator } = rig();
    await orchestrator.load(doc, VIEWPORT);
    calls.length = 0;
    expect(await orchestrator.tileCommand("netflix", "launch")).toBe("ok");
    expect(calls.some((c) => c.op === "launch")).toBe(true);
    expect(await orchestrator.tileCommand("yt", "launch")).toBe("unknown-cmd");
  });
});
