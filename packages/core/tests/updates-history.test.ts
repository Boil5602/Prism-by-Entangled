import { describe, expect, it } from "vitest";
import { UpdateChecker, parseManifest } from "../src/updates.js";

// the changelog feed (2026-10-07, "can we have the option to see a change log feed on the side of that modal window")
const entry = {
  version: "0.27.0", date: "2026-10-08", notes: "Newest.",
  history: [
    { version: "0.27.0", date: "2026-10-08", notes: "Newest." },
    { version: "0.26.26", date: "2026-10-06", notes: "Breaks covered." },
    { version: "bad" },
    "not an entry",
    { version: "0.26.25", notes: "Peacock." },
  ],
};

describe("the manifest's changelog history", () => {
  it("reads well-formed entries newest first and skips the rest", () => {
    const m = parseManifest(JSON.stringify({ alpha: entry }));
    expect(m?.alpha?.date).toBe("2026-10-08");
    expect(m?.alpha?.history?.map((h) => h.version)).toEqual(["0.27.0", "0.26.26", "0.26.25"]);
    expect(m?.alpha?.history?.[2]).toEqual({ version: "0.26.25", notes: "Peacock." });
  });

  it("reads at most forty entries", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ version: "0.1." + i, notes: "n" }));
    expect(parseManifest(JSON.stringify({ alpha: { version: "1.0.0", history: many } }))?.alpha?.history?.length).toBe(40);
  });

  it("a manifest without history still reads", () => {
    expect(parseManifest(JSON.stringify({ alpha: { version: "1.0.0", notes: "x" } }))?.alpha?.history).toBeUndefined();
  });

  it("keeps the track's latest entry when this Prism is already on it, so the feed has something to show", async () => {
    const u = new UpdateChecker({ fetchManifest: () => JSON.stringify({ alpha: entry }), apply: () => "staged", now: () => 0 });
    await u.start({ currentVersion: "0.27.0", manifestUrl: "https://example.test/manifest.json", channel: "alpha" });
    const st = await u.check();
    expect(st.available).toBeNull();
    expect(st.latest?.version).toBe("0.27.0");
    expect(st.latest?.history?.length).toBe(3);
  });

  it("a newer release is both available and latest", async () => {
    const u = new UpdateChecker({ fetchManifest: () => JSON.stringify({ alpha: entry }), apply: () => "staged", now: () => 0 });
    await u.start({ currentVersion: "0.26.25", manifestUrl: "https://example.test/manifest.json", channel: "alpha" });
    const st = await u.check();
    expect(st.available?.version).toBe("0.27.0");
    expect(st.latest?.version).toBe("0.27.0");
  });
});
