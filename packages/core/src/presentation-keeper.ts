/**
 * Presentation keeping (dashboard-schema §26 "standing human instruction").
 *
 * Sites drop player fullscreen/theater at ad boundaries or video end. When a
 * facet-in-slot carries `keepPresentation: true`, the shell restores the
 * state the HUMAN established — and only when the drop is the site's doing:
 *
 *  - a drop that CORRELATES with an ad-break or `ended` signal (within
 *    CORRELATION_MS either way) is site-initiated → restore at the boundary;
 *  - a drop PRECEDED by user input (within USER_INPUT_MS) is the human
 *    leaving → never fought; keeping stays off until the human re-enters;
 *  - a drop with no signal either way is doubt → nothing (asymmetric bias:
 *    fighting a human is the real failure, a lost fullscreen is cheap).
 *
 * Restoration never fires while an ad break is active: a drop at ad START
 * waits for the break's END (the boundary the site created), so keeping
 * can never alter an ad. `onEnd` replays at `ended` under its own standing
 * instruction. Pure and event-driven: `step(state, event)` returns the next
 * state and the actions the shell may take — presentation actions
 * (enterFullscreen / enterTheater / play) exist ONLY as outputs of this
 * machine, and only under a standing instruction.
 */

import type { AssignmentSettings, OnEnd } from "./scene-model.js";

export type PresentationState = "fullscreen" | "theater" | "none";

export type KeeperEvent =
  | { type: "user-input"; at: number }
  | { type: "presentation"; at: number; state: PresentationState }
  | { type: "ad-break"; at: number; active: boolean }
  | { type: "ended"; at: number }
  | { type: "tick"; at: number };

export type PresentationAction =
  | { kind: "enterFullscreen"; reason: KeeperReason }
  | { kind: "enterTheater"; reason: KeeperReason }
  | { kind: "play"; reason: "onEnd" };

export type KeeperReason = "ad-break" | "ended" | "onEnd";

export interface KeeperConfig {
  keepPresentation: boolean;
  onEnd: OnEnd;
}

export interface KeeperState {
  /** What the human established (the state to restore); null once the human left it. */
  established: Exclude<PresentationState, "none"> | null;
  /** What the player reports now. */
  current: PresentationState;
  lastUserInputAt: number | null;
  lastBoundaryAt: number | null;
  lastBoundary: "ad-break" | "ended" | null;
  adBreakActive: boolean;
  /** A site-initiated drop we are holding for its correlating signal, or for the ad break to end. */
  pendingDrop: { at: number; state: Exclude<PresentationState, "none">; waitingForBreakEnd: boolean } | null;
  /** We asked for a restore; the next matching entry is ours, not a fresh human establishment. */
  restoreRequested: Exclude<PresentationState, "none"> | null;
}

/** A drop this close after user input belongs to the human. */
export const USER_INPUT_MS = 1_000;
/** A drop and an ad-break/ended signal this close together are one site event. */
export const CORRELATION_MS = 1_500;

export function initialKeeperState(): KeeperState {
  return { established: null, current: "none", lastUserInputAt: null, lastBoundaryAt: null, lastBoundary: null, adBreakActive: false, pendingDrop: null, restoreRequested: null };
}

export function keeperConfig(settings: Pick<AssignmentSettings, "keepPresentation" | "onEnd">): KeeperConfig {
  return { keepPresentation: settings.keepPresentation, onEnd: settings.onEnd };
}

function restoreAction(state: Exclude<PresentationState, "none">, reason: KeeperReason): PresentationAction {
  return state === "fullscreen" ? { kind: "enterFullscreen", reason } : { kind: "enterTheater", reason };
}

/** One event in; the next state and the (possibly empty) action list out. */
export function step(state: KeeperState, event: KeeperEvent, config: KeeperConfig): { state: KeeperState; actions: PresentationAction[] } {
  const s: KeeperState = { ...state };
  const actions: PresentationAction[] = [];

  // The gate: a presentation action exists only under a standing instruction.
  // keepPresentation covers site drops at ad-break/ended boundaries; onEnd
  // "restart-fullscreen" covers the restore that replay asks for.
  const restore = (target: Exclude<PresentationState, "none">, reason: KeeperReason): void => {
    s.pendingDrop = null;
    if (reason === "ad-break" && !config.keepPresentation) return;
    if (reason === "ended" && !config.keepPresentation) {
      if (config.onEnd !== "restart-fullscreen") return;
      reason = "onEnd";
    }
    if (reason === "onEnd" && config.onEnd !== "restart-fullscreen") return;
    if (s.restoreRequested === target) return; // already asked
    s.restoreRequested = target;
    actions.push(restoreAction(target, reason));
  };

  const resolvePending = (now: number): void => {
    const p = s.pendingDrop;
    if (!p) return;
    if (p.waitingForBreakEnd) { if (!s.adBreakActive) restore(p.state, "ad-break"); return; }
    const userLeft = s.lastUserInputAt !== null && s.lastUserInputAt >= p.at - USER_INPUT_MS && s.lastUserInputAt <= p.at + USER_INPUT_MS;
    if (userLeft) { s.pendingDrop = null; s.established = null; return; }
    const correlated = s.lastBoundaryAt !== null && Math.abs(s.lastBoundaryAt - p.at) <= CORRELATION_MS;
    if (correlated) {
      if (s.adBreakActive) { s.pendingDrop = { ...p, waitingForBreakEnd: true }; return; }
      restore(p.state, s.lastBoundary ?? "ad-break");
      return;
    }
    if (now - p.at > CORRELATION_MS) s.pendingDrop = null; // doubt: never fought, never restored
  };

  switch (event.type) {
    case "user-input": {
      s.lastUserInputAt = event.at;
      if (s.pendingDrop && !s.pendingDrop.waitingForBreakEnd && event.at - s.pendingDrop.at <= USER_INPUT_MS) {
        // the human acted right after the drop: their exit, not the site's
        s.pendingDrop = null;
        s.established = null;
      } else if (s.pendingDrop?.waitingForBreakEnd) {
        // the human took over during the break: the standing state is theirs to re-enter
        s.pendingDrop = null;
        s.established = null;
      }
      break;
    }
    case "presentation": {
      const prev = s.current;
      s.current = event.state;
      if (event.state !== "none") {
        if (s.restoreRequested === event.state) s.restoreRequested = null; // our restore landed
        s.established = event.state;                                       // human-established (or re-established)
        s.pendingDrop = null;
      } else if (prev !== "none") {
        const userLeft = s.lastUserInputAt !== null && event.at - s.lastUserInputAt <= USER_INPUT_MS && event.at >= s.lastUserInputAt;
        if (userLeft) { s.established = null; s.pendingDrop = null; break; }
        if (!s.established) break;
        s.pendingDrop = { at: event.at, state: s.established, waitingForBreakEnd: false };
        resolvePending(event.at);
      }
      break;
    }
    case "ad-break": {
      s.adBreakActive = event.active;
      s.lastBoundaryAt = event.at;
      s.lastBoundary = "ad-break";
      resolvePending(event.at);
      break;
    }
    case "ended": {
      s.lastBoundaryAt = event.at;
      s.lastBoundary = "ended";
      resolvePending(event.at);
      if (config.onEnd !== "none") {
        actions.push({ kind: "play", reason: "onEnd" });
        // replay-and-restore: the state already dropped (uncorrelated earlier, or
        // held pending) comes back under onEnd's own instruction
        if (config.onEnd === "restart-fullscreen" && s.established && s.current === "none") restore(s.established, "onEnd");
      }
      break;
    }
    case "tick": {
      resolvePending(event.at);
      break;
    }
  }
  return { state: s, actions };
}

/** Convenience: run a whole event log; returns the final state and every action in order. */
export function run(events: readonly KeeperEvent[], config: KeeperConfig, start: KeeperState = initialKeeperState()): { state: KeeperState; actions: PresentationAction[] } {
  let state = start;
  const actions: PresentationAction[] = [];
  for (const e of events) {
    const r = step(state, e, config);
    state = r.state;
    actions.push(...r.actions);
  }
  return { state, actions };
}
