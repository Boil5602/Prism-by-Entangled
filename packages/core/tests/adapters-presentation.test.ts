import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PresentationKeeperRunner, resolvePresentationAction } from "../src/adapters-presentation.js";
import { CORRELATION_MS } from "../src/presentation-keeper.js";
import type { AdapterSpec } from "../src/adapters.js";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../src");

const youtube: AdapterSpec = {
  presentation: { enterFullscreen: ".ytp-fullscreen-button", enterTheater: ".ytp-size-button", play: ".ytp-play-button" },
};

describe("presentation actions (§26 standing instruction only)", () => {
  it("resolves a keeper action to the adapter's OWN control by name", () => {
    const r = resolvePresentationAction(youtube, { kind: "enterFullscreen", reason: "ad-break" });
    expect(r.js).toContain('".ytp-fullscreen-button"');
    expect(r.js).toContain(".click()");
    expect(resolvePresentationAction(youtube, { kind: "play", reason: "onEnd" }).js).toContain(".ytp-play-button");
  });
  it("an adapter without the action degrades to nothing - no generic fullscreen hunt", () => {
    expect(resolvePresentationAction({ presentation: { play: "#p" } }, { kind: "enterFullscreen", reason: "ad-break" }).js).toBeNull();
    expect(resolvePresentationAction(undefined, { kind: "enterTheater", reason: "ended" }).js).toBeNull();
    expect(resolvePresentationAction({ presentation: { enterFullscreen: "  " } }, { kind: "enterFullscreen", reason: "ad-break" }).js).toBeNull();
  });
  it("the runner emits nothing for a surface with no standing instruction, whatever the site does", () => {
    const k = new PresentationKeeperRunner();
    k.attach("hero", { keepPresentation: false, onEnd: "none" }, youtube);
    const out = [
      k.handle("hero", { type: "presentation", at: 0, state: "fullscreen" }),
      k.handle("hero", { type: "ad-break", at: 10_000, active: true }),
      k.handle("hero", { type: "presentation", at: 10_100, state: "none" }),
      k.handle("hero", { type: "ad-break", at: 40_000, active: false }),
      k.handle("hero", { type: "ended", at: 90_000 }),
    ].flat();
    expect(out).toEqual([]);
  });
  it("with keepPresentation the site-initiated drop restores at the break's END through the adapter control", () => {
    const k = new PresentationKeeperRunner();
    k.attach("hero", { keepPresentation: true, onEnd: "none" }, youtube);
    expect(k.handle("hero", { type: "presentation", at: 0, state: "fullscreen" })).toEqual([]);
    expect(k.handle("hero", { type: "ad-break", at: 10_000, active: true })).toEqual([]);
    expect(k.handle("hero", { type: "presentation", at: 10_100, state: "none" })).toEqual([]);   // held: never during the ad
    const end = k.handle("hero", { type: "ad-break", at: 40_000, active: false });
    expect(end).toHaveLength(1);
    expect(end[0]!.action).toEqual({ kind: "enterFullscreen", reason: "ad-break" });
    expect(end[0]!.js).toContain(".ytp-fullscreen-button");
  });
  it("a human exit (Esc within 1 s) is never fought - even with the instruction set", () => {
    const k = new PresentationKeeperRunner();
    k.attach("hero", { keepPresentation: true, onEnd: "none" }, youtube);
    k.handle("hero", { type: "presentation", at: 0, state: "fullscreen" });
    k.handle("hero", { type: "user-input", at: 5_000 });
    expect(k.handle("hero", { type: "presentation", at: 5_200, state: "none" })).toEqual([]);
    expect(k.handle("hero", { type: "tick", at: 5_200 + CORRELATION_MS + 1 })).toEqual([]);
    expect(k.handle("hero", { type: "ad-break", at: 9_000, active: true })).toEqual([]);
    expect(k.handle("hero", { type: "ad-break", at: 20_000, active: false })).toEqual([]);
  });
  it("unknown surfaces and detached surfaces produce nothing", () => {
    const k = new PresentationKeeperRunner();
    expect(k.handle("x", { type: "ended", at: 1 })).toEqual([]);
    k.attach("x", { keepPresentation: true, onEnd: "restart-fullscreen" }, youtube);
    k.detach("x");
    expect(k.has("x")).toBe(false);
    expect(k.handle("x", { type: "ended", at: 1 })).toEqual([]);
  });
  it("adapter `presentation` is read in exactly one place in core: the keeper's action resolver", () => {
    const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    const readers: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(srcDir, f), "utf8");
      // a read of the block (not the type declaration, not a comment mention)
      const hits = src.match(/\.presentation\?\.\[|\.presentation\?\.[a-zA-Z]|\.presentation\.[a-zA-Z[]/g) ?? [];
      const reads = hits.filter(() => f !== "adapters.ts");
      if (reads.length) readers.push(`${f}:${reads.length}`);
    }
    expect(readers).toEqual(["adapters-presentation.ts:1"]);
    const resolver = readFileSync(join(srcDir, "adapters-presentation.ts"), "utf8");
    expect(resolver.match(/spec\?\.presentation\?\.\[action\.kind\]/g)).toHaveLength(1);
    // and the only thing that turns a control into page JS is clickControlJs, called from resolvePresentationAction alone in this file
    expect(resolver.match(/clickControlJs\(/g)).toHaveLength(1);
  });
});
