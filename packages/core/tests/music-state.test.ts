import { describe, expect, it } from "vitest";
import { MusicStateModel, emptySource, reduceSource, transportAvailability, visualizationFeed } from "../src/music-state.js";
import { normalizeScene, type Visualization } from "../src/scene-model.js";
import { PRISM_BANDS, tintPalette } from "../src/visualization.js";

const beams: Visualization = { id: "viz-kitchen", source: "spotify-hidden", style: "prism-beams", artwork: "backdrop" };

describe("§32 music state — Media Session per hidden facet", () => {
  it("reduces metadata / playbackState / position / actions events; 'gone' resets", () => {
    let s = emptySource("spotify-hidden");
    s = reduceSource(s, { type: "metadata", metadata: { title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue", artwork: "https://i.scdn.co/x.jpg" } }, 10);
    s = reduceSource(s, { type: "playbackState", state: "playing" }, 11);
    s = reduceSource(s, { type: "position", position: 42, duration: 337 }, 12);
    s = reduceSource(s, { type: "actions", actions: ["play", "pause", "nexttrack"] }, 13);
    expect(s).toEqual({
      facet: "spotify-hidden", playbackState: "playing",
      metadata: { title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue", artwork: "https://i.scdn.co/x.jpg" },
      position: 42, duration: 337, actions: ["play", "pause", "nexttrack"], updatedAt: 13,
    });
    expect(reduceSource(s, { type: "gone" }, 20)).toEqual(emptySource("spotify-hidden", 20));
    expect(reduceSource(s, { type: "playbackState", state: "weird" as never }, 21).playbackState).toBe("none");
  });
  it("a visualization idles dark without a playing source; artwork follows the placement's mode", () => {
    expect(visualizationFeed(beams, undefined)).toMatchObject({ active: false, metadata: null, artwork: null, playbackState: "none" });
    const paused = reduceSource(reduceSource(emptySource("spotify-hidden"), { type: "metadata", metadata: { title: "x", artwork: "https://a/1.jpg" } }, 1), { type: "playbackState", state: "paused" }, 2);
    expect(visualizationFeed(beams, paused)).toMatchObject({ active: false, artwork: null, playbackState: "paused" });
    const playing = reduceSource(paused, { type: "playbackState", state: "playing" }, 3);
    expect(visualizationFeed(beams, playing)).toMatchObject({ active: true, artwork: "https://a/1.jpg", artworkMode: "backdrop", style: "prism-beams", metadata: { title: "x", artwork: "https://a/1.jpg" } });
    expect(visualizationFeed({ ...beams, artwork: "off" }, playing).artwork).toBeNull();
  });
  it("one hidden facet feeds multiple visualizations", () => {
    const m = new MusicStateModel();
    m.configure(["spotify-hidden"]);
    m.onMediaSession("spotify-hidden", { type: "playbackState", state: "playing" }, 1);
    const feeds = m.feeds([beams, { ...beams, id: "viz-2", style: "bloom", artwork: "off" }]);
    expect(feeds.map((f) => [f.visualization, f.active, f.style])).toEqual([["viz-kitchen", true, "prism-beams"], ["viz-2", true, "bloom"]]);
    expect(m.sourcesPlaying()).toEqual(["spotify-hidden"]);
  });
  it("events for facets that are not configured sources are inert", () => {
    const m = new MusicStateModel();
    m.configure(["a"]);
    expect(m.onMediaSession("b", { type: "playbackState", state: "playing" }, 1)).toBeNull();
    expect(m.source("b")).toBeUndefined();
  });
  it("transport availability: registered actions enable; the rest render disabled, never hidden", () => {
    const s = reduceSource(emptySource("x"), { type: "actions", actions: ["nexttrack"] }, 1);
    expect(transportAvailability(s)).toEqual({ play: false, pause: false, previoustrack: false, nexttrack: true });
    expect(transportAvailability(reduceSource(s, { type: "playbackState", state: "playing" }, 2)).pause).toBe(true);
    expect(Object.keys(transportAvailability(undefined))).toEqual(["play", "pause", "previoustrack", "nexttrack"]);
  });
});

describe("§32 reveal is transient, never a placement", () => {
  it("reveal/collapse lives in runtime state; the scene document has no such field", () => {
    const m = new MusicStateModel();
    m.configure(["spotify-hidden"]);
    expect(m.revealVisualization(beams, "hero")).toEqual({ facet: "spotify-hidden", mode: "hero" });
    expect(m.revealed().facet).toBe("spotify-hidden");
    expect(m.collapse()).toEqual({ facet: null, mode: "panel" });
    // reconfiguring away the source collapses it too
    m.revealSource("spotify-hidden");
    m.configure([]);
    expect(m.revealed().facet).toBeNull();
    // a scene round-trips without any reveal state: it is not a placement
    const scene = normalizeScene({ id: "s", layout: "l", hidden: [{ facet: "spotify-hidden", audio: "exclusive" }], visualizations: [beams], reveal: { facet: "spotify-hidden" } })!;
    expect(JSON.stringify(scene)).not.toContain("reveal");
  });
  it("revealing an unknown source is refused", () => {
    const m = new MusicStateModel();
    expect(m.revealSource("nope").facet).toBeNull();
  });
});

describe("concept-scenes §2.5.2 — what the feed carries so no shell decides anything", () => {
  function playing(m: MusicStateModel, artwork: string | null = "https://a/cover.jpg") {
    m.configure(["spotify-hidden"]);
    m.onMediaSession("spotify-hidden", { type: "metadata", metadata: { title: "Aurora Skies", artist: "The Refractions", artwork } }, 1);
    m.onMediaSession("spotify-hidden", { type: "playbackState", state: "playing" }, 2);
  }
  // a 2x2 sample: three cyan-ish pixels and one warm one, opaque
  const sample = Uint8Array.from([0x30, 0x80, 0xd0, 255, 0x30, 0x80, 0xd0, 255, 0x30, 0x80, 0xd0, 255, 0xd0, 0x40, 0x30, 255]);

  it("point 2: core tints the pack's palette from the art — backdrop only, and only while it is playing", () => {
    const m = new MusicStateModel();
    expect(m.registerStylePalettes({ "prism-beams": PRISM_BANDS as string[], bogus: ["not-a-hex"], nope: "x" })).toBe(1);
    playing(m);
    // no sample yet: the pack's palette stands
    expect(m.feed(beams).palette).toEqual([...PRISM_BANDS]);
    expect(m.feed(beams).dominant).toBeNull();
    const dominant = m.noteArtworkColors("spotify-hidden", "https://a/cover.jpg", sample)!;
    expect(dominant.length).toBeGreaterThan(0);
    const tinted = m.feed(beams);
    expect(tinted.dominant).toEqual(dominant);
    expect(tinted.palette).toEqual(tintPalette(PRISM_BANDS, dominant));
    expect(tinted.palette).not.toEqual([...PRISM_BANDS]);
    // focal and off keep the pack's palette (§32)
    expect(m.feed({ ...beams, artwork: "focal" }).palette).toEqual([...PRISM_BANDS]);
    expect(m.feed({ ...beams, artwork: "off" }).palette).toEqual([...PRISM_BANDS]);
    // an unregistered style falls back to the brand's bands rather than guessing
    expect(m.feed({ ...beams, style: "ribbon" }).palette.length).toBe(PRISM_BANDS.length);
  });

  it("point 2: a sample never outlives its track, and a paused source is not tinted", () => {
    const m = new MusicStateModel();
    m.registerStylePalettes({ "prism-beams": PRISM_BANDS as string[] });
    playing(m);
    m.noteArtworkColors("spotify-hidden", "https://a/cover.jpg", sample);
    expect(m.feed(beams).dominant).not.toBeNull();
    // next track, new art, no sample yet: back to the pack's palette instead of the last track's colours
    m.onMediaSession("spotify-hidden", { type: "metadata", metadata: { title: "Second", artwork: "https://a/other.jpg" } }, 3);
    expect(m.feed(beams).dominant).toBeNull();
    expect(m.feed(beams).palette).toEqual([...PRISM_BANDS]);
    // paused: nothing is playing, so nothing is tinted
    m.onMediaSession("spotify-hidden", { type: "metadata", metadata: { title: "Aurora Skies", artwork: "https://a/cover.jpg" } }, 4);
    m.onMediaSession("spotify-hidden", { type: "playbackState", state: "paused" }, 5);
    expect(m.feed(beams).palette).toEqual([...PRISM_BANDS]);
    // a sample for a facet that is not a source is inert
    expect(m.noteArtworkColors("nobody", "https://a/cover.jpg", sample)).toBeNull();
  });

  it("point 3: audioOwner is core's answer about §3 focus, per feed", () => {
    const m = new MusicStateModel();
    playing(m);
    expect(m.feed(beams).audioOwner).toBe(false);                       // nobody owns audio
    expect(m.feed(beams, "spotify-hidden").audioOwner).toBe(true);      // this source owns it: "♪ exclusive"
    expect(m.feed(beams, "hulu-live").audioOwner).toBe(false);          // someone else does: "muted"
    expect(m.feeds([beams], "spotify-hidden").map((f) => f.audioOwner)).toEqual([true]);
  });
});
