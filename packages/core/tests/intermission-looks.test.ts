import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntermissionController } from "../src/intermission.js";
import type { AdLook } from "../src/intermission.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig(look: AdLook) {
  const calls: Array<Record<string, unknown>> = [];
  const state = { look };
  const controller = new IntermissionController(
    {
      show: (id, source, l) => void calls.push({ op: "show", id, look: l }),
      hide: (id) => void calls.push({ op: "hide", id }),
      setMuted: (id, muted) => void calls.push({ op: "mute", id, muted }),
      ambient: (id, sound, on) => void calls.push({ op: "ambient", id, on }),
      look: () => state.look,
    },
    { debounceMs: 1_000, safetyTimeoutMs: 60_000 },
  );
  controller.configure([{ id: "v", enabled: true, source: "pack:cosmos", audio: "mute", ambient: "rain" }]);
  return { calls, controller, state };
}

describe("Video ads looks (Watch settings, 2026-10-07)", () => {
  it("veil: the mute, the scenery and its soundscape, as before", async () => {
    const { calls, controller } = rig("veil");
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([
      { op: "mute", id: "v", muted: true },
      { op: "ambient", id: "v", on: true },
      { op: "show", id: "v", look: "veil" },
    ]);
  });

  it("mute: the sound off and the picture up (no soundscape); Unmute gives the sound back for this break and the next break mutes again", async () => {
    const { calls, controller } = rig("mute");
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([{ op: "mute", id: "v", muted: true }, { op: "show", id: "v", look: "mute" }]);
    expect(controller.lookOf("v")).toBe("mute");
    calls.length = 0;
    expect(controller.unmute("v", true)).toBe(true);
    expect(calls).toEqual([{ op: "mute", id: "v", muted: false }]);
    controller.onAdBreak("v", false);
    calls.length = 0;
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([{ op: "mute", id: "v", muted: true }, { op: "show", id: "v", look: "mute" }]);
  });

  it("show: never muted, the break still kept (covered) so the shell can say it is on", async () => {
    const { calls, controller } = rig("show");
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([{ op: "show", id: "v", look: "show" }]);
    expect(controller.isCovered("v")).toBe(true);
    expect(controller.unmute("v", true)).toBe(false);   // nothing to unmute
  });

  it("an unmuted break is not held muted by the backstop", async () => {
    const { calls, controller } = rig("mute");
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.unmute("v", true);
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toContainEqual({ op: "mute", id: "v", muted: false });
    expect(calls).toContainEqual({ op: "hide", id: "v" });
  });

  it("Unmute does nothing on a veiled break", async () => {
    const { controller } = rig("veil");
    controller.onAdBreak("v", true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.unmute("v", true)).toBe(false);
  });
});
