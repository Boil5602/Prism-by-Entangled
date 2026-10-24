import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

// A break belongs to its page (2026-10-23, "not getting any sound in prism right now"): Netflix's pause ad was covered, Silo was picked on
// Apple TV in the same window, and the cover's backstop fell two minutes on holding the mute for the page's own end signal - which a page that
// was never in that break does not send. A move to another site ends the break; a move within the same site does not.

function rig() {
  const mutes: boolean[] = [];
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {}, navigate: () => {}, inject: () => {},
      freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setViewport: () => {},
      setMuted: (id, m) => { if (id === "screen") mutes.push(m); },
    },
    store: { get: () => null, set: () => {} },
  };
  return { mutes, drivers };
}
const doc: DashboardDocument = { schema: "frame.dashboard/v0.1", id: "wall", name: "Wall", layout: { mode: "hero", hero: "screen", heroSize: 0.62, satellites: "auto", gap: 0 }, tiles: [{ id: "screen", url: "https://www.netflix.com/browse", audio: "exclusive", adapter: "netflix", intermission: { enabled: true } }] };

async function heldMute() {
  const { mutes, drivers } = rig();
  const rt = createRuntime(drivers);
  rt.init(JSON.stringify(doc), 1920, 1080, JSON.stringify({ adapters: { netflix: { match: ["www.netflix.com"], videoContext: "/*c*/" } } }));
  await vi.advanceTimersByTimeAsync(50);
  rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/watch/1" }));
  rt.event(JSON.stringify({ type: "interaction", id: "screen" }));
  rt.event(JSON.stringify({ type: "playback", id: "screen", playing: true }));   // the window's sound is on
  await vi.advanceTimersByTimeAsync(100);
  rt.event(JSON.stringify({ type: "ad-break", id: "screen", active: true }));
  await vi.advanceTimersByTimeAsync(130_000);   // covered, then the backstop falls with the page still in its break: the mute is held
  return { rt, mutes };
}

describe("a break and its page", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("ends when the window moves to another site: the held mute is lifted", async () => {
    const { rt, mutes } = await heldMute();
    expect(mutes.at(-1)).toBe(true);
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://tv.apple.com/us/episode/its-all-good/umc.1" }));
    await vi.advanceTimersByTimeAsync(50);
    expect(mutes.at(-1)).toBe(false);
  });

  it("goes on when the page moves within its own site", async () => {
    const { rt, mutes } = await heldMute();
    rt.event(JSON.stringify({ type: "navigated", id: "screen", url: "https://www.netflix.com/watch/2" }));
    await vi.advanceTimersByTimeAsync(50);
    expect(mutes.at(-1)).toBe(true);
  });
});
