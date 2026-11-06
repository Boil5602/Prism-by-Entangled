import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AV_OFFSET_MS, PrivateListening, UNNAMED_LISTENER, avOffsetJs, listeningChips } from "../src/listening.js";
import type { ListenerInfo } from "../src/listening.js";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 20, 0, 0));
});
afterEach(() => vi.useRealTimers());

function rig(transports: Array<"webrtc" | "http"> = ["webrtc", "http"]) {
  const log: string[] = [];
  const pl = new PrivateListening(
    {
      capture: (enable) => void log.push(`capture:${enable}`),
      serve: (t, enable) => void log.push(`serve:${t}:${enable}`),
      speakers: (mode) => void log.push(`speakers:${mode}`),
      now: () => Date.now(),
    },
    transports,
    { heartbeatMs: 1000, dropAfterMs: 3000, graceMs: 10_000 },
  );
  return { pl, log };
}

describe("PrivateListening (§14 dual transport)", () => {
  it("one capture mix feeds both transports; each starts with its first listener and stops with its last", async () => {
    const { pl, log } = rig();
    await pl.setListening("android-phone", true, undefined, "webrtc");
    expect(log).toEqual(["capture:true", "serve:webrtc:true", "speakers:mute"]);
    await pl.setListening("iphone", true, "duck", "http");
    expect(log.slice(3)).toEqual(["serve:http:true", "speakers:duck"]); // no second capture
    expect(pl.status()).toMatchObject({ active: true, activeTransport: "http", transports: ["webrtc", "http"] });
    expect(pl.activeOffsetMs()).toBe(DEFAULT_AV_OFFSET_MS.http); // slowest listener governs lip-sync

    await pl.setListening("iphone", false);
    expect(log.slice(5)).toEqual(["serve:http:false", "speakers:duck"]);
    expect(pl.activeOffsetMs()).toBe(DEFAULT_AV_OFFSET_MS.webrtc);
    await pl.setListening("android-phone", false);
    expect(log.slice(7)).toEqual(["serve:webrtc:false", "capture:false", "speakers:normal"]);
    expect(pl.status()).toMatchObject({ active: false, listeners: [], mode: null, paused: false });
  });

  it("refuses transports the shell does not serve, and is honest when unsupported", async () => {
    const { pl } = rig(["webrtc"]);
    expect(await pl.setListening("iphone", true, undefined, "http")).toBe(false);
    const none = rig([]);
    expect(await none.pl.setListening("p", true)).toBe(false);
    expect(none.pl.status().supported).toBe(false);
  });

  it("peer-drop grace: an unexpected loss keeps speakers muted; explicit resume or expiry restores them", async () => {
    const { pl, log } = rig();
    await pl.setListening("iphone", true, undefined, "http");
    log.length = 0;
    await pl.onListenerLost("iphone");
    expect(pl.status()).toMatchObject({ active: false, paused: true, listeners: [{ id: "iphone", state: "paused" }] });
    expect(log).toEqual(["serve:http:false", "capture:false", "speakers:mute"]); // NOT normal
    expect(pl.status().graceUntil).toBe(new Date(Date.now() + 10_000).toISOString());

    // Time passes inside grace: still muted.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log.filter((l) => l === "speakers:normal")).toEqual([]);

    // The phone comes back (heartbeat) → listening resumes, grace cleared.
    await pl.heartbeat("iphone");
    expect(pl.status()).toMatchObject({ active: true, paused: false });
    expect(log.slice(-3)).toEqual(["capture:true", "serve:http:true", "speakers:mute"]);

    // Lose it again and let grace expire → speakers back, paused phone dropped.
    log.length = 0;
    await pl.onListenerLost("iphone");
    await vi.advanceTimersByTimeAsync(10_001);
    expect(log.at(-1)).toBe("speakers:normal");
    expect(pl.status()).toMatchObject({ active: false, paused: false, listeners: [] });
  });

  it("explicit resume ends grace immediately; explicit leave never triggers grace", async () => {
    const { pl, log } = rig();
    await pl.setListening("a", true);
    await pl.onListenerLost("a");
    await pl.resumeSpeakers();
    expect(log.at(-1)).toBe("speakers:normal");
    expect(pl.status().listeners).toEqual([]);

    log.length = 0;
    await pl.setListening("b", true);
    await pl.setListening("b", false); // by choice
    expect(log.at(-1)).toBe("speakers:normal");
    expect(pl.status().paused).toBe(false);
  });

  it("missed heartbeats count as an unexpected loss", async () => {
    const { pl, log } = rig();
    await pl.setListening("a", true, undefined, "webrtc");
    await vi.advanceTimersByTimeAsync(2_000);
    await pl.heartbeat("a");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pl.status().paused).toBe(false); // beat 2s ago, within the 3s window
    await vi.advanceTimersByTimeAsync(2_500);
    expect(pl.status()).toMatchObject({ paused: true, listeners: [{ id: "a", state: "paused" }] });
    expect(log.at(-1)).toBe("speakers:mute");
    await pl.stop();
  });

  it("A/V offset is per transport and clamped; the active transport is the default target", async () => {
    const { pl } = rig();
    expect(pl.setAvOffset(9_999, "http")).toBe(5_000);
    expect(pl.setAvOffset(-1, "webrtc")).toBe(0);
    await pl.setListening("p", true, undefined, "http");
    expect(pl.setAvOffset(1_800)).toBe(1_800); // lands on http
    expect(pl.status().avOffsetMs).toEqual({ webrtc: 0, http: 1_800 });
    expect(avOffsetJs(1_800)).toContain("1800");
    await pl.stop();
  });
});

/* ------------------------ Orchestrator + remote ----------------------- */

function frame(opts: { capture: boolean; transports?: Array<"webrtc" | "http"> }) {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
      inject: (id, _css, js) => void calls.push({ op: "inject", id, js }),
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
      ...(opts.capture ? { captureAudio: (enable: boolean) => void calls.push({ op: "capture", enable }) } : {}),
    },
    media: {
      launch: () => {},
      audioTransports: () => opts.transports ?? ["webrtc", "http"],
      serveAudio: (t, enable) => void calls.push({ op: "serve", t, enable }),
      audioStreamPath: () => "/audio/stream",
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, api: new RemoteApi(o, drivers.store), calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d", name: "D", layout: { mode: "grid" },
  tiles: [
    { id: "yt", url: "https://youtube.com", area: "1 / 1 / 2 / 2", audio: "exclusive" },
    { id: "cal", url: "https://cal.test", area: "1 / 2 / 2 / 3", audio: "mute" },
  ],
};

describe("private listening via the remote (§14)", () => {
  it("client picks the transport; frame reports stream path, per-transport offsets, heartbeat cadence", async () => {
    const { o, api, calls } = frame({ capture: true });
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true });
    const { token } = await api.mintPairing("http://frame");
    calls.length = 0;

    const on = await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":true,"mode":"both","transport":"http"}', token });
    expect(on.status).toBe(200);
    expect(JSON.parse(on.body)).toMatchObject({
      active: true, activeTransport: "http", streamPath: "/audio/stream", heartbeatMs: 5000,
      avOffsetMs: { webrtc: 150, http: 2000 }, listeners: [{ id: token, transport: "http", state: "listening" }],
    });
    expect(calls.find((c) => c.op === "capture")).toMatchObject({ enable: true });
    expect(calls.find((c) => c.op === "serve")).toMatchObject({ t: "http", enable: true });
    expect(String(calls.find((c) => c.op === "inject" && c.id === "yt")?.js)).toContain("2000"); // http-scale lip-sync

    expect((await api.handle({ method: "POST", path: "/audio/heartbeat", body: null, token })).status).toBe(200);
    expect((await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":true,"transport":"carrier-pigeon"}', token })).status).toBe(400);

    // Shell reports the stream closed unexpectedly → paused, speakers held, resume is explicit.
    calls.length = 0;
    await o.onSurfaceEvent({ type: "listener-lost", id: "yt", listener: token });
    const paused = JSON.parse((await api.handle({ method: "GET", path: "/audio/listen", body: null, token })).body);
    expect(paused).toMatchObject({ active: false, paused: true });
    expect(calls.filter((c) => c.op === "setMuted").every((c) => c.muted === true)).toBe(true);
    const resumed = JSON.parse((await api.handle({ method: "POST", path: "/audio/resume", body: null, token })).body);
    expect(resumed).toMatchObject({ active: false, paused: false, listeners: [] });
    expect(calls.filter((c) => c.op === "setMuted").at(-1)).toMatchObject({ id: "cal", muted: true }); // policy restored
  });

  it("stream access is by short-lived ticket, never by pairing token in a URL", async () => {
    const { api } = frame({ capture: true });
    const { token } = await api.mintPairing("http://frame");
    const minted = JSON.parse((await api.handle({ method: "POST", path: "/audio/stream-ticket", body: null, token })).body);
    expect(minted.path).toBe("/audio/stream");
    expect(minted.ticket).toMatch(/^[0-9a-f]{32}$/);
    expect(minted.ticket).not.toBe(token);
    expect(api.redeemStreamTicket(minted.ticket)).toBe(token); // reusable within TTL (segment fetches)
    vi.advanceTimersByTime(61_000);
    expect(api.redeemStreamTicket(minted.ticket)).toBeNull();
    expect(api.redeemStreamTicket(token)).toBeNull(); // a pairing token is not a ticket
    // Core refuses the stream path outright — it is the shell's, ticket-only.
    expect((await api.handle({ method: "GET", path: "/audio/stream", body: null, token })).status).toBe(400);
  });

  it("501 without capture or serve; the unknown-phone heartbeat is a 404", async () => {
    const { api } = frame({ capture: false });
    const { token } = await api.mintPairing("http://frame");
    expect((await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":true}', token })).status).toBe(501);
    expect((await api.handle({ method: "POST", path: "/audio/heartbeat", body: null, token })).status).toBe(404);
    expect(JSON.parse((await api.handle({ method: "GET", path: "/audio/listen", body: null, token })).body)).toMatchObject({ supported: false, transports: [] });
  });
});

/* ------------------------------------------- §14 chips on the wall (CS-10.2) */

describe("listeningChips", () => {
  const status = (...ls: Array<Partial<ListenerInfo> & { id: string }>) => ({
    listeners: ls.map((l) => ({ transport: "webrtc" as const, state: "listening" as const, since: "2026-09-03T10:00:00.000Z", ...l })),
  });

  it("names the paired device and points every listener at the audio owner", () => {
    // §14 streams the FRAME's audio - one capture - so two phones hear the same
    // slot. Two phones on two different games would need per-surface capture
    // (B-25) and a §14 amendment; the maintainer chose honesty over the mockup.
    const chips = listeningChips(status({ id: "tok-a" }, { id: "tok-b", transport: "http" }), { "tok-a": "Sam's phone", "tok-b": "Alex's phone" }, "game1");
    expect(chips.map((c) => [c.label, c.slot, c.transport])).toEqual([
      ["Sam's phone", "game1", "webrtc"],
      ["Alex's phone", "game1", "http"],
    ]);
  });

  it("still shows a chip for a token we hold no device for - someone IS hearing the wall", () => {
    const chips = listeningChips(status({ id: "unknown-token" }), {}, "game1");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe(UNNAMED_LISTENER);
    expect(chips[0]!.slot).toBe("game1");
  });

  it("keeps a paused listener's chip - the speakers are still muted on its behalf", () => {
    const chips = listeningChips(status({ id: "t", state: "paused" }), { t: "iPhone" }, "game1");
    expect(chips[0]!.state).toBe("paused");
  });

  it("says null rather than guessing when nothing owns audio", () => {
    expect(listeningChips(status({ id: "t" }), { t: "iPhone" }, null)[0]!.slot).toBeNull();
    expect(listeningChips(status({ id: "t" }), { t: "iPhone" })[0]!.slot).toBeNull();
  });

  it("nobody listening is no chips - the wall carries nothing", () => {
    expect(listeningChips(status(), { t: "iPhone" }, "game1")).toEqual([]);
  });

  it("a blank or whitespace name falls back rather than rendering an empty chip", () => {
    expect(listeningChips(status({ id: "t" }), { t: "   " }, "g")[0]!.label).toBe(UNNAMED_LISTENER);
    expect(listeningChips(status({ id: "t" }), { t: "" }, "g")[0]!.label).toBe(UNNAMED_LISTENER);
  });

  it("§22: the pairing token is never part of what a chip DISPLAYS", () => {
    // The token stays the chip's identity (id) so the host can key on it, but
    // nothing rendered may carry it - a chip is on a wall a room can see.
    const token = "0123456789abcdef0123456789abcdef";
    const chip = listeningChips(status({ id: token }), { [token]: "Sam's phone" }, "game1")[0]!;
    expect(chip.label).not.toContain(token);
    expect(chip.slot).not.toContain(token);
    expect(`${chip.label} ${chip.slot} ${chip.transport} ${chip.state}`).not.toContain(token);
  });
});
