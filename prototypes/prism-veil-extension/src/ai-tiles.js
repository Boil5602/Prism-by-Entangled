/*
  Prism - AI-labelled video TILES on YouTube (opt-in, pv:ui.aiVeil; spec
  section 5: the platform's own disclosure is the only source).

  A tile (home, search, sidebar, Shorts shelf) shows no AI label even when the
  video carries one - the disclosure lives in the watch page's "How this was
  made" section. YouTube's own `next` endpoint returns that section for a
  video id, so a tile can be judged BEFORE the click: the same fact, fetched
  a little earlier. Observed 2026-08-29: howThisWasMadeSectionViewModel present
  for labelled videos, absent otherwise; ~300-500 KB, ~0.7 s per lookup.

  Rules of the road:
    - only while the switch is on, only on youtube.com, only for tiles on or
      near the screen; one lookup at a time with a gap; anonymous
      (credentials omitted); the request carries the video id and nothing else
    - every answer is cached locally (pv:ai:yt, capped), so a video is looked
      up once, ever; a watch page that shows the label also fills the cache
    - a labelled tile is marked data-prism-ai="1"; rules.js covers it like an
      ad (art over it, link not clickable); nothing is removed or reordered
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  if (!/(^|\.)youtube\.com$/i.test(location.hostname)) return;
  if (window !== window.top) return;   // page-level feature: top frame only (the veil runs in player embeds too)

  var TILE = "ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model, ytd-rich-grid-media";
  var CACHE_KEY = "pv:ai:yt3",   /* v2: verdicts from the loose whole-response scan (pv:ai:yt) are discarded; v3 (2026-09-12): the watch page had been caching a STALE previous video's section under the new video's id (pv:ai:yt2) */ CAP = 4000, GAP_MS = 120, NEAR = 2.5, PARALLEL = 3;   // NEAR: screens of look-ahead; PARALLEL: lookups in flight
  var on = false, cache = null, dirty = false, saveTimer = 0, queue = [], busy = 0, timer = 0, mo = null, apiKey = "", ver = "";
  var inflight = {};

  // ---- cache
  function load(cb) {
    if (cache) return cb();
    try { chrome.storage.local.get(CACHE_KEY, function (r) { cache = (r && r[CACHE_KEY]) || {}; cb(); }); }
    catch (e) { cache = {}; cb(); }
  }
  function remember(id, val) {
    if (!cache) cache = {};
    if (cache[id] === val) return;
    cache[id] = val; dirty = true;
    var keys = Object.keys(cache);
    if (keys.length > CAP) for (var i = 0; i < keys.length - CAP; i++) delete cache[keys[i]];
    if (!saveTimer) saveTimer = setTimeout(function () {
      saveTimer = 0; if (!dirty) return; dirty = false;
      try { var o = {}; o[CACHE_KEY] = cache; chrome.storage.local.set(o); } catch (e) {}
    }, 1500);
  }
  PV.aiRemember = function (id, val) { remember(id, val ? 1 : 0); };

  // ---- ids
  function idOf(href) {
    var m = /[?&]v=([\w-]{11})/.exec(href) || /\/shorts\/([\w-]{11})/.exec(href) || /\/live\/([\w-]{11})/.exec(href);
    return m ? m[1] : "";
  }
  function tileId(t) {
    var a = t.querySelector("a[href*='/watch?v='], a[href*='/shorts/'], a[href*='/live/']");
    return a ? idOf(a.getAttribute("href") || "") : "";
  }
  function near(t) {
    var r = t.getBoundingClientRect();
    return r.width > 40 && r.height > 40 && r.bottom > -innerHeight * NEAR && r.top < innerHeight * (1 + NEAR);
  }
  var sweepT = 0;
  function mark(t, val) {
    var was = t.getAttribute("data-prism-ai") === "1";
    if (val) t.setAttribute("data-prism-ai", "1"); else t.removeAttribute("data-prism-ai");
    // The cover sweep wakes on child-list mutations and a 1.2s timer, not on
    // attributes: kick it now so a judged tile is veiled within a frame or two.
    if (was !== !!val && PV.sweep && !sweepT) sweepT = setTimeout(function () { sweepT = 0; try { PV.sweep(); } catch (e) {} }, 20);
  }
  function dist(t) {   // px from the viewport (0 = on screen), for queue order
    var r = t.getBoundingClientRect();
    return r.bottom < 0 ? -r.bottom : (r.top > innerHeight ? r.top - innerHeight : 0);
  }

  // ---- lookup (YouTube's own next endpoint, anonymous)
  function pageKey() {
    if (apiKey) return apiKey;
    try {
      var html = "", ss = document.scripts;
      for (var i = 0; i < ss.length && !apiKey; i++) {
        html = ss[i].textContent || "";
        var m = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html); if (m) apiKey = m[1];
        var v = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html); if (v) ver = v[1];
      }
    } catch (e) {}
    return apiKey;
  }
  // Only the PRIMARY video's own "How this was made" section counts. The
  // next response also carries the related-videos rail, and a regex over the
  // whole text matched a related video's disclosure (search page, three
  // unrelated results veiled, 2026-08-29). Walk the engagement panels'
  // structured description; a plain-text scan is the fallback only when the
  // JSON has no panels at all.
  function disclosedInOwnDescription(txt) {
    var data; try { data = JSON.parse(txt); } catch (e) { return false; }
    var panels = (data && data.engagementPanels) || [];
    var sawPanels = false, hit = false;
    (function walk(node, depth) {
      if (!node || depth > 12 || hit) return;
      if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], depth + 1); return; }
      if (typeof node !== "object") return;
      if (node.structuredDescriptionContentRenderer) sawPanels = true;
      if (node.howThisWasMadeSectionViewModel) {
        var t = JSON.stringify(node.howThisWasMadeSectionViewModel);
        if (/made with ai|ai[- ]generated|altered or synthetic|altered or fully generated|synthetic/i.test(t)) hit = true;
        return;
      }
      for (var k in node) if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k], depth + 1);
    })(panels, 0);
    if (hit) return true;
    if (sawPanels) return false;
    return false;   // no description panel in the response: unknown, treat as not labelled
  }
  function lookup(id, done) {
    var key = pageKey(); if (!key) return done(null);
    fetch("https://www.youtube.com/youtubei/v1/next?key=" + encodeURIComponent(key) + "&prettyPrint=false", {
      method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: ver || "2.20250101.00.00", hl: "en" } }, videoId: id })
    }).then(function (r) { return r.ok ? r.text() : null; }).then(function (txt) {
      if (txt == null) return done(null);
      done(disclosedInOwnDescription(txt) ? 1 : 0);
    }).catch(function () { done(null); });
  }
  function pump() {
    while (busy < PARALLEL && on && queue.length) {
      // the tile nearest the viewport RIGHT NOW (the user may have scrolled since the scan)
      var bi = 0, bd = Infinity;
      for (var i = 0; i < queue.length; i++) { var dd = dist(queue[i]); if (dd < bd) { bd = dd; bi = i; } }
      var t = queue.splice(bi, 1)[0], id = t.__prismAiId;
      if (!id || !t.isConnected || !near(t)) continue;
      if (cache && cache[id] !== undefined) { mark(t, cache[id] === 1); continue; }
      if (inflight[id]) continue;
      busy++; inflight[id] = true;
      lookup(id, function (vid) { return function (val) {
        delete inflight[vid];
        if (val !== null) { remember(vid, val); applyAll(vid, val); }
        setTimeout(function () { busy--; pump(); }, GAP_MS);
      }; }(id));
    }
  }
  function applyAll(id, val) {
    document.querySelectorAll(TILE).forEach(function (t) { if (t.__prismAiId === id) mark(t, val === 1); });
  }
  // For the watch page (video.js): the cached verdict for a video id (1 / 0 /
  // undefined), and a one-off lookup that settles it. The DOM section on a
  // watch page can be the PREVIOUS video's (YouTube keeps the old watch DOM
  // through a navigation, 2026-09-12); this answer is per video id.
  PV.aiVerdict = function (id) { return (cache && id) ? cache[id] : undefined; };
  PV.aiLookup = function (id) {
    if (!on || !id || inflight[id] || (cache && cache[id] !== undefined)) return;
    inflight[id] = true;
    lookup(id, function (val) {
      delete inflight[id];
      if (val !== null) { remember(id, val); applyAll(id, val); }
      if (PV.videoAdBreak) { try { PV.videoAdBreak(); } catch (e) {} }   // re-evaluate the watch page now that the verdict is in
    });
  };

  // ---- scan
  function scan() {
    timer = 0;
    if (!on || !cache) return;
    var tiles = document.querySelectorAll(TILE);
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], id = tileId(t);
      if (!id) continue;
      if (t.__prismAiId !== id) { t.__prismAiId = id; t.removeAttribute("data-prism-ai"); }   // recycled tile
      if (cache[id] !== undefined) { mark(t, cache[id] === 1); continue; }
      if (near(t) && queue.indexOf(t) < 0) queue.push(t);
    }
    pump();
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 100); }
  function start() {
    load(function () {
      if (!mo) { mo = new MutationObserver(schedule); try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
      addEventListener("scroll", schedule, { passive: true });
      addEventListener("resize", schedule);
      scan();
    });
  }
  function stop() {
    queue = [];
    document.querySelectorAll("[data-prism-ai]").forEach(function (t) { t.removeAttribute("data-prism-ai"); });
  }
  function apply(prefs) {
    var next = !!(prefs && prefs.aiVeil);
    if (next === on) return;
    on = next;
    if (on) start(); else stop();
  }
  try {
    chrome.storage.local.get("pv:ui", function (r) { apply((r && r["pv:ui"]) || {}); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:ui"]) apply(ch["pv:ui"].newValue || {}); });
  } catch (e) {}
})();
