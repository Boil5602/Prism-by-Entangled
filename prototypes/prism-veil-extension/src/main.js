/*
  PRISM Veil - entry. Wires observers, timers, the human overrides (Escape,
  hold-to-reveal) and starts the sweep. Loaded last.
*/
(function () {
  "use strict";
  if (window.__prismVeil) return;
  window.__prismVeil = true;
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  // ONE COPY A PAGE (B-614, 2026-11-27, a picture from aether.ist in Safari on an iPhone: three PRISM buttons on one page, each
  // working). Safari starts the scripts of an updated extension in the pages already open and leaves the old copy running with
  // its link to the extension intact, so the old copy never saw itself as orphaned (the tab had stayed open over the day's
  // updates). Each copy writes a mark of its own on the page's root as it starts (a random word made on this page, which says
  // nothing of the person). A copy that reads another mark there may have been replaced, and stands down: it takes down what it
  // put up, its button too, and idles (orphaned, below).
  // THE PAGE CANNOT SWITCH PRISM OFF WITH THIS. The page can write that attribute too, so the mark decides nothing: it is read
  // once, as this copy starts and before any script of the page has run, and only to learn that another copy is there. Then
  // this copy tells the background, and the background tells the copies in this one frame of this one tab, over the extension's
  // own messages, which no page can send or read. A copy stands down only on that message, from a copy that started after it.
  // (0.9.99 asked the extension's store for the mark it read from the page; a mark recorded for one page could have been put on
  // another page of the same site that was open at the same update. Found by the commit's security review; gone here.)
  var COPY = "", COPY_START = Date.now(), newerCopy = false;
  try { var rnd = new Uint32Array(2); crypto.getRandomValues(rnd); COPY = rnd[0].toString(36) + rnd[1].toString(36); } catch (eR) { COPY = Math.random().toString(36).slice(2, 12); }
  try {
    var prevCopy = document.documentElement.getAttribute("data-prism-copy");
    document.documentElement.setAttribute("data-prism-copy", COPY);
    if (prevCopy && prevCopy !== COPY) chrome.runtime.sendMessage({ type: "pv:copy-hello", copy: COPY, start: COPY_START }, function () { void chrome.runtime.lastError; });
  } catch (eC) {}
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender) {
      // from the extension itself (the background has no tab), about another copy, started after this one
      if (msg && msg.type === "pv:copy-newer" && sender && !sender.tab && typeof msg.copy === "string" && msg.copy !== COPY && typeof msg.at === "number" && msg.at >= COPY_START) newerCopy = true;
    });
  } catch (eL) {}
  function replaced() { return newerCopy; }
  PV.VERSION = (function () { try { return chrome.runtime.getManifest().version; } catch (e) { return ""; } })();
  // On a page of the developer's own (127.0.0.1 or localhost, the hosts the prism-dev-reload hook answers), the version in view: after
  // a reload asked for from there, the page says which build is running (2026-11-07). Never on any other site.
  try { if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) chrome.storage.local.get("pv:dev", function (r) { if (r && r["pv:dev"]) document.documentElement.setAttribute("data-prism-version", PV.VERSION); }); } catch (e) {}

  // ---- art
  var BUNDLED = (PV.ART_FILES || []).map(function (p) { return chrome.runtime.getURL(p); });
  var HOSTED = [];   // pv:art - 24 verified photos from the person's server, if they asked for them
  // A page whose content security policy refuses the hosted photos gets bundled ones, and no request for a hosted one is made
  // from it (decision 2026-11-22, spec section 30; measured that day on Facebook in Safari on an iPhone: every cover cost one
  // refused request and changed its picture about 36 ms after it was up). Known BEFORE the first request three ways: a site
  // measured to refuse (ART_REFUSERS), the page's own policy where a script can read it (a meta tag; a header cannot be read), and
  // what this device remembers of the site (pv:artRefused, host -> until when; kept on the device, sent nowhere). Learned when a
  // request is refused all the same: the browser's own securitypolicyviolation event (remembered 30 days) or, without one, the
  // photo failing to load while the device is online and no hosted photo has loaded on the page (remembered one day, since that
  // can also be the server).
  var ART_REFUSERS = /(^|\.)facebook\.com$/i;
  var artRefused = false, hostedGood = false, metaDone = false;
  try { artRefused = ART_REFUSERS.test(location.hostname); } catch (e) {}
  // Does this policy text refuse a picture from this address? img-src, else default-src; no such directive refuses nothing.
  PV.cspRefuses = function (policy, url) {
    try {
      var u = new URL(url), src = null, def = null;
      String(policy || "").split(";").forEach(function (d) {
        var w = d.trim().split(/\s+/), n = (w.shift() || "").toLowerCase();
        if (n === "img-src" && !src) src = w; else if (n === "default-src" && !def) def = w;
      });
      src = src || def; if (!src) return false;
      return !src.some(function (x) {
        x = x.toLowerCase();
        if (x === "*" || x === u.protocol) return true;
        if (x.charAt(0) === "'" || /^[a-z][a-z0-9+.-]*:$/.test(x)) return false;   // a keyword, or another scheme
        var m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^\/:]+)(?::(\d+|\*))?(\/.*)?$/.exec(x); if (!m) return false;
        if (m[1] && m[1] + ":" !== u.protocol) return false;
        var h = m[2], host = u.hostname.toLowerCase();
        if (!(h === host || (h.slice(0, 2) === "*." && host.slice(-(h.length - 1)) === h.slice(1)))) return false;
        return !m[4] || u.pathname.indexOf(m[4]) === 0;
      });
    } catch (e) { return false; }
  };
  function metaRefuses() {
    if (metaDone || !HOSTED.length) return false;
    try {
      if (document.readyState !== "loading") metaDone = true;   // the head is whole: read once more and no further
      var ms = document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]');
      for (var i = 0; i < ms.length; i++) if (PV.cspRefuses(ms[i].getAttribute("content"), HOSTED[0])) return true;
    } catch (e) {}
    return false;
  }
  function rememberRefused(days) {
    artRefused = true;
    try {
      var host = location.hostname; if (!host) return;
      chrome.storage.local.get("pv:artRefused", function (r) {
        try {
          var m = (r && r["pv:artRefused"]) || {}, now = Date.now(), out = {}, n = 0;
          Object.keys(m).forEach(function (k) { if (m[k] > now && n < 300) { out[k] = m[k]; n++; } });
          out[host] = Math.max(out[host] || 0, now + days * 86400000);
          chrome.storage.local.set({ "pv:artRefused": out });
        } catch (e2) {}
      });
    } catch (e) {}
  }
  PV.artRefused = function () { if (!artRefused && metaRefuses()) artRefused = true; return artRefused; };
  PV.pickArt = function () { var src = (HOSTED.length && !PV.artRefused()) ? HOSTED : BUNDLED; return src[Math.floor(Math.random() * src.length)] || ""; };
  PV.pickBundledArt = function () { return BUNDLED[Math.floor(Math.random() * BUNDLED.length)] || ""; };
  PV.artInfo = function () { return { hosted: HOSTED.length, at: PV.__artAt || 0, refused: artRefused }; };
  // Put a photo on an element as its background. A hosted photo is never asked for on a page known to refuse it (a bundled one
  // goes on instead, and the element's __artUrl names it, for the credit). On any other page it is probed, and a refusal swaps
  // this element to a bundled photo and is remembered.
  // A picture kept on the device (bg.js, 2026-11-24): its bytes are asked of the background once a page, made into an address of
  // this page's own (a blob), and drawn with no request to the network. LOCAL holds what is ready; a picture that is not stored,
  // or a page whose policy refuses such an address, is drawn from its own address as before.
  var LOCAL = {}, localWait = {}, HOSTED_LOCAL = false, blobBad = false;
  function localArt(url, cb) {
    if (LOCAL[url] !== undefined) { cb(blobBad ? "" : LOCAL[url]); return; }
    if (localWait[url]) { localWait[url].push(cb); return; }
    localWait[url] = [cb];
    var over = false, done = function (b) { if (over) return; over = true; clearTimeout(late); LOCAL[url] = b; var l = localWait[url] || []; delete localWait[url]; l.forEach(function (f) { try { f(blobBad ? "" : b); } catch (e) {} }); };
    var late = setTimeout(function () { done(""); }, 1500);
    try {
      chrome.runtime.sendMessage({ type: "prism-art-bytes", url: url }, function (r) {
        void chrome.runtime.lastError;
        if (!(r && r.ok && r.b64)) { done(""); return; }
        try {
          var bin = atob(r.b64), n = bin.length, a = new Uint8Array(n);
          for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
          done(URL.createObjectURL(new Blob([a], { type: "image/jpeg" })));
        } catch (e) { done(""); }
      });
    } catch (e) { done(""); }
  }
  // the address to draw a picture from: the page's own copy when it is ready
  PV.artCss = function (url) { return (!blobBad && LOCAL[url]) || url; };
  function fromNet(el, url) {
    el.style.backgroundImage = "url('" + url + "')";
    try {
      var im = new Image();
      im.onload = function () { hostedGood = true; };
      im.onerror = function () {
        var on = true; try { on = navigator.onLine !== false; } catch (e0) {}
        if (!hostedGood && on && !artRefused) rememberRefused(1);
        if (el.style.backgroundImage.indexOf(url) >= 0) { var b = PV.pickBundledArt(); el.style.backgroundImage = "url('" + b + "')"; el.__artUrl = b; }
      };
      im.src = url;
    } catch (e) {}
  }
  function fromLocal(el, url, blob) {
    el.style.backgroundImage = "url('" + blob + "')";
    try {
      var im = new Image();
      // refused by the page's policy (or the copy is gone): this page draws from the pictures' addresses from here on
      im.onerror = function () { blobBad = true; if (el.__artWant === url && el.style.backgroundImage.indexOf(blob) >= 0) fromNet(el, url); };
      im.src = blob;
    } catch (e) {}
  }
  // What a cover shows (pv:ui.coverLook, 2026-11-25, asked for): a photo as before, plain black, or frosted: the page under the
  // cover blurred past reading, with a dark tint. A plain cover asks for no picture at all.
  PV.coverLook = function () { var v = PV.uiPrefs && PV.uiPrefs.coverLook; return v === "black" || v === "frosted" ? v : ""; };
  function plainOnto(el, look) {
    el.__artWant = ""; el.__artUrl = "";
    el.style.backgroundImage = "none";
    if (look === "frosted") {
      // frosted glass: light, the colours under it kept and spread wide, a sheen from the top corner and a bright edge
      el.style.backgroundColor = "rgba(255,255,255,.22)";
      el.style.backgroundImage = "linear-gradient(135deg, rgba(255,255,255,.42) 0%, rgba(255,255,255,.10) 38%, rgba(255,255,255,.04) 62%, rgba(255,255,255,.20) 100%)";
      el.style.backgroundSize = "100% 100%"; el.style.backgroundPosition = "0 0";
      el.style.setProperty("-webkit-backdrop-filter", "blur(40px) saturate(1.7) brightness(1.08)"); el.style.setProperty("backdrop-filter", "blur(40px) saturate(1.7) brightness(1.08)");
      el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,.45), inset 0 1px 0 rgba(255,255,255,.7)";
    } else { el.style.backgroundColor = "#0A0C0F"; el.style.boxShadow = ""; el.style.removeProperty("-webkit-backdrop-filter"); el.style.removeProperty("backdrop-filter"); }
  }
  // the covers already up follow a change of the choice, and the settings when they load after the first covers
  PV.relookCovers = function () {
    var look = PV.coverLook(), list = [];
    try { list = document.querySelectorAll("[data-prism-veil]"); } catch (e) {}
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (typeof c.__artUrl !== "string") continue;   // not a cover that carries a picture
      if (look && (c.__artUrl || c.__look !== look)) { plainOnto(c, look); c.__look = look; }
      else if (!look && c.__look) {
        c.__look = ""; c.style.removeProperty("-webkit-backdrop-filter"); c.style.removeProperty("backdrop-filter"); c.style.backgroundColor = "#0A0C0F"; c.style.boxShadow = ""; c.style.backgroundSize = "cover"; c.style.backgroundPosition = "center";
        var u = PV.pickArt(); c.__artUrl = u; PV.artOnto(c, u);
      }
    }
  };
  PV.artOnto = function (el, url) {
    var look = PV.coverLook(); if (look) { plainOnto(el, look); el.__look = look; return; }
    var net = /^https?:/i.test(url);
    if (net && PV.artRefused()) { url = PV.pickBundledArt(); el.__artUrl = url; net = false; }
    el.__artWant = url;
    if (net && HOSTED_LOCAL && !blobBad) {
      if (LOCAL[url]) { fromLocal(el, url, LOCAL[url]); return; }
      // a few tens of milliseconds, with the cover's own ground until then
      localArt(url, function (blob) { if (el.__artWant !== url) return; if (blob) fromLocal(el, url, blob); else fromNet(el, url); });
      return;
    }
    el.style.backgroundImage = "url('" + url + "')";
    if (!net) return;
    try {
      var im = new Image();
      im.onload = function () { hostedGood = true; };
      im.onerror = function () {
        var on = true; try { on = navigator.onLine !== false; } catch (e0) {}
        if (!hostedGood && on && !artRefused) rememberRefused(1);
        if (el.style.backgroundImage.indexOf(url) >= 0) { var b = PV.pickBundledArt(); el.style.backgroundImage = "url('" + b + "')"; el.__artUrl = b; }
      };
      im.src = url;
    } catch (e) {}
  };
  // the browser's own word that the page's policy refused one of the hosted photos (nothing is read but the refused address)
  try {
    document.addEventListener("securitypolicyviolation", function (e) {
      try {
        var b = String(e.blockedURI || ""); if (!b || !HOSTED.length) return;
        var o = new URL(HOSTED[0]).origin;
        if (b.indexOf(o) === 0) rememberRefused(30);
        if (/^blob/i.test(b) && /img-src|default-src/i.test(String(e.effectiveDirective || e.violatedDirective || ""))) blobBad = true;
      } catch (e2) {}
    }, true);
  } catch (e) {}
  function loadHostedArt(rec) { HOSTED = (rec && rec.urls && rec.urls.length) ? rec.urls.slice() : []; HOSTED_LOCAL = !!(rec && rec.local); PV.__artAt = (rec && rec.at) || 0; if (PV.onArtChange) PV.onArtChange(); }
  try {
    // one read for both, so no hosted photo is on offer before what the device remembers of this site is known
    chrome.storage.local.get(["pv:art", "pv:artRefused"], function (r) {
      try { var m = r && r["pv:artRefused"]; if (m && m[location.hostname] > Date.now()) artRefused = true; } catch (e) {}
      loadHostedArt(r && r["pv:art"]);
    });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:art"]) loadHostedArt(ch["pv:art"].newValue); });
  } catch (e) {}

  // ---- human override: Escape rips down every cover and unmutes, and holds
  // off for a while, so a viewer can ALWAYS get straight back to their show.
  var suppressUntil = 0;
  PV.suppressed = function () { return Date.now() < suppressUntil || orphaned() || !!(PV.veilOff && PV.veilOff()); };
  // Switched off at edge://extensions (or Firefox's add-ons page), the page
  // keeps the covers this script put there and nothing is left to take them
  // down (2026-10-27). An orphaned content
  // script sees no chrome.runtime.id: the first sweep that notices tears
  // everything down and the loops idle from then on.
  var dead = false;
  function orphaned() {
    if (dead) return true;
    var alive = true; try { alive = !!(chrome.runtime && chrome.runtime.id); } catch (e) { alive = false; }
    var newer = alive && replaced();
    if (alive && !newer) return false;
    dead = true;
    PV.__dead = true; window.__prismVeil = false;   // the next copy (bg.js probeTab, reinjection) may start
    try { PV.clearCovers(); } catch (e1) {}
    try { if (PV.uncoverVideo) PV.uncoverVideo(); } catch (e2) {}
    // replaced by a newer copy: only this copy's own button goes, for the rest in the page is the newer copy's
    if (newer) { try { if (PV.removePill) PV.removePill(); } catch (e4) {} return true; }
    try { document.querySelectorAll("[data-prism-ui],prism-popup-button").forEach(function (n) { n.remove(); }); } catch (e3) {}
    return true;
  }
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
    // PRISM UI (Report chip, pick catcher, toasts, pill) is data-prism-ui, never
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

  // ---- the look's share of the time (2026-11-26, B-567: a news page was slow with PRISM on; on AP News the look ran 52 times in
  // 20 s at 170 ms a time). A look that costs much is run less often: after a look, the next routine one (a change in the page,
  // a scroll, the clock) waits eight times what the last one cost, two seconds at most, so the looks take about a ninth of the
  // time however large the page. A cheap look waits for nothing. What cannot wait is not held: a cover the page took away, a
  // video that starts, the tab coming back, the person's own press; those call PV.sweep itself.
  var swEnd = 0, swCost = 0, swT = 0, SW_SHARE = 8, SW_MAX = 2000, perf = { n: 0, ms: 0, max: 0, n10: 0, ms10: 0, vn: 0, vms: 0 };
  var nowMs = function () { try { return performance.now(); } catch (e) { return Date.now(); } };
  (function () {
    var raw = PV.sweep;
    PV.sweep = function () { var t = nowMs(); try { return raw.apply(this, arguments); } finally { swEnd = nowMs(); swCost = swEnd - t; perf.n++; perf.ms += swCost; if (swCost > perf.max) perf.max = swCost; if (swEnd < 10000) { perf.n10++; perf.ms10 += swCost; } } };
    // the video check, timed the same way
    var rawV = PV.videoAdBreak;
    if (rawV) PV.videoAdBreak = function () { var t = nowMs(); try { return rawV.apply(this, arguments); } finally { var c = nowMs() - t; perf.vn++; perf.vms += c; } };
  })();
  // For a report (2026-11-26, B-567: a page that loads in 6 s without PRISM took a minute with it in Safari on an iPhone, and the
  // cost can be measured here only on a computer): how many looks this page has had and what they cost, in numbers alone.
  // How late a timer of 250 ms comes says how long the page's one thread was held, by anything (2026-11-26: the looks took a second
  // of a page that was slow for a minute, so the report also has to say whether the page was held at all, or was waiting).
  var held = { ms: 0, max: 0, ms10: 0, n: 0 }, heldAt = nowMs();
  setInterval(function () {
    var n = nowMs(), late = n - heldAt - 250; heldAt = n; held.n++;
    if (late > 50) { held.ms += late; if (late > held.max) held.max = late; if (n < 10000) held.ms10 += late; }
  }, 250);
  PV.perfDiag = function () {
    var els = 0; try { els = document.getElementsByTagName("*").length; } catch (e) {}
    var o = { age: Math.round(nowMs()), looks: perf.n, ms: Math.round(perf.ms), max: Math.round(perf.max), looks10: perf.n10, ms10: Math.round(perf.ms10), video: perf.vn, videoMs: Math.round(perf.vms), last: Math.round(swCost), els: els,
      heldMs: Math.round(held.ms), heldMax: Math.round(held.max), heldMs10: Math.round(held.ms10), ticks: held.n };
    // the self-check of covers against the page's fixed strips (B-585): times asked, their cost, strips found
    try { var sc = PV.selfCheckStat; if (sc) { o.self = sc.n; o.selfMs = Math.round(sc.ms); o.selfFound = sc.found; } } catch (eS) {}
    // the page's own load times, from the browser, and how many files it has asked for
    try {
      var nv = performance.getEntriesByType("navigation")[0];
      if (nv) o.nav = { type: nv.type, start: Math.round(nv.requestStart), first: Math.round(nv.responseStart), end: Math.round(nv.responseEnd), ready: Math.round(nv.domInteractive), dcl: Math.round(nv.domContentLoadedEventEnd), load: Math.round(nv.loadEventEnd) };
      var rs = performance.getEntriesByType("resource"), slow = 0, longest = 0;
      for (var i = 0; i < rs.length; i++) { var du = rs[i].duration; if (du > 3000) slow++; if (du > longest) longest = du; }
      o.files = rs.length; o.filesSlow = slow; o.fileLongest = Math.round(longest);
    } catch (e2) {}
    return o;
  };
  PV.sweepSoon = function (share) {
    var wait = swEnd + Math.min(SW_MAX, swCost * (share > 0 ? share : SW_SHARE)) - nowMs();
    if (!(wait > 4)) { PV.sweep(); return; }
    if (!swT) swT = setTimeout(function () { swT = 0; PV.sweep(); }, wait);
  };

  // ---- observers
  var mo = new MutationObserver(function () {
    // a covered element just went out of the page: its replacement is covered in this same turn, before the screen is painted
    // (the looks that follow in the next second, for what comes in its place, wait twice the last look's cost)
    try { if (PV.coverLost && PV.coverLost()) { if (PV.coverLostFresh) PV.sweep(); else PV.sweepSoon(2); } } catch (eL) {}
    if (mo.__t) return;
    mo.__t = setTimeout(function () { mo.__t = null; PV.sweepSoon(); }, 400);
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
    // at most one in 60 ms, and no more than about a sixth of the time when the check itself costs (2026-11-26, B-567)
    var tA = nowMs();
    if (!PV.suppressed()) PV.videoAdBreak();
    fastAdT = setTimeout(function () { fastAdT = 0; }, Math.max(60, Math.min(600, (nowMs() - tA) * 6)));
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
    PV.loadUiPrefs();
    if (PV.ensurePill) PV.ensurePill();
    PV.sweep();
    setInterval(function () { PV.sweepSoon(); if (!orphaned() && PV.ensurePill) PV.ensurePill(); }, 1200);
    findInfopanes();
    setInterval(findInfopanes, 2000);   // (re)cache infopanes as they load
    setInterval(pollInfopanes, 60);      // catch a slide swap within ~60ms
    // Ads lazy-load as you scroll; a slot merely scrolled into view may fill
    // without a mutation we see - re-sweep on scroll/resize (throttled).
    var scrollT = 0;
    var onMove = function () {
      if (scrollT) return;
      scrollT = setTimeout(function () { scrollT = 0; PV.sweepSoon(); }, 200);
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
