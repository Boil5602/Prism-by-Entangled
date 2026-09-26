import { describe, expect, it } from "vitest";
import {
  DEVICE_PROFILES,
  exportLayout,
  fitReport,
  importLayout,
  importPlan,
} from "../src/sharing.js";
import { layoutDashboard } from "../src/layout.js";
import type { DashboardDocument } from "../src/types.js";

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen-main",
  name: "Kitchen Command",
  theme: { background: "#0e0e10" },
  audio: { policy: "exclusive" },
  layout: { mode: "hero", hero: "yt", heroSize: 0.62, satellites: "auto", gap: 8 },
  inputs: { KEY_1: { action: "layout", value: "kitchen-main" } },
  schedule: [{ at: "22:30", action: "dim", value: 0.25 }],
  tiles: [
    {
      id: "yt",
      url: "https://www.youtube.com/feed?authuser=2",
      adapter: "youtube",
      aspectHint: "16:9",
      aspectWeight: 1,
      audio: "exclusive",
      persist: true,
      profile: "mark",
    },
    {
      id: "cal",
      url: "https://app.merge.family/calendar?family=graff&token=abc123",
      aspectHint: "3:4",
      aspectWeight: 0.6,
      audio: "mute",
      profile: "family",
      refresh: 300,
    },
    {
      id: "cams",
      url: "https://cams.graff-home.internal/dash?key=s3cret",
      aspectHint: "4:3",
      aspectWeight: 0.5,
      audio: "mute",
    },
    { id: "poster", launch: { package: "com.netflix.ninja" }, audio: "mute" },
  ],
};

describe("export sanitization (§15 normative)", () => {
  const shared = exportLayout(doc, { remixOf: "prism.entangled.world/l/abc" });

  it("profiles never travel", () => {
    expect(JSON.stringify(shared)).not.toContain("profile");
    expect(JSON.stringify(shared)).not.toContain("mark");
  });

  it("known first-party URLs become named slots", () => {
    const cal = shared.tiles.find((t) => t.id === "cal")!;
    expect(cal.slot).toBe("calendar");
    expect(cal.url).toBeUndefined();
    expect(JSON.stringify(cal)).not.toContain("graff");
    expect(JSON.stringify(cal)).not.toContain("abc123");
  });

  it("custom URLs reduce to origin-only suggestions", () => {
    const cams = shared.tiles.find((t) => t.id === "cams")!;
    expect(cams.slot).toBe("custom");
    expect(cams.suggestedUrl).toBe("https://cams.graff-home.internal");
    expect(JSON.stringify(cams)).not.toContain("s3cret");
    expect(JSON.stringify(cams)).not.toContain("/dash");
  });

  it("public adapter tiles keep origin+path, query stripped", () => {
    const yt = shared.tiles.find((t) => t.id === "yt")!;
    expect(yt.url).toBe("https://www.youtube.com/feed");
    expect(yt.slot).toBeUndefined();
    expect(JSON.stringify(yt)).not.toContain("authuser");
  });

  it("keeps the transferable substance", () => {
    expect(shared.layout).toEqual(doc.layout);
    expect(shared.inputs).toEqual(doc.inputs);
    expect(shared.schedule).toEqual(doc.schedule);
    expect(shared.remixOf).toBe("prism.entangled.world/l/abc");
    const yt = shared.tiles.find((t) => t.id === "yt")!;
    expect(yt.aspectHint).toBe("16:9");
    expect(yt.persist).toBe(true);
    const poster = shared.tiles.find((t) => t.id === "poster")!;
    expect(poster.launch).toEqual({ package: "com.netflix.ninja" });
  });
});

describe("import = fill the slots (§15)", () => {
  const shared = exportLayout(doc);

  it("importPlan lists exactly the slot tiles", () => {
    expect(importPlan(shared)).toEqual([
      { tile: "cal", slot: "calendar" },
      { tile: "cams", slot: "custom", suggestedUrl: "https://cams.graff-home.internal" },
    ]);
  });

  it("filled slots produce a working document; unfilled are reported", () => {
    const { doc: imported, missing } = importLayout(shared, "our-kitchen", {
      cal: "https://app.merge.family/calendar?family=smith",
    });
    expect(missing).toEqual(["cams"]);
    expect(imported.id).toBe("our-kitchen");
    expect(imported.tiles.map((t) => t.id)).toEqual(["yt", "cal", "poster"]);
    expect(imported.tiles.find((t) => t.id === "cal")!.url).toBe(
      "https://app.merge.family/calendar?family=smith",
    );
    // and it solves — same layout geometry as the original arrangement
    expect(Object.keys(layoutDashboard(imported, { w: 1000, h: 625 }))).toContain("yt");
  });

  it("round-trips the geometry: import of an export solves identically", () => {
    const { doc: imported } = importLayout(shared, "copy", {
      cal: "https://x.test/cal",
      cams: "https://y.test/cams",
    });
    expect(layoutDashboard(imported, { w: 1000, h: 625 })).toEqual(
      layoutDashboard(doc, { w: 1000, h: 625 }),
    );
  });
});

describe("fit scores (§20 geometry check)", () => {
  it("reports per-profile scores across the standard device sweep", () => {
    const report = fitReport(doc);
    expect(report.map((r) => r.profile)).toEqual(DEVICE_PROFILES.map((p) => p.id));
    for (const entry of report) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
      expect(["excellent", "good", "poor"]).toContain(entry.grade);
    }
  });

  it("is deterministic", () => {
    expect(fitReport(doc)).toEqual(fitReport(doc));
  });

  it("a landscape-heavy layout fits landscape better than portrait", () => {
    const landscapeHeavy: DashboardDocument = {
      ...doc,
      tiles: [
        { id: "a", url: "https://a.test", aspectHint: "16:9", aspectWeight: 1 },
        { id: "b", url: "https://b.test", aspectHint: "16:9", aspectWeight: 1 },
      ],
    };
    const report = fitReport(landscapeHeavy);
    const tv = report.find((r) => r.profile === "tv")!;
    const portrait = report.find((r) => r.profile === "portrait")!;
    expect(tv.score).toBeGreaterThan(portrait.score);
  });

  it("flags sliver tiles and grades them poor", () => {
    // A 12×8 grid with a single-cell tile: ~83-unit cells are unreadable.
    const degenerate: DashboardDocument = {
      schema: "frame.dashboard/v0.1",
      id: "d",
      name: "D",
      grid: { cols: 12, rows: 8, gap: 8 },
      tiles: [
        { id: "main", area: "1 / 2 / 9 / 13", url: "https://a.test", aspectHint: "16:9" },
        { id: "tiny", area: "1 / 1 / 2 / 2", url: "https://b.test", aspectHint: "1:1" },
      ],
    };
    const monitor = fitReport(degenerate).find((r) => r.profile === "monitor")!;
    expect(monitor.sliverTiles).toEqual(["tiny"]);
    expect(monitor.grade).toBe("poor");
  });
});
