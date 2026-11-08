// YouTube TV's own ad slots (src/ytv-cues.js, opt-in pv:ui.ytvVeil, 2026-11-06): a "Cuepoint-Event:" mark in the stream data the
// page appends puts up the SDK ad flag for the slot's announced remaining length, only while the switch is mirrored on.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(here, "..", "src", "ytv-cues.js"), "utf8");

function cueBytes(ev, dur, pos) {
  const s = "\x00\x01junk Cuepoint-Event: " + ev + "\nCuepoint-Type: AD\nCuepoint-Total-Duration-Sec: " + dur + "\nCuepoint-Playhead-Time-Sec: " + pos + "\n\x00more";
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

describe("YouTube TV ad slot marks", () => {
  let appended;
  beforeEach(() => {
    vi.useFakeTimers();
    try { window.happyDOM.setURL("https://tv.youtube.com/watch/abc"); } catch (e) {}
    window.__prismYtvCues = undefined;
    appended = [];
    window.SourceBuffer = function () {};
    window.SourceBuffer.prototype.appendBuffer = function (d) { appended.push(d); };
    globalThis.SourceBuffer = window.SourceBuffer;
    document.documentElement.removeAttribute("data-prism-ad");
    document.documentElement.removeAttribute("data-prism-adrem");
    (0, eval)(CODE);
  });
  afterEach(() => { vi.useRealTimers(); });
  const flag = () => document.documentElement.getAttribute("data-prism-ad");
  const sb = () => { const b = new window.SourceBuffer(); b.buffered = { length: 0 }; return b; };

  it("a slot's start puts the flag up for its remaining length, then down", () => {
    document.documentElement.setAttribute("data-prism-ytv", "on");
    sb().appendBuffer(cueBytes("EVENT_START", 30, 0));
    expect(appended.length).toBe(1);                       // the data is passed on unchanged
    vi.advanceTimersByTime(300);
    expect(flag()).toBe("active");
    expect(Number(document.documentElement.getAttribute("data-prism-adrem"))).toBeGreaterThan(28);
    vi.advanceTimersByTime(33000);
    expect(flag()).toBe("idle");
    expect(document.documentElement.hasAttribute("data-prism-adrem")).toBe(false);
  });
  it("with the switch off nothing is read and the flag is never touched", () => {
    document.documentElement.setAttribute("data-prism-ytv", "off");
    sb().appendBuffer(cueBytes("EVENT_START", 30, 0));
    vi.advanceTimersByTime(1000);
    expect(flag()).toBe(null);
    expect(appended.length).toBe(1);
  });
  it("turning the switch off during a slot takes the flag down at once", () => {
    document.documentElement.setAttribute("data-prism-ytv", "on");
    sb().appendBuffer(cueBytes("EVENT_START", 60, 0));
    vi.advanceTimersByTime(300);
    expect(flag()).toBe("active");
    document.documentElement.setAttribute("data-prism-ytv", "off");
    vi.advanceTimersByTime(300);
    expect(flag()).toBe("idle");
  });
  it("STOP near the end: the slot runs to its announced length, 8 s at most", () => {
    document.documentElement.setAttribute("data-prism-ytv", "on");
    sb().appendBuffer(cueBytes("EVENT_START", 120, 0));
    vi.advanceTimersByTime(300);
    sb().appendBuffer(cueBytes("EVENT_STOP", 120, 115));
    vi.advanceTimersByTime(4000);
    expect(flag()).toBe("active");
    vi.advanceTimersByTime(2000);
    expect(flag()).toBe("idle");
  });
});
