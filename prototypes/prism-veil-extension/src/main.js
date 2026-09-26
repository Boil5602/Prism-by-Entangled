/*
  Prism Veil - entry. Wires observers, timers, the human overrides (Escape,
  hold-to-reveal) and starts the sweep. Loaded last.
*/
(function () {
  "use strict";
  if (window.__prismVeil) return;
  window.__prismVeil = true;
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  PV.VERSION = (function () { try { return chrome.runtime.getManifest().version; } catch (e) { return ""; } })();

  // ---- art
  var BUNDLED = (PV.ART_FILES || []).map(function (p) { return chrome.runtime.getURL(p); });
  var HOSTED = [];   // pv:art - 24 verified photos from the person's server, if they asked for them
  PV.pickArt = function () { var src = HOSTED.length ? HOSTED : BUNDLED; return src[Math.floor(Math.random() * src.length)] || ""; };
  PV.pickBundledArt = function () { return BUNDLED[Math.floor(Math.random() * BUNDLED.length)] || ""; };
  PV.artInfo = function () { return { hosted: HOSTED.length, at: PV.__artAt || 0 }; };
  // Put a photo on an element as its background. A hosted photo can be
  // refused by a strict page CSP (img-src): probe it, and fall back to a
  // bundled (extension-scheme) photo for that element if it will not load.
  PV.artOnto = function (el, url) {
    el.style.backgroundImage = "url('" + url + "')";
    if (!/^https?:/i.test(url)) return;
    try {
      var im = new Image();
      im.onerror = function () { if (el.style.backgroundImage.indexOf(url) >= 0) { var b = PV.pickBundledArt(); el.style.backgroundImage = "url('" + b + "')"; el.__artUrl = b; } };
      im.src = url;
    } catch (e) {}
  };
  function loadHostedArt(rec) { HOSTED = (rec && rec.urls && rec.urls.length) ? rec.urls.slice() : []; PV.__artAt = (rec && rec.at) || 0; if (PV.onArtChange) PV.onArtChange(); }
  try {
    chrome.storage.local.get("pv:art", function (r) { loadHostedArt(r && r["pv:art"]); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:art"]) loadHostedArt(ch["pv:art"].newValue); });
  } catch (e) {}

  // ---- human override: Escape rips down every cover and unmutes, and holds
  // off for a while, so a viewer can ALWAYS get straight back to their show.
  var suppressUntil = 0;
  PV.suppressed = function () { return Date.now() < suppressUntil; };
  function dismissAll(ms) {
    suppressUntil = Date.now() + (ms || 6000);
    PV.clearCovers();
    // A timed reveal re-veils the video when its time is up (the restore chip
    // brings it back sooner).
    if (PV.dismissVideo) PV.dismissVideo(ms || 6000); else PV.uncoverVideo();
  }
  addEventListener("keydown", function (e) { if (e.key === "Escape") dismissAll(6000); }, true);
  PV.dismissAll = dismissAll;
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "prism-popup-reveal") dismissAll(Math.min(60000, +msg.ms || 15000));
    });
  } catch (e) {}

  // Press-and-hold on any veil for 3s reveals what's behind for 15s.
  var holdTimer = 0, holdHint = null;
  function overVeil(x, y) {
    var n = document.elementFromPoint(x, y);
    // Prism UI (Report chip, pick catcher, toasts, pill) is data-prism-ui, never
    // a veil: pressing it must not start the hold-to-reveal countdown.
    while (n) {
      if (n.hasAttribute && n.hasAttribute("data-prism-ui")) return false;
      if (n.hasAttribute && n.hasAttribute("data-prism-veil")) return true;
      n = n.parentElement;
    }
    return false;
  }
  function clearHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; } if (holdHint) { holdHint.remove(); holdHint = null; } }
  addEventListener("mousedown", function (e) {
    if (!overVeil(e.clientX, e.clientY)) return;
    clearHold();
    holdHint = document.createElement("div");
    holdHint.style.cssText = "position:fixed;left:" + Math.round(e.clientX + 14) + "px;top:" + Math.round(e.clientY + 14) + "px;z-index:2147483647;pointer-events:none;font:600 12px system-ui;color:#fff;background:rgba(10,12,15,.85);padding:5px 9px;border-radius:7px";
    holdHint.textContent = "Hold to reveal…";
    document.documentElement.appendChild(holdHint);
    holdTimer = setTimeout(function () { clearHold(); dismissAll(15000); }, 3000);
  }, true);
  ["mouseup", "mouseleave", "dragstart", "blur"].forEach(function (t) { addEventListener(t, clearHold, true); });
  addEventListener("mousemove", function (e) { if (holdTimer && !overVeil(e.clientX, e.clientY)) clearHold(); }, true);

  // ---- observers
  var mo = new MutationObserver(function () {
    if (mo.__t) return;
    mo.__t = setTimeout(function () { mo.__t = null; PV.sweep(); }, 400);
  });
  PV.observeRoot = function (root) { mo.observe(root, { childList: true, subtree: true }); };

  // A video that starts playing may be a freshly mounted ad (Reels, Reddit
  // autoplay): sweep at once rather than after the mutation debounce.
  var playT = 0;
  ["play", "playing", "loadeddata"].forEach(function (ev) {
    addEventListener(ev, function (e) {
      if (!e.target || e.target.tagName !== "VIDEO" || playT) return;
      playT = setTimeout(function () { playT = 0; PV.sweep(); }, 30);
    }, true);
  });
  // Uncover the MOMENT the SDK ad flag flips - event-driven, so the show
  // returns even in a throttled background tab.
  new MutationObserver(function () {
    if (!PV.suppressed()) PV.videoAdBreak();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-prism-ad"] });
  // SSAI ads have no flag: react to the player's ad class appearing at once.
  var fastAdT = 0;
  new MutationObserver(function () {
    if (fastAdT) return;
    fastAdT = setTimeout(function () { fastAdT = 0; }, 60);
    if (!PV.suppressed()) PV.videoAdBreak();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  // A background tab's timers are throttled to ~once a minute and its rAF is
  // paused, so a break that ends while the player window is unfocused may not
  // be re-evaluated - the veil stays up until something wakes it. Re-evaluate
  // the instant the tab becomes visible (and on window focus), so refocusing
  // lifts a break that already ended.
  function wake() { if (!document.hidden && !PV.suppressed()) { PV.videoAdBreak(); PV.sweep(); } }
  document.addEventListener("visibilitychange", wake);
  addEventListener("focus", wake, true);
  addEventListener("pageshow", wake);

  // MSN's infopane is an article SLIDER that rotates its ONE card (between a
  // news story and a native ad) by REUSING the element and swapping its content
  // inside a shadow root - no node is added, so neither a light-DOM observer nor
  // a childList observer on the infopane shadow catches it, and the ad flashed
  // for ~1s until the next poll. Instead: cache the infopane element(s), then
  // poll its current card's id cheaply; the instant it changes (a rotation),
  // sweep at once. Gated to MSN so it costs nothing elsewhere.
  var infopanes = [], lastCardId = new WeakMap(), infopaneWired = new WeakSet();
  function onMsn() { return /(^|\.)msn\.com$/i.test(location.hostname); }
  // The infopane (a Microsoft FAST component) fires its OWN "infopane-change"
  // event the instant it rotates a slide - the earliest possible signal, well
  // before the ad fades in. It's not composed, and dispatches inside the shadow,
  // so listen on both the host and its shadow root. Sweep in a short burst so we
  // catch the ad whether its DOM is set on the event or a frame later.
  function wireInfopane(p) {
    if (infopaneWired.has(p)) return;
    infopaneWired.add(p);
    var onChange = function () {
      if (PV.suppressed()) return;
      PV.sweep();
      setTimeout(function () { if (!PV.suppressed()) PV.sweep(); }, 30);
      setTimeout(function () { if (!PV.suppressed()) PV.sweep(); }, 90);
    };
    try { p.addEventListener("infopane-change", onChange, true); } catch (e) {}
    try { if (p.shadowRoot) p.shadowRoot.addEventListener("infopane-change", onChange, true); } catch (e) {}
  }
  function findInfopanes() {
    if (!onMsn()) return;
    var found = [], stack = [document], budget = 6000;
    while (stack.length && budget > 0) {
      var root = stack.pop(), els;
      try { els = root.querySelectorAll("*"); } catch (e) { continue; }
      for (var i = 0; i < els.length && budget > 0; i++) {
        budget--;
        var sr = els[i].shadowRoot; if (!sr) continue;
        if (els[i].tagName === "CS-RESPONSIVE-INFOPANE") { found.push(els[i]); wireInfopane(els[i]); }
        stack.push(sr);
      }
    }
    infopanes = found;
  }
  function pollInfopanes() {
    if (!infopanes.length || PV.suppressed()) return;
    var changed = false;
    for (var i = 0; i < infopanes.length; i++) {
      var p = infopanes[i], sr = p.shadowRoot; if (!sr) continue;
      var card; try { card = sr.querySelector("cs-responsive-card"); } catch (e) { continue; }
      // id + a slice of data-t: catches a swap even if the id were ever reused.
      var id = card ? (card.id + "|" + (card.getAttribute("data-t") || "").slice(0, 24)) : "";
      if (lastCardId.get(p) !== id) { lastCardId.set(p, id); changed = true; }
    }
    if (changed) PV.sweep();
  }

  function start() {
    if (PV.__started) return; PV.__started = true;
    PV.observeRoot(document.documentElement);
    PV.mountReportChip();
    if (PV.ensurePill) PV.ensurePill();
    PV.sweep();
    setInterval(function () { PV.sweep(); if (PV.ensurePill) PV.ensurePill(); }, 1200);
    findInfopanes();
    setInterval(findInfopanes, 2000);   // (re)cache infopanes as they load
    setInterval(pollInfopanes, 60);      // catch a slide swap within ~60ms
    // Ads lazy-load as you scroll; a slot merely scrolled into view may fill
    // without a mutation we see - re-sweep on scroll/resize (throttled).
    var scrollT = 0;
    var onMove = function () {
      if (scrollT) return;
      scrollT = setTimeout(function () { scrollT = 0; PV.sweep(); }, 200);
    };
    addEventListener("scroll", onMove, { passive: true, capture: true });
    addEventListener("resize", onMove, { passive: true });
    // The video veil runs on its own faster cadence: covered promptly, and
    // the show comes BACK the instant the break ends.
    // Both loops survive an exception: a throw inside videoTick ended the rAF
    // chain for good and the HUD froze at its first value, refreshing only on
    // focus changes (YouTube embed in Firefox, 2026-08-29). Log once, go on.
    var tickErr = 0, evalErr = 0;
    setInterval(function () { try { if (!PV.suppressed()) PV.videoAdBreak(); } catch (e) { if (!evalErr++ && PV.recordError) PV.recordError("videoAdBreak threw: " + (e && e.message || e)); } }, 350);
    (function tick() {
      try { PV.videoTick(); } catch (e) { if (!tickErr++ && PV.recordError) PV.recordError("videoTick threw: " + (e && (e.stack || e.message) || e).toString().slice(0, 200)); }
      requestAnimationFrame(tick);
    })();
    // rAF is not serviced in a cross-origin EMBED frame until a focus change
    // (Firefox, Google's YouTube embed: the HUD sat at "0:30 left" until the
    // window lost and regained focus, 2026-08-29). A plain timer drives the
    // card and cover as well; rAF just makes it smoother where it runs.
    setInterval(function () { try { PV.videoTick(); } catch (e) {} }, 200);
  }
  // Runs at document_start (no <body> yet). Start the moment <body> appears -
  // long before DOMContentLoaded on a slow page - so ads in the first paint
  // are covered on the first sweep rather than after the page settles.
  if (document.body) start();
  else {
    var bodyWatch = new MutationObserver(function () { if (document.body) { bodyWatch.disconnect(); start(); } });
    bodyWatch.observe(document.documentElement, { childList: true });
    addEventListener("DOMContentLoaded", function () { if (document.body) { bodyWatch.disconnect(); if (!PV.__started) start(); } }, { once: true });
  }
})();
