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
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, auto: false });
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
    await u.start({ currentVersion: "1.1.0", manifestUrl: URL, auto: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(u.status().available).toBeNull();
    await u.setChannel("beta");
    expect(u.status().available).toMatchObject({ version: "1.2.0-beta.1" });
    u.stop();
  });

  it("installs only in the night window, remembers the staged release, and surfaces notes after the reboot", async () => {
    const { make, applied, kv } = rig({ manifest: () => JSON.stringify(manifest), apply: "staged" });
    const u = make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, auto: false });   // the switch off: the night window alone installs
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
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, auto: false });
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
    await u.start({ currentVersion: "0.22.0", manifestUrl: "https://example.test/manifest.json", channel: "alpha", auto: false });
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

// B-458 (2026-10-30, "Is there an upgrade process running in the background or must Prism be open overnight"): the section-28 night window
// had no door - the silent install hung off a section-24 schedule entry no Prism could make, so every release waited for a press.
describe("install on its own (B-458)", () => {
  it("a release found by a check is staged at once; with the switch off the flag waits as before", async () => {
    const on = rig({ manifest: () => JSON.stringify(manifest), apply: "staged" });
    const u = on.make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(on.applied).toEqual(["1.1.0"]);
    expect(u.status()).toMatchObject({ staged: { version: "1.1.0" }, available: null, auto: true, restart: "next-start" });   // no restart hook: the next start
    // the next check finds the same release: already staged, not found again, not downloaded again
    await u.check();
    expect(on.applied).toHaveLength(1);
    expect(u.status()).toMatchObject({ staged: { version: "1.1.0" }, available: null });
    u.stop();
    const off = rig({ manifest: () => JSON.stringify(manifest), apply: "staged" });
    const v = off.make();
    await v.start({ currentVersion: "1.0.0", manifestUrl: URL, auto: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(off.applied).toEqual([]);
    expect(v.status()).toMatchObject({ available: { version: "1.1.0" }, staged: null, auto: false, restart: null });
    // the switch turned on with a release already found: staged now
    v.setAuto(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(off.applied).toEqual(["1.1.0"]);
    v.stop();
  });

  it("Never: a check by hand finds the release but downloads nothing on its own", async () => {
    const r = rig({ manifest: () => JSON.stringify(manifest), apply: "staged" });
    const u = r.make();
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, enabled: false });
    await u.check();
    expect(r.applied).toEqual([]);
    expect(u.status()).toMatchObject({ available: { version: "1.1.0" }, staged: null });
    u.stop();
  });

  it("restarts into the staged release only at a quiet moment inside the three hours after the check's time, on the PC's clock", async () => {
    // the clock stands at Monday 24 August 2026, 12:00 local (beforeEach)
    const kv = new Map<string, string>(); let quiet = false; const restarted: number[] = []; const applied: string[] = [];
    const u = new UpdateChecker(
      { fetchManifest: () => JSON.stringify(manifest), apply: (r) => { applied.push(r.version); return "staged"; }, now: () => Date.now(), restart: () => { restarted.push(Date.now()); }, quiet: () => quiet },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, schedule: { at: "04:00" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual(["1.1.0"]);
    expect(u.status()).toMatchObject({ staged: { version: "1.1.0" }, restart: "quiet" });
    expect(u.inRestartWindow(new Date(2026, 7, 25, 5, 30).getTime())).toBe(true);
    expect(u.inRestartWindow(new Date(2026, 7, 25, 7, 30).getTime())).toBe(false);
    expect(u.inRestartWindow(new Date(2026, 7, 25, 3, 59).getTime())).toBe(false);
    // quiet at noon: not the window
    quiet = true;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(restarted).toEqual([]);
    // the window, but a title plays: waits
    quiet = false;
    await vi.advanceTimersByTimeAsync(new Date(2026, 7, 25, 4, 30).getTime() - Date.now());
    expect(restarted).toEqual([]);
    expect(applied).toHaveLength(1);   // the 04:00 check found the staged release and left it be
    // the title ends: within a minute Prism restarts into the staged release
    quiet = true;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(restarted).toHaveLength(1);
    expect(new Date(restarted[0]!).getHours()).toBe(4);
    u.stop();
  });

  it("without a schedule the window follows 04:00; the switch off disarms the restart", async () => {
    let quiet = true; const restarted: number[] = [];
    const u = new UpdateChecker({ fetchManifest: () => JSON.stringify(manifest), apply: () => "staged", now: () => Date.now(), restart: () => { restarted.push(Date.now()); }, quiet: () => quiet });
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(u.inRestartWindow(new Date(2026, 7, 25, 6, 59).getTime())).toBe(true);
    expect(u.inRestartWindow(new Date(2026, 7, 25, 12, 0).getTime())).toBe(false);
    u.setAuto(false);
    await vi.advanceTimersByTimeAsync(new Date(2026, 7, 25, 5, 0).getTime() - Date.now());
    expect(restarted).toEqual([]);
    expect(u.status().restart).toBe("next-start");
    u.stop();
  });
});

// the security review of the auto-install change (2026-10-30): one apply at a time, and a staged release the track no longer offers is let go
describe("install on its own: one apply at a time, and a staged release let go (security review 2026-10-30)", () => {
  function rig2(manifestRef: { text: string }) {
    const kv = new Map<string, string>(); const applied: string[] = []; let discarded = 0; const pending: Array<(v: "staged") => void> = [];
    const u = new UpdateChecker(
      {
        fetchManifest: () => manifestRef.text,
        apply: (r) => { applied.push(r.version); return new Promise<"staged">((res) => pending.push(res)); },
        now: () => Date.now(),
        discard: () => { discarded++; },
      },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    return { u, applied, pending, get discarded() { return discarded; } };
  }
  it("two asks while an apply is in flight run one apply, and both hear its answer", async () => {
    const m = { text: JSON.stringify(manifest) };
    const { u, applied, pending } = rig2(m);
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL, auto: false });
    await vi.advanceTimersByTimeAsync(0);
    const a = u.onNightWindow(); const b = u.onNightWindow();
    expect(applied).toEqual(["1.1.0"]);
    pending[0]!("staged");
    expect(await a).toBe("staged"); expect(await b).toBe("staged");
    expect(applied).toHaveLength(1);
    u.stop();
  });
  it("a staged release the track no longer offers is let go and the shell removes it; a track change does the same", async () => {
    const m = { text: JSON.stringify(manifest) };
    const r = rig2(m);
    await r.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    r.pending[0]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.1.0" } });
    // withdrawn: the track has no entry at the next check
    m.text = JSON.stringify({ beta: manifest.beta });
    await r.u.check();
    expect(r.u.status()).toMatchObject({ staged: null, available: null });
    expect(r.discarded).toBe(1);
    // the track moved back to an older release: let go too, and the older one (still newer than this Prism) is staged in its place
    m.text = JSON.stringify(manifest);
    await r.u.check(); r.pending[1]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.1.0" } });
    m.text = JSON.stringify({ stable: { version: "1.0.5", notes: "pulled back" } });
    await r.u.check(); r.pending[2]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.discarded).toBe(2);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.0.5" } });
    // a track change lets the staged release go before the new track is read
    m.text = JSON.stringify(manifest);
    await r.u.setChannel("beta"); r.pending[3]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.discarded).toBe(3);
    expect(r.u.status()).toMatchObject({ channel: "beta", staged: { version: "1.2.0-beta.1" } });
    r.u.stop();
  });
});

// the second security review (2026-10-30): an apply is tied to the offer it started from, and a discard the shell could not finish is asked again
describe("install on its own: the offer that moved during a download, and a discard asked again", () => {
  function rig3(manifestRef: { text: string }) {
    const kv = new Map<string, string>(); const applied: string[] = []; const pending: Array<(v: "staged") => void> = [];
    const d = { calls: 0, ok: true };
    const u = new UpdateChecker(
      {
        fetchManifest: () => manifestRef.text,
        apply: (r) => { applied.push(r.version); return new Promise<"staged">((res) => pending.push(res)); },
        now: () => Date.now(),
        discard: () => { d.calls++; return d.ok; },
      },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    return { u, applied, pending, d, kv };
  }
  it("withdrawn while it downloaded: never recorded, its copy removed", async () => {
    const m = { text: JSON.stringify(manifest) };
    const r = rig3(m);
    await r.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.applied).toEqual(["1.1.0"]);
    m.text = JSON.stringify({ beta: manifest.beta });   // the track's entry gone before the download ends
    await r.u.check();
    r.pending[0]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: null, available: null });
    expect(r.d.calls).toBe(1);
    expect(r.applied).toHaveLength(1);
    r.u.stop();
  });
  it("replaced by a newer offer while it downloaded: the old copy goes and the newer one is staged in its turn", async () => {
    const m = { text: JSON.stringify(manifest) };
    const r = rig3(m);
    await r.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    m.text = JSON.stringify({ stable: { version: "1.3.0", notes: "newer" } });
    await r.u.check();
    expect(r.applied).toEqual(["1.1.0"]);   // the newer one waits for the apply in flight
    r.pending[0]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.d.calls).toBe(1);
    expect(r.applied).toEqual(["1.1.0", "1.3.0"]);
    r.pending[1]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.3.0" }, available: null });
    r.u.stop();
  });
  it("a discard the shell could not finish is kept pending and asked again at the next check and the next start", async () => {
    const m = { text: JSON.stringify(manifest) };
    const r = rig3(m);
    await r.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    r.pending[0]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.1.0" } });
    r.d.ok = false;
    m.text = JSON.stringify({ beta: manifest.beta });
    await r.u.check();
    expect(r.u.status()).toMatchObject({ staged: null, discardPending: true });
    expect(r.d.calls).toBe(1);
    await r.u.check();
    expect(r.d.calls).toBe(2);   // asked again
    expect(r.u.status().discardPending).toBe(true);
    r.u.stop();
    // the next start (the same store) asks once more; the shell manages this time
    const again = rig3(m); again.d.ok = true; for (const [k, v] of r.kv) again.kv.set(k, v);
    await again.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    expect(again.d.calls).toBe(1);
    expect(again.u.status().discardPending).toBe(false);
    again.u.stop();
  });
  it("a pending discard never touches a release core records now: a newer one staged clears it", async () => {
    const m = { text: JSON.stringify(manifest) };
    const r = rig3(m);
    await r.u.start({ currentVersion: "1.0.0", manifestUrl: URL });
    await vi.advanceTimersByTimeAsync(0);
    r.pending[0]!("staged"); await vi.advanceTimersByTimeAsync(0);
    r.d.ok = false;
    m.text = JSON.stringify({ beta: manifest.beta });
    await r.u.check();
    expect(r.u.status()).toMatchObject({ staged: null, discardPending: true });
    expect(r.d.calls).toBe(1);
    // a newer release offered: its staging clears the old folder on the shell, and the pending mark with it
    m.text = JSON.stringify({ stable: { version: "1.3.0", notes: "newer" } });
    await r.u.check();   // the retry (2) fails again, then the apply starts
    expect(r.d.calls).toBe(2);
    expect(r.applied).toEqual(["1.1.0", "1.3.0"]);
    r.pending[1]!("staged"); await vi.advanceTimersByTimeAsync(0);
    expect(r.u.status()).toMatchObject({ staged: { version: "1.3.0" }, discardPending: false });
    await r.u.check();
    expect(r.d.calls).toBe(2);   // nothing asked of the shell against the release core records
    r.u.stop();
  });
  it("a failed apply lets go of a release the attempt overwrote on the shell, and has the folder cleared at the next check before trying again", async () => {
    const m = { text: JSON.stringify(manifest) };
    const kv = new Map<string, string>(); const applied: string[] = []; let discards = 0; let failVersion: string | null = null;
    const u = new UpdateChecker(
      { fetchManifest: () => m.text, apply: (r) => { applied.push(r.version); if (r.version === failVersion) throw new Error("hash mismatch"); return "staged"; }, now: () => Date.now(), discard: () => { discards++; return true; } },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL }); await vi.advanceTimersByTimeAsync(0);
    expect(u.status()).toMatchObject({ staged: { version: "1.1.0" } });
    failVersion = "1.3.0"; m.text = JSON.stringify({ stable: { version: "1.3.0" } });
    await u.check(); await vi.advanceTimersByTimeAsync(0);
    expect(applied).toEqual(["1.1.0", "1.3.0"]);
    expect(discards).toBe(1);   // the shell asked at once to clear whatever its folder holds
    expect(u.status()).toMatchObject({ staged: null, discardPending: false, available: { version: "1.3.0" }, restart: null });
    failVersion = null;
    await u.check(); await vi.advanceTimersByTimeAsync(0);
    expect(discards).toBe(1);
    expect(applied).toEqual(["1.1.0", "1.3.0", "1.3.0"]);
    expect(u.status()).toMatchObject({ staged: { version: "1.3.0" }, discardPending: false });
    u.stop();
  });
  it("a failed apply whose discard the shell could not finish keeps it pending", async () => {
    const m = { text: JSON.stringify({ stable: { version: "1.3.0" } }) };
    const kv = new Map<string, string>(); let discards = 0;
    const u = new UpdateChecker(
      { fetchManifest: () => m.text, apply: () => { throw new Error("hash mismatch"); }, now: () => Date.now(), discard: () => { discards++; return false; } },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
    await u.start({ currentVersion: "1.0.0", manifestUrl: URL }); await vi.advanceTimersByTimeAsync(0);
    expect(discards).toBe(1);
    expect(u.status()).toMatchObject({ staged: null, discardPending: true });
    u.stop();
  });
});
