import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { CHORES_KEY, normalizeChores } from "../src/tiles-data.js";
import type { Drivers } from "../src/drivers.js";

/**
 * §6 remote editing of the household list (docs/concept-scenes.md §6): the
 * phone in the shop and the panel on the wall edit ONE document, through core.
 * The store here stands in for the host's store.json (§10 — written, never
 * wiped): what a request persists is exactly what the panel then reads.
 */
function rig() {
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, inject: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {},
      resume: () => {}, setMuted: () => {},
    },
    store: { get: (key) => kv.get(key) ?? null, set: (key, value) => void kv.set(key, value) },
  };
  const remote = new RemoteApi(new Orchestrator(drivers), drivers.store);
  return { kv, remote };
}

async function paired() {
  const r = rig();
  const { token } = await r.remote.mintPairing("http://10.0.0.5:8471");
  return { ...r, token };
}

const body = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

describe("remote — the household list", () => {
  it("an unpaired phone gets nothing, list included", async () => {
    const { remote } = rig();
    const res = await remote.handle({ method: "GET", path: "/chores", body: null, token: "made-up" });
    expect(res.status).toBe(401);
  });

  it("reads an empty list before anything is on it", async () => {
    const { remote, token } = await paired();
    const res = await remote.handle({ method: "GET", path: "/chores", body: null, token });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ items: [], notes: "" });
  });

  it("adds an item and persists it under the key the panel reads", async () => {
    const { remote, token, kv } = await paired();
    const res = await remote.handle({ method: "POST", path: "/chores", body: '{"text":"milk"}', token });
    expect(res.status).toBe(200);
    expect((body(res)["items"] as Array<{ text: string }>).map((i) => i.text)).toEqual(["milk"]);
    expect(normalizeChores(kv.get(CHORES_KEY) ?? null).items[0]!.text).toBe("milk");
  });

  it("refuses an add with no text, and says what the body should be", async () => {
    const { remote, token, kv } = await paired();
    const res = await remote.handle({ method: "POST", path: "/chores", body: '{"text":"   "}', token });
    expect(res.status).toBe(400);
    expect(String(body(res)["error"])).toContain("text");
    expect(kv.has(CHORES_KEY)).toBe(false);
  });

  it("checks one off — the phone's tap is the same human action as the panel's", async () => {
    const { remote, token, kv } = await paired();
    await remote.handle({ method: "POST", path: "/chores", body: '{"text":"milk"}', token });
    await remote.handle({ method: "POST", path: "/chores", body: '{"text":"bins"}', token });
    const list = normalizeChores(kv.get(CHORES_KEY)!);
    const id = list.items[1]!.id;
    const res = await remote.handle({ method: "POST", path: `/chores/${id}/check`, body: '{"done":true}', token });
    expect(res.status).toBe(200);
    const after = normalizeChores(kv.get(CHORES_KEY)!);
    expect(after.items.map((i) => i.done)).toEqual([false, true]);
    // and back off again
    await remote.handle({ method: "POST", path: `/chores/${id}/check`, body: '{"done":false}', token });
    expect(normalizeChores(kv.get(CHORES_KEY)!).items[1]!.done).toBe(false);
  });

  it("404s a check for an item that is not on the list", async () => {
    const { remote, token } = await paired();
    const res = await remote.handle({ method: "POST", path: "/chores/nope/check", body: '{"done":true}', token });
    expect(res.status).toBe(404);
  });

  it("400s a check with no boolean — no guessing what the phone meant", async () => {
    const { remote, token, kv } = await paired();
    await remote.handle({ method: "POST", path: "/chores", body: '{"text":"milk"}', token });
    const id = normalizeChores(kv.get(CHORES_KEY)!).items[0]!.id;
    const res = await remote.handle({ method: "POST", path: `/chores/${id}/check`, body: "{}", token });
    expect(res.status).toBe(400);
  });

  it("edits the notes beneath the list", async () => {
    const { remote, token, kv } = await paired();
    const res = await remote.handle({ method: "PUT", path: "/chores/notes", body: '{"notes":"back Tuesday"}', token });
    expect(res.status).toBe(200);
    expect(normalizeChores(kv.get(CHORES_KEY)!).notes).toBe("back Tuesday");
  });

  it("names the routes it has when asked for one it has not", async () => {
    const { remote, token } = await paired();
    const res = await remote.handle({ method: "DELETE", path: "/chores/everything", body: null, token });
    expect(res.status).toBe(404);
    expect(String(body(res)["error"])).toContain("/chores");
  });

  it("carries no identifier: the request is a bearer token and a body, and the answer is the list", async () => {
    const { remote, token } = await paired();
    const res = await remote.handle({ method: "POST", path: "/chores", body: '{"text":"milk"}', token, userAgent: "iPhone" });
    const returned = body(res);
    expect(Object.keys(returned).sort()).toEqual(["items", "notes", "updated", "v"]);
    expect(res.body).not.toContain(token);
  });
});
