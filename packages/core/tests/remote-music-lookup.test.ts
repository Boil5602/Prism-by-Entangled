import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";

// The phone's cross-service add (2026-10-27, "add songs to a playlist cross service like I can do in the pc player"): five routes over
// the PC's own lookup. The orchestrator's verbs are stubbed; what is under test is that each route calls the right one with ids the
// state holds, and refuses what it must.
function setup() {
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
    },
    net: { fetchStatic: () => "", applyBlockHosts: () => {} },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  const api = new RemoteApi(o, drivers.store);
  return { o, api };
}
const blank = { status: "idle" as const, song: null, key: "", match: null, candidates: [], action: null, at: 1, playlists: [] };
const found = { ...blank, status: "found" as const, song: { title: "Halo" }, match: { id: "s1", title: "Halo", artist: "Beyonce" }, playlists: [{ id: "p1", name: "Drive" }] };

describe("the phone's cross-service add", () => {
  it("refuses a body without a tile", async () => {
    const { api } = setup();
    const { token } = await api.mintPairing("http://frame");
    const r = await api.handle({ method: "POST", path: "/music/lookup", body: "{}", token });
    expect(r.status).toBe(400);
  });
  it("starts the lookup and answers its state", async () => {
    const { o, api } = setup();
    const { token } = await api.mintPairing("http://frame");
    const look = vi.spyOn(o, "musicLookup").mockResolvedValue("searching");
    vi.spyOn(o, "musicLookupState").mockReturnValue({ ...blank, status: "searching" });
    const r = await api.handle({ method: "POST", path: "/music/lookup", body: JSON.stringify({ tile: "apple" }), token });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).status).toBe("searching");
    expect(look).toHaveBeenCalledWith("apple");
    const s = await api.handle({ method: "POST", path: "/music/lookup-state", body: JSON.stringify({ tile: "apple" }), token });
    expect(JSON.parse(s.body).status).toBe("searching");
    expect(look).toHaveBeenCalledTimes(1);   // reading the state asks nothing of the page
  });
  it("adds and makes a station only with the match the state holds", async () => {
    const { o, api } = setup();
    const { token } = await api.mintPairing("http://frame");
    const state = vi.spyOn(o, "musicLookupState").mockReturnValue({ ...blank, status: "not-found" as const });
    const add = vi.spyOn(o, "musicAddToPlaylist").mockResolvedValue("ok");
    const station = vi.spyOn(o, "musicStationFromSong").mockResolvedValue("ok");
    let r = await api.handle({ method: "POST", path: "/music/add", body: JSON.stringify({ tile: "apple", playlist: "p1" }), token });
    expect(r.status).toBe(409);
    expect(add).not.toHaveBeenCalled();
    state.mockReturnValue(found);
    r = await api.handle({ method: "POST", path: "/music/add", body: JSON.stringify({ tile: "apple" }), token });
    expect(r.status).toBe(400);
    r = await api.handle({ method: "POST", path: "/music/add", body: JSON.stringify({ tile: "apple", playlist: "p1" }), token });
    expect(r.status).toBe(200);
    expect(add).toHaveBeenCalledWith("apple", "p1", "s1");
    r = await api.handle({ method: "POST", path: "/music/station", body: JSON.stringify({ tile: "apple" }), token });
    expect(r.status).toBe(200);
    expect(station).toHaveBeenCalledWith("apple", "s1");
  });
  it("a pick must be one of the candidates", async () => {
    const { o, api } = setup();
    const { token } = await api.mintPairing("http://frame");
    vi.spyOn(o, "musicLookupState").mockReturnValue(found);
    const pick = vi.spyOn(o, "musicLookupPick").mockImplementation((_t, id) => id === "s2");
    let r = await api.handle({ method: "POST", path: "/music/lookup-pick", body: JSON.stringify({ tile: "apple", song: "zzz" }), token });
    expect(r.status).toBe(409);
    r = await api.handle({ method: "POST", path: "/music/lookup-pick", body: JSON.stringify({ tile: "apple", song: "s2" }), token });
    expect(r.status).toBe(200);
    expect(pick).toHaveBeenCalledWith("apple", "s2");
  });
});
