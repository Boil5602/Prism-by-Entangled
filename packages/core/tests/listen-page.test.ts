import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// The listen page (2026-10-31): a view-and-listen page for the house behind one key and a switch - what plays and a stream ticket,
// never a pairing's rights.
function frame() {
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: { create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {} },
    media: { launch: () => {} },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  return { o, drivers, api: new RemoteApi(o, drivers.store) };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "d", name: "D", layout: { mode: "grid" }, tiles: [{ id: "music", url: "https://music.example/", area: "1 / 1 / 2 / 2" }] };

describe("the listen page's key", () => {
  it("answers nothing while off, what plays and a ticket with the key while on, and never a pairing route", async () => {
    const { o, drivers, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: "anything" })).status).toBe(404);
    const off = await api.houseListen(null);
    expect(off.on).toBe(false);
    const on = await api.houseListen(true);
    expect(on.on).toBe(true); expect(on.key).toMatch(/^[a-hj-km-np-z2-9]{8}$/);   // a code a person types
    // typed loosely: upper case, a dash, a space
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key.slice(0, 4).toUpperCase() + "-" + on.key.slice(4) + " " })).status).toBe(200);
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: "wrong" })).status).toBe(401);
    for (let i = 0; i < 10; i++) await api.handle({ method: "GET", path: "/listen/now", body: null, token: "wrong" + i, client: "10.0.0.9" });   // ten wrong from one device
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key, client: "10.0.0.9" })).status).toBe(429);   // that device waits a minute, right code or not
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key, client: "10.0.0.5" })).status).toBe(200);   // another device is untouched
    const fresh0 = await api.houseListen("new");   // a new code does not lift the lock
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: fresh0.key, client: "10.0.0.9" })).status).toBe(429);
    (api as unknown as { houseTries: Map<string, unknown> }).houseTries.clear();   // the minute passes
    const on2 = await api.houseListen(null); expect(on2.key).toBe(fresh0.key);
    Object.assign(on, on2);
    const now = await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key });
    expect(now.status).toBe(200);
    expect(JSON.parse(now.body)).toMatchObject({ now: null });
    const t = await api.handle({ method: "POST", path: "/listen/ticket", body: null, token: on.key });
    expect(t.status).toBe(200);
    const ticket = JSON.parse(t.body).ticket as string;
    expect(api.redeemStreamTicket(ticket)).toMatch(/^house:[0-9a-f]{8}$/);   // a generation, never the code
    expect(api.redeemStreamTicket(ticket)).not.toContain(on.key.slice(0, 4));
    // the key opens nothing a phone's pairing opens
    expect((await api.handle({ method: "GET", path: "/state", body: null, token: on.key })).status).toBe(401);
    expect((await api.handle({ method: "GET", path: "/now-playing", body: null, token: on.key })).status).toBe(401);
    // a paired phone's token opens nothing of the listen page
    const { token } = await api.mintPairing("http://pc");
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token })).status).toBe(401);
    // a paired phone reads and sets the switch; the house key cannot
    expect(JSON.parse((await api.handle({ method: "GET", path: "/listen-page", body: null, token })).body)).toEqual({ on: true, since: expect.any(String) });   // no key on a plain read
    expect(JSON.parse((await api.handle({ method: "GET", path: "/listen-page/address", body: null, token })).body)).toMatchObject({ on: true, key: on.key });
    expect((await api.handle({ method: "POST", path: "/listen-page", body: '{"on":"maybe"}', token })).status).toBe(400);
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen-page", body: '{"on":false}', token })).body)).toMatchObject({ on: false });
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key })).status).toBe(404);
    expect(JSON.parse((await api.handle({ method: "POST", path: "/listen-page", body: '{"on":true}', token })).body)).toMatchObject({ on: true, key: on.key });
    expect((await api.handle({ method: "GET", path: "/listen-page", body: null, token: on.key })).status).toBe(401);
    // a phone's ticket falls with its pairing (the same rule as the house's with its switch)
    const pt = JSON.parse((await api.handle({ method: "POST", path: "/audio/stream-ticket", body: null, token })).body).ticket as string;
    expect(api.redeemStreamTicket(pt)).toBe(token);
    await api.revoke(token);
    expect(api.redeemStreamTicket(pt)).toBeNull();
    // the switch and the key survive a restart, and off is off
    const reborn = new RemoteApi(o, drivers.store);
    expect(await reborn.houseListen(null)).toMatchObject({ on: true, key: on.key });
    expect((await reborn.handle({ method: "GET", path: "/listen/now", body: null, token: on.key })).status).toBe(200);
    const t2 = JSON.parse((await reborn.handle({ method: "POST", path: "/listen/ticket", body: null, token: on.key })).body).ticket as string;
    await reborn.houseListen(false);
    expect((await reborn.handle({ method: "GET", path: "/listen/now", body: null, token: on.key })).status).toBe(404);
    expect(reborn.redeemStreamTicket(t2)).toBeNull();   // off voids the tickets the house held: a stream in flight ends at its next redeem
    expect((await api.houseListen(true)).key).toBe(on.key);   // back on: the same key, the house's bookmarks still good
    // a new address: the old key opens nothing, the new one everything
    const fresh = await api.houseListen("new");
    expect(fresh.on).toBe(true); expect(fresh.key).not.toBe(on.key);
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: on.key })).status).toBe(401);
    expect((await api.handle({ method: "GET", path: "/listen/now", body: null, token: fresh.key })).status).toBe(200);
  });
});
