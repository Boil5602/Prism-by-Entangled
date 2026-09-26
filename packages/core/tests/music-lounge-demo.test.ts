/**
 * CS-9 — Music Lounge in the Parkers' house (docs/concept-scenes.md §2.5, §7)
 * and the §2.5 fixtures.
 *
 * The seed ships the lounge IDLE: its hidden `source` role takes the same
 * `demo:placeholder` every account-needing role takes, so nothing loads,
 * nothing is signed in, no third-party name appears — and the stage draws the
 * ambient drift with an empty metadata line over the dark substrate (§2.5.2
 * point 6). "Aurora Skies" / "The Refractions" (`DEMO_TRACK`) is FIXTURE data
 * for that stage, defined once in the seed module so the marketing shot and
 * these assertions answer to one text; the seed never plays it.
 *
 * What is pinned here, in the charter's order:
 *   1. §2.5.1 — the template completes with each of the three suggestions
 *      (mocked), and the stage is never a second question
 *   2. §2.5.2 point 6 — idle drift renders, and is never a black screen
 *   3. §2.5.2 point 3 — the metadata line populates from a synthetic Media
 *      Session event, through the real reducer and the real feed
 *   4. §2.5.2 point 4 / §32 layer 3 — transport is pass-through only
 *   5. §2.5.3 — reveal and collapse never interrupt the audio
 *   6. the shot reproduces from the demo
 *
 * The host halves of 2, 3 and 6 are `PrismHost.Tests/MusicLoungeDemoTests.cs`
 * (VisualizationChrome builds the strings; this file proves core hands it the
 * right feed).
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "../src/scene-model.js";
import {
  MUSIC_LOUNGE,
  instantiateTemplate,
  sceneDocument,
  templateAudioOwner,
  templateCompletion,
  type App,
  type Facet,
  type Layout,
  type Scene,
} from "../src/scene-model.js";
import { MusicStateModel, transportAvailability, type MediaSessionEvent } from "../src/music-state.js";
import { AMBIENT_FLOOR, AMBIENT_SWING, PRISM_BANDS, ambientSignal } from "../src/visualization.js";
import { clickControlJs, mediaFallbackJs } from "../src/adapters.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { Drivers } from "../src/drivers.js";
import type { DashboardDocument } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const seedModule = join(here, "..", "..", "..", "scripts", "seed-demo-household.mjs");
const seed = (await import(/* @vite-ignore */ seedModule)) as typeof import("../../../scripts/seed-demo-household.mjs");
const { DEMO_TRACK, PLACEHOLDER_REF, STORE_KEYS, applySeed, demoTrackEvents } = seed as any;

const FHD = { w: 1920, h: 1080 };
const NOW = "2026-09-02T00:00:00.000Z";

/**
 * The glyphs the metadata line is made of, by code point rather than typed, so
 * this file is plain ASCII on disk and cannot drift with an encoding
 * round-trip — the same discipline as `VisualizationChrome` host-side and
 * `DEMO_TRACK.line` in the seed.
 */
const EM_DASH = String.fromCharCode(0x2014);
const MIDDOT = String.fromCharCode(0x00b7);
const EIGHTH_NOTE = String.fromCharCode(0x266a);

/**
 * The bottom-left line, assembled exactly the way the host's
 * `VisualizationChrome.Metadata(active, title, artist, audioOwner)` does
 * (§2.5.2 point 3), from CORE's feed and nothing else. This is the JS twin of
 * that method; `PrismHost.Tests/MusicLoungeDemoTests.cs` holds the C# half
 * against the same strings.
 */
function metadataLine(feed: { active: boolean; metadata: { title?: string; artist?: string } | null; audioOwner: boolean }) {
  if (!feed.active) return { now: "", state: "" };
  const t = (feed.metadata?.title ?? "").trim();
  const a = (feed.metadata?.artist ?? "").trim();
  return {
    now: t && a ? `${t} ${EM_DASH} ${a}` : t || a,
    state: feed.audioOwner ? `${EIGHTH_NOTE} exclusive` : `muted`,
  };
}

/* ------------------------------------------------------------- the rig ---- */

type Op = Record<string, unknown>;

function rig() {
  const ops: Op[] = [];
  const drivers: Drivers = {
    surface: {
      create: (o) => void ops.push({ op: "create", id: o.id, kind: o.kind ?? null, placeholder: !!o.placeholder }),
      destroy: (id) => void ops.push({ op: "destroy", id }),
      setRect: () => {},
      setOpacity: () => {},
      setZ: (id, z) => void ops.push({ op: "setZ", id, z }),
      navigate: (id, url) => void ops.push({ op: "navigate", id, url }),
      inject: (id, _css, js) => void ops.push({ op: "inject", id, js: js ?? "" }),
      freeze: () => {},
      reveal: (id) => void ops.push({ op: "reveal", id }),
      suspend: (id) => void ops.push({ op: "suspend", id }),
      resume: (id) => void ops.push({ op: "resume", id }),
      setMuted: (id, muted) => void ops.push({ op: "setMuted", id, muted }),
      setViewport: () => {},
      setNowPlaying: () => {},
      setChrome: (id, kind, face, hidden) => void ops.push({ op: "setChrome", id, kind, face, hidden: !!hidden }),
      createVisualization: (o) => void ops.push({ op: "createVisualization", ...o }),
      setVisualizationFeed: (id, json) => void ops.push({ op: "feed", id, feed: JSON.parse(json) }),
      setPresence: (id, presence, rect, durationMs) => void ops.push({ op: "setPresence", id, presence, rect, durationMs }),
    },
    store: { get: () => null, set: () => {} },
  };
  return { ops, drivers, orchestrator: new Orchestrator(drivers) };
}

/** A mocked service: an App and its hidden music facet. Nothing here is signed into and nothing is fetched. */
function mockService(id: string): { app: App; facet: Facet } {
  return {
    app: { id, name: id, baseUrl: `https://mock.test/${id}/`, profileId: id, setup: { status: "unknown" } },
    facet: { id: `${id}-player`, app: id, url: `https://mock.test/${id}/`, slotClass: "16:9·XL", label: "Player", music: true, audio: "exclusive", touch: "full" },
  };
}

/** The lounge instantiated onto a mocked service, materialized for the wall. */
function loungeDoc(service: { app: App; facet: Facet }): { doc: DashboardDocument; scene: Scene; layout: Layout } {
  const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: service.facet.id }, { layoutId: "l", sceneId: "s" });
  if ("error" in r) throw new Error(`the lounge refused to instantiate: ${r.unresolved.join(", ")}`);
  const { doc } = sceneDocument({ scene: r.scene, layout: r.layout, facets: [service.facet], apps: [service.app] }, "wall", FHD);
  return { doc, scene: r.scene, layout: r.layout };
}

/** The lounge exactly as the seed writes it, materialized. */
function seededLounge() {
  const r = applySeed({}, core, { now: NOW });
  const scene = core.normalizeScene(JSON.parse(r.data[STORE_KEYS.scenes]).find((s: any) => s.id === "demo-music-lounge"))!;
  const layout = core.normalizeLayout(JSON.parse(r.data[STORE_KEYS.layouts]).find((l: any) => l.id === "demo-music-lounge-layout"))!;
  const facets = JSON.parse(r.data[STORE_KEYS.facets]).map((f: any) => core.normalizeFacet(f)!);
  const apps = JSON.parse(r.data[STORE_KEYS.apps]).map((a: any) => core.normalizeApp(a)!);
  const { doc, notes } = sceneDocument({ scene, layout, facets, apps }, "wall", FHD);
  return { seeded: r, scene, layout, facets, apps, doc, notes };
}

/* ---------------------------------------- the lounge as the seed ships it ---- */

describe("CS-9 — the Parkers' Music Lounge is seeded IDLE", () => {
  it("resolves the hidden music source to the App-poster placeholder: no service, no login, no name", () => {
    const { scene, doc, notes } = seededLounge();
    expect(scene.hidden).toEqual([{ facet: PLACEHOLDER_REF, audio: "exclusive" }]);
    expect(scene.visualizations).toEqual([
      { id: "viz-stage", source: PLACEHOLDER_REF, style: "prism-beams", artwork: "backdrop", label: "The stage" },
    ]);
    expect(scene.assign).toEqual({ stage: "viz-stage" });
    // one tile, and it is the stage: the placeholder is not a facet, so no hidden
    // surface is created, nothing is navigated to, and nothing could be signed in
    expect(doc.tiles.map((t) => t.id)).toEqual(["stage"]);
    expect(doc.tiles[0]!.visualization).toEqual({ style: "prism-beams", source: PLACEHOLDER_REF, artwork: "backdrop" });
    expect(doc.tiles.some((t) => t.url)).toBe(false);
    // and it is reported, not swallowed (§5, the same honesty as a placeholder slot)
    expect(notes).toEqual([`hidden ${PLACEHOLDER_REF}: not a known facet`]);
  });

  it("names no music service anywhere in what it writes", () => {
    const { seeded } = seededLounge();
    const written = JSON.stringify(seeded.data);
    for (const service of MUSIC_LOUNGE.hidden![0]!.suggestions) expect(written.toLowerCase(), service).not.toContain(service);
    for (const app of JSON.parse(seeded.data[STORE_KEYS.apps])) expect(app.setup.status).toBe("unknown");
  });

  it("puts the stage on the wall and no player: the wall drifts, and there is nothing to reveal yet", async () => {
    const { ops, orchestrator } = rig();
    const { doc } = seededLounge();
    await orchestrator.load(doc, FHD);
    expect(ops.filter((o) => o.op === "createVisualization")).toHaveLength(1);
    expect(ops.some((o) => o.op === "navigate")).toBe(false);
    expect(orchestrator.musicState().sources).toEqual({});
    // §2.5.3 has nothing to bring up until the household picks a service — and says so
    expect(await orchestrator.revealMusic("stage")).toBe("unknown");
    expect(orchestrator.musicState().reveal.facet).toBeNull();
  });
});

/* --------------------- 1. the template completes with each of the three ---- */

describe("CS-9 §2.5.1 — the template completes with each of the three suggestions (mocked)", () => {
  const SUGGESTIONS = ["spotify", "apple-music", "pandora"];

  it("offers exactly those three, as a HIDDEN music role", () => {
    expect(MUSIC_LOUNGE.hidden!.map((r) => r.id)).toEqual(["source"]);
    expect(MUSIC_LOUNGE.hidden![0]!.suggestions).toEqual(SUGGESTIONS);
    expect(MUSIC_LOUNGE.hidden![0]!.kind).toBe("music");
  });

  for (const id of SUGGESTIONS) {
    it(`${id}: one decision produces the hidden placement, the visualization sourced to it, and the audio owner`, () => {
      const svc = mockService(id);
      // the wizard asked ONE question and got one answer
      expect(templateCompletion(MUSIC_LOUNGE, { source: svc.facet.id })).toEqual({ complete: true, unresolved: [] });

      const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: svc.facet.id }, { layoutId: `l-${id}`, sceneId: `s-${id}` });
      if ("error" in r) throw new Error(`${id}: expected an instance`);
      expect(r.notes).toEqual([]);
      expect(r.scene.hidden).toEqual([{ facet: svc.facet.id, audio: "exclusive" }]);
      expect(r.scene.visualizations).toEqual([
        { id: "viz-stage", source: svc.facet.id, style: "prism-beams", artwork: "backdrop", label: "The stage" },
      ]);
      expect(r.scene.assign).toEqual({ stage: "viz-stage" });
      // §7a: the one exclusive role is the hidden one
      expect(templateAudioOwner(MUSIC_LOUNGE)).toBe("source");
      expect(r.scene.settings!.stage.audio).toBe("mute");

      // and it materializes: the stage's source IS the hidden facet's own tile
      const { doc } = loungeDoc(svc);
      const stage = doc.tiles.find((t) => t.id === "stage")!;
      const hidden = doc.tiles.find((t) => t.id === svc.facet.id)!;
      expect(stage.visualization!.source).toBe(hidden.id);
      expect(hidden.float?.hidden).toBe(true);
      expect(hidden.audio).toBe("exclusive");
      expect(hidden.url).toBe(svc.facet.url);
    });
  }

  it("with none resolved the SERVICE is the open question — the stage never reports itself unresolved", () => {
    expect(templateCompletion(MUSIC_LOUNGE, {})).toEqual({ complete: false, unresolved: ["source"] });
    expect(templateCompletion(MUSIC_LOUNGE, {}).unresolved).not.toContain("stage");
    expect(instantiateTemplate(MUSIC_LOUNGE, FHD, {}, { layoutId: "l", sceneId: "s" }))
      .toEqual({ error: "incomplete", unresolved: ["source"] });
    // naming the stage instead of the service answers nothing
    expect(templateCompletion(MUSIC_LOUNGE, { stage: "viz-stage" }).unresolved).toEqual(["source"]);
  });
});

/* -------------------------------------------------- 2. idle drift renders ---- */

describe("CS-9 §2.5.2 point 6 — idle drift renders, and is never a black screen", () => {
  it("the seeded wall's feed is inactive, unlit by artwork, and on the pack's own palette", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(seededLounge().doc, FHD);
    const feed = (ops.filter((o) => o.op === "feed").at(-1) as { feed: Record<string, unknown> }).feed;
    expect(feed).toMatchObject({
      visualization: "stage", source: PLACEHOLDER_REF, active: false, playbackState: "none",
      metadata: null, artwork: null, artworkMode: "backdrop", style: "prism-beams", dominant: null, audioOwner: false,
    });
    expect(feed.palette).toEqual([...PRISM_BANDS]);        // the substrate, not a tint from art we do not have
    // §2.5.2 point 3: an idle wall says nothing
    expect(metadataLine(feed as never)).toEqual({ now: "", state: "" });
  });

  it("a source that exists but is not playing is idle too — paused is not playing", () => {
    const svc = mockService("spotify");
    const model = new MusicStateModel();
    model.configure([svc.facet.id]);
    const viz = { id: "stage", source: svc.facet.id, style: "prism-beams", artwork: "backdrop" as const };
    expect(model.feed(viz, svc.facet.id).active).toBe(false);
    for (const e of demoTrackEvents() as MediaSessionEvent[]) model.onMediaSession(svc.facet.id, e, 1);
    expect(model.feed(viz, svc.facet.id).active).toBe(true);
    model.onMediaSession(svc.facet.id, { type: "playbackState", state: "paused" }, 2);
    const paused = model.feed(viz, svc.facet.id);
    expect(paused.active).toBe(false);
    expect(paused.metadata).toBeNull();
    expect(paused.artwork).toBeNull();
    expect(metadataLine(paused)).toEqual({ now: "", state: "" });
  });

  it("ambientSignal never yields an all-zero frame, at CS-8's pinned numbers", () => {
    // the guarantee: every band of every ambient frame is at or above the floor
    for (const n of [1, 4, 16, 64]) {
      for (let t = 0; t < 40; t += 0.37) {
        const frame = ambientSignal(t, n);
        expect(frame).toHaveLength(n);
        expect(frame.some((v) => v === 0), `t=${t} n=${n}`).toBe(false);
        for (const v of frame) {
          expect(v).toBeGreaterThanOrEqual(AMBIENT_FLOOR);
          expect(v).toBeLessThanOrEqual(AMBIENT_FLOOR + AMBIENT_SWING);
        }
      }
    }
    // frame for frame what visualization.test.ts and VisualizationChromeTests.cs pin
    expect(ambientSignal(2, 4).map((v) => Number(v.toFixed(4)))).toEqual([0.0973, 0.1163, 0.0661, 0.0577]);
    expect(ambientSignal(0, 1).map((v) => Number(v.toFixed(4)))).toEqual([0.085]);
    // it drifts rather than standing still
    expect(ambientSignal(0, 8)).not.toEqual(ambientSignal(6, 8));
  });
});

/* -------------------- 3. the metadata line from a Media Session event ---- */

describe("CS-9 §2.5.2 point 3 — the metadata line populates from a synthetic Media Session event", () => {
  const svc = mockService("spotify");
  const viz = { id: "stage", source: svc.facet.id, style: "prism-beams", artwork: "backdrop" as const };

  function playing(audioOwner: string | null) {
    const model = new MusicStateModel();
    model.configure([svc.facet.id]);
    for (const e of demoTrackEvents() as MediaSessionEvent[]) model.onMediaSession(svc.facet.id, e, 1);
    return { model, feed: model.feed(viz, audioOwner) };
  }

  it("the staged track is fixture data with no art and no account attached to it", () => {
    expect(DEMO_TRACK.title).toBe("Aurora Skies");
    expect(DEMO_TRACK.artist).toBe("The Refractions");
    expect(DEMO_TRACK.artwork).toBeNull();                    // we own no album art; nothing bundled, nothing fetched (§19/§22)
    const events = demoTrackEvents() as MediaSessionEvent[];
    expect(events.map((e) => e.type)).toEqual(["metadata", "playbackState", "actions"]);
    expect(events[0]).toEqual({ type: "metadata", metadata: { title: "Aurora Skies", artist: "The Refractions", artwork: null } });
    expect(events[1]).toEqual({ type: "playbackState", state: "playing" });
  });

  it("through the real reducer: the source plays it and the feed carries it", () => {
    const { model, feed } = playing(svc.facet.id);
    const src = model.source(svc.facet.id)!;
    expect(src.playbackState).toBe("playing");
    expect(src.metadata).toEqual({ title: "Aurora Skies", artist: "The Refractions", artwork: null });
    expect(feed.active).toBe(true);
    expect(feed.metadata).toEqual({ title: "Aurora Skies", artist: "The Refractions", artwork: null });
    expect(feed.artwork).toBeNull();                          // backdrop with no art stays the dark substrate
    expect(feed.dominant).toBeNull();
    expect(feed.palette).toEqual([...PRISM_BANDS]);
    expect(feed.audioOwner).toBe(true);
  });

  it("the line reads the track and the audio state, and swaps to muted when the owner is elsewhere", () => {
    expect(metadataLine(playing(svc.facet.id).feed)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.owner });
    expect(metadataLine(playing("some-other-tile").feed)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.muted });
    expect(metadataLine(playing(null).feed).state).toBe(DEMO_TRACK.line.muted);
  });

  it("and the same event through the orchestrator's own now-playing path reaches the wall's feed", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(loungeDoc(svc).doc, FHD);
    ops.length = 0;
    await orchestrator.onSurfaceEvent({
      type: "now-playing", id: svc.facet.id,
      info: { playing: true, title: DEMO_TRACK.title, artist: DEMO_TRACK.artist, artwork: DEMO_TRACK.artwork ?? undefined, actions: [...DEMO_TRACK.actions] },
    });
    const pushed = (ops.filter((o) => o.op === "feed" && o.id === "stage").at(-1) as { feed: never }).feed;
    expect(metadataLine(pushed)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.owner });   // B-165: the stage's music takes the audio when nobody has it
    // §3 gives it audio focus on a human-attributed play; the state half flips
    await orchestrator.onSurfaceEvent({ type: "interaction", id: svc.facet.id });
    await orchestrator.onSurfaceEvent({ type: "playback", id: svc.facet.id, playing: true });
    await orchestrator.onSurfaceEvent({
      type: "now-playing", id: svc.facet.id,
      info: { playing: true, title: DEMO_TRACK.title, artist: DEMO_TRACK.artist, actions: [...DEMO_TRACK.actions] },
    });
    const owned = (ops.filter((o) => o.op === "feed" && o.id === "stage").at(-1) as { feed: never }).feed;
    expect(metadataLine(owned)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.owner });
  });
});

/* -------------------------------- 4. transport only through pass-through ---- */

describe("CS-9 §2.5.2 point 4 / §32 layer 3 — transport is reachable ONLY through the pass-through", () => {
  const svc = mockService("spotify");

  it("what the page did not register is disabled, never hidden", () => {
    const model = new MusicStateModel();
    model.configure([svc.facet.id]);
    // nothing registered at all: every action disabled
    expect(transportAvailability(model.source(svc.facet.id))).toEqual({ play: false, pause: false, previoustrack: false, nexttrack: false });
    expect(transportAvailability(undefined)).toEqual({ play: false, pause: false, previoustrack: false, nexttrack: false });
    // the staged page registered all four
    for (const e of demoTrackEvents() as MediaSessionEvent[]) model.onMediaSession(svc.facet.id, e, 1);
    expect(transportAvailability(model.source(svc.facet.id))).toEqual({ play: true, pause: true, previoustrack: true, nexttrack: true });
    // a page that registered only "next": prev stays disabled; pause follows the live playback state, never a guess
    model.onMediaSession(svc.facet.id, { type: "actions", actions: ["nexttrack"] }, 2);
    expect(transportAvailability(model.source(svc.facet.id))).toEqual({ play: false, pause: true, previoustrack: false, nexttrack: true });
    // the four names the chrome may draw, and no more
    expect(Object.keys(transportAvailability(undefined))).toEqual(["play", "pause", "previoustrack", "nexttrack"]);
  });

  it("core's music model has no transport verb of its own — it only reports", () => {
    const names = new Set(Object.getOwnPropertyNames(MusicStateModel.prototype));
    for (const verb of ["play", "pause", "next", "previous", "nexttrack", "previoustrack", "stop", "seek"]) {
      expect(names.has(verb), `MusicStateModel.${verb} would be a second way to play`).toBe(false);
    }
  });

  it("a press with no adapter routes to the PAGE's own Media Session handler, never a synthetic click", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(loungeDoc(svc).doc, FHD);
    for (const cmd of ["play", "pause", "next", "prev"] as const) {
      ops.length = 0;
      expect(await orchestrator.tileCommand(svc.facet.id, cmd)).toBe("ok");
      const injects = ops.filter((o) => o.op === "inject");
      expect(injects, cmd).toHaveLength(1);
      // exactly §32's routing, verbatim: the page's own handler (the OS media
      // keys' function), then the adapter's onMediaCommand, then the element
      expect(injects[0]!.js, cmd).toBe(mediaFallbackJs(cmd));
      expect(String(injects[0]!.js), cmd).toContain("__prismMediaAction");
      expect(String(injects[0]!.js), cmd).not.toContain(".click(");
      // and nothing else happened to the surface
      expect(ops.filter((o) => o.op !== "inject"), cmd).toEqual([]);
    }
    expect(mediaFallbackJs("next")).toContain('"nexttrack"');
    expect(mediaFallbackJs("prev")).toContain('"previoustrack"');
  });

  it("with an adapter, the press goes to the SITE's own declared control", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { next: ".player-next", prev: ".player-prev" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    ops.length = 0;
    expect(await orchestrator.tileCommand(svc.facet.id, "next")).toBe("ok");
    expect(ops.filter((o) => o.op === "inject").map((o) => o.js)).toEqual([clickControlJs(".player-next")]);
  });

  it("the adapter's declared controls light the transport the wall state carries (Pandora registers no Media Session, 2026-09-14)", async () => {
    const { orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { next: ".player-next", prev: ".player-prev" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Stargazing", artist: "Myles Smith", actions: ["play", "pause"] } });
    const np = orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!;
    expect(new Set(np.actions)).toEqual(new Set(["play", "pause", "nexttrack", "previoustrack"]));
    // the music model's copy agrees, so the section 6 remote offers the same transport
    expect(transportAvailability(orchestrator.music.source(svc.facet.id)).nexttrack).toBe(true);
  });

  it("the service's own offer (Pandora's Get more skips) rides the context and a press goes to the declared control (2026-09-14)", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { offer: "[data-prism-offer]" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Stargazing", context: { kind: "station", label: "Pop Coast Hits Radio", offer: { label: "Get more skips" } } } });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!.context!.offer).toEqual({ label: "Get more skips" });
    ops.length = 0;
    expect(await orchestrator.tileCommand(svc.facet.id, "offer")).toBe("ok");
    expect(ops.filter((o) => o.op === "inject").map((o) => o.js)).toEqual([clickControlJs("[data-prism-offer]")]);
  });

  it("a Next press accepts the service's own offer it provokes - once, on the heels of the press (Pandora's Get Skips, 2026-09-14)", async () => {
    const { ops, orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { next: ".player-next", offer: "iframe[id^='coachmark'] >>> #reward" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    ops.length = 0;
    expect(await orchestrator.tileCommand(svc.facet.id, "next")).toBe("ok");
    const js = ops.filter((o) => o.op === "inject").map((o) => o.js).join("");
    expect(js).toContain(clickControlJs(".player-next"));
    expect(js).toContain(clickControlJs("iframe[id^='coachmark'] >>> #reward"));
    expect(js).toContain("setInterval");
    ops.length = 0;
    await orchestrator.tileCommand(svc.facet.id, "prev");   // an offer never rides a Previous
    expect(ops.filter((o) => o.op === "inject").map((o) => o.js).join("")).not.toContain("coachmark");
  });

  it("the page's own transport saying paused wins over an element that reads as playing (Pandora's pre-buffered next track, 2026-09-14)", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(loungeDoc(svc).doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Heaven", artist: "Niall Horan", position: 26, duration: 156, context: { kind: "station", label: "Pop Coast Hits Radio", playing: false, position: 26, duration: 156 } } });
    const np = orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!;
    expect(np.playing).toBe(false);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: false, title: "Heaven", artist: "Niall Horan", context: { kind: "station", label: "Pop Coast Hits Radio", playing: true } } });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!.playing).toBe(true);   // B-132 still holds the other way
  });

  it("a control the page has hidden or disabled is withheld from the transport (Pandora hides Skip during an ad, 2026-09-14)", async () => {
    const { orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { next: ".player-next", prev: ".player-prev" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Advertisement", actions: ["play", "pause"], context: { kind: "station", label: "Pop Coast Hits Radio", unavailable: ["next"] } } });
    const np = orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!;
    expect(new Set(np.actions)).toEqual(new Set(["play", "pause", "previoustrack"]));
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Heaven", actions: ["play", "pause"], context: { kind: "station", label: "Pop Coast Hits Radio", unavailable: [] } } });
    expect(new Set(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.nowPlaying!.actions)).toEqual(new Set(["play", "pause", "previoustrack", "nexttrack"]));
  });

  it("the rating offer follows the page's thumbs: hidden during an ad, back after (Pandora, 2026-09-14)", async () => {
    const { orchestrator } = rig();
    orchestrator.setAdapters({ "mock-music": { id: "mock-music", controls: { thumbUp: ".up", thumbDown: ".down" } } as never });
    const { doc } = loungeDoc(svc);
    doc.tiles.find((t) => t.id === svc.facet.id)!.adapter = "mock-music";
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Advertisement", context: { kind: "station", label: "Pop Coast Hits Radio", unavailable: ["next", "thumbUp", "thumbDown"] } } });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.rate).toBeUndefined();
    await orchestrator.onSurfaceEvent({ type: "now-playing", id: svc.facet.id, info: { playing: true, title: "Heaven", context: { kind: "station", label: "Pop Coast Hits Radio", unavailable: [] } } });
    expect(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.rate).toBe(true);
  });

  it("there is no other command that plays or pauses", async () => {
    const { orchestrator } = rig();
    await orchestrator.load(loungeDoc(svc).doc, FHD);
    for (const cmd of ["start", "resume", "toggle", "playpause", "stop", "seek", "skipnext"]) {
      expect(await orchestrator.tileCommand(svc.facet.id, cmd), cmd).toBe("unknown-cmd");
    }
  });
});

/* --------------------------- 5. reveal / collapse, audio uninterrupted ---- */

describe("CS-9 §2.5.3 — reveal and collapse never interrupt the audio", () => {
  const svc = mockService("spotify");

  async function playingWall() {
    const r = rig();
    await r.orchestrator.load(loungeDoc(svc).doc, FHD);
    // the household pressed play in the hidden player: §3 hands it audio focus
    await r.orchestrator.onSurfaceEvent({ type: "interaction", id: svc.facet.id });
    await r.orchestrator.onSurfaceEvent({ type: "playback", id: svc.facet.id, playing: true });
    await r.orchestrator.onSurfaceEvent({
      type: "now-playing", id: svc.facet.id,
      info: { playing: true, title: DEMO_TRACK.title, artist: DEMO_TRACK.artist, actions: [...DEMO_TRACK.actions] },
    });
    return r;
  }

  it("through the orchestrator: reveal then collapse touch nothing that could stop the sound", async () => {
    const { ops, orchestrator } = await playingWall();
    const ownerBefore = orchestrator.getState()!.audioOwner;
    const stateBefore = orchestrator.musicState().sources[svc.facet.id]!.playbackState;
    const surfaceBefore = orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.id;
    expect(ownerBefore).toBe(svc.facet.id);
    expect(stateBefore).toBe("playing");

    ops.length = 0;
    expect(await orchestrator.revealMusic("stage", "panel")).toBe("ok");    // a tap on the stage reveals its source
    expect(orchestrator.musicState().reveal).toEqual({ facet: svc.facet.id, mode: "panel" });
    expect(await orchestrator.collapseMusic()).toBe("ok");
    expect(orchestrator.musicState().reveal.facet).toBeNull();

    // ACROSS BOTH TRANSITIONS: nothing that could interrupt playback happened
    for (const forbidden of ["setMuted", "destroy", "navigate", "create", "suspend"]) {
      expect(ops.filter((o) => o.op === forbidden), `${forbidden} during reveal/collapse`).toEqual([]);
    }
    // no injected play/pause either — the pass-through is the only transport,
    // and reveal is not a press (§2.5.3: the facet's playback is never changed)
    for (const inj of ops.filter((o) => o.op === "inject")) {
      expect(String(inj.js)).not.toContain("__prismMediaCmd");
      expect(String(inj.js)).not.toContain("pause()");
    }

    // it is the SAME surface throughout: only its size and visibility moved
    const presences = ops.filter((o) => o.op === "setPresence") as Array<{ id: string; presence: string }>;
    expect(presences.map((p) => p.id)).toEqual([svc.facet.id, svc.facet.id]);
    expect(presences.map((p) => p.presence)).toEqual(["panel", "hidden"]);
    expect(orchestrator.getState()!.tiles.find((t) => t.id === svc.facet.id)!.id).toBe(surfaceBefore);

    // and the audio is exactly where it was
    expect(orchestrator.getState()!.audioOwner).toBe(ownerBefore);
    expect(orchestrator.musicState().sources[svc.facet.id]!.playbackState).toBe(stateBefore);
    expect(orchestrator.musicState().sources[svc.facet.id]!.metadata.title).toBe(DEMO_TRACK.title);
  });

  it("the stage was never stopped either: the beams' surface survives both transitions, still fed", async () => {
    const { ops, orchestrator } = await playingWall();
    ops.length = 0;
    await orchestrator.revealMusic("stage", "hero");
    await orchestrator.collapseMusic();
    expect(ops.some((o) => (o.op === "destroy" || o.op === "createVisualization") && o.id === "stage")).toBe(false);
    const feed = orchestrator.musicState().feeds.find((f) => f.visualization === "stage")!;
    expect(feed.active).toBe(true);
    expect(feed.audioOwner).toBe(true);
    expect(metadataLine(feed)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.owner });
  });

  it("revealing again after a collapse is the same surface a third and fourth time", async () => {
    const { ops, orchestrator } = await playingWall();
    ops.length = 0;
    for (const mode of ["panel", "hero", "panel"] as const) {
      expect(await orchestrator.revealMusic("stage", mode)).toBe("ok");
      expect(await orchestrator.collapseMusic()).toBe("ok");
    }
    expect(new Set((ops.filter((o) => o.op === "setPresence") as Array<{ id: string }>).map((p) => p.id))).toEqual(new Set([svc.facet.id]));
    expect(ops.filter((o) => o.op === "destroy" || o.op === "setMuted")).toEqual([]);
    expect(orchestrator.getState()!.audioOwner).toBe(svc.facet.id);
    expect(orchestrator.musicState().sources[svc.facet.id]!.playbackState).toBe("playing");
  });
});

/* ------------------------------------------ 6. the shot reproduces here ---- */

describe("CS-9 — the marketing shot reproduces from the demo", () => {
  it("seeded, the wall is the idle lounge: beams drifting, an empty line, the substrate", async () => {
    const { ops, orchestrator } = rig();
    await orchestrator.load(seededLounge().doc, FHD);
    const feed = (ops.filter((o) => o.op === "feed").at(-1) as { feed: never }).feed;
    expect(metadataLine(feed)).toEqual({ now: "", state: "" });
    expect(ambientSignal(0, 4).every((v) => v >= AMBIENT_FLOOR)).toBe(true);
  });

  it("seeded, then the one decision the wizard asks for, then DEMO_TRACK: exactly the strings the shot shows", async () => {
    // the seed hands over the scene; the shot's only extra step is the service
    // the photographer signed into — the SAME single question §2.5.1 asks, so
    // the swap is `resolved.source`, not a second scene.
    const { scene } = seededLounge();
    const svc = mockService("spotify");
    const r = instantiateTemplate(MUSIC_LOUNGE, FHD, { source: svc.facet.id }, { layoutId: scene.layout, sceneId: scene.id });
    if ("error" in r) throw new Error("expected an instance");
    expect(r.scene.assign).toEqual(scene.assign);                    // same wall, same slot, same visualization id
    expect(r.scene.settings).toEqual(scene.settings);
    expect(r.scene.hidden).toEqual([{ facet: svc.facet.id, audio: "exclusive" }]);

    const { ops, orchestrator } = rig();
    const { doc } = sceneDocument({ scene: r.scene, layout: r.layout, facets: [svc.facet], apps: [svc.app] }, "wall", FHD);
    await orchestrator.load(doc, FHD);
    await orchestrator.onSurfaceEvent({ type: "interaction", id: svc.facet.id });
    await orchestrator.onSurfaceEvent({ type: "playback", id: svc.facet.id, playing: true });
    await orchestrator.onSurfaceEvent({
      type: "now-playing", id: svc.facet.id,
      info: { playing: true, title: DEMO_TRACK.title, artist: DEMO_TRACK.artist, artwork: DEMO_TRACK.artwork ?? undefined, actions: [...DEMO_TRACK.actions] },
    });

    const feed = (ops.filter((o) => o.op === "feed" && o.id === "stage").at(-1) as { feed: never }).feed;
    // bottom-left (point 3): the seed's own strings, and what they are made of
    expect(metadataLine(feed)).toEqual({ now: DEMO_TRACK.line.now, state: DEMO_TRACK.line.owner });
    expect(DEMO_TRACK.line.now).toBe(`Aurora Skies ${EM_DASH} The Refractions`);
    expect(DEMO_TRACK.line.owner).toBe(`${EIGHTH_NOTE} exclusive`);
    expect(DEMO_TRACK.line.muted).toBe(`muted`);
    // bottom-right (point 4): all four enabled, because the staged page registered all four
    expect(transportAvailability(orchestrator.musicState().sources[svc.facet.id]))
      .toEqual({ play: true, pause: true, previoustrack: true, nexttrack: true });
    // the composition (points 1, 2 and 5): prism-beams, backdrop, the brand bands, no art
    expect(feed).toMatchObject({ active: true, style: "prism-beams", artworkMode: "backdrop", artwork: null, audioOwner: true });
    expect((feed as { palette: string[] }).palette).toEqual([...PRISM_BANDS]);
  });
});

/* -------------------------------------------- CS-10.5: the P4 split strings */

describe("DEMO_TRACK's metadata block (P4)", () => {
  it("carries the two-line strings the wall now draws, and keeps the old joined one", () => {
    // P4 (adopted 2026-09-03): line 1 the title, line 2 "artist · state".
    expect(DEMO_TRACK.line.title).toBe("Aurora Skies");
    expect(DEMO_TRACK.line.artistAndOwner).toBe("The Refractions · ♪ exclusive");
    expect(DEMO_TRACK.line.artistAndMuted).toBe("The Refractions · muted");
    // the pre-P4 joined form is kept so nothing still reading it breaks
    expect(DEMO_TRACK.line.now).toBe("Aurora Skies — The Refractions");
  });

  it("the split strings are what the renderer's own rule produces from the FIELDS", () => {
    // This is the point of the split: the fixture's expected output and the
    // renderer's actual output must agree, and the renderer builds from
    // title/artist rather than parsing a joined line (CS-10.1's boundary).
    const owner = musicBlock(DEMO_TRACK.title, DEMO_TRACK.artist, true);
    const muted = musicBlock(DEMO_TRACK.title, DEMO_TRACK.artist, false);
    expect(owner.title).toBe(DEMO_TRACK.line.title);
    expect(owner.line2).toBe(DEMO_TRACK.line.artistAndOwner);
    expect(muted.line2).toBe(DEMO_TRACK.line.artistAndMuted);
  });

  it("still declares no artwork - we own no album art and nothing is fetched", () => {
    expect(DEMO_TRACK.artwork).toBeNull();
  });
});

/**
 * The C# renderer's rule (PrismHost.Core/VisualizationChrome.Metadata), written
 * once here so the seed's strings are checked against the SAME shape the wall
 * draws rather than against themselves.
 */
function musicBlock(title: string, artist: string, audioOwner: boolean): { title: string; line2: string } {
  const state = audioOwner ? "♪ exclusive" : "muted";
  return { title, line2: artist ? `${artist} · ${state}` : state };
}
