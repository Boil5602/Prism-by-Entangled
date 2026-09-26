import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT_MAP,
  deviceMap,
  overriddenDevices,
  resolveBinding,
} from "../src/input.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument, InputMap } from "../src/types.js";

const inputs: InputMap = {
  KEY_1: { action: "layout", value: "kitchen" },
  ARROW_RIGHT: { tile: "photos", cmd: "next" },
  "device:kitchen-remote": {
    KEY_1: { tile: "radio", cmd: "play-pause" },
  },
  "device:broken": { tile: "x", cmd: "y" } as never, // a binding where a block should be — ignored
};

describe("resolveBinding (§7 × §11)", () => {
  it("prefers device override, then dashboard map, then the shipped default", () => {
    expect(resolveBinding(inputs, "KEY_1", "kitchen-remote")).toEqual({ tile: "radio", cmd: "play-pause" });
    expect(resolveBinding(inputs, "KEY_1", "couch-remote")).toEqual({ action: "layout", value: "kitchen" });
    expect(resolveBinding(inputs, "KEY_1")).toEqual({ action: "layout", value: "kitchen" });
    // Dashboard map beats default for the same key…
    expect(resolveBinding(inputs, "ARROW_RIGHT")).toEqual({ tile: "photos", cmd: "next" });
    // …and the default fills what the dashboard doesn't claim.
    expect(resolveBinding(inputs, "MEDIA_PLAY_PAUSE")).toEqual(DEFAULT_INPUT_MAP.MEDIA_PLAY_PAUSE);
    expect(resolveBinding(inputs, "KEY_Z")).toBeUndefined();
    expect(resolveBinding(undefined, "ARROW_LEFT")).toEqual({ action: "carousel-prev" });
  });

  it("never treats a device block as a binding, or a binding as a block", () => {
    expect(resolveBinding(inputs, "device:kitchen-remote")).toBeUndefined();
    expect(deviceMap(inputs, "broken")).toBeUndefined();
    expect(overriddenDevices(inputs)).toEqual(["kitchen-remote"]);
    expect(overriddenDevices(undefined)).toEqual([]);
  });
});

/* --------------------------- Orchestrator ----------------------------- */

function rig() {
  const calls: Array<Record<string, unknown>> = [];
  const drivers: Drivers = {
    surface: {
      create: () => {},
      destroy: () => {},
      setRect: () => {},
      setOpacity: () => {},
      setZ: () => {},
      navigate: () => {},
      inject: (id, _css, js) => void calls.push({ op: "inject", id, js }),
      freeze: () => {},
      reveal: () => {},
      suspend: () => {},
      resume: () => {},
      setMuted: (id, muted) => void calls.push({ op: "setMuted", id, muted }),
    },
    display: {
      setBrightness: (v) => void calls.push({ op: "brightness", v }),
      setPower: (s) => void calls.push({ op: "power", s }),
    },
  };
  return { o: new Orchestrator(drivers), calls };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "kitchen",
  name: "Kitchen",
  layout: { mode: "grid" },
  tiles: [
    { id: "yt", url: "https://youtube.com", area: "1 / 1 / 2 / 2", audio: "exclusive", adapter: "youtube" },
    { id: "radio", url: "https://radio.test", area: "1 / 2 / 2 / 3", audio: "exclusive" },
  ],
  inputs: {
    "device:kitchen-remote": { KEY_K: { tile: "radio", cmd: "play" } },
  },
};

describe("Orchestrator.onInput (§7 × §11)", () => {
  it("routes tile bindings through the same command path as the remote, with play-pause toggling", async () => {
    const { o, calls } = rig();
    o.setAdapters({ youtube: { js: "/* yt */" } });
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "interaction", id: "yt" });             // human attribution (rule 5)
    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: true }); // yt is focusedMedia
    calls.length = 0;

    await o.onInput({ key: "MEDIA_PLAY_PAUSE" }); // default map → focusedMedia play-pause → pause
    expect(calls.find((c) => c.op === "inject" && c.id === "yt")?.js).toContain('"pause"');

    await o.onSurfaceEvent({ type: "playback", id: "yt", playing: false });
    calls.length = 0;
    await o.onInput({ key: "KEY_K" }); // 8BitDo A: play-pause → play
    expect(calls.find((c) => c.op === "inject" && c.id === "yt")?.js).toContain('"play"');

    calls.length = 0;
    await o.onInput({ key: "KEY_K", device: "kitchen-remote" }); // override targets the radio
    expect(calls.find((c) => c.op === "inject")).toMatchObject({ id: "radio" });
    expect(calls.find((c) => c.op === "inject" && c.id === "yt")).toBeUndefined();
  });

  it("does nothing for focusedMedia before anything has played, and handles display actions", async () => {
    const { o, calls } = rig();
    await o.load(doc, { w: 1000, h: 600 });
    calls.length = 0;
    await o.onInput({ key: "MEDIA_NEXT" });
    expect(calls.filter((c) => c.op === "inject")).toEqual([]);

    await o.enterLowPower();
    calls.length = 0;
    await o.onInput({ key: "KEY_Z" }); // unbound key still wakes the frame (§11)
    expect(calls.find((c) => c.op === "power")).toMatchObject({ s: "wake" });
  });
});
