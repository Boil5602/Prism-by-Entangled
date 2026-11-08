import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AMBIENT_FLOOR,
  AMBIENT_SWING,
  ARTWORK_CROSSFADE_MS,
  PRISM_BANDS,
  SILENT_SOURCE,
  VISUALIZATION_STYLE_IDS,
  ambientSignal,
  artworkPresentation,
  decodeBase64Bytes,
  dominantColors,
  normalizeStylePack,
  smoothBands,
  testSignal,
  tintPalette,
} from "../src/visualization.js";
import { visualizationFeed } from "../src/music-state.js";
import { SPORTS_MULTIVIEW } from "../src/scene-model.js";
import type { Visualization } from "../src/scene-model.js";

const here = dirname(fileURLToPath(import.meta.url));
const packsDir = join(here, "../data/visualization-styles");

describe("§32 style packs — the twenty shipped packs are valid data", () => {
  const files = readdirSync(packsDir).filter((f) => f.endsWith(".json")).sort();
  it("ships exactly the twenty packs core names: the four originals, eight environment tableaus, eight community tableaus", () => {
    expect(files).toEqual([...VISUALIZATION_STYLE_IDS].map((id) => id + ".json").sort());
    expect(files).toHaveLength(20);
    const ids = files.map((f) => normalizeStylePack(JSON.parse(readFileSync(join(packsDir, f), "utf8")))!.id).sort();
    expect(ids).toEqual([...VISUALIZATION_STYLE_IDS].sort());
  });
  it("every pack normalizes to itself (no field the validator has to repair)", () => {
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(packsDir, f), "utf8"));
      const pack = normalizeStylePack(raw)!;
      expect(pack, f).not.toBeNull();
      expect(pack.id).toBe(raw.id);
      expect(pack.palette).toEqual(raw.palette);
      expect(pack.motion).toEqual(raw.motion);
      expect(pack.reducedMotion).toEqual(raw.reducedMotion);
      expect(pack.params).toEqual(raw.params);
      expect(pack.background).toBe("transparent");
      expect(pack.reducedMotion.speed).toBeLessThan(pack.motion.speed);
    }
  });
  it("Prism Beams is the signature: the brand's four bands, in order", () => {
    const beams = normalizeStylePack(JSON.parse(readFileSync(join(packsDir, "prism-beams.json"), "utf8")))!;
    expect(beams.program).toBe("beams");
    expect(beams.palette).toEqual([...PRISM_BANDS]);
  });
  it("a malformed community pack is refused or repaired to safe defaults, never guessed at", () => {
    expect(normalizeStylePack(null)).toBeNull();
    expect(normalizeStylePack({ id: "x", program: "shader" })).toBeNull();
    expect(normalizeStylePack({ id: "Bad Id", program: "bars" })).toBeNull();
    const repaired = normalizeStylePack({ id: "sparse", program: "bars", palette: ["nope", "#123456"], bands: 9999, background: "red", motion: { speed: 99 } })!;
    expect(repaired.palette).toEqual(["#123456"]);
    expect(repaired.bands).toBe(128);
    expect(repaired.background).toBe("transparent");
    expect(repaired.motion.speed).toBe(4);
    expect(normalizeStylePack({ id: "nopal", program: "ribbon" })!.palette).toEqual([...PRISM_BANDS]);
  });
});

describe("§32 artwork modes and the §16 crossfade", () => {
  const viz = (artwork: Visualization["artwork"]): Visualization => ({ id: "v", source: "spotify", style: "prism-beams", artwork });
  const playing = { facet: "spotify", playbackState: "playing" as const, metadata: { title: "t", artwork: "https://i.scdn.co/a.jpg" }, position: null, duration: null, actions: [], updatedAt: 0 };
  it("off shows nothing; backdrop blurs, dims and drifts; focal is sharp and still", () => {
    expect(artworkPresentation(visualizationFeed(viz("off"), playing), false).url).toBeNull();
    const back = artworkPresentation(visualizationFeed(viz("backdrop"), playing), false);
    expect(back).toMatchObject({ mode: "backdrop", url: "https://i.scdn.co/a.jpg", drift: true, crossfadeMs: ARTWORK_CROSSFADE_MS });
    expect(back.blur).toBeGreaterThan(0);
    expect(back.dim).toBeGreaterThan(0.3);
    const focal = artworkPresentation(visualizationFeed(viz("focal"), playing), false);
    expect(focal).toMatchObject({ mode: "focal", url: "https://i.scdn.co/a.jpg", blur: 0, drift: false });
  });
  it("reduced motion keeps the dissolve and drops the drift; a paused source idles dark", () => {
    expect(artworkPresentation(visualizationFeed(viz("backdrop"), playing), true).drift).toBe(false);
    expect(artworkPresentation(visualizationFeed(viz("backdrop"), { ...playing, playbackState: "paused" }), false).url).toBeNull();
    expect(artworkPresentation(visualizationFeed(viz("focal"), undefined), false).url).toBeNull();
  });
});

describe("§32 palette tint from album art", () => {
  it("no art → the pack's default palette; art moves each band toward a dominant color", () => {
    expect(tintPalette(PRISM_BANDS, null)).toEqual([...PRISM_BANDS]);
    expect(tintPalette(PRISM_BANDS, [])).toEqual([...PRISM_BANDS]);
    const tinted = tintPalette(["#000000", "#FFFFFF"], ["#FF0000"], 0.5);
    expect(tinted).toEqual(["#800000", "#FF8080"]);
    expect(tintPalette(["#000000"], ["#FF0000"], 1)).toEqual(["#FF0000"]);
    expect(tintPalette(["#000000"], ["zzz"], 1)).toEqual(["#000000"]);
  });
  it("dominant colors: quantized buckets by weight, black and white skipped, deterministic", () => {
    const px: number[] = [];
    const put = (r: number, g: number, b: number, n: number) => { for (let i = 0; i < n; i++) px.push(r, g, b, 255); };
    put(10, 10, 10, 50);      // near-black: skipped
    put(250, 250, 250, 50);   // near-white: skipped
    put(200, 40, 40, 20);
    put(40, 200, 60, 30);
    put(40, 60, 200, 10);
    px.push(200, 40, 40, 0);  // transparent: skipped
    expect(dominantColors(px, 2)).toEqual(["#28C83C", "#C82828"]);
    expect(dominantColors(new Uint8Array(px), 3)).toHaveLength(3);
    expect(dominantColors([], 4)).toEqual([]);
  });
});

describe("§32 audio source contract — silent idle and the deterministic test signal", () => {
  it("silent source idles dark", () => {
    expect(SILENT_SOURCE.active()).toBe(false);
    expect(SILENT_SOURCE.bands(4)).toEqual([0, 0, 0, 0]);
    expect(SILENT_SOURCE.bands(0)).toEqual([]);
  });
  it("test signal is pure, bounded, and the same frame every port must produce", () => {
    const a = testSignal(1.25, 8), b = testSignal(1.25, 8);
    expect(a).toEqual(b);
    expect(a).toHaveLength(8);
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(testSignal(0, 0)).toEqual([]);
    // the 120 bpm pulse: band 0 peaks on the beat and falls between beats
    expect(testSignal(0, 8)[0]!).toBeGreaterThan(testSignal(0.25, 8)[0]!);
    // pinned frame (the C# twin's unit test compares against these numbers)
    expect(testSignal(0.5, 4).map((v) => Number(v.toFixed(4)))).toEqual([0.5859, 0.2661, 0.6799, 0.3406]);
    expect(testSignal(2, 8).map((v) => Number(v.toFixed(4)))).toEqual([0.58, 0.2947, 0.0836, 0.1031, 0.1775, 0.4997, 0.6576, 0.6798]);
  });
  it("smoothing follows attack up and release down; reduced motion is gentler", () => {
    const motion = { speed: 1, attack: 0.5, release: 0.1, beat: 0 };
    expect(smoothBands([0, 1], [1, 0], motion, false)).toEqual([0.5, 0.9]);
    const gentle = smoothBands([0, 1], [1, 0], motion, true);
    expect(gentle[0]!).toBeLessThan(0.5);
    expect(gentle[1]!).toBeGreaterThan(0.9);
    expect(smoothBands([], [0.3], motion, false)).toEqual([0.15]);
  });
});

describe("concept-scenes §2.5.2 point 6 — idle drifts, never a black screen", () => {
  it("every band of every ambient frame sits at or above the floor (that IS the guarantee)", () => {
    for (const n of [1, 4, 16, 64]) {
      for (let t = 0; t < 40; t += 0.37) {
        const frame = ambientSignal(t, n);
        expect(frame).toHaveLength(n);
        for (const v of frame) {
          expect(v).toBeGreaterThanOrEqual(AMBIENT_FLOOR);
          expect(v).toBeLessThanOrEqual(AMBIENT_FLOOR + AMBIENT_SWING);
        }
      }
    }
    expect(ambientSignal(0, 0)).toEqual([]);
  });
  it("it is a slow drift, not a beat: it moves far less than the live signal, and it does move", () => {
    const spread = (f: number[]) => Math.max(...f) - Math.min(...f);
    expect(spread(ambientSignal(3, 16))).toBeLessThan(spread(testSignal(3, 16)));
    expect(ambientSignal(0, 8)).not.toEqual(ambientSignal(6, 8));
    // pinned frames: the C# twin (PrismHost.Core VisualizationChrome.Ambient) compares against these
    expect(ambientSignal(2, 4).map((v) => Number(v.toFixed(4)))).toEqual([0.0973, 0.1163, 0.0661, 0.0577]);
    expect(ambientSignal(0, 1).map((v) => Number(v.toFixed(4)))).toEqual([0.085]);
  });
});

describe("artwork pixels cross the seam as base64 so CORE derives the palette", () => {
  it("decodes what a shell encodes, whitespace and padding included", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 128]);
    const b64 = Buffer.from(bytes).toString("base64");
    expect([...decodeBase64Bytes(b64)]).toEqual([...bytes]);
    expect([...decodeBase64Bytes("  " + b64.slice(0, 4) + "\n" + b64.slice(4) + "  ")]).toEqual([...bytes]);
    expect([...decodeBase64Bytes("")]).toEqual([]);
  });
  it("a decoded RGBA sample yields the same dominant colours as the raw bytes", () => {
    const px: number[] = [];
    for (let i = 0; i < 64; i++) px.push(0x30, 0x80, 0xd0, 255);
    for (let i = 0; i < 16; i++) px.push(0xd0, 0x40, 0x30, 255);
    const raw = dominantColors(px, 4);
    expect(raw.length).toBeGreaterThan(0);
    expect(dominantColors(decodeBase64Bytes(Buffer.from(Uint8Array.from(px)).toString("base64")), 4)).toEqual(raw);
  });
});

/* ------------------------------ CS-10.6: the mockup and the wall agree ---- */

describe("the website mockup draws the brand's bands (P2 rejected)", () => {
  const mockup = readFileSync(new URL("../../../prototypes/prism-website-mockups.jsx", import.meta.url), "utf8");

  it("T.beams IS PRISM_BANDS - a marketing draft does not move the brand's palette", () => {
    const m = /beams: \[([^\]]+)\]/.exec(mockup);
    expect(m).toBeTruthy();
    const beams = m![1]!.split(",").map((x) => x.trim().replace(/["']/g, ""));
    expect(beams).toEqual([...PRISM_BANDS]);
    // Scope note: P2 is about the BEAMS palette only. Mock 1's calendar colours
    // (#8FBF6B, #5B9BD5, #E8654F) are per-event chips, not brand bands, and are
    // deliberately left alone - asserting the whole file is free of those hexes
    // would be a wrong reading of the verdict.
  });

  it("mock 4 still carries the adopted composition (P1, P3, P5b)", () => {
    expect(mockup).toContain('top: "44%"');                 // P1: the prism centre
    expect(mockup).toContain("const bars = 42;");           // P3: the spectrum floor
    expect(mockup).toContain('opacity="0.5"');              // P3: the beams stay the subject
    expect(mockup).toContain("PRISM BEAMS · backdrop: album art");   // P5b: the label text
  });

  it("mock 3 is the hero-plus-two Sports blueprint CS-10.2 landed", () => {
    // the mockup was always hero-plus-two; CS-10.2 moved the template TO it
    expect(mockup).toContain('width: "66.5%", height: "84%"');
    expect(mockup).toContain('left: "66.5%", top: 0, width: "33.5%", height: "84%"');
    expect(SPORTS_MULTIVIEW.slots.find((s) => s.role === "game1")!.rect).toEqual({ x: 0, y: 0, w: 0.665, h: 0.84 });
    expect(SPORTS_MULTIVIEW.slots.map((s) => s.role)).toEqual(["game1", "game2", "game3", "scores"]);
  });
});
