/**
 * Gallery veil (spec §27): display-ad slots become art.
 *
 * Network blocking (§5, shell-owned) stops ad/tracker requests, which is
 * the privacy win but leaves gap-toothed pages. The veil fills the slots:
 * element-hiding selectors from ATTRIBUTED filter lists (EasyList's
 * cosmetic rules — the same named-source transparency as §5) locate them,
 * and locally-served imagery sized to each slot replaces what was there.
 *
 * Modes (per tile):
 * - `block+art` (default when enabled): composes with blocking. Purely
 *   additive — trackers stay blocked, pages look composed.
 * - `veil-only`: for sites that hard-wall on blocking. Ads LOAD (requests
 *   fire, trackers run — stated in the toggle, never hidden) and the slots
 *   are visually replaced. This mode trades privacy for access.
 * - `off`.
 *
 * Safety model inherited from §26: read-only-plus-replace on matched
 * elements only; a selector that matches nothing does nothing; a slot with
 * no box is left alone (no reflow beyond what blocking already causes);
 * site redesigns degrade to ordinary blocking or ordinary ads, never to
 * broken pages. Imagery is never fetched from the web at render time.
 */

export type VeilMode = "block+art" | "veil-only" | "off";

/** §5-style attribution: every selector traces to a named, inspectable source. */
export interface CosmeticSourceAttribution {
  name: string;
  maintainer: string;
  url: string;
  license: string;
  /** ISO date of the last sync; shells keep this current. */
  syncedAt: string;
}

export interface CosmeticSourceSpec {
  attribution: CosmeticSourceAttribution;
  /** Raw list text in Adblock Plus syntax; only element-hiding rules are used. */
  text: string;
}

interface ParsedSource {
  attribution: CosmeticSourceAttribution;
  generic: Set<string>;
  byDomain: Map<string, Set<string>>;
  exceptGeneric: Set<string>;
  exceptByDomain: Map<string, Set<string>>;
  entryCount: number;
}

export interface CosmeticSourceInfo extends CosmeticSourceAttribution {
  /** Element-hiding entries parsed from the list (what the UI shows). */
  entryCount: number;
}

export interface SelectorSet {
  selectors: string[];
  /** Names of the sources that contributed — the veil's "whose judgment". */
  sources: string[];
}

/**
 * Parse the element-hiding subset of an ABP-syntax list:
 *   ##sel                 generic hide
 *   dom1,dom2##sel        domain-scoped hide (`~dom` entries exclude)
 *   dom#@#sel  /  #@#sel  exceptions
 * Network rules, extended (`#?#`), snippet (`#$#`), and comment lines are
 * ignored — the veil only ever locates slots; it never changes requests.
 */
export function parseCosmeticRules(text: string): Omit<ParsedSource, "attribution"> {
  const generic = new Set<string>();
  const byDomain = new Map<string, Set<string>>();
  const exceptGeneric = new Set<string>();
  const exceptByDomain = new Map<string, Set<string>>();
  let entryCount = 0;

  const add = (map: Map<string, Set<string>>, domain: string, selector: string) => {
    let set = map.get(domain);
    if (!set) map.set(domain, (set = new Set()));
    set.add(selector);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    let sep = "##";
    let idx = line.indexOf("#@#");
    let exception = false;
    if (idx >= 0) {
      sep = "#@#";
      exception = true;
    } else {
      idx = line.indexOf("##");
      if (idx < 0) continue; // network rule
      // `#?#` / `#$#` / `#%#` share the `#` prefix but not `##` — reject them.
      if (line[idx + 2] === "?" || line[idx + 2] === "$" || line[idx + 2] === "%") continue;
    }
    const selector = line.slice(idx + sep.length).trim();
    if (!selector || !isPlainSelector(selector)) continue;
    const domains = line
      .slice(0, idx)
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    entryCount += 1;
    if (domains.length === 0) {
      (exception ? exceptGeneric : generic).add(selector);
      continue;
    }
    for (const d of domains) {
      if (d.startsWith("~")) {
        // Negated domain on a generic rule: treat as a domain-scoped exception.
        add(exceptByDomain, d.slice(1), selector);
        if (!exception) generic.add(selector);
      } else {
        add(exception ? exceptByDomain : byDomain, d, selector);
      }
    }
  }
  return { generic, byDomain, exceptGeneric, exceptByDomain, entryCount };
}

/** Reject procedural/extended syntax that a plain querySelectorAll would choke on. */
function isPlainSelector(selector: string): boolean {
  return !/:-abp-|:has-text\(|:matches-css|:xpath\(|:style\(|:remove\(|:upward\(|:matches-path/.test(
    selector,
  );
}

function domainsOf(hostname: string): string[] {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join("."));
  if (parts.length === 1) out.push(parts[0]!);
  return out;
}

export class CosmeticRegistry {
  private sources = new Map<string, ParsedSource>();

  /** Register (or replace) a list; the name in its attribution is the key. */
  register(spec: CosmeticSourceSpec): void {
    this.sources.set(spec.attribution.name, {
      attribution: spec.attribution,
      ...parseCosmeticRules(spec.text),
    });
  }

  unregister(name: string): void {
    this.sources.delete(name);
  }

  /** Every source with its attribution — what the settings UI must display (§5). */
  list(): CosmeticSourceInfo[] {
    return [...this.sources.values()].map((s) => ({ ...s.attribution, entryCount: s.entryCount }));
  }

  /** Selectors applicable to a page hostname, with the sources that contributed. */
  selectorsFor(hostname: string): SelectorSet {
    const chain = domainsOf(hostname);
    const selectors = new Set<string>();
    const contributors: string[] = [];
    for (const src of this.sources.values()) {
      const candidates = new Set<string>(src.generic);
      for (const d of chain) for (const sel of src.byDomain.get(d) ?? []) candidates.add(sel);
      for (const sel of src.exceptGeneric) candidates.delete(sel);
      for (const d of chain) for (const sel of src.exceptByDomain.get(d) ?? []) candidates.delete(sel);
      if (candidates.size === 0) continue;
      contributors.push(src.attribution.name);
      for (const sel of candidates) selectors.add(sel);
    }
    return { selectors: [...selectors], sources: contributors };
  }
}

/* ====================================================================== */

export interface VeilOverlay {
  selector: string;
  /** `hide` = plain element-hide (preferred when the site's overlay is dismissible); `patch` = art over the element's rect. */
  mode: "hide" | "patch";
}

export interface VeilPageConfig {
  selectors: string[];
  /**
   * §27 partial veil: in-player overlay ads, element-scoped. Patches track
   * the element through resizes and fullscreen by read-only observation.
   * NEVER clicks a close button (§26 prohibition applies to veils identically).
   */
  overlays?: VeilOverlay[];
  /** Locally-served image URLs (shell-provided). Empty ⇒ textured fallback. */
  images: string[];
  /** Short-side threshold (px) above which a slot gets a full image rather than a texture. */
  largeSlotPx?: number;
  /** Slots smaller than this on either side are left alone (collapsed by blocking). */
  minSlotPx?: number;
}

/** Marker attribute on veiled elements — inspectable, removable, idempotent. */
export const VEIL_ATTR = "data-prism-veil";

/**
 * Page-side veil installer. Idempotent: re-injection (SPA navigation,
 * config change) updates the running instance. Observes DOM mutations and
 * applies to newly matched slots, throttled. Each selector runs inside its
 * own try/catch so one bad rule never disables the rest.
 */
export function veilJs(config: VeilPageConfig): string {
  const cfg = {
    selectors: config.selectors,
    overlays: config.overlays ?? [],
    images: config.images,
    largeSlotPx: config.largeSlotPx ?? 300,
    minSlotPx: config.minSlotPx ?? 24,
  };
  return VEIL_RUNTIME_JS.replace("__CFG__", JSON.stringify(cfg));
}

/** Remove every veil and stop observing (mode `off`, tile reconfigured). */
export const CLEAR_VEIL_JS = "window.__prismVeil && window.__prismVeil.clear()";

const VEIL_RUNTIME_JS = `
(function (cfg) {
  var ATTR = ${JSON.stringify(VEIL_ATTR)};
  if (window.__prismVeil) { window.__prismVeil.update(cfg); return; }
  var state = { cfg: cfg, count: 0, pending: false, observer: null };
  function pick(i) {
    if (!state.cfg.images.length) return null;
    return state.cfg.images[i % state.cfg.images.length];
  }
  function veilOne(el) {
    if (el.getAttribute(ATTR)) return;
    var r = el.getBoundingClientRect();
    if (r.width < state.cfg.minSlotPx || r.height < state.cfg.minSlotPx) return; // collapsed — leave it
    var cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    // Cage the cover's z-index INSIDE the slot: without a stacking context a
    // full-width background ad's cover (Twitch headliner) painted over the
    // content the page floats above it (the live carousel - reported
    // 2026-08-31). isolation changes nothing about the slot's own stacking
    // against siblings; it only contains ours.
    el.style.isolation = 'isolate';
    el.style.overflow = 'hidden';
    var idx = state.count++;
    var img = pick(idx);
    var large = Math.min(r.width, r.height) >= state.cfg.largeSlotPx;
    var v = document.createElement('div');
    v.setAttribute(ATTR + '-cover', '1');
    // pointer-events AUTO: a veiled slot must not stay a live ad link - the
    // cover absorbs the click (reported 2026-08-31: ad links clickable
    // through the art). Absorbing a click on art is not synthetic
    // interaction; nothing is ever clicked FOR the user. In-player overlay
    // patches below stay pass-through (player controls live under those).
    v.style.cssText = 'position:absolute;inset:0;z-index:2147483646;pointer-events:auto;cursor:default;' +
      'background-color:#0e0e10;background-size:' + (large ? 'cover' : '400%') + ';' +
      'background-position:' + ((idx * 37) % 100) + '% ' + ((idx * 53) % 100) + '%;' +
      (img ? 'background-image:url(' + JSON.stringify(img) + ');' :
        'background-image:radial-gradient(circle at ' + ((idx * 31) % 100) + '% ' + ((idx * 67) % 100) + '%,#2a2f3a,#0e0e10 70%);');
    var g = document.createElement('span');
    g.textContent = '\\u25D0';
    g.style.cssText = 'position:absolute;right:6px;bottom:4px;font:11px/1 system-ui,sans-serif;color:rgba(255,255,255,.45);';
    v.appendChild(g);
    ['click', 'auxclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup'].forEach(function (t) {
      v.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    });
    el.appendChild(v);
    el.setAttribute(ATTR, String(idx));
  }
  // §27 partial veil — element-scoped patches over in-player overlays.
  // Read-only observation (rects, resize, fullscreen). No element here is
  // ever clicked, dismissed, or removed: §26's prohibition reaches veils.
  var patches = []; // [{el, node}]
  function place(p) {
    var r = p.el.getBoundingClientRect();
    if (!document.documentElement.contains(p.el) || r.width < 2 || r.height < 2) { p.node.style.display = 'none'; return; }
    p.node.style.display = 'block';
    p.node.style.left = r.left + 'px'; p.node.style.top = r.top + 'px';
    p.node.style.width = r.width + 'px'; p.node.style.height = r.height + 'px';
  }
  function placeAll() { for (var i = patches.length - 1; i >= 0; i--) {
    if (!document.documentElement.contains(patches[i].el)) { try { patches[i].node.remove(); } catch (e) {} patches.splice(i, 1); continue; }
    place(patches[i]);
  } }
  function patchOne(el) {
    if (el.getAttribute(ATTR + '-overlay')) return;
    el.setAttribute(ATTR + '-overlay', 'patch');
    var idx = state.count++;
    var img = pick(idx);
    var node = document.createElement('div');
    node.setAttribute(ATTR + '-cover', '1');
    node.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;background-color:#0e0e10;background-size:cover;' +
      (img ? 'background-image:url(' + JSON.stringify(img) + ');' :
        'background-image:radial-gradient(circle at 30% 40%,#2a2f3a,#0e0e10 70%);');
    var g = document.createElement('span');
    g.textContent = '\u25D0';
    g.style.cssText = 'position:absolute;right:6px;bottom:4px;font:11px/1 system-ui,sans-serif;color:rgba(255,255,255,.45);';
    node.appendChild(g);
    document.body.appendChild(node);
    var p = { el: el, node: node };
    patches.push(p);
    place(p);
    try { new ResizeObserver(function () { place(p); }).observe(el); } catch (e) {}
  }
  function hideOne(el) {
    if (el.getAttribute(ATTR + '-overlay')) return;
    el.setAttribute(ATTR + '-overlay', 'hide');
    el.style.setProperty('display', 'none', 'important');
  }
  function apply() {
    state.pending = false;
    var sels = state.cfg.selectors;
    for (var i = 0; i < sels.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(sels[i]); } catch (e) { continue; } // bad rule: skip
      for (var j = 0; j < nodes.length; j++) { try { veilOne(nodes[j]); } catch (e) {} }
    }
    var ovs = state.cfg.overlays || [];
    for (var k = 0; k < ovs.length; k++) {
      var found;
      try { found = document.querySelectorAll(ovs[k].selector); } catch (e) { continue; }
      for (var m = 0; m < found.length; m++) { try { (ovs[k].mode === 'hide' ? hideOne : patchOne)(found[m]); } catch (e) {} }
    }
    placeAll();
  }
  function schedule() {
    if (state.pending) return;
    state.pending = true;
    setTimeout(apply, 250);
  }
  function clear() {
    var covers = document.querySelectorAll('[' + ATTR + '-cover]');
    for (var i = 0; i < covers.length; i++) { try { covers[i].parentNode.removeChild(covers[i]); } catch (e) {} }
    var els = document.querySelectorAll('[' + ATTR + ']');
    for (var k = 0; k < els.length; k++) els[k].removeAttribute(ATTR);
    var ovs = document.querySelectorAll('[' + ATTR + '-overlay]');
    for (var o = 0; o < ovs.length; o++) {
      if (ovs[o].getAttribute(ATTR + '-overlay') === 'hide') ovs[o].style.removeProperty('display');
      ovs[o].removeAttribute(ATTR + '-overlay');
    }
    patches = [];
    window.removeEventListener('resize', placeAll); window.removeEventListener('scroll', placeAll, true);
    document.removeEventListener('fullscreenchange', placeAll);
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    window.__prismVeil = null;
  }
  window.__prismVeil = {
    update: function (next) { state.cfg = next; schedule(); },
    clear: clear,
    count: function () { return document.querySelectorAll('[' + ATTR + ']').length; }
  };
  try {
    state.observer = new MutationObserver(schedule);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  window.addEventListener('resize', placeAll); window.addEventListener('scroll', placeAll, true);
  document.addEventListener('fullscreenchange', placeAll);
  apply();
})(__CFG__);
`.trim();
