/**
 * The two players (2026-09-19): "can we begin to make a video player that we can switch to from the music
 * player? Make sure I can switch back and forth. I imagine it's just a prism menu item."
 *
 * A player is a Scene the household already owns: the Music player is its Music Lounge (a stage over hidden
 * music sources), the Video player its Movie Night (one screen, edge to edge). Nothing new is stored - a scene
 * is told apart by the template its layout came from (scene-model.ts: layout.source.template), or, for a
 * lounge drawn by hand, by what it holds. A switch is a scene switch through the same path the rail and the
 * schedules use, with one addition: the Video player carries the Music player's hidden sources, so the wall
 * keeps them warm across the switch (a scene switch destroys any tile the next scene lacks, orchestrator
 * applyDocument) - the music plays on until a video takes the audio, and the way back is instant.
 */
import type { Facet, Layout, Scene, HiddenPlacement } from "./scene-model.js";

export type PlayerKind = "music" | "video";
export const PLAYER_KINDS: readonly PlayerKind[] = ["music", "video"];

/** The templates each player is made from; the first is the one the wizard opens when the household has none. */
export const PLAYER_TEMPLATES: Record<PlayerKind, readonly string[]> = {
  music: ["music-lounge", "music-lounge-clock"],
  video: ["movie-night"],
};

export function isPlayerKind(x: unknown): x is PlayerKind { return x === "music" || x === "video"; }

/**
 * Which player a scene is, if any: by its layout's template lineage first; a scene with no lineage is the
 * Music player when it draws a stage over a hidden music source (a lounge built by hand). Video has no such
 * tell - a slot holding any App - so a video scene is one made from Movie Night.
 */
export function playerOfScene(scene: Scene, layout: Layout | undefined, facet: (id: string) => Facet | undefined): PlayerKind | null {
  const src = layout?.source;
  const template = src && src.mode === "template" ? src.template : null;
  if (template) for (const kind of PLAYER_KINDS) if (PLAYER_TEMPLATES[kind].includes(template)) return kind;
  if (scene.visualizations?.length && scene.hidden.some((h) => facet(h.facet)?.music)) return "music";
  return null;
}

/**
 * The household's scene for each player. The active scene wins when it is that player; otherwise the
 * household's own instance over a seeded demo one, and among several the newest (instantiateTemplate numbers
 * them: music-lounge-1, music-lounge-2 ...).
 */
export function playerScenes(scenes: readonly Scene[], layout: (id: string) => Layout | undefined, facet: (id: string) => Facet | undefined, active: string | null): Record<PlayerKind, Scene | null> {
  const out: Record<PlayerKind, Scene | null> = { music: null, video: null };
  const rank = (s: Scene): number => {
    if (s.id === active) return Number.MAX_SAFE_INTEGER;
    const demo = s.id.startsWith("demo-") ? 0 : 1_000_000;
    const n = /-(\d+)$/.exec(s.id);
    return demo + (n ? Number(n[1]) : 0);
  };
  for (const kind of PLAYER_KINDS) {
    let best: Scene | null = null;
    for (const s of scenes) {
      if (playerOfScene(s, layout(s.layout), facet) !== kind) continue;
      if (!best || rank(s) > rank(best)) best = s;
    }
    out[kind] = best;
  }
  return out;
}

/**
 * The Video player's hidden placements, with the Music player's music sources carried over: every hidden
 * music facet of the lounge, with its audio policy, in the lounge's order; the video scene's own non-music
 * hidden facets stay. Returns the scene to save, or null when it already carries them.
 */
export function carryHiddenMusic(video: Scene, music: Scene, facet: (id: string) => Facet | undefined): Scene | null {
  const isMusic = (h: HiddenPlacement): boolean => !!facet(h.facet)?.music;
  const sources = music.hidden.filter(isMusic);
  const own = video.hidden.filter((h) => !isMusic(h));
  const next = [...own, ...sources];
  const same = next.length === video.hidden.length && next.every((h, i) => h.facet === video.hidden[i]!.facet && h.audio === video.hidden[i]!.audio);
  return same ? null : { ...video, hidden: next };
}
