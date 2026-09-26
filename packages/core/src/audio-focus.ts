/**
 * Audio focus state machine (spec §3 — normative).
 *
 * 1. At most one `exclusive` tile audible at a time: a play event in an
 *    exclusive tile MUTES all other exclusive tiles (they keep playing
 *    silently - the wall keeps moving, only the audio migrates), ducks nothing.
 * 2. `mix` tiles are unaffected by exclusive transitions and by each other.
 * 3. `mute` tiles are never audible.
 *
 * Pure: consumes playback events, emits driver commands. The shell executes
 * them (setMuted + adapter pause injection) and decides nothing.
 */

import type { AudioPolicy } from "./types.js";

export interface AudioCommand {
  tile: string;
  op: "mute" | "unmute" | "pause";
}

export class AudioFocusMachine {
  private policies: Map<string, AudioPolicy>;
  private playing = new Set<string>();
  /** Last tile that produced audio — the §7 `focusedMedia` target. */
  focusedMedia: string | null = null;

  constructor(policies: Record<string, AudioPolicy>) {
    this.policies = new Map(Object.entries(policies));
  }

  policyOf(tile: string): AudioPolicy {
    return this.policies.get(tile) ?? "mute";
  }

  isPlaying(tile: string): boolean {
    return this.playing.has(tile);
  }

  /**
   * Swap in a new dashboard's policies (§9 carousel switch). Surviving tiles
   * keep their playing state — persist tiles keep playing across moves;
   * audio policy continues to apply globally, not per-dashboard.
   */
  retarget(policies: Record<string, AudioPolicy>): void {
    this.policies = new Map(Object.entries(policies));
    for (const id of [...this.playing]) {
      if (!this.policies.has(id)) this.playing.delete(id);
    }
    if (this.focusedMedia && !this.policies.has(this.focusedMedia)) {
      this.focusedMedia = null;
    }
  }

  /** Boot is SILENT (§3 rule 5, 2026-08-31): every tile starts muted -
   * nothing autoplaying may blow the speakers before a human plays or
   * unmutes something. The first human play/unmute lifts exactly one. */
  initialCommands(): AudioCommand[] {
    return [...this.policies.keys()].map((tile) => ({ tile, op: "mute" as const }));
  }

  /**
   * `human`: this playback report is attributable to a human act in the tile
   * (a play click, an in-page unmute). AUTOPLAY is not - rule 5's boot
   * silence would be worthless if any autoplaying page could lift its own
   * mute. Non-human playing joins the playing set silently: the tile keeps
   * playing muted and never steals focus.
   */
  onPlayback(tile: string, playing: boolean, human = true): AudioCommand[] {
    const policy = this.policyOf(tile);
    const cmds: AudioCommand[] = [];

    if (!playing) {
      this.playing.delete(tile);
      return cmds;
    }

    if (policy === "mute") {
      // Never audible — enforce, don't trust the page.
      this.playing.delete(tile);
      return [{ tile, op: "mute" }];
    }

    this.playing.add(tile);
    if (!human) return cmds;                       // silent participant only
    this.focusedMedia = tile;

    // mix tiles boot muted too (rule 5) - playing one is the ask to hear it
    if (policy === "mix") cmds.push({ tile, op: "unmute" });

    if (policy === "exclusive") {
      cmds.push({ tile, op: "unmute" });
      for (const other of this.playing) {
        if (other !== tile && this.policyOf(other) === "exclusive") {
          // MUTE ONLY - the other tiles keep playing silently (the sports-bar
          // wall). Pausing them was a functionality loss the spec owner
          // rejected 2026-08-31; they stay in `playing`, so making any of
          // them audible again is one play/unmute away.
          cmds.push({ tile: other, op: "mute" });
        }
      }
    }
    return cmds;
  }

  /**
   * §5 audio-follows-tap (docs/concept-scenes.md §5, normative): a human tap
   * on a placement whose standing instruction is `tapAction: "audio"` hands
   * the exclusive audio to that tile. This is rule 1, reached by a tap
   * instead of by a play report - there is no second audio path: the
   * previous owner is MUTED and keeps playing silently, the tapped tile
   * unmutes, nothing is paused and no layout changes.
   *
   * Tapping the tile that already owns the audio is a NO-OP - never a mute.
   *
   * A resting `mute` policy does not block the switch. Rule 3 exists to stop
   * PAGES unmuting themselves; this is the household's own tap on a
   * placement that asked for it, so the tile becomes the exclusive owner for
   * as long as this document stands (a document apply retargets policies
   * from the document again). Without that promotion the tile's own next
   * playback report would re-mute it a second later.
   *
   * Returns [] when the tile is not on this wall, or when it is already the
   * owner.
   */
  /**
   * A human MUTES the owner (the transport's mute, 2026-09-07): the tile goes silent and gives the focus
   * up, so the wall's `audioOwner` says nobody - which is what lets the same button read "unmute" next.
   * Muting a tile that does not own the audio just mutes it. Nothing is paused.
   */
  releaseAudioFocus(tile: string): AudioCommand[] {
    if (this.focusedMedia === tile) this.focusedMedia = null;
    return [{ tile, op: "mute" }];
  }

  takeAudioFocus(tile: string): AudioCommand[] {
    if (!this.policies.has(tile)) return [];
    if (this.focusedMedia === tile) return [];
    const previous = this.focusedMedia;
    const cmds: AudioCommand[] = [];
    // Mute first, so the wall is never audible twice over.
    for (const other of this.policies.keys()) {
      if (other === tile) continue;
      if (this.policyOf(other) !== "exclusive") continue;
      if (this.playing.has(other) || other === previous) cmds.push({ tile: other, op: "mute" });
    }
    this.policies.set(tile, "exclusive");
    this.focusedMedia = tile;
    cmds.push({ tile, op: "unmute" });
    return cmds;
  }
}
