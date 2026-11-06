import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";

function frame() {
  const calls: string[] = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
      captureAudio: (enable) => void calls.push(`capture:${enable}`),
    },
    media: {
      launch: () => {},
      audioTransports: () => ["webrtc", "http"],
      serveAudio: (t, on) => void calls.push(`serve:${t}:${on}`),
      audioStreamPath: () => "/audio/stream",
      webrtcOffer: (listener, sdp) => {
        calls.push(`offer:${listener.slice(0, 4)}:${sdp}`);
        return "v=0 answer";
      },
      webrtcIce: (listener, c) => void calls.push(`ice:${listener.slice(0, 4)}:${c}`),
      webrtcClose: (listener) => void calls.push(`close:${listener.slice(0, 4)}`),
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, api: new RemoteApi(o, drivers.store), calls };
}

describe("§14 WebRTC signaling relay", () => {
  it("relays offer/ICE only for a listener admitted on webrtc, and tears the peer down on leave", async () => {
    const { api, calls } = frame();
    const { token } = await api.mintPairing("http://frame");
    const short = token.slice(0, 4);

    // Not listening yet → 409, nothing reaches the shell.
    expect((await api.handle({ method: "POST", path: "/audio/webrtc/offer", body: '{"sdp":"v=0 offer"}', token })).status).toBe(409);
    expect(calls.filter((c) => c.startsWith("offer"))).toEqual([]);

    // Listening on http → still 409 (wrong transport).
    await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":true,"transport":"http"}', token });
    expect((await api.handle({ method: "POST", path: "/audio/webrtc/offer", body: '{"sdp":"v=0 offer"}', token })).status).toBe(409);

    // Switch to webrtc → the shell answers from its capture mix.
    await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":true,"transport":"webrtc"}', token });
    const res = await api.handle({ method: "POST", path: "/audio/webrtc/offer", body: '{"sdp":"v=0 offer"}', token });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sdp: "v=0 answer" });
    expect(calls).toContain(`offer:${short}:v=0 offer`);
    expect((await api.handle({ method: "POST", path: "/audio/webrtc/ice", body: '{"candidate":"{\\"candidate\\":\\"x\\"}"}', token })).status).toBe(200);
    expect(calls.at(-1)).toBe(`ice:${short}:{"candidate":"x"}`);

    await api.handle({ method: "POST", path: "/audio/listen", body: '{"enable":false}', token });
    expect(calls).toContain(`close:${short}`);
    expect((await api.handle({ method: "POST", path: "/audio/webrtc/ice", body: '{"candidate":"y"}', token })).status).toBe(409);
    expect((await api.handle({ method: "POST", path: "/audio/webrtc/offer", body: "{}", token })).status).toBe(400);
  });
});
