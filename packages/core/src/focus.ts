/**
 * Region focus (spec §17): a tile displays a region of a page rather than
 * the whole page. The element is framed by a scroll+scale transform on the
 * document root (GPU compositing) — the rest of the DOM is untouched, so
 * pages behave normally underneath.
 *
 * The framing script reports success/failure through the shell's per-tile
 * `PrismTile` host object as a focus-result event. Refresh continuity (§16
 * composition) is handled by the caller: framing runs in the hidden buffer
 * before the crossfade, and a missing selector fails the load (snapshot
 * stays, quiet retry).
 */

import type { FocusRegion, FocusSpec } from "./types.js";

/** A usable page rectangle: finite, non-negative origin, positive size. */
export function validRegion(r: unknown): r is FocusRegion {
  if (!r || typeof r !== "object") return false;
  const { x, y, w, h } = r as Record<string, unknown>;
  return [x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (x as number) >= 0 && (y as number) >= 0 && (w as number) > 0 && (h as number) > 0;
}

/** Undo a framing transform (tile switched to an unfocused dashboard, §9). */
export const CLEAR_FRAMING_JS = `
(function () {
  var root = document.documentElement;
  root.style.transform = "";
  root.style.transformOrigin = "";
  root.style.overflow = "";
  try { if (window.__prismFocusRO) { window.__prismFocusRO.disconnect(); window.__prismFocusRO = null; } } catch (e) {}
  try { if (window.__prismFocusRefit) { window.removeEventListener("resize", window.__prismFocusRefit); window.__prismFocusRefit = null; } } catch (e) {}
})();
`.trim();

export function focusFramingJs(focus: FocusSpec): string {
  const region = focus.region && validRegion(focus.region)
    ? { x: focus.region.x, y: focus.region.y, w: focus.region.w, h: focus.region.h }
    : null;
  const selector = JSON.stringify(region ? null : focus.selector ?? null);
  const pad = Number.isFinite(focus.pad) ? Number(focus.pad) : 0;
  const fit = JSON.stringify(focus.fit ?? (region ? "contain" : "width"));
  return `
(function () {
  var tile = typeof PrismTile !== "undefined" ? PrismTile : null;
  var report = function (found) { try { tile && tile.notifyFocusResult(found); } catch (e) {} };
  var region = ${JSON.stringify(region)};
  var selector = ${selector};
  var el = region || !selector ? null : document.querySelector(selector);
  if (!region && !el) { report(false); return; }
  var pad = ${pad};
  var fit = ${fit};
  var root = document.documentElement;
  function frame() {
    // Measure untransformed: clear, measure, re-apply (rects are post-transform otherwise).
    var prev = root.style.transform; root.style.transform = "";
    // Shell page zoom below 1 (Windows host): the layout viewport is wider
    // than the view and <body> is scaled by z to fit, so html-space px =
    // layout px × z; the view shows innerWidth × z html px. Absent ⇒ 1.
    var z = parseFloat(root.getAttribute("data-prism-zoom")) || 1;
    var x, y, w, h;
    if (region) {
      // a page rectangle in layout CSS px, no measuring needed
      x = region.x * z - pad; y = region.y * z - pad; w = region.w * z + 2 * pad; h = region.h * z + 2 * pad;
    } else {
      var r = el.getBoundingClientRect();          // already html-space
      x = r.left + window.scrollX - pad;
      y = r.top + window.scrollY - pad;
      w = r.width + 2 * pad;
      h = r.height + 2 * pad;
    }
    if (w <= 0 || h <= 0) { root.style.transform = prev; return false; }
    var vw = window.innerWidth * z, vh = window.innerHeight * z;
    var scale = fit === "height" ? vh / h
              : fit === "contain" ? Math.min(vw / w, vh / h)
              : vw / w;
    root.style.transformOrigin = "0 0";
    root.style.transform = "scale(" + scale + ") translate(" + (-x) + "px, " + (-y) + "px)";
    root.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return true;
  }
  if (!frame()) { report(false); return; }
  // Pages reflow after first paint (fonts, late content, dialogs growing):
  // keep the frame fitted as the element or the viewport changes.
  try {
    if (window.__prismFocusRO) window.__prismFocusRO.disconnect();
    if (window.__prismFocusRefit) window.removeEventListener("resize", window.__prismFocusRefit);
    var pending = null;
    var refit = function () { if (pending) return; pending = setTimeout(function () { pending = null; frame(); }, 120); };
    window.__prismFocusRO = new ResizeObserver(refit);
    if (el) window.__prismFocusRO.observe(el);
    window.__prismFocusRO.observe(document.body);
    window.__prismFocusRefit = refit;          // kept so CLEAR can remove it (a leaked refit re-applies a stale framing on every resize)
    window.addEventListener("resize", refit);
  } catch (e) {}
  report(true);
})();
`.trim();
}
