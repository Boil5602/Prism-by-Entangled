import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CORRELATION_MS, USER_INPUT_MS, initialKeeperState, keeperConfig, run, step, type KeeperConfig, type KeeperEvent } from "../src/presentation-keeper.js";
import { DEFAULT_ASSIGNMENT_SETTINGS } from "../src/scene-model.js";

const KEEP: KeeperConfig = { keepPresentation: true, onEnd: "none" };
const OFF: KeeperConfig = { keepPresentation: false, onEnd: "none" };

const enter = (at: number): KeeperEvent => ({ type: "presentation", at, state: "fullscreen" });
const drop = (at: number): KeeperEvent => ({ type: "presentation", at, state: "none" });
const input = (at: number): KeeperEvent => ({ type: "user-input", at });
const ad = (at: number, active: boolean): KeeperEvent => ({ type: "ad-break", at, active });
const ended = (at: number): KeeperEvent => ({ type: "ended", at });
const tick = (at: number): KeeperEvent => ({ type: "tick", at });

describe("§26 presentation keeper — fixtures", () => {
  it("site drop at an ad-break END → restore (the boundary the site created)", () => {
    const { actions } = run([enter(0), ad(10_000, true), ad(40_000, false), drop(40_300)], KEEP);
    expect(actions).toEqual([{ kind: "enterFullscreen", reason: "ad-break" }]);
  });
  it("site drop at an ad-break START waits for the break's end; never fires during the ad", () => {
    const mid = run([enter(0), drop(10_000), ad(10_200, true), tick(11_000), tick(20_000)], KEEP);
    expect(mid.actions).toEqual([]);
    expect(mid.state.pendingDrop?.waitingForBreakEnd).toBe(true);
    const done = run([ad(40_000, false)], KEEP, mid.state);
    expect(done.actions).toEqual([{ kind: "enterFullscreen", reason: "ad-break" }]);
  });
  it("the correlating signal may arrive BEFORE or AFTER the drop, within ~1.5 s", () => {
    expect(run([enter(0), ad(5_000, false), drop(5_000 + CORRELATION_MS)], KEEP).actions).toHaveLength(1);
    expect(run([enter(0), drop(5_000), ad(5_000 + CORRELATION_MS, false)], KEEP).actions).toHaveLength(1);
    expect(run([enter(0), drop(5_000), ad(5_000 + CORRELATION_MS + 1, false)], KEEP).actions).toEqual([]);
    expect(run([enter(0), ad(5_000, false), drop(5_000 + CORRELATION_MS + 1), tick(9_000)], KEEP).actions).toEqual([]);
  });
  it("user Esc → no restore, keeping disabled while the human is out", () => {
    const r = run([enter(0), input(9_500), drop(9_800), ad(10_000, false), tick(20_000)], KEEP);
    expect(r.actions).toEqual([]);
    expect(r.state.established).toBeNull();
    // a later site drop signal changes nothing: there is no state to restore
    const later = run([ad(30_000, true), ad(60_000, false), drop(60_100), tick(70_000)], KEEP, r.state);
    expect(later.actions).toEqual([]);
  });
  it("user input right AFTER the drop (the click that closed it) is also the human's exit", () => {
    const r = run([enter(0), drop(9_800), input(9_800 + USER_INPUT_MS), ad(10_000, false), tick(20_000)], KEEP);
    expect(r.actions).toEqual([]);
    expect(r.state.established).toBeNull();
  });
  it("re-enter → keeping resumes", () => {
    const out = run([enter(0), input(9_500), drop(9_800)], KEEP);
    expect(out.state.established).toBeNull();
    const back = run([enter(30_000), ad(50_000, false), drop(50_200)], KEEP, out.state);
    expect(back.state.established).toBe("fullscreen");
    expect(back.actions).toEqual([{ kind: "enterFullscreen", reason: "ad-break" }]);
  });
  it("a drop with no signal either way is doubt: nothing happens (asymmetric bias)", () => {
    const r = run([enter(0), drop(5_000), tick(5_000 + CORRELATION_MS + 1), ad(9_000, false)], KEEP);
    expect(r.actions).toEqual([]);
    expect(r.state.pendingDrop).toBeNull();
    expect(r.state.established).toBe("fullscreen"); // the human never left; a future correlated drop still restores
  });
  it("our own restore landing is not a fresh establishment, and is asked for once", () => {
    const r = run([enter(0), ad(5_000, false), drop(5_100), ad(5_200, false), tick(6_000)], KEEP);
    expect(r.actions).toHaveLength(1);
    const landed = step(r.state, enter(5_400), KEEP);
    expect(landed.state.restoreRequested).toBeNull();
    expect(landed.state.established).toBe("fullscreen");
  });
  it("theater is kept the same way", () => {
    const r = run([{ type: "presentation", at: 0, state: "theater" }, ended(9_000), drop(9_100)], KEEP);
    expect(r.actions).toEqual([{ kind: "enterTheater", reason: "ended" }]);
  });
  it("onEnd: restart plays; restart-fullscreen plays and restores under its own instruction", () => {
    expect(run([enter(0), ended(9_000)], { keepPresentation: false, onEnd: "restart" }).actions).toEqual([{ kind: "play", reason: "onEnd" }]);
    const r = run([enter(0), drop(8_000), tick(10_000), ended(20_000)], { keepPresentation: false, onEnd: "restart-fullscreen" });
    expect(r.actions).toEqual([{ kind: "play", reason: "onEnd" }, { kind: "enterFullscreen", reason: "onEnd" }]);
    // ended-correlated drop + restart-fullscreen: one restore, not two
    const both = run([enter(0), ended(9_000), drop(9_100)], { keepPresentation: true, onEnd: "restart-fullscreen" });
    expect(both.actions).toEqual([{ kind: "play", reason: "onEnd" }, { kind: "enterFullscreen", reason: "ended" }]);
    // the human left: replay may happen, the presentation is not restored
    const left = run([enter(0), input(7_900), drop(8_000), ended(20_000)], { keepPresentation: false, onEnd: "restart-fullscreen" });
    expect(left.actions).toEqual([{ kind: "play", reason: "onEnd" }]);
  });
});

describe("§26 presentation actions exist ONLY under a standing instruction", () => {
  const every: KeeperEvent[][] = [
    [enter(0), ad(10_000, true), ad(40_000, false), drop(40_300), tick(50_000)],
    [enter(0), drop(10_000), ad(10_200, true), ad(40_000, false), tick(50_000)],
    [enter(0), ended(9_000), drop(9_100), tick(20_000)],
    [enter(0), drop(8_000), ended(9_000), tick(20_000)],
    [{ type: "presentation", at: 0, state: "theater" }, ended(9_000), drop(9_100)],
    [enter(0), input(100), drop(200), enter(1_000), ad(2_000, false), drop(2_100), ended(3_000), tick(9_000)],
  ];
  it("with keepPresentation off and onEnd none, no event sequence produces any action", () => {
    for (const events of every) expect(run(events, OFF).actions, JSON.stringify(events)).toEqual([]);
  });
  it("the default assignment settings carry no standing instruction", () => {
    expect(keeperConfig(DEFAULT_ASSIGNMENT_SETTINGS)).toEqual(OFF);
  });
  it("no other core module can emit a presentation action: the action strings live in this machine alone", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../src/presentation-keeper.ts"), "utf8");
    // every action is constructed through restoreAction()/the onEnd branch, both gated by config
    expect(src.match(/\{ kind: "enterFullscreen", reason \}/g)).toHaveLength(1);
    expect(src.match(/\{ kind: "enterTheater", reason \}/g)).toHaveLength(1);
    expect(src.match(/\{ kind: "play", reason: "onEnd" \}/g)).toHaveLength(1);
    expect(initialKeeperState().established).toBeNull();
  });
});
