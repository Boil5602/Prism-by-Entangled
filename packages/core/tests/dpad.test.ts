import { describe, expect, it } from "vitest";
import { nextTileInDirection } from "../src/input.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

describe("nextTileInDirection (§12 d-pad)", () => {
  // hero on the left, two satellites stacked on the right
  const rects = {
    hero: { x: 0, y: 0, w: 600, h: 600 },
    top: { x: 600, y: 0, w: 400, h: 300 },
    bottom: { x: 600, y: 300, w: 400, h: 300 },
  };
  it("moves spatially and stays put at edges", () => {
    expect(nextTileInDirection(rects, "hero", "right")).toBe("top");
    expect(nextTileInDirection(rects, "top", "down")).toBe("bottom");
    expect(nextTileInDirection(rects, "bottom", "left")).toBe("hero");
    expect(nextTileInDirection(rects, "hero", "left")).toBe("hero");
    expect(nextTileInDirection(rects, null, "down")).toBe("hero"); // nothing focused → first tile
    expect(nextTileInDirection({}, null, "up")).toBeNull();
  });
});

function frame() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: (id, r) => void calls.push({ op: "rect", id, r }), setOpacity: () => {}, setZ: (id, z) => void calls.push({ op: "z", id, z }),
      navigate: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {}, setMuted: () => {},
      inject: (id, _c, js) => void calls.push({ op: "inject", id, js }),
      setFocused: (id, focused) => void calls.push({ op: "focus", id, focused }),
    },
    media: { launch: (pkg) => void calls.push({ op: "launch", pkg }) },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  return { o: new Orchestrator(drivers), calls, drivers };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "lr", name: "Living Room",
  layout: { mode: "hero", hero: "netflix", heroSize: 0.6, satellites: "auto", gap: 8 },
  tiles: [
    { id: "netflix", launch: { package: "com.netflix.ninja" }, aspectHint: "16:9" },
    { id: "yt", url: "https://youtube.com", aspectHint: "16:9", audio: "exclusive", adapter: "youtube", intermission: { enabled: true } },
    { id: "plex", launch: { package: "com.plexapp.android" }, aspectHint: "16:9" },
  ],
};

describe("TV remote: focus ring + select (§12)", () => {
  it("focus starts on the hero, d-pad moves it, select launches the focused app", async () => {
    const { o, calls } = frame();
    await o.load(doc, { w: 1920, h: 1080 });
    expect(o.getState()!.focused).toBe("netflix");
    expect(calls.find((c) => c.op === "focus")).toEqual({ op: "focus", id: "netflix", focused: true });

    await o.onInput({ key: "KEYCODE_DPAD_CENTER" });
    expect(calls.at(-1)).toEqual({ op: "launch", pkg: "com.netflix.ninja" });

    await o.onInput({ key: "KEYCODE_DPAD_RIGHT" });
    const moved = o.getState()!.focused;
    expect(moved).not.toBe("netflix");
    expect(calls.filter((c) => c.op === "focus").slice(-2)).toEqual([
      { op: "focus", id: "netflix", focused: false },
      { op: "focus", id: moved, focused: true },
    ]);
  });

  it("select on a focused web tile ENTERS it (page gets the remote); Back leaves; with an observed skip, select is the pass-through skip", async () => {
    const { o, calls } = frame();
    o.setAdapters({ youtube: { js: "", controls: { skip: ".ytp-skip-ad-button" } } });
    await o.load(doc, { w: 1920, h: 1080 });
    await o.setFocus("yt");
    expect(await o.activateFocused()).toBe("enter");
    expect(o.getState()!.entered).toBe("yt");
    expect(o.getState()!.hero).toBe("netflix"); // entering never promotes
    // §2 fullscreen: OK takes the tile to the whole viewport, above the others
    expect(o.getState()!.fullscreen).toBe("yt");
    const full = calls.filter((c) => c.op === "rect" && c.id === "yt").pop() as { r: { x: number; y: number; w: number; h: number } };
    expect(full.r).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(calls.some((c) => c.op === "z" && c.id === "yt" && (c.z as number) > 0)).toBe(true);
    // In page mode the d-pad goes INTO the page as real key events…
    await o.onInput({ key: "KEYCODE_DPAD_DOWN" });
    expect(o.getState()!.focused).toBe("yt"); // …not to the focus ring
    // …typed text goes to the page, and Back returns the remote to the wall.
    expect(await o.typeIntoTile("yt", "hello")).toBe("unsupported"); // this fake shell has no typeText hook — honest 501 upstream
    await o.onInput({ key: "KEYCODE_BACK" });
    expect(o.getState()!.entered).toBeNull();
    expect(o.getState()!.fullscreen).toBeNull(); // one Back: out of the page and back to the wall
    const restored = calls.filter((c) => c.op === "rect" && c.id === "yt").pop() as { r: { w: number } };
    expect(restored.r.w).toBeLessThan(1920); // the solved rect again, unchanged
    await o.leaveTile();

    await o.onSurfaceEvent({ type: "skip-available", id: "yt", available: true });
    expect(await o.activateFocused()).toBe("skip");
    expect(String(calls.at(-1)!.js)).toContain(".ytp-skip-ad-button");
  });
});

describe("typeIntoTile field wait (remote sign-in)", () => {
  it("accepts a shell that hands the evaluate result back already JSON-parsed (boolean true)", async () => {
    const { o, calls, drivers } = frame();
    let polls = 0;
    drivers.surface.evaluate = async (_id, js) => { if (js.includes("var sels=")) polls += 1; return js.includes("var sels=") ? (true as unknown as string) : JSON.stringify([]); };
    drivers.surface.typeText = (id, text) => void calls.push({ op: "type", id, text });
    await o.load(doc, { w: 1920, h: 1080 });
    expect(await o.typeIntoTile("yt", "me@example.org", "email")).toBe("ok");
    expect(polls).toBe(1);
    expect(calls.some((c) => c.op === "type" && c.text === "me@example.org")).toBe(true);
  });
});

describe("sign-in helpers: buttons and presses (human-forwarded, §26)", () => {
  it("reports the page's visible buttons when no field appears, and presses only what the human named", async () => {
    const { o, calls, drivers } = frame();
    o.fieldWaitMs = 0;
    const seen: string[] = [];
    drivers.surface.evaluate = async (_id, js) => {
      seen.push(js);
      if (js.includes("var re=/^(agree")) return JSON.stringify([]); // no consent gate in this page
      if (js.includes("JSON.stringify(out)")) return JSON.stringify(["Agree", "Sign In"]);
      if (js.includes("b.click()")) return (js.includes('"Agree"') ? true : false) as unknown as string;
      if (js.includes("var sels=")) return false as unknown as string; // focusFieldJs: no field
      return null;
    };
    drivers.surface.typeText = (id, text) => void calls.push({ op: "type", id, text });
    await o.load(doc, { w: 1920, h: 1080 });
    expect(await o.typeIntoTile("yt", "me@example.org", "email")).toBe("no-field");
    expect(calls.some((c) => c.op === "type")).toBe(false); // nothing typed into nothing
    expect(await o.visibleButtons("yt")).toEqual(["Agree", "Sign In"]);
    expect(await o.pressButton("yt", "Agree")).toBe("ok");
    expect(await o.pressButton("yt", "Skip")).toBe("none");
    // every press script carries the exact label the human tapped — nothing else is ever clicked
    expect(seen.filter((j) => j.includes("b.click()")).every((j) => j.includes('"Agree"') || j.includes('"Skip"'))).toBe(true);
  });
});

describe("consent gate (§26: a human decision before any typing)", () => {
  it("types nothing while an Agree/Accept button is visible, even if the field is reachable", async () => {
    const { o, calls, drivers } = frame();
    o.fieldWaitMs = 0;
    let gateUp = true;
    drivers.surface.evaluate = async (_id, js) => {
      if (js.includes("var re=/^(agree")) return JSON.stringify(gateUp ? ["Agree"] : []);
      if (js.includes("JSON.stringify(out)")) return JSON.stringify(["Continue"]);
      if (js.includes("b.click()")) { if (js.includes('"Agree"')) gateUp = false; return true as unknown as string; }
      if (js.includes("var sels=")) return true as unknown as string; // the field IS there, under the sheet
      return null;
    };
    drivers.surface.typeText = (id, text) => void calls.push({ op: "type", id, text });
    await o.load(doc, { w: 1920, h: 1080 });
    expect(await o.typeIntoTile("yt", "me@example.org", "email")).toBe("no-field");
    expect(calls.some((c) => c.op === "type")).toBe(false);
    expect(await o.visibleButtons("yt")).toEqual(["Agree", "Continue"]); // gate first
    expect(await o.pressButton("yt", "Agree")).toBe("ok"); // the human tapped it
    expect(await o.typeIntoTile("yt", "me@example.org", "email")).toBe("ok");
    expect(calls.some((c) => c.op === "type" && c.text === "me@example.org")).toBe(true);
  });
});

describe("solo layout: one app at a time", () => {
  const solo: DashboardDocument = { ...doc, id: "solo", layout: { mode: "solo", start: "yt" }, tiles: [{ id: "yt", url: "https://www.youtube.com/" }, { id: "b", url: "https://b.example/" }, { id: "app", launch: { package: "x.y" } }] as DashboardDocument["tiles"] };
  it("starts full screen on the start tile, ◀ ▶ cycle, OK enters, Back leaves the page but never the app", async () => {
    const { o, calls } = frame();
    await o.load(solo, { w: 1920, h: 1080 });
    expect(o.getState()!.layoutMode).toBe("solo");
    expect(o.getState()!.fullscreen).toBe("yt");
    await o.onInput({ key: "KEYCODE_DPAD_RIGHT" });
    expect(o.getState()!.fullscreen).not.toBe("yt");
    const second = o.getState()!.fullscreen!;
    await o.onInput({ key: "KEYCODE_DPAD_LEFT" });
    expect(o.getState()!.fullscreen).toBe("yt");
    expect(o.getState()!.focused).toBe("yt");
    expect(await o.activateFocused()).toBe("enter");
    expect(o.getState()!.entered).toBe("yt");
    await o.onInput({ key: "KEYCODE_BACK" });
    expect(o.getState()!.entered).toBeNull();
    expect(o.getState()!.fullscreen).toBe("yt"); // still one app on screen
    await o.tileCommand("yt", "normal");
    expect(o.getState()!.fullscreen).toBe("yt"); // normal is a no-op in solo
    expect(second).toBeTruthy();
    expect(calls.some((c) => c.op === "rect" && c.id === "yt" && (c.r as { w: number }).w === 1920)).toBe(true);
  });
});

describe("solo layout remembers the app shown last", () => {
  it("boots on the tile that was on screen when the frame last ran", async () => {
    const { o, drivers } = frame();
    const solo: DashboardDocument = { ...doc, id: "solo2", layout: { mode: "solo", start: "yt" }, tiles: [{ id: "yt", url: "https://www.youtube.com/" }, { id: "b", url: "https://b.example/" }] as DashboardDocument["tiles"] };
    await o.load(solo, { w: 1920, h: 1080 });
    await o.onInput({ key: "KEYCODE_DPAD_RIGHT" });
    expect(o.getState()!.fullscreen).toBe("b");
    const again = new Orchestrator(drivers); // same store = same frame after a restart
    await again.load(solo, { w: 1920, h: 1080 });
    expect(again.getState()!.fullscreen).toBe("b");
  });
});
