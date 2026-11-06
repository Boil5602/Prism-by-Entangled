import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// Resume-last-location: the frame is furniture — closing it is a TV turning
// off, not a streaming box resetting. The shell reports each navigation's URL
// (`navigated.url`); core persists it per tile and boots the tile there
// instead of its catalog home URL. Same-site only: a persisted URL on a
// different registrable domain never hijacks the tile's identity.
function frame(kv = new Map<string, string>()) {
  const calls: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: (id, url) => void calls.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void calls.push({ op: "inject", id, js }),
      destroy: (id) => void calls.push({ op: "destroy", id }),
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { o: new Orchestrator(drivers), calls, kv };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d", name: "D", layout: { mode: "hero", hero: "netflix", heroSize: 0.6, satellites: "auto" },
  tiles: [
    { id: "netflix", url: "https://www.netflix.com/browse", audio: "exclusive" },
    { id: "cam", url: "https://cams.example.org/porch", audio: "mute" },
  ],
};

describe("resume last location (TV off, streaming box holds)", () => {
  it("boots a tile at its last reported same-site URL", async () => {
    const { o, calls, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "navigated", id: "netflix", url: "https://www.netflix.com/watch/81234567" });

    const again = frame(kv);                      // restart: same store, fresh orchestrator
    await again.o.load(doc, { w: 1000, h: 600 });
    const nav = again.calls.filter((c) => c.op === "navigate" && c.id === "netflix").at(-1);
    expect(nav!.url).toBe("https://www.netflix.com/watch/81234567");
  });

  it("subdomain moves within the site still count as same-site", async () => {
    const { o, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "navigated", id: "netflix", url: "https://help.netflix.com/somewhere" });
    const again = frame(kv);
    await again.o.load(doc, { w: 1000, h: 600 });
    expect(again.calls.filter((c) => c.op === "navigate" && c.id === "netflix").at(-1)!.url)
      .toBe("https://help.netflix.com/somewhere");
  });

  it("a different registrable domain is never persisted as the tile's resume point", async () => {
    const { o, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "navigated", id: "netflix", url: "https://evil.example.com/phish" });
    await o.onSurfaceEvent({ type: "navigated", id: "netflix", url: "javascript:alert(1)" });
    const again = frame(kv);
    await again.o.load(doc, { w: 1000, h: 600 });
    expect(again.calls.filter((c) => c.op === "navigate" && c.id === "netflix").at(-1)!.url)
      .toBe("https://www.netflix.com/browse");
  });

  it("removeTile drops the tile, persists the doc, and reassigns a removed hero", async () => {
    const { o, calls, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    calls.length = 0;
    expect(await o.removeTile("netflix")).toBe("ok");     // the hero
    expect(calls).toContainEqual({ op: "destroy", id: "netflix" });
    const persisted = JSON.parse(kv.get("dashboard")!);
    expect(persisted.tiles.map((t: { id: string }) => t.id)).toEqual(["cam"]);
    expect(persisted.layout.hero).toBe("cam");
    expect(await o.removeTile("nope")).toBe("unknown-tile");
  });

  it("multi-tenant hosting suffixes never cross tenants", async () => {
    const { sameRegistrableDomain } = await import("../src/orchestrator.js");
    expect(sameRegistrableDomain("https://alice.github.io/x", "https://bob.github.io/y")).toBe(false);
    expect(sameRegistrableDomain("https://alice.github.io/x", "https://alice.github.io/y")).toBe(true);
    expect(sameRegistrableDomain("https://app.example.co.uk/", "https://www.example.co.uk/")).toBe(true);
    expect(sameRegistrableDomain("https://evil.co.uk/", "https://example.co.uk/")).toBe(false);
    expect(sameRegistrableDomain("https://help.netflix.com/", "https://www.netflix.com/")).toBe(true);
  });

  it("a navigated event without a url (older shells) changes nothing", async () => {
    const { o, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "navigated", id: "cam" });
    const again = frame(kv);
    await again.o.load(doc, { w: 1000, h: 600 });
    expect(again.calls.filter((c) => c.op === "navigate" && c.id === "cam").at(-1)!.url)
      .toBe("https://cams.example.org/porch");
  });

  it("a resumed tile boots paused; the human's own engagement releases the hold", async () => {
    const { o, kv } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "navigated", id: "netflix", url: "https://www.netflix.com/watch/81234567" });

    const again = frame(kv);
    await again.o.load(doc, { w: 1000, h: 600 });
    again.calls.length = 0;
    // the service autoplays on its watch page -> the frame pauses it, once,
    // without stealing audio focus
    await again.o.onSurfaceEvent({ type: "playback", id: "netflix", playing: true });
    const pause = again.calls.find((c) => c.op === "inject" && String(c.js).includes("pause()"));
    expect(pause).toBeTruthy();
    expect(again.calls.some((c) => c.op === "setMuted" && c.id !== "netflix")).toBe(false);
    // human engages, then plays: normal focus behavior, no second hold
    again.calls.length = 0;
    await again.o.onSurfaceEvent({ type: "interaction", id: "netflix" });
    await again.o.onSurfaceEvent({ type: "playback", id: "netflix", playing: true });
    expect(again.calls.some((c) => c.op === "inject" && String(c.js).includes("pause()"))).toBe(false);
    expect(again.calls).toContainEqual({ op: "setMuted", id: "netflix", muted: false });
  });
});
