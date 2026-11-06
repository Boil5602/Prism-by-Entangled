import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterRegistry, lintAdapter } from "../src/adapters.js";
import { IntermissionController } from "../src/intermission.js";
import { Orchestrator } from "../src/orchestrator.js";
import { RemoteApi } from "../src/remote.js";
import { veilJs } from "../src/veil.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/* --------------------- §26 synthetic interaction lint ------------------ */

describe("lintAdapter (§26 prohibition)", () => {
  it("rejects clicks, dispatched events, synthetic event constructors, and submits", () => {
    expect(lintAdapter({ js: "document.querySelector('.skip').click()" })).toEqual(["click"]);
    expect(lintAdapter({ js: "el.dispatchEvent(new MouseEvent('click'))" })).toEqual(["dispatchEvent", "synthetic-event"]);
    expect(lintAdapter({ js: "form.submit()" })).toEqual(["form-submit"]);
    expect(lintAdapter({ js: "dialog.close()" })).toEqual(["showModal-close"]);
  });

  it("allows observation and media-element APIs", () => {
    const clean =
      "var v=document.querySelector('video'); v.play(); v.pause(); v.currentTime=3;" +
      "new MutationObserver(function(){ frame.adBreak(true); frame.skipAvailable(!!document.querySelector('.skip')); })";
    expect(lintAdapter({ js: clean })).toEqual([]);
    expect(lintAdapter({ js: null })).toEqual([]);
  });

  it("the registry refuses violators regardless of intent and reports why", () => {
    const reg = new AdapterRegistry();
    reg.registerAll({
      good: { js: "frame.skipAvailable(true)", controls: { skip: ".skip" } },
      wellMeaning: { js: "/* auto-dismiss the cookie banner */ document.querySelector('.close').click()" },
    });
    expect(reg.get("good")).toBeDefined();
    expect(reg.get("wellMeaning")).toBeUndefined();
    expect(reg.rejected()).toEqual({ wellMeaning: ["click"] });
  });
});

/* ----------------------- IntermissionController ------------------------ */

describe("IntermissionController skip affordance (§26 pass-through)", () => {
  function rig() {
    const log: string[] = [];
    const c = new IntermissionController(
      {
        show: (id) => void log.push(`show:${id}`),
        hide: (id) => void log.push(`hide:${id}`),
        setMuted: () => {},
        setSkip: (id, a) => void log.push(`skip:${id}:${a}`),
      },
      { debounceMs: 1000, safetyTimeoutMs: 60_000 },
    );
    c.configure([{ id: "yt", enabled: true, source: "pack:cosmos", audio: "mute" }]);
    return { c, log };
  }

  it("shows the chip only while covered and the affordance exists; never acts on its own", () => {
    const { c, log } = rig();
    c.onSkipAvailable("yt", true); // before cover: remembered, no chip yet
    expect(log).toEqual([]);
    expect(c.skipTarget()).toBe("yt");
    c.onAdBreak("yt", true);
    vi.advanceTimersByTime(1000);
    expect(log).toEqual(["show:yt", "skip:yt:true"]);
    c.onSkipAvailable("yt", false);
    expect(log.at(-1)).toBe("skip:yt:false");
    c.onSkipAvailable("yt", true);
    c.onAdBreak("yt", false);
    expect(log.slice(-2)).toEqual(["skip:yt:false", "hide:yt"]);
    // Nothing in the log is a forward — the controller only ever shows/hides the chip.
  });
});

/* ------------------------- Orchestrator wiring -------------------------- */

function frame() {
  const calls: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const drivers: Drivers = {
    surface: {
      create: () => {}, destroy: () => {}, setRect: () => {}, setOpacity: () => {}, setZ: () => {},
      navigate: () => {}, freeze: () => {}, reveal: () => {}, suspend: () => {}, resume: () => {},
      setMuted: () => {},
      inject: (id, _css, js) => void calls.push({ op: "inject", id, js }),
      showIntermission: (id) => void calls.push({ op: "cover", id }),
      hideIntermission: (id) => void calls.push({ op: "uncover", id }),
      setIntermissionSkip: (id, available) => void calls.push({ op: "chip", id, available }),
    },
    store: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
  };
  const o = new Orchestrator(drivers);
  o.setAdapters({
    youtube: {
      js: "/* observe only */",
      controls: { skip: ".ytp-skip-ad-button", next: ".ytp-next-button" },
      overlays: [{ selector: ".ytp-ad-overlay-container", mode: "hide" }],
    },
  });
  const forwards = () => calls.filter((c) => c.op === "inject" && String(c.js).includes(".click()"));
  return { o, calls, forwards, api: new RemoteApi(o, drivers.store) };
}

const doc: DashboardDocument = {
  schema: "frame.dashboard/v0.1",
  id: "d", name: "D", layout: { mode: "grid" },
  tiles: [{
    id: "yt", url: "https://youtube.com", area: "1 / 1 / 2 / 2", audio: "exclusive", adapter: "youtube",
    intermission: { enabled: true, source: "pack:cosmos" },
  }],
};

describe("Orchestrator pass-through skip (§26)", () => {
  it("observation never forwards; a human ✓ / chip tap / phone button forwards exactly to the declared control", async () => {
    const { o, calls, forwards, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "ad-break", id: "yt", active: true });
    await vi.advanceTimersByTimeAsync(1000);
    await o.onSurfaceEvent({ type: "skip-available", id: "yt", available: true });
    expect(calls.find((c) => c.op === "chip")).toMatchObject({ id: "yt", available: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(forwards()).toEqual([]); // time passes; nothing is clicked
    expect(o.getState()!.tiles[0]).toMatchObject({ intermission: true, skipAvailable: true });

    await o.onInput({ key: "DPAD_CENTER" }); // mapped remote key
    expect(forwards()).toHaveLength(1);
    expect(String(forwards()[0]!.js)).toContain(".ytp-skip-ad-button");

    await o.onSurfaceEvent({ type: "intermission-skip", id: "yt" }); // chip tap on the frame
    expect(forwards()).toHaveLength(2);

    const { token } = await api.mintPairing("http://frame");
    const res = await api.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"skip"}', token });
    expect(res.status).toBe(200); // phone-remote button
    expect(forwards()).toHaveLength(3);
  });

  it("refuses to forward when the affordance is not observed, or the adapter declared no control", async () => {
    const { o, forwards, api } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    const { token } = await api.mintPairing("http://frame");
    const res = await api.handle({ method: "POST", path: "/tiles/yt/command", body: '{"cmd":"skip"}', token });
    expect(res.status).toBe(409);
    await o.onInput({ key: "ENTER" });
    expect(forwards()).toEqual([]);

    o.setAdapters({ youtube: { js: "" } });
    await o.onSurfaceEvent({ type: "skip-available", id: "yt", available: true });
    expect(await o.tileCommand("yt", "skip")).toBe("unknown-cmd");
    expect(forwards()).toEqual([]);
  });

  it("an observed target refines the declared control; close forwards a human dismissal (§27 pass-through)", async () => {
    const { o, forwards } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "skip-available", id: "yt", available: true, target: ".ytp-ad-skip-button-modern" });
    expect(await o.tileCommand("yt", "skip")).toBe("ok");
    expect(String(forwards()[0]!.js)).toContain(".ytp-ad-skip-button-modern");
    await o.onSurfaceEvent({ type: "skip-available", id: "yt", available: false });
    expect(await o.tileCommand("yt", "skip")).toBe("unavailable");
    expect(await o.tileCommand("yt", "close")).toBe("unknown-cmd"); // no declared close control
  });

  it("next/prev use declared controls only on a human command, never from adapter code", async () => {
    const { o, forwards } = frame();
    await o.load(doc, { w: 1000, h: 600 });
    expect(await o.tileCommand("yt", "next")).toBe("ok");
    expect(String(forwards()[0]!.js)).toContain(".ytp-next-button");
  });
});

/* ---------------------------- §27 partial veil -------------------------- */

describe("partial veil (§27)", () => {
  it("passes adapter overlays into the page script with hide/patch modes and no dismissal code", () => {
    const js = veilJs({
      selectors: [],
      images: [],
      overlays: [
        { selector: ".ytp-ad-overlay-container", mode: "hide" },
        { selector: ".player-banner", mode: "patch" },
      ],
    });
    expect(js).toContain('"overlays":[{"selector":".ytp-ad-overlay-container","mode":"hide"}');
    expect(js).toContain("ResizeObserver"); // tracked through resizes
    expect(js).toContain("fullscreenchange"); // and fullscreen
    expect(js).not.toMatch(/\.click\s*\(/); // §26 prohibition reaches veils
    expect(js).not.toMatch(/dispatchEvent/);
  });

  it("installs on the tile even when no list selectors match, because the adapter declared overlays", async () => {
    const { o, calls } = frame();
    await o.load({ ...doc, tiles: [{ ...doc.tiles[0]!, veil: { mode: "block+art" } }] }, { w: 1000, h: 600 });
    await o.onSurfaceEvent({ type: "load-finished", id: "yt", ok: true });
    const veil = calls.find((c) => c.op === "inject" && String(c.js).includes("__prismVeil"));
    expect(String(veil?.js)).toContain(".ytp-ad-overlay-container");
  });
});
