// What a report sends (2026-11-16: the Facebook block was built on the page and never put in what is sent; no test read the
// sent report, so no stored report had the block for months). The function is read out of report.js and run alone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "report.js"), "utf8");
const block = src.slice(src.indexOf("var DIAG_KEEP = ["), src.indexOf("PV.reportSendable = sendable;"));
const sendable = new Function("location", block + "; return sendable;")({ href: "https://www.example.com/a/page?x=1" });

const base = () => ({
  site: "www.example.com", coveredByPrism: false, nearbyAdLabel: "Sponsored", veil: { rule: "label", mode: "display" },
  target: { tag: "IMG" }, chain: [{ tag: "DIV" }], card: { tag: "DIV" }, stack: [{ tag: "IMG" }],
  diag: { isVisible: true, inViewport: true, errors: "x", ua: "chromium", iframes: ["player.example/embed"] },
});

describe("what a report sends", () => {
  it("is found in report.js", () => {
    expect(block.length).toBeGreaterThan(200);
    expect(typeof sendable).toBe("function");
  });
  it("carries the element's details, the kind, the version and the note, and only the kept diagnostics", () => {
    const p = sendable(base(), { kind: "display", note: "n".repeat(400), full: false }, "0.9.9");
    expect(p.site).toBe("www.example.com");
    expect(p.kind).toBe("display");
    expect(p.veil).toBe("0.9.9");
    expect(p.rule).toBe("label [display]");
    expect(p.target).toEqual({ tag: "IMG" });
    expect(p.chain.length).toBe(1);
    expect(p.note.length).toBe(280);
    expect(Object.keys(p.diag).sort()).toEqual(["framesOnPage", "framesWithPrism", "inViewport", "isVisible"]);
  });
  it("sends the page address and the players' addresses only when asked", () => {
    expect(sendable(base(), { kind: "display", full: false }, "1").url).toBeUndefined();
    const p = sendable(base(), { kind: "display", full: true }, "1");
    expect(p.url).toBe("https://www.example.com/a/page?x=1");
    expect(p.diag.iframes).toEqual(["player.example/embed"]);
  });
  it("sends the shapes of a Facebook post and its neighbours, never the header's text", () => {
    const r = base();
    r.fb = { posinset: "7", postH: 640, headerRow: "Paper Boats 13h", band: [{ text: "Paper Boats" }], headerLinks: ["x"], ariaLabels: ["Tall Grass"],
             shape: { roles: { profile_name: 1 }, buttons: ["Follow", "other"] }, near: [{ roles: {} }, { roles: {} }] };
    const p = sendable(r, { kind: "sponsored", full: true }, "1");
    expect(p.fb.shape.buttons).toEqual(["Follow", "other"]);
    expect(p.fb.near.length).toBe(2);
    expect(p.fb.posinset).toBe("7");
    expect(JSON.stringify(p)).not.toContain("Paper Boats");
    expect(JSON.stringify(p)).not.toContain("Tall Grass");
    expect(Object.keys(p.fb).sort()).toEqual(["near", "posinset", "postH", "shape", "shapeErr"]);
  });
  it("sends no Facebook block from another site, and says when the block could not be made", () => {
    expect(sendable(base(), { kind: "display" }, "1").fb).toBeUndefined();
    const r = base(); r.fbErr = "TypeError: " + "x".repeat(300);
    expect(sendable(r, { kind: "display" }, "1").fbErr.length).toBe(120);
    const r2 = base(); r2.fb = { shapeErr: "Error: no" };
    expect(sendable(r2, { kind: "display" }, "1").fb.shapeErr).toBe("Error: no");
  });
  it("keeps a person's name off a button word: only Facebook's own words pass", () => {
    const m = /var FB_WORDS = (\/.*\/);/.exec(src);
    expect(m).toBeTruthy();
    const re = new Function("return " + m[1])();
    for (const w of ["Follow", "Join", "Like", "Share", "Not interested", "Sponsored"]) expect(re.test(w)).toBe(true);
    for (const w of ["Paper Boats", "Tall Grass", "Evening Beats", "follow me"]) expect(re.test(w)).toBe(false);
  });
});

// 2026-11-22: three reports from Facebook's Reels pages sent the tab bar and nothing of the reel, the card being the whole screen
describe("a report from a pager of screens", () => {
  const fn = src.slice(src.indexOf("PV.reportPagerItem = function"), src.indexOf("function clearLayer("));
  const box = (top, h) => ({ getBoundingClientRect: () => ({ top, bottom: top + h, height: h }), children: [], querySelectorAll: () => [] });
  const make = () => { const PV = {}; new Function("PV", "innerHeight", fn)(PV, 800); return PV.reportPagerItem; };
  it("takes the screen in view as the card", () => {
    const reels = [box(-750, 750), box(0, 750), box(750, 750), box(1500, 750), box(2250, 750)];
    const pager = { ...box(0, 750), children: reels };
    const screen = { ...box(0, 800), children: [box(0, 50), pager], querySelectorAll: () => [pager, ...reels] };
    expect(make()(screen)).toBe(reels[1]);
  });
  it("leaves a feed of short posts alone", () => {
    const posts = [box(0, 300), box(300, 900), box(1200, 200), box(1400, 300), box(1700, 300)];
    const feed = { ...box(0, 2000), children: posts, querySelectorAll: () => posts };
    expect(make()(feed)).toBe(null);
  });
});
