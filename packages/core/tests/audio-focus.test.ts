import { describe, expect, it } from "vitest";
import { AudioFocusMachine } from "../src/audio-focus.js";

const machine = () =>
  new AudioFocusMachine({
    yt: "exclusive",
    radio: "exclusive",
    ambient: "mix",
    calendar: "mute",
  });

describe("AudioFocusMachine (§3 normative)", () => {
  it("boot is silent: EVERY tile starts muted (rule 5)", () => {
    const cmds = machine().initialCommands();
    expect(cmds.every((c) => c.op === "mute")).toBe(true);
    expect(new Set(cmds.map((c) => c.tile)).size).toBe(cmds.length);
    expect(cmds.map((c) => c.tile)).toContain("calendar");
    expect(cmds.map((c) => c.tile)).toContain("yt");
  });

  it("play in an exclusive tile MUTES other playing exclusives - they keep playing silently", () => {
    const m = machine();
    m.onPlayback("yt", true);
    const cmds = m.onPlayback("radio", true);
    expect(cmds).toEqual([
      { tile: "radio", op: "unmute" },
      { tile: "yt", op: "mute" },
    ]);
    // still playing: making it audible again is one play/unmute away
    expect(m.isPlaying("yt")).toBe(true);
  });

  it("exclusive transitions never touch mix tiles", () => {
    const m = machine();
    m.onPlayback("ambient", true);
    const cmds = m.onPlayback("yt", true);
    expect(cmds.filter((c) => c.tile === "ambient")).toEqual([]);
  });

  it("AUTOPLAY never lifts the boot mute or steals focus (rule 5 attribution)", () => {
    const m = machine();
    expect(m.onPlayback("yt", true, false)).toEqual([]);   // autoplay: silent participant
    expect(m.isPlaying("yt")).toBe(true);
    expect(m.focusedMedia).toBeNull();
    // the human's own play still lifts exactly that tile
    expect(m.onPlayback("radio", true)).toEqual([
      { tile: "radio", op: "unmute" },
      { tile: "yt", op: "mute" },
    ]);
  });

  it("mix tiles unmute themselves on play and never touch exclusives", () => {
    const m = machine();
    m.onPlayback("yt", true);
    const cmds = m.onPlayback("ambient", true);
    expect(cmds).toEqual([{ tile: "ambient", op: "unmute" }]);
  });

  it("mute tiles are re-muted if they ever try to play", () => {
    const m = machine();
    expect(m.onPlayback("calendar", true)).toEqual([{ tile: "calendar", op: "mute" }]);
  });

  it("tracks focusedMedia as the last audible tile (§7)", () => {
    const m = machine();
    m.onPlayback("yt", true);
    m.onPlayback("radio", true);
    expect(m.focusedMedia).toBe("radio");
    m.onPlayback("radio", false);
    // stop doesn't clear focus — focusedMedia is "last tile that produced audio"
    expect(m.focusedMedia).toBe("radio");
  });

  it("a stopped exclusive is not re-paused by the next play", () => {
    const m = machine();
    m.onPlayback("yt", true);
    m.onPlayback("yt", false);
    const cmds = m.onPlayback("radio", true);
    expect(cmds).toEqual([{ tile: "radio", op: "unmute" }]);
  });

  it("unknown tiles default to mute policy", () => {
    const m = machine();
    expect(m.onPlayback("mystery", true)).toEqual([{ tile: "mystery", op: "mute" }]);
  });
});
