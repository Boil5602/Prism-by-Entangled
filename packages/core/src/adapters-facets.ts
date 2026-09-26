/**
 * Facet-side adapter data (dashboard-schema §31 "utility facet presets",
 * scene-model-spec §2/§4): the catalog's per-slot-class presets, their
 * resolution into a plain Facet, the login-redirect heuristic that flips an
 * App to "needs attention", the representative shape a slot class previews
 * at, and the §31 element picker (hover-highlight → tap records a stable
 * selector) as page-side JS.
 *
 * Presets reference adapter selectors BY NAME — the catalog never carries
 * CSS; drift lives in the adapter's `selectors` table. `presetSelectorNames`
 * feeds the repo test that fails on a dangling name.
 */

import type { CatalogEntry, CatalogPreset } from "./catalog.js";
import { clampZoom } from "./catalog.js";
import type { App, AppSetupStatus, SlotClass } from "./scene-model.js";
import { ASPECT_BUCKETS, TIER_SHARE, bucketAspectHint, formatSlotClass, parseSlotClass, slotClassRatio, type AspectBucket, type SizeTier } from "./scene-model.js";

/* ------------------------------------------------- facet presets (§31) ---- */

/** A facet preset: a focus preset tuned for one slot class (zoom for glanceability, a page, padding). */
export interface FacetPreset extends CatalogPreset {
  /** Page override; default = the catalog entry's url. */
  url?: string | null;
  /** §31 zoom (0.5–3) tuned so the region reads at the class's size. */
  zoom?: number;
  /** §17 region padding in CSS px. */
  pad?: number;
  fit?: "width" | "height" | "contain";
  /** Notes for the picker / review ("location page: search your town first"). */
  notes?: string;
}

/** Catalog entry with the §31 per-slot-class block: key = a slot class ("4:3·M") or an aspect bucket ("8:1-ticker", any tier). */
export interface CatalogEntryWithFacets extends CatalogEntry {
  facetPresets?: Record<string, FacetPreset[]>;
}

function keyMatches(key: string, cls: SlotClass): "exact" | "aspect" | null {
  const parsed = parseSlotClass(key);
  if (parsed) return parsed.aspect === cls.aspect && parsed.tier === cls.tier ? "exact" : null;
  return key === cls.aspect ? "aspect" : null;
}

/** The presets a catalog entry offers for a slot class — exact-class keys first, then aspect-wide ones. Empty when none. */
export function facetPresetsFor(entry: CatalogEntryWithFacets | undefined, slotClass: string | SlotClass): FacetPreset[] {
  const cls = typeof slotClass === "string" ? parseSlotClass(slotClass) : slotClass;
  if (!entry?.facetPresets || !cls) return [];
  const exact: FacetPreset[] = [], wide: FacetPreset[] = [];
  for (const [key, list] of Object.entries(entry.facetPresets)) {
    if (!Array.isArray(list)) continue;
    const m = keyMatches(key, cls);
    if (m === "exact") exact.push(...list);
    else if (m === "aspect") wide.push(...list);
  }
  const seen = new Set<string>();
  return [...exact, ...wide].filter((p) => p && typeof p.id === "string" && !seen.has(p.id) && seen.add(p.id));
}

/**
 * The preset a Scene Template role names (`tunedPreset`, by id) for its
 * class: a facet preset of that class first, else the plain focus preset of
 * the same id (whole-page semantics, no zoom tuning). Null = the entry has
 * no such preset; the wizard then offers the plain picker.
 */
export function tunedPresetFor(entry: CatalogEntryWithFacets | undefined, roleClass: string, presetId: string): FacetPreset | null {
  const tuned = facetPresetsFor(entry, roleClass).find((p) => p.id === presetId);
  if (tuned) return tuned;
  const plain = entry?.focusPresets?.find((p) => p.id === presetId);
  return plain ? { ...plain } : null;
}

/** Every adapter selector NAME a catalog entry's presets reference (focus + facet presets) — for the dangling-name test. */
export function presetSelectorNames(entry: CatalogEntryWithFacets): string[] {
  const names = new Set<string>();
  for (const p of entry.focusPresets ?? []) if (p.selector) names.add(p.selector);
  for (const list of Object.values(entry.facetPresets ?? {})) for (const p of list ?? []) if (p.selector) names.add(p.selector);
  return [...names];
}

/** "16:9·XL" → "16x9-xl" (a facet id fragment). */
export function slotClassSlug(slotClass: string): string {
  return slotClass.toLowerCase().replace(/[·]/g, "-").replace(/[^a-z0-9-]+/g, "x").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The plain Facet a preset produces for an App and slot class. The selector
 * name resolves through the adapter's table; an unresolvable name degrades
 * to whole page (never a dangling name in the store, §31). Returns the
 * store's input shape — `modelSaveFacet` normalizes it.
 */
export function presetFacet(
  entry: CatalogEntryWithFacets,
  preset: FacetPreset,
  app: Pick<App, "id">,
  slotClass: string,
  selectorTable?: Record<string, string>,
  ids: { facetId?: string } = {},
): Record<string, unknown> {
  const cls = parseSlotClass(slotClass);
  const css = preset.selector ? selectorTable?.[preset.selector] : undefined;
  const zoom = preset.zoom ?? entry.zoom;
  const facet: Record<string, unknown> = {
    id: ids.facetId ?? `${app.id}-${preset.id}-${slotClassSlug(slotClass)}`,
    app: app.id,
    url: preset.url ?? entry.url,
    slotClass,
    label: preset.label,
  };
  if (css) facet.focus = { selector: css, pad: preset.pad ?? 12, ...(preset.fit ? { fit: preset.fit } : {}) };
  if (typeof zoom === "number" && zoom !== 1) facet.zoom = clampZoom(zoom);
  if (cls && ASPECT_BUCKETS.some((b) => b.id === cls.aspect)) facet.aspectHint = bucketAspectHint(cls.aspect as AspectBucket);
  if (entry.audio === "mute") facet.audio = "mute";
  return facet;
}

/* ------------------------------------------- representative shape (§4) ---- */

/**
 * The area share a tier previews at: the midpoint of its band (XL: between
 * its floor and the whole canvas). Derived from TIER_SHARE so the preview
 * follows the tier line wherever B-10 lands it.
 */
export function representativeShare(tier: SizeTier): number {
  const floors: Record<SizeTier, number> = { XL: TIER_SHARE.XL, L: TIER_SHARE.L, M: TIER_SHARE.M, S: 0 };
  const ceilings: Record<SizeTier, number> = { XL: 1, L: TIER_SHARE.XL, M: TIER_SHARE.L, S: TIER_SHARE.M };
  return (floors[tier] + ceilings[tier]) / 2;
}

/** The pixel rect (centered) a slot class previews at on a canvas — the facet editor's box. */
export function representativeRect(slotClass: string | SlotClass, canvas: { w: number; h: number }): { x: number; y: number; w: number; h: number } | null {
  const cls = typeof slotClass === "string" ? parseSlotClass(slotClass) : slotClass;
  const ratio = cls ? slotClassRatio(cls) : null;
  if (!cls || !ratio || canvas.w <= 0 || canvas.h <= 0) return null;
  const area = representativeShare(cls.tier) * canvas.w * canvas.h;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  if (w > canvas.w) { w = canvas.w; h = w / ratio; }
  if (h > canvas.h) { h = canvas.h; w = h * ratio; }
  return { x: (canvas.w - w) / 2, y: (canvas.h - h) / 2, w, h };
}

/** Class string for a given aspect bucket + tier (convenience for shells). */
export function classString(aspect: AspectBucket | string, tier: SizeTier): string {
  return formatSlotClass({ aspect, tier });
}

/* ----------------------------------------------- login redirect (§2) ---- */

export type LoginRedirect = "login" | "app" | "elsewhere";

const LOGIN_PATH_RE = /(^|\/)(login|log-in|signin|sign-in|sign_in|auth|authorize|oauth2?|sso|account\/login|accounts\/login|session\/new)(\/|$|\?)/i;
const LOGIN_HOSTS = [/^accounts\.google\.com$/i, /^login\.microsoftonline\.com$/i, /^login\.live\.com$/i, /^appleid\.apple\.com$/i, /^idmsa\.apple\.com$/i, /^auth\./i, /^login\./i, /^signin\./i, /^id\./i];

function registrable(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

/**
 * Where a navigated URL landed, relative to an App: on its sign-in (the
 * adapter/catalog `login` prefix, else a well-known login host or path), on
 * the App's own site, or elsewhere. Pure and conservative: a real login
 * prefix from the adapter always wins; the generic patterns only add
 * "login" verdicts, never take one away.
 */
export function loginRedirect(url: string, opts: { login?: string | null; baseUrl?: string | null } = {}): LoginRedirect {
  let u: URL;
  try { u = new URL(url); } catch { return "elsewhere"; }
  if (opts.login) {
    try {
      const l = new URL(opts.login);
      if (u.host.toLowerCase() === l.host.toLowerCase() && (u.pathname === l.pathname || u.pathname.startsWith(l.pathname.replace(/\/$/, "") + "/") || (l.pathname === "/" && u.pathname === "/"))) return "login";
    } catch { /* an unparsable login prefix cannot match */ }
  }
  if (LOGIN_HOSTS.some((re) => re.test(u.hostname)) || LOGIN_PATH_RE.test(u.pathname)) return "login";
  if (opts.baseUrl) {
    try {
      if (registrable(new URL(opts.baseUrl).hostname) === registrable(u.hostname)) return "app";
    } catch { /* fall through */ }
  }
  return "elsewhere";
}

/**
 * The passive verification (scene-model §2): a facet or setup page landing
 * on a login redirect flips the App to "needs attention"; landing on the
 * App's own site after browsing counts as signed in; elsewhere changes
 * nothing (null). `lastVerified` is the caller's date.
 */
export function setupStatusFor(redirect: LoginRedirect): AppSetupStatus | null {
  return redirect === "login" ? "needs-attention" : redirect === "app" ? "signed-in" : null;
}

/* ---------------------------------------------------- the session probe ---- */

/**
 * What an adapter says proves a signed-in page (its avatar, profile gate, account
 * menu) and what proves a signed-out one (its Sign in link). Both optional: an
 * adapter without a probe yields no evidence either way, and the App is then
 * "reachable", never "signed in", unless a person marks it.
 */
export interface SessionProbe {
  signedIn?: string | null;
  signedOut?: string | null;
}

/**
 * Page JS for the probe: evaluates to a JSON string {signedIn, signedOut, url}.
 * Selectors are embedded as JSON string literals, so nothing in an adapter's
 * data can escape into code. Nothing about the page leaves the device.
 */
/**
 * B-123 (2026-09-07): the same probe, standing. Injected with the adapter on the wall; it looks every 2 s
 * for the first 30 s after load (the page's chrome settles), then every 30 s, and sets
 * `window.__prismSession` to "signed-in" | "signed-out" on evidence, never on its absence. The shell's
 * bootstrap posts a change as a `session` surface event; the page never talks to the host itself.
 */
export function sessionWatchJs(probe: SessionProbe): string {
  const q = (s: string | null | undefined) => (s ? `!!document.querySelector(${JSON.stringify(s)})` : "false");
  return `(function(){if(window.__prismSessionWatch)return;window.__prismSessionWatch=1;var n=0;function look(){try{var i=${q(probe.signedIn)},o=${q(probe.signedOut)};var s=i&&!o?'signed-in':o&&!i?'signed-out':null;if(s)window.__prismSession=s;}catch(e){}n++;setTimeout(look,n<15?2000:30000);}look();})();`;
}

export function sessionProbeJs(probe: SessionProbe): string {
  const q = (s: string | null | undefined) => (s ? `!!document.querySelector(${JSON.stringify(s)})` : "false");
  return `(function(){try{return JSON.stringify({signedIn:${q(probe.signedIn)},signedOut:${q(probe.signedOut)},url:location.href});}catch(e){return JSON.stringify({error:String(e)});}})()`;
}

/**
 * The probe's verdict: "signed-in" on evidence of an account, "needs-attention" on
 * evidence of its absence, null when the page showed neither (still loading, a page
 * without the chrome, a probe that no longer matches). Accepts the raw value a
 * WebView's ExecuteScript returns (a JSON-encoded string) or the decoded JSON.
 */
export function sessionVerdict(result: string | null | undefined): AppSetupStatus | null {
  if (!result) return null;
  try {
    let v: unknown = JSON.parse(result);
    if (typeof v === "string") v = JSON.parse(v);
    if (!v || typeof v !== "object") return null;
    const r = v as { signedIn?: unknown; signedOut?: unknown };
    if (r.signedIn === true && r.signedOut !== true) return "signed-in";
    if (r.signedOut === true && r.signedIn !== true) return "needs-attention";
    return null;
  } catch { return null; }
}

/* --------------------------------------------- the element picker (§31) ---- */

/**
 * Stable selector for an element: id → data-testid / data-qa / data-test →
 * a short class path (hashed / framework classes skipped), each candidate
 * verified to resolve to exactly one element. Self-contained (embedded in
 * the page script by source), ES2018, no closures over module scope.
 */
export function stableSelector(el: Element, doc: Document): { selector: string; unique: boolean } | null {
  const esc = (s: string): string => (typeof (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape === "function" ? (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS.escape(s) : s.replace(/([^a-zA-Z0-9_-])/g, "\\$1"));
  const unique = (sel: string): boolean => { try { return doc.querySelectorAll(sel).length === 1; } catch { return false; } };
  const hashed = (s: string): boolean => /\d{4,}/.test(s) || /^(css|sc|jss|svelte|emotion|chakra)-/.test(s) || (/[0-9]/.test(s) && /[A-Z]/.test(s) && s.length >= 10) || (s.length >= 16 && !/[-_]/.test(s));
  const stableId = (s: string): boolean => !!s && !hashed(s) && !/^[0-9]/.test(s) && !/[:.]/.test(s);
  const attrs = ["data-testid", "data-qa", "data-test", "data-test-id", "data-cy", "data-a-target", "name", "aria-label"];

  const own = (e: Element): string | null => {
    const id = e.getAttribute("id") ?? "";
    if (stableId(id) && unique("#" + esc(id))) return "#" + esc(id);
    for (const a of attrs) {
      const v = e.getAttribute(a);
      if (v && !hashed(v) && v.length <= 80) {
        const sel = `${e.tagName.toLowerCase()}[${a}="${v.replace(/"/g, '\\"')}"]`;
        if (unique(sel)) return sel;
      }
    }
    return null;
  };
  const step = (e: Element): string => {
    const tag = e.tagName.toLowerCase();
    const cls = Array.from(e.classList).filter((c) => !hashed(c)).slice(0, 2).map((c) => "." + esc(c)).join("");
    let s = tag + cls;
    const parent = e.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === e.tagName && (!cls || Array.from(e.classList).filter((k) => !hashed(k)).slice(0, 2).every((k) => c.classList.contains(k))));
      if (same.length > 1) s += `:nth-of-type(${Array.from(parent.children).filter((c) => c.tagName === e.tagName).indexOf(e) + 1})`;
    }
    return s;
  };

  const direct = own(el);
  if (direct) return { selector: direct, unique: true };
  // walk up: an ancestor with a stable hook anchors the path (robust to
  // look-alikes appearing later); failing that, the shortest unique path
  const path: string[] = [];
  let shortest: string | null = null;
  let cur: Element | null = el;
  for (let depth = 0; cur && cur !== doc.documentElement && depth < 6; depth++) {
    const anchor = depth === 0 ? null : own(cur);
    if (anchor) {
      const loose = anchor + " " + path[path.length - 1];
      if (unique(loose)) return { selector: loose, unique: true };
      const sel = anchor + " > " + path.join(" > ");
      if (unique(sel)) return { selector: sel, unique: true };
      break;
    }
    path.unshift(step(cur));
    const sel = path.join(" > ");
    if (shortest === null && unique(sel)) shortest = sel;
    cur = cur.parentElement;
  }
  if (shortest) return { selector: shortest, unique: true };
  const fallback = path.join(" > ");
  return fallback ? { selector: fallback, unique: unique(fallback) } : null;
}

/**
 * Page-side picker (installed by the shell into the App's surface while the
 * facet editor is in "pick an element" mode): the hovered element's box is
 * outlined; a click records `{selector, unique, tag, rect (document CSS px),
 * client (viewport px), scroll, viewport}`
 * on `window.__prismFacetPick` and stops. The shell polls that value.
 * `window.__prismFacetPickStop()` cancels. The click that picks never
 * reaches the page (the human is choosing a region, not pressing a button),
 * and the picker ignores Prism's own veil / UI elements.
 */
function facetPickerMain(stable: (el: Element, doc: Document) => { selector: string; unique: boolean } | null): void {
  const w = window as unknown as { __prismFacetPick?: unknown; __prismFacetPickStop?: (() => void) | undefined; __prismFacetPicking?: boolean };
  if (w.__prismFacetPickStop) w.__prismFacetPickStop();
  w.__prismFacetPick = null;
  w.__prismFacetPicking = true;
  const box = document.createElement("div");
  box.setAttribute("data-prism-ui", "facet-pick");
  box.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646;border:2px solid #F0A83C;box-shadow:0 0 0 4px rgba(240,168,60,.35),0 0 0 9999px rgba(15,18,22,.18);border-radius:4px;transition:all 60ms linear;display:none";
  const tag = document.createElement("div");
  tag.setAttribute("data-prism-ui", "facet-pick");
  tag.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;background:#12131A;color:#F0A83C;font:12px/1.4 Consolas,monospace;padding:2px 6px;border-radius:4px;display:none;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  (document.body || document.documentElement).appendChild(box);
  (document.body || document.documentElement).appendChild(tag);
  let current: Element | null = null;
  const ours = (e: Element | null): boolean => !!e && (e.hasAttribute("data-prism-ui") || e.hasAttribute("data-prism-veil") || !!e.closest("[data-prism-ui],[data-prism-veil]"));
  const target = (x: number, y: number): Element | null => {
    box.style.display = "none";
    let e = document.elementFromPoint(x, y);
    box.style.display = current ? "block" : "none";
    if (!e || ours(e) || e === document.documentElement || e === document.body) return null;
    // a bare text-ish leaf inside a link/button: the control is the better region
    const ctl = e.closest("a,button,[role=button],li,article,section,[data-testid],[data-qa]");
    if (ctl && !ours(ctl) && ctl !== document.body) e = ctl;
    return e;
  };
  const show = (e: Element): void => {
    const r = e.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = r.left + "px"; box.style.top = r.top + "px"; box.style.width = r.width + "px"; box.style.height = r.height + "px";
    const s = stable(e, document);
    tag.textContent = (s ? s.selector : e.tagName.toLowerCase()) + "  " + Math.round(r.width) + "×" + Math.round(r.height);
    tag.style.display = "block";
    tag.style.left = Math.max(4, r.left) + "px";
    tag.style.top = (r.top > 24 ? r.top - 22 : r.bottom + 4) + "px";
  };
  const onMove = (ev: MouseEvent): void => {
    const e = target(ev.clientX, ev.clientY);
    if (!e) { current = null; box.style.display = "none"; tag.style.display = "none"; return; }
    if (e !== current) { current = e; show(e); }
  };
  const onClick = (ev: MouseEvent): void => {
    ev.preventDefault(); ev.stopPropagation();
    const e = target(ev.clientX, ev.clientY) || current;
    if (!e) return;
    const r = e.getBoundingClientRect();
    const s = stable(e, document);
    w.__prismFacetPick = {
      selector: s ? s.selector : null, unique: !!(s && s.unique), tag: e.tagName.toLowerCase(),
      rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height },
      client: { x: r.left, y: r.top, w: r.width, h: r.height },
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    stop();
  };
  const swallow = (ev: Event): void => { ev.preventDefault(); ev.stopPropagation(); };
  const onKey = (ev: KeyboardEvent): void => { if (ev.key === "Escape") { swallow(ev); stop(); } };
  function stop(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", swallow, true);
    document.removeEventListener("mouseup", swallow, true);
    document.removeEventListener("pointerdown", swallow, true);
    document.removeEventListener("keydown", onKey, true);
    box.remove(); tag.remove();
    w.__prismFacetPicking = false;
    w.__prismFacetPickStop = undefined;
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("pointerdown", swallow, true);
  document.addEventListener("keydown", onKey, true);
  w.__prismFacetPickStop = stop;
}

/** The picker as injectable JS (source-embedded so the selector logic is the tested one). */
export function facetPickerJs(): string {
  return `(function(){var stable=${stableSelector.toString()};(${facetPickerMain.toString()})(stable);})()`;
}

/** Poll expression: the pick as JSON, or "null" while the human is still choosing. */
export const FACET_PICK_POLL_JS = "JSON.stringify(window.__prismFacetPick||null)";
/** Cancel expression. */
export const FACET_PICK_STOP_JS = "(function(){if(window.__prismFacetPickStop)window.__prismFacetPickStop();window.__prismFacetPick=null;return true;})()";
/** Verify a selector resolves to exactly one element; evaluates to the element's document rect or null. */
export function selectorRectJs(selector: string): string {
  return `(function(s){try{var l=document.querySelectorAll(s);if(l.length!==1)return JSON.stringify({count:l.length});var r=l[0].getBoundingClientRect();return JSON.stringify({count:1,rect:{x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:r.height}});}catch(e){return JSON.stringify({count:0,error:String(e)});}})(${JSON.stringify(selector)})`;
}
