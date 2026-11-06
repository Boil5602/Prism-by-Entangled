/**
 * Model evaluation for the editors (SM-2; exposed as PrismRuntime.model* host
 * calls by runtime.ts, B-40).
 *
 * The layout and facet editors need core's classing, bucket snapping, canvas
 * classes, representative shapes, preset resolution, the login-redirect
 * heuristic and the §31 element picker - decisions that must stay core-side
 * (B-10: the XL line flips in ONE place). Every function is sync, JSON in /
 * JSON out; runtime.ts re-exports them one-to-one, so the shell evaluates
 * `PrismRuntime.<fn>` and mirrors no threshold of its own.
 */

import {
  canvasClassOf,
  classifyRect,
  formatCanvasClass,
  formatSlotClass,
  nearestAspectBucket,
  normalizeLayout,
  parseSlotClass,
  sizeTier,
  slotClassRatio,
  type Layout,
} from "./scene-model.js";
import { FACET_PICK_POLL_JS, FACET_PICK_STOP_JS, facetPickerJs, facetPresetsFor, loginRedirect, presetFacet, sessionProbeJs, sessionVerdict, signInPage, signInPressJs, representativeRect, selectorRectJs, setupStatusFor, tunedPresetFor, type CatalogEntryWithFacets } from "./adapters-facets.js";

const json = (v: unknown): string => JSON.stringify(v);

function parse<T>(s: string | null | undefined): T | null {
  if (s === null || s === undefined || s === "") return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

const modelEval = {
  /** normalizeLayout on a draft (classes + canvas class), never persisted; "null" when invalid. */
  classifyLayout(layoutJson: string): string {
    const l = normalizeLayout(parse(layoutJson));
    if (!l) return "null";
    return json({ ...l, canvasLabel: formatCanvasClass(l.canvas) } satisfies Layout & { canvasLabel: string });
  },
  /** One rect on a canvas → its class string. */
  classifyRect(x: number, y: number, w: number, h: number, canvasW: number, canvasH: number): string {
    return json({ class: formatSlotClass(classifyRect({ x, y, w, h }, { w: canvasW, h: canvasH })), tier: sizeTier(w * h) });
  },
  /** Nearest aspect bucket for a pixel ratio, with its ratio (so a drawn slot can snap its height). */
  nearestBucket(ratio: number): string {
    const b = nearestAspectBucket(ratio);
    return json({ bucket: b.bucket, deviation: b.deviation, ratio: slotClassRatio({ aspect: b.bucket, tier: "M" }) });
  },
  canvasClass(w: number, h: number): string {
    const c = canvasClassOf(w, h);
    return json({ ...c, label: formatCanvasClass(c) });
  },
  /** The centered pixel rect a slot class previews at on a canvas. */
  representativeRect(slotClass: string, w: number, h: number): string {
    return json(representativeRect(slotClass, { w, h }));
  },
  classRatio(slotClass: string): string {
    return json(slotClassRatio(slotClass));
  },
  parseClass(slotClass: string): string {
    return json(parseSlotClass(slotClass));
  },
  /** The catalog entry's presets for a slot class (exact class first, then aspect-wide). */
  facetPresets(entryJson: string, slotClass: string): string {
    return json(facetPresetsFor(parse<CatalogEntryWithFacets>(entryJson) ?? undefined, slotClass));
  },
  tunedPreset(entryJson: string, roleClass: string, presetId: string): string {
    return json(tunedPresetFor(parse<CatalogEntryWithFacets>(entryJson) ?? undefined, roleClass, presetId));
  },
  /** The Facet input a preset produces (modelSaveFacet's shape); "null" when the entry or preset is unknown. */
  presetFacet(entryJson: string, presetId: string, appId: string, slotClass: string, selectorTableJson: string | null, facetId: string | null): string {
    const entry = parse<CatalogEntryWithFacets>(entryJson);
    if (!entry) return "null";
    const preset = tunedPresetFor(entry, slotClass, presetId);
    if (!preset) return "null";
    return json(presetFacet(entry, preset, { id: appId }, slotClass, parse<Record<string, string>>(selectorTableJson) ?? undefined, facetId ? { facetId } : {}));
  },
  /** {redirect: login|app|elsewhere, status: needs-attention|signed-in|null} for a navigated URL. */
  loginRedirect(url: string, loginPrefix: string | null, baseUrl: string | null): string {
    const r = loginRedirect(url, { login: loginPrefix, baseUrl });
    return json({ redirect: r, status: setupStatusFor(r) });
  },
  /** Page JS for an adapter's session probe (selectors as JSON literals; either may be null). */
  sessionProbeJs(signedIn: string | null, signedOut: string | null): string {
    return sessionProbeJs({ signedIn, signedOut });
  },
  /** "signed-in" | "needs-attention" | null from the probe's raw ExecuteScript result. */
  /** The adapter's login as a page to open, or "" when the sign-in is on the service's own page. */
  signInPage(login: string | null, signIn?: string | null): string { return signInPage(login, signIn) ?? ""; },
  signInPressJs(signedOut: string | null): string { return signInPressJs(signedOut); },
  sessionVerdict(resultJson: string | null): string {
    return json(sessionVerdict(resultJson));
  },
  /** The §31 element picker as injectable page JS, its poll and stop expressions, and a selector verifier. */
  facetPickerJs(): string {
    return facetPickerJs();
  },
  facetPickPollJs(): string {
    return FACET_PICK_POLL_JS;
  },
  facetPickStopJs(): string {
    return FACET_PICK_STOP_JS;
  },
  selectorRectJs(selector: string): string {
    return selectorRectJs(selector);
  },
};

declare global {
  // eslint-disable-next-line no-var
  var PrismModelEval: ModelEvalApi | undefined;
}

export type ModelEvalApi = typeof modelEval;
export const PrismModelEval: ModelEvalApi = modelEval;
if (typeof globalThis !== "undefined") globalThis.PrismModelEval = modelEval;
