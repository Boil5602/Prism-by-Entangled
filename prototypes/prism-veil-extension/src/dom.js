/*
  Prism Veil - DOM helpers shared by every module. Loaded first (after art.js).

  All modules run as classic content scripts in the same isolated world and
  talk through one namespace, PV (window.__prismVeilNS). Each file exports the
  functions it owns onto PV; cross-module calls go through PV.<name> at call
  time, so load order only matters for top-level execution (main.js, last).
*/
(function () {
  // Diagnostics: content-script exceptions are invisible to the page console.
  // Record them on <html data-prism-errors> so they can be read from any tab
  // (Report ad includes them too). No page data, no network - local only.
  try {
    var _errs = [];
    var _relayT = 0;
    var _relay = function () {   // an embed FRAME's ring is invisible to the top page's report: relay it to bg (throttled)
      if (window === window.top || _relayT) return;
      _relayT = setTimeout(function () {
        _relayT = 0;
        try { chrome.runtime.sendMessage({ type: "prism-frame-trace", href: location.href.slice(0, 120), errs: _errs.slice() }); } catch (e) {}
        // and straight to the parent page as well (no background involved)
        try { window.parent.postMessage({ __prismFrameTrace: 1, href: location.href.slice(0, 120), errs: _errs.slice() }, "*"); } catch (e) {}
      }, 800);
    };
    var _rec = function (msg) { try { _errs.push(String(msg).slice(0, 300)); if (_errs.length > 12) _errs.shift(); document.documentElement.setAttribute("data-prism-errors", JSON.stringify(_errs)); _relay(); } catch (e) {} };
    addEventListener("error", function (e) { if (e && e.filename && /chrome-extension:|moz-extension:/.test(e.filename)) _rec(e.filename.replace(/^.*\//, "") + ":" + e.lineno + " " + (e.message || e.error)); }, true);
    addEventListener("unhandledrejection", function (e) { var r = e && e.reason; if (r && (r.stack || "").match(/chrome-extension:|moz-extension:/)) _rec("promise: " + (r.message || r)); }, true);
    window.__prismVeilNS = window.__prismVeilNS || {}; window.__prismVeilNS.recordError = _rec;
    // An embed frame announces itself to the parent the moment it loads, so a
    // top-page report can say whether Prism is present in each iframe at all
    // (Firefox + Google's YouTube embed: no frame trace by any route, 2026-08-29).
    if (window !== window.top) { try { window.parent.postMessage({ __prismFrameHello: 1, href: location.href.slice(0, 120) }, "*"); } catch (e) {} }
    // top page: keep embed frames' rings (diagnostic text only; shape-checked)
    if (window === window.top) {
      window.__prismVeilNS.frameTraces = {};
      window.__prismVeilNS.frameHello = [];
      addEventListener("message", function (ev) {
        try { var h = ev.data; if (h && h.__prismFrameHello === 1) window.__prismVeilNS.frameHello.push(String(ev.origin) + " " + String(h.href || "").slice(0, 80)); } catch (e) {}
      });
      addEventListener("message", function (ev) {
        try {
          var m = ev.data; if (!m || m.__prismFrameTrace !== 1 || !Array.isArray(m.errs)) return;
          window.__prismVeilNS.frameTraces[String(ev.origin) + " " + String(m.href || "").slice(0, 80)] = { at: Date.now(), href: String(m.href || "").slice(0, 120), errs: m.errs.slice(0, 12).map(function (x) { return String(x).slice(0, 300); }) };
        } catch (e) {}
      });
    }
  } catch (e) {}

  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});

  /** An element that is rendered and at least ad-sized (40x30). */
  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) return false;
    var cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  /** Rendered, non-transparent, and at least partly inside the viewport vertically. */
  function elVisible(e) {
    var cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1) return false;
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  /** parentElement that crosses a shadow boundary (jumps to the host). */
  function parentAcross(el) {
    if (el.parentElement) return el.parentElement;
    var root = el.getRootNode && el.getRootNode();
    return (root && root.host) ? root.host : null;
  }
  /** parentNode that crosses a shadow boundary (ShadowRoot fragment -> host). */
  function deepParent(n) {
    var pn = n.parentNode;
    if (!pn) return null;
    if (pn.nodeType === 11 && pn.host) return pn.host;
    return pn;
  }
  /** contains() that crosses shadow boundaries. */
  function deepContains(a, b) {
    var n = deepParent(b);
    while (n) { if (n === a) return true; n = deepParent(n); }
    return false;
  }

  /**
   * The document plus every reachable OPEN shadow root, so ads rendered inside
   * web components (MSN's feed) are scanned too - querySelectorAll never
   * crosses shadow boundaries. Bounded so it can't run away. Newly found roots
   * are handed to main.js to observe (a MutationObserver on the light DOM is
   * blind to mutations inside shadow roots).
   */
  var observedRoots = (typeof WeakSet !== "undefined") ? new WeakSet() : null;
  function collectRoots() {
    // Walk every open shadow root (BFS). The cap is a runaway backstop, not a
    // budget: MSN puts a shadow root on every feed card, so a long scrolled
    // channel feed easily passes 900 - and an ad beyond the cap never gets a
    // detection pass. The per-root work is bounded by the page's element count
    // (querySelectorAll("*") returns only that root's own elements), so a higher
    // cap costs more only on pages that genuinely have that many roots - the
    // long feeds where the coverage is needed.
    var roots = [document], i = 0;
    while (i < roots.length && roots.length < 6000) {
      var els;
      try { els = roots[i++].querySelectorAll("*"); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) {
        var sr = els[j].shadowRoot;
        if (!sr) continue;
        roots.push(sr);
        if (observedRoots && !observedRoots.has(sr)) {
          observedRoots.add(sr);
          if (PV.observeRoot) { try { PV.observeRoot(sr); } catch (e) {} }
        }
      }
    }
    return roots;
  }

  /** elementFromPoint that descends through OPEN shadow roots. */
  function deepElementFromPoint(x, y) {
    var el = document.elementFromPoint(x, y), guard = 0;
    if (!el) return null;
    while (el.shadowRoot && guard++ < 24) {
      var inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** Own text of an element (its first text node), trimmed - "" if none. */
  function ownText(e) {
    return (e.firstChild && e.firstChild.nodeType === 3) ? (e.textContent || "").trim() : "";
  }
  function classStr(e) {
    return (e && e.className && e.className.toString) ? e.className.toString() : "";
  }
  /** Largest <video> on the page - the main player, not a preview clip. */
  function mainVideo() {
    var vs = document.querySelectorAll("video"), best = null, bestA = 0;
    for (var i = 0; i < vs.length; i++) {
      var r = vs[i].getBoundingClientRect(), a = r.width * r.height;
      if (a > bestA) { bestA = a; best = vs[i]; }
    }
    return best;
  }

  PV.isVisible = isVisible;
  PV.elVisible = elVisible;
  PV.parentAcross = parentAcross;
  PV.deepParent = deepParent;
  PV.deepContains = deepContains;
  PV.collectRoots = collectRoots;
  PV.deepElementFromPoint = deepElementFromPoint;
  PV.ownText = ownText;
  PV.classStr = classStr;
  PV.mainVideo = mainVideo;

  // Keep a Prism UI element (the pill, the Report chip) a top-most child of
  // <html>, above the page's own content AND any ad that appends itself late -
  // some floating video ads sit at the maximum z-index (2147483647), and at
  // equal z-index the LATER DOM sibling wins. Re-asserted on every <html>
  // mutation (synchronously, before the next input event) and on a slow timer.
  // A Prism element only jumps ahead of NON-Prism nodes, so our own UI elements
  // and covers never shuffle each other into a loop.
  // PV.releaseOnTop(el) stops the watcher so the element can actually be
  // removed (the Report chip toggle); without it, fix() would re-append it.
  PV.keepOnTop = function (el) {
    if (!el) return;
    try { el.setAttribute("data-prism-ui", "1"); } catch (e) {}
    var root = document.documentElement, keep = { mo: null, timer: 0, released: false };
    el.__prismKeep = keep;
    function fix() {
      if (keep.released) return;
      if (!el.isConnected) { try { root.appendChild(el); } catch (e) {} return; }
      var n = el.nextElementSibling, need = false;
      while (n) { if (!(n.hasAttribute && (n.hasAttribute("data-prism-ui") || n.hasAttribute("data-prism-veil")))) { need = true; break; } n = n.nextElementSibling; }
      if (need) { try { root.appendChild(el); } catch (e) {} }
    }
    fix();
    try { keep.mo = new MutationObserver(fix); keep.mo.observe(root, { childList: true }); } catch (e) {}
    keep.timer = setInterval(fix, 2000);
  };
  PV.releaseOnTop = function (el) {
    var keep = el && el.__prismKeep; if (!keep) return;
    keep.released = true;
    try { if (keep.mo) keep.mo.disconnect(); } catch (e) {}
    if (keep.timer) clearInterval(keep.timer);
    el.__prismKeep = null;
  };
})();
