import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockListManager, DEFAULT_BLOCK_SOURCES, parseAbpHosts, parseHostsFile } from "../src/blocking.js";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const EASYLIST = `[Adblock Plus 2.0]
! Title: EasyList
||doubleclick.net^
||ads.example.com^$third-party
||example.com/banner.js
||scoped.example^$domain=foo.com
@@||allowed.example^
##.ad-banner
example.org##.sponsored
/adframe.
`;

const HOSTS = `# StevenBlack
127.0.0.1 localhost
0.0.0.0 hoax.example
0.0.0.0 scam.example # trailing comment
bare.example
`;

describe("list parsers (§5)", () => {
  it("takes only host-level ||host^ rules from ABP lists", () => {
    expect([...parseAbpHosts(EASYLIST)].sort()).toEqual(["ads.example.com", "doubleclick.net"]);
  });
  it("reads hosts files and skips localhost entries", () => {
    expect([...parseHostsFile(HOSTS)].sort()).toEqual(["bare.example", "hoax.example", "scam.example"]);
  });
});

function rig(opts: { fetch?: (url: string) => string } = {}) {
  const kv = new Map<string, string>();
  const applied: Array<{ id: string; name: string; hosts: string[] }> = [];
  const fetched: string[] = [];
  let cosmetics: string[] = [];
  const make = () =>
    new BlockListManager(
      {
        fetchStatic: (url) => {
          fetched.push(url);
          if (!opts.fetch) throw new Error("offline");
          return opts.fetch(url);
        },
        applyHosts: (id, name, hosts) => void applied.push({ id, name, hosts }),
        cosmeticsChanged: (sources) => void (cosmetics = sources.map((s) => s.attribution.name)),
        now: () => Date.now(),
      },
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    );
  return { make, kv, applied, fetched, cosmetics: () => cosmetics };
}

const SOURCES = DEFAULT_BLOCK_SOURCES.map((s) =>
  s.id === "ads" ? { ...s, bundled: "||bundled.example^\n", bundledSyncedAt: "2026-08-01" } : s,
);

describe("BlockListManager", () => {
  it("applies bundled baselines at boot, respects defaults, then syncs and persists", async () => {
    const { make, applied, fetched, kv, cosmetics } = rig({
      fetch: (url) => (url.includes("easylist.txt") ? EASYLIST : url.includes("easyprivacy") ? "[Adblock Plus 2.0]\n||tracker.example^\n" : HOSTS),
    });
    const m = make();
    await m.start(SOURCES);
    // Boot: bundled ads list applied; trackers has nothing yet; scam-disinfo is off.
    expect(applied.find((a) => a.id === "ads")?.hosts).toEqual(["bundled.example"]);
    expect(applied.find((a) => a.id === "scam-disinfo")?.hosts).toEqual([]);
    expect(m.status().find((s) => s.id === "ads")).toMatchObject({ origin: "bundled", entryCount: 1, enabled: true });
    expect(cosmetics()).toEqual(["EasyList"]); // ABP text doubles as a cosmetic source

    await vi.advanceTimersByTimeAsync(0); // never synced → sync now
    expect(fetched).toEqual(DEFAULT_BLOCK_SOURCES.map((s) => s.url)); // exactly the URLs, nothing appended
    expect(applied.at(-1)).toBeDefined();
    const ads = m.status().find((s) => s.id === "ads")!;
    expect(ads).toMatchObject({ origin: "synced", entryCount: 2, lastResult: "ok" });
    expect(m.blockedBy("static.doubleclick.net")).toBe("EasyList");
    expect(m.blockedBy("hoax.example")).toBeNull(); // synced but disabled by default
    expect(kv.get("blocking:text:ads")).toBe(EASYLIST); // §10: survives restart

    // Restart with the same store: synced text comes back before any fetch.
    const again = make();
    await again.start(SOURCES);
    expect(again.status().find((s) => s.id === "ads")).toMatchObject({ origin: "synced", entryCount: 2 });
    m.stop();
    again.stop();
  });

  it("enable/disable applies immediately and persists; unreachable keeps what it had", async () => {
    const { make, applied } = rig();
    const m = make();
    await m.start(SOURCES);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.status().find((s) => s.id === "ads")).toMatchObject({ lastResult: "unreachable", origin: "bundled", entryCount: 1 });
    expect(m.blockedBy("bundled.example")).toBe("EasyList");

    await m.setEnabled("scam-disinfo", true);
    expect(applied.at(-1)).toMatchObject({ id: "scam-disinfo", hosts: [] }); // enabled but no text yet
    await m.setEnabled("ads", false);
    expect(applied.at(-1)).toMatchObject({ id: "ads", hosts: [] });
    expect(m.blockedBy("bundled.example")).toBeNull();
    m.stop();
  });

  it("accepts user lists only at plain URLs, and removes cleanly", async () => {
    const { make, applied } = rig({ fetch: () => HOSTS });
    const m = make();
    await m.start([]);
    expect(await m.addCustom({ id: "mine", name: "Mine", maintainer: "me", url: "https://x.example/list.txt?u=1", license: "n/a", format: "hosts" })).toBe(false);
    expect(await m.addCustom({ id: "mine", name: "Mine", maintainer: "me", url: "https://x.example/list.txt", license: "n/a", format: "hosts" })).toBe(true);
    expect(applied.at(-1)).toMatchObject({ id: "mine", name: "Mine" });
    expect(applied.at(-1)!.hosts.sort()).toEqual(["bare.example", "hoax.example", "scam.example"]);
    await m.remove("mine");
    expect(applied.at(-1)).toMatchObject({ id: "mine", hosts: [] });
    expect(m.status()).toEqual([]);
    m.stop();
  });
});

describe("blocking via the orchestrator + remote (§5 transparency)", () => {
  it("exposes attribution, toggles, sync, and 'why' answers", async () => {
    const kv = new Map<string, string>();
    const applied: string[] = [];
    const drivers: Drivers = {
      surface: {
        create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
        navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
        resume: () => {}, setMuted: () => {},
      },
      net: {
        fetchStatic: (url) => (url.includes("easylist.txt") ? EASYLIST : ""),
        applyBlockHosts: (id, _name, hosts) => void applied.push(`${id}:${hosts.length}`),
      },
      store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    };
    const o = new Orchestrator(drivers);
    const api = new RemoteApi(o, drivers.store);
    const { token } = await api.mintPairing("http://frame");
    await o.startBlocking();
    await vi.advanceTimersByTimeAsync(0);

    const status = JSON.parse((await api.handle({ method: "GET", path: "/blocking", body: null, token })).body);
    const ads = status.sources.find((s: { id: string }) => s.id === "ads");
    expect(ads).toMatchObject({ name: "EasyList", maintainer: "EasyList community", license: "GPL-3.0 / CC BY-SA 3.0", enabled: true, entryCount: 2 });
    expect(ads.url).toBe("https://easylist.to/easylist/easylist.txt");

    const why = JSON.parse((await api.handle({ method: "GET", path: "/blocking/why/ads.doubleclick.net", body: null, token })).body);
    expect(why).toEqual({ host: "ads.doubleclick.net", blockedBy: "EasyList" });

    const off = await api.handle({ method: "PUT", path: "/blocking/ads", body: '{"enabled":false}', token });
    expect(off.status).toBe(200);
    expect(applied.at(-1)).toBe("ads:0");
    expect(o.cosmeticSources().map((s) => s.name)).toEqual([]); // veil follows the toggle
    expect((await api.handle({ method: "PUT", path: "/blocking/nope", body: '{"enabled":true}', token })).status).toBe(404);
  });
});
