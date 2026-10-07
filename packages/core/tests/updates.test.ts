import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UpdateChecker,
  asUpdateChannel,
  channelLabel,
  compareVersions,
  isUnparameterized,
  lastScheduledAt,
  nextScheduledAt,
  parseManifest,
  scheduleMinutes,
} from "../src/updates.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe("compareVersions", () => {
  it("orders numerically with pre-releases first", () => {
    expect(compareVersions("1.2.3", "1.2.10")).toBe(-1);
    expect(compareVersions("2026.8.1", "2026.8.1")).toBe(0);
    expect(compareVersions("v1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });
});

describe("isUnparameterized (§28 × §22)", () => {
  it("accepts a bare static URL and rejects anything that could carry an id", () => {
    expect(isUnparameterized("https://cdn.entangled.world/prism/manifest.json")).toBe(true);
    expect(isUnparameterized("https://cdn.example/manifest.json?device=abc")).toBe(false);
    expect(isUnparameterized("https://cdn.example/manifest.json#v1")).toBe(false);
    expect(isUnparameterized("https://user:pw@cdn.example/m.json")).toBe(false);
    expect(isUnparameterized("not a url")).toBe(false);
  });
});

describe("parseManifest", () => {
  it("keeps only well-formed channel entries", () => {
    expect(parseManifest("nope")).toBeNull();
    expect(
      parseManifest(JSON.stringify({ stable: { version: "1.1.0", notes: "hi" }, beta: { nope: 1 }, x: 1 })),
    ).toEqual({ stable: { version: "1.1.0", notes: "hi" } });
  });
  it("carries a release's file list and its hash together, never one without the other (2026-10-06, incremental updates)", () => {
    const sha = "a".repeat(64);
    expect(parseManifest(JSON.stringify({ alpha: { version: "0.26.0", url: "https://x/z.zip", sha256: sha, files: "https://x/files/l.json", filesSha256: sha } }))?.alpha)
      .toEqual({ version: "0.26.0", url: "https://x/z.zip", sha256: sha, files: "https://x/files/l.json", filesSha256: sha });
    expect(parseManifest(JSON.stringify({ alpha: { version: "0.26.0", files: "https://x/files/l.json" } }))?.alpha).toEqual({ version: "0.26.0" });
  });
});

function rig(opts: { manifest?: () => string; apply?: "applied" | "staged" | "failed" | "throw" } = {}) {
  const kv = new Map<string, string>();
  const fetched: string[] = [];
  const applied: string[] = [];
  const make = () =>
    new UpdateChecker(
      {
        fetchManifest: (url) => {
          fetched.push(url);
          if (!opts.manifest) throw new Error("offline");
          return opts.manifest();
        },
        apply: (release) => {
          applied.push(release.version);
          if (opts.apply === "throw") throw new Error("boom");
          return opts.apply ?? "staged";
        },
        now: () => Date.now(),
      },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
  return { make, kv, fetched, applied };
}

const URL = "https://cdn.entangled.world/prism/manifest.json";
const manifest = { stable: { version: "1.1.0", notes: "Stable notes", url: "https://cdn/x.apk" }, beta: { version: "1.2.0-beta.1", notes: "Beta notes" } };

describe("UpdateChecker (§28)", () => {
  it("refuses a parameterized manifest URL outright", async () => {
    const { make } = rig();
    await expect(make().start({ currentVersion: "1.0.0", manifestUrl: `${URL}?v=1` })).rejects.toThrow(/unparameterized/);
  });

  it("checks on boot, compares locally, exposes the release, and re-checks daily", async () => {
    const { make, fetched } = rig({ manifest: () => JSON.stringify(manifest) });
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched).toEqual([URL]); // exactly the URL — nothing appended
    expect(u.status()).toMatchObject({ channel: "stable", available: { version: "1.1.0" }, lastResult: "ok" });

    await vi.advanceTimersByTimeAsync(86_400_000 + 10);
    expect(fetched).toHaveLength(2);
    u.stop();
  });

  it("an unreachable CDN is a status, not an error; an up-to-date frame shows nothing", async () => {
    const offline = rig();
    const u = offline.make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(u.status()).toMatchObject({ lastResult: "unreachable", available: null });
    u.stop();

    const current = rig({ manifest: () => JSON.stringify(manifest) });
    const v = current.make();
    await v.start({ currentVersion: "1.1.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(v.status().available).toBeNull();
    v.stop();
  });

  it("beta channel is opt-in and re-checks immediately", async () => {
    const { make } = rig({ manifest: () => JSON.stringify(manifest) });
    const u = make();
    await u.start({ currentVersion: "1.1.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(u.status().available).toBeNull();
    await u.setChannel("beta");
    expect(u.status().available).toMatchObject({ version: "1.2.0-beta.1" });
    u.stop();
  });

  it("installs only in the night window, remembers the staged release, and surfaces notes after the reboot", async () => {
    const { make, applied, kv } = rig({ manifest: () => JSON.stringify(manifest), apply: "staged" });
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual([]); // nothing during the day
    expect(await u.onNightWindow()).toBe("staged");
    expect(applied).toEqual(["1.1.0"]);
    expect(u.status()).toMatchObject({ staged: { version: "1.1.0" }, available: null });
    expect(await u.onNightWindow()).toBe("staged"); // idempotent — no re-apply
    expect(applied).toHaveLength(1);
    u.stop();

    // "Reboot" into the new version with the same store (§10 — never wiped).
    const next = new UpdateChecker(
      { fetchManifest: () => JSON.stringify(manifest), apply: () => "failed", now: () => Date.now() },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    await next.start({ currentVersion: "1.1.0", manifestUrl: URL });
    expect(next.status()).toMatchObject({ staged: null, pendingNotes: { version: "1.1.0", notes: "Stable notes" } });
    await next.dismissNotes();
    expect(next.status().pendingNotes).toBeNull();
    next.stop();
  });

  it("a failed apply keeps the release available for the next window", async () => {
    const { make } = rig({ manifest: () => JSON.stringify(manifest), apply: "throw" });
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(await u.onNightWindow()).toBe("failed");
    expect(u.status()).toMatchObject({ available: { version: "1.1.0" }, staged: null });
    u.stop();
  });
});

describe("tracks (2026-10-05: alpha, beta, full)", () => {
  it("reads an alpha entry and follows it when the shell is built on alpha", async () => {
    const m = parseManifest(JSON.stringify({ alpha: { version: "0.23.0" }, stable: { version: "0.22.0" } }));
    expect(m?.alpha?.version).toBe("0.23.0");
    expect(m?.stable?.version).toBe("0.22.0");
    const u = new UpdateChecker({ fetchManifest: () => JSON.stringify({ alpha: { version: "0.23.0" }, stable: { version: "0.22.0" } }), apply: () => "staged", now: () => 0 });
    await u.start({ currentVersion: "0.22.0", manifestUrl: "https://example.test/manifest.json", channel: "alpha" });
    const st = await u.check();
    expect(st.channel).toBe("alpha");
    expect(st.available?.version).toBe("0.23.0");
  });
  it("names the tracks as a person reads them and refuses an unknown one", () => {
    expect(channelLabel("alpha")).toBe("Alpha");
    expect(channelLabel("beta")).toBe("Beta");
    expect(channelLabel("stable")).toBe("Full");
    expect(asUpdateChannel("nightly")).toBe("stable");
    expect(asUpdateChannel("alpha")).toBe("alpha");
  });
});

describe("a scheduled check (2026-10-06, \"Let the user check for updates at a scheduled time\")", () => {
  // the clock stands at Monday 24 August 2026, 12:00 local (beforeEach)
  it("the next time and the time owed are on the PC's own clock, every day or one day a week", () => {
    const now = Date.now();
    expect(new Date(nextScheduledAt({ at: "04:00" }, now)!).toString()).toBe(new Date(2026, 7, 25, 4, 0).toString());
    expect(new Date(lastScheduledAt({ at: "04:00" }, now)!).toString()).toBe(new Date(2026, 7, 24, 4, 0).toString());
    expect(new Date(nextScheduledAt({ at: "18:30" }, now)!).toString()).toBe(new Date(2026, 7, 24, 18, 30).toString());
    expect(new Date(nextScheduledAt({ at: "04:00", weekday: 3 }, now)!).toString()).toBe(new Date(2026, 7, 26, 4, 0).toString());   // Wednesday
    expect(new Date(lastScheduledAt({ at: "04:00", weekday: 6 }, now)!).toString()).toBe(new Date(2026, 7, 22, 4, 0).toString());   // last Saturday
    expect(scheduleMinutes({ at: "25:00" })).toBeNull();
  });

  it("a time missed while the PC was off is made up at the start; otherwise the check waits for its time, and runs at it", async () => {
    const { make, fetched, kv } = rig({ manifest: () => JSON.stringify(manifest) });
    kv.set("updates:state", JSON.stringify({ lastCheck: new Date(2026, 7, 23, 5, 0).toISOString() }));   // yesterday 05:00, before today's 04:00
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, schedule: { at: "04:00" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched).toHaveLength(1);   // owed: made up at once
    expect(new Date(u.status().nextCheck!).toString()).toBe(new Date(2026, 7, 25, 4, 0).toString());
    await vi.advanceTimersByTimeAsync(new Date(2026, 7, 25, 4, 0).getTime() - Date.now() - 1000);
    expect(fetched).toHaveLength(1);   // not before its time
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetched).toHaveLength(2);   // at it
    u.stop();
  });

  it("a change takes effect at once; Never stops the checks but Check now still asks", async () => {
    const { make, fetched } = rig({ manifest: () => JSON.stringify(manifest) });
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched).toHaveLength(1);
    u.setSchedule({ at: "13:00" });
    expect(new Date(u.status().nextCheck!).toString()).toBe(new Date(2026, 7, 24, 13, 0).toString());
    u.setSchedule(null, false);
    expect(u.status()).toMatchObject({ enabled: false, nextCheck: null });
    await vi.advanceTimersByTimeAsync(3 * 86_400_000);
    expect(fetched).toHaveLength(1);
    await u.check();
    expect(fetched).toHaveLength(2);
    u.stop();
  });
});
