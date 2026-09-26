/**
 * Presentation actions (dashboard-schema §26 "presentation keeping").
 *
 * Adapters expose named presentation actions — `enterFullscreen`,
 * `enterTheater`, `play` — as data (`AdapterSpec.presentation`). They are
 * invocable ONLY under a standing human instruction, which in core means:
 * only as outputs of the presentation keeper's state machine
 * (`presentation-keeper.ts`), which itself emits an action only when a
 * per-assignment `keepPresentation` / `onEnd` instruction is set and the
 * drop was the site's doing. This module is the single place that turns a
 * keeper action into page-side JS; nothing else reads the presentation block
 * (tests/adapters-presentation.test.ts asserts that with a source grep).
 *
 * The runner below keeps one keeper state per surface and resolves actions
 * through the adapter bound to that surface. The shell/orchestrator feeds it
 * events (user input, presentation state changes, ad-break, ended) and
 * injects the JS it returns. Feeding is SM-4's wiring (see the ledger); the
 * machine and the resolution are complete here.
 */

import type { AdapterSpec } from "./adapters.js";
import { clickControlJs } from "./adapters.js";
import type { AssignmentSettings } from "./scene-model.js";
import { initialKeeperState, keeperConfig, step, type KeeperEvent, type KeeperState, type PresentationAction } from "./presentation-keeper.js";

/** A resolved action: the JS to inject (null when the adapter declares no control for it) plus why. */
export interface ResolvedPresentationAction {
  action: PresentationAction;
  /** Page-side JS forwarding to the player's own control, or null = the adapter has no such control (nothing happens). */
  js: string | null;
}

/**
 * THE call site: keeper action → adapter presentation control → JS. Returns
 * null JS when the adapter declares nothing for the action — keeping then
 * degrades to nothing, never to a guess (no generic "find a fullscreen
 * button" heuristics live here; a human tap has its own path in the shell).
 */
export function resolvePresentationAction(spec: AdapterSpec | undefined, action: PresentationAction): ResolvedPresentationAction {
  const control = spec?.presentation?.[action.kind];
  return { action, js: typeof control === "string" && control.trim() ? clickControlJs(control) : null };
}

export interface KeeperSurface {
  state: KeeperState;
  settings: Pick<AssignmentSettings, "keepPresentation" | "onEnd">;
  adapter?: AdapterSpec;
}

/**
 * Per-surface presentation keeping. `handle` steps the machine for one
 * surface and returns the resolved actions (possibly none). Surfaces with
 * no standing instruction never produce an action — that gate is inside
 * `step`; this class adds nothing that could bypass it.
 */
export class PresentationKeeperRunner {
  private surfaces = new Map<string, KeeperSurface>();

  /** Register (or re-register on a scene change) a surface with its standing instructions and adapter. */
  attach(surfaceId: string, settings: Pick<AssignmentSettings, "keepPresentation" | "onEnd">, adapter?: AdapterSpec): void {
    const prev = this.surfaces.get(surfaceId);
    this.surfaces.set(surfaceId, { state: prev?.state ?? initialKeeperState(), settings: { keepPresentation: settings.keepPresentation, onEnd: settings.onEnd }, ...(adapter ? { adapter } : {}) });
  }

  detach(surfaceId: string): void {
    this.surfaces.delete(surfaceId);
  }

  has(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }

  stateOf(surfaceId: string): KeeperState | undefined {
    return this.surfaces.get(surfaceId)?.state;
  }

  /** One event for one surface; the actions the shell may inject, already resolved against the adapter. */
  handle(surfaceId: string, event: KeeperEvent): ResolvedPresentationAction[] {
    const s = this.surfaces.get(surfaceId);
    if (!s) return [];
    const r = step(s.state, event, keeperConfig(s.settings));
    s.state = r.state;
    return r.actions.map((a) => resolvePresentationAction(s.adapter, a));
  }
}
