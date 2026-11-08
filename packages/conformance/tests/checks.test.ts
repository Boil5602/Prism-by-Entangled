import { describe, expect, it } from "vitest";
import { Orchestrator, RemoteApi } from "prism-core";
import type { DashboardBundle, Drivers } from "prism-core";
import { formatReport, runConformance, type Transport } from "../src/checks.js";

/**
 * In-process conformance run: the kit's transport wired straight into
 * core's RemoteApi over fake drivers — proving the checks themselves
 * against the reference implementation.
 */
function rig() {
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
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const orchestrator = new Orchestrator(drivers);
  const remote = new RemoteApi(orchestrator, drivers.store);
  const transport: Transport = async (method, path, body, token) => {
    const res = await remote.handle({ method, path, body, token });
    return { status: res.status, body: res.body };
  };
  return { orchestrator, remote, transport };
}

const bundle: DashboardBundle = {
  dashboards: [
    {
      schema: "frame.dashboard/v0.1",
      id: "kitchen",
      name: "Kitchen",
      layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
      tiles: [
        { id: "yt", url: "https://yt.test", aspectHint: "16:9", aspectWeight: 1, audio: "exclusive" },
        { id: "cal", url: "https://cal.test", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute" },
        { id: "radio", url: "https://radio.test", aspectHint: "4:3", aspectWeight: 0.2, audio: "exclusive" },
      ],
    },
    {
      schema: "frame.dashboard/v0.1",
      id: "reading",
      name: "Reading",
      layout: { mode: "hero", hero: "cal", heroSize: 0.7, satellites: "auto", gap: 8 },
      tiles: [
        { id: "cal", url: "https://cal.test", aspectHint: "3:4", aspectWeight: 0.6, audio: "mute" },
        { id: "radio", url: "https://radio.test", aspectHint: "4:3", aspectWeight: 0.2, audio: "exclusive" },
      ],
    },
  ],
  carousel: { order: ["kitchen", "reading"], wrap: true },
};

describe("conformance kit (§23)", () => {
  it("the reference implementation passes every check", async () => {
    const { orchestrator, remote, transport } = rig();
    await orchestrator.loadBundle(bundle, { w: 1000, h: 625 });
    const { token } = await remote.mintPairing("http://frame.test");

    const results = await runConformance(transport, token, bundle);
    for (const r of results) {
      expect(r.pass, `${r.name}: ${r.detail}`).toBe(true);
    }
    expect(formatReport(results)).toContain("this shell is a Prism");
  });

  it("a shell with wrong rects fails rects-solver-identical", async () => {
    const { orchestrator, remote, transport } = rig();
    await orchestrator.loadBundle(bundle, { w: 1000, h: 625 });
    const { token } = await remote.mintPairing("http://frame.test");

    // Sabotage: the kit is handed a bundle whose hints differ from what the
    // device solved — reference rects won't match.
    const skewed: DashboardBundle = JSON.parse(JSON.stringify(bundle));
    skewed.dashboards[0]!.tiles[0]!.aspectHint = "1:1";

    const results = await runConformance(transport, token, skewed);
    const rects = results.find((r) => r.name === "rects-solver-identical");
    expect(rects?.pass).toBe(false);
    expect(formatReport(results)).toContain("not conformant");
  });

  it("a shell without auth fails auth-required", async () => {
    const { orchestrator, remote, transport } = rig();
    await orchestrator.loadBundle(bundle, { w: 1000, h: 625 });
    const { token } = await remote.mintPairing("http://frame.test");

    // Sabotage: transport that silently injects a valid token everywhere.
    const noAuth: Transport = (m, p, b, t) => transport(m, p, b, t ?? token);
    const results = await runConformance(noAuth, token, bundle);
    expect(results.find((r) => r.name === "auth-required")?.pass).toBe(false);
  });
});
