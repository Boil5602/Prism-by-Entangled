/*
  Prism - source reliability marks on ANY page (spec section 5, "Credibility
  labeling": label, never censor).

  THE GLYPH: a small cylinder of three stacked disks, one per source, top to
  bottom:  Wikipedia RSP  /  Iffy Index (MBFC)  /  Steven Black fakenews.
  Each disk is red, yellow or green on that source's own scale, GREY when that
  source has nothing on the site (grey is "no information", never "bad"), and
  hollow when the person has switched that source off. The tooltip spells out
  all three lines; clicking the glyph opens the discussion/review behind the
  first source that has one.

  With the Prism-wide switch on (pv:ui.srcMarks, OFF by default), every link
  that leaves the current site for a listed outlet gets the glyph; the site
  you are on gets it on the Prism pill and, line by line with Why? buttons, in
  the Prism panel. Sources are individually switchable (pv:ui.credSrc).

  Rules of the road:
    - nothing is hidden, dimmed, reordered or blocked; unlisted = grey disk
    - lists arrive from bg.js (signed, verified, cached a day); pages never
      fetch them and never ask unless the switch is on
    - marks are inert to the page: [data-prism-ui] spans, capture-phase click
      with stopPropagation, no attributes touched on the page's own anchors
    - shadow DOM feeds (MSN etc.) are walked via PV.collectRoots
    - bounded: a page gets at most MAX marks, rescans are throttled
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  if (window !== window.top) return;   // page-level feature: top frame only (the veil runs in player embeds too)
  var MAX = 600, on = false, timer = 0, count = 0, mo = null;
  var TIER_COLORS = { r: "#f85149", y: "#d29922", g: "#3fb950", none: "#7d8590" };
  var TIER_WORDS = { r: "red", y: "yellow", g: "green" };
  var RSP_URL = "https://en.wikipedia.org/wiki/Wikipedia:Reliable_sources/Perennial_sources";
  // Disk order is fixed (top -> bottom) so the glyph reads the same everywhere.
  var SOURCES = [
    { id: "rsp", file: "list", name: "Wikipedia Perennial Sources", short: "Wikipedia RSP", scale: { gr: "g", nc: "y", m: "y", gu: "r", d: "r", b: "r" } },
    { id: "iffy", file: "iffy", name: "Iffy Index (via Media Bias/Fact Check)", short: "Iffy Index" },
    { id: "sb", file: "sb", name: "Steven Black fakenews hosts list", short: "Steven Black" }
  ];
  var IDX = {};      // id -> { legend, scale, source, byHost } once loaded
  var asked = {};    // id -> in-flight
  var srcOn = { rsp: true, iffy: true, sb: true };
  PV.CRED_SOURCES = SOURCES;

  // ---- the site you are on: registrable domain, roughly (public-suffix-lite)
  var TWO = /^(?:com?|org|net|gov|edu|ac|co|ne|or)\.[a-z]{2}$/;
  function regDomain(host) {
    var l = String(host || "").toLowerCase().replace(/^www\./, "").split(".");
    if (l.length <= 2) return l.join(".");
    var tail = l.slice(-2).join(".");
    return TWO.test(tail) ? l.slice(-3).join(".") : tail;
  }
  var SITE = regDomain(location.hostname);

  // ---- indexes
  function build(src, idx) {
    var byHost = {};
    (idx.entries || []).forEach(function (e) {
      (e.domains || []).forEach(function (d) {
        var slash = d.indexOf("/"), host = slash < 0 ? d : d.slice(0, slash), path = slash < 0 ? "" : d.slice(slash);
        (byHost[host] = byHost[host] || []).push({ e: e, host: host, path: path });
      });
    });
    return { legend: idx.legend || {}, scale: idx.scale || src.scale || {}, source: idx.source || {}, byHost: byHost };
  }
  // Longest domain(+path) match wins; several entries on the same key = mixed
  // (RSP) / first wins (others). Returns null when the source has nothing.
  function lookup(src, u) {
    var X = IDX[src.id]; if (!X) return null;
    var host = u.hostname.toLowerCase().replace(/^www\./, ""), labels = host.split("."), best = [], bestLen = -1;
    for (var i = 0; i < labels.length - 1; i++) {
      var h = labels.slice(i).join("."), cands = X.byHost[h] || [];
      cands.forEach(function (c) {
        if (c.path && u.pathname.indexOf(c.path) !== 0) return;
        var len = h.length + c.path.length;
        if (len > bestLen) { bestLen = len; best = [c.e]; } else if (len === bestLen) best.push(c.e);
      });
    }
    if (!best.length) return null;
    var e = best[0], status = e.status;
    if (src.id === "rsp") { var st = {}; best.forEach(function (b) { st[b.status] = 1; }); if (Object.keys(st).length > 1) status = "m"; }
    var label = status === "m" && src.id === "rsp" ? "Mixed - several ratings apply" : (X.legend[status] || status);
    var why = e.why || ((X.source.url || RSP_URL) + "#" + encodeURIComponent(e.id));
    return { tier: X.scale[status] || "y", status: status, label: label, name: e.name || host, last: e.last || "", why: why };
  }
  // One line per source, in disk order. { src, off, tier|null, label, name, why }
  function marksFor(url) {
    var u; try { u = new URL(url, location.href); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return SOURCES.map(function (src) {
      var off = !srcOn[src.id], m = off ? null : lookup(src, u);
      return { src: src, off: off, loaded: !!IDX[src.id], tier: m ? m.tier : null, label: m ? m.label : "", name: m ? m.name : "", last: m ? m.last : "", why: m ? m.why : "" };
    });
  }
  function anyInfo(ms) { return !!ms && ms.some(function (m) { return !!m.tier; }); }
  // Worst tier across sources (r > y > g), for a border tint. null = none.
  function worst(ms) {
    var w = null; (ms || []).forEach(function (m) { if (!m.tier) return; if (m.tier === "r" || (m.tier === "y" && w !== "r") || !w) w = m.tier; });
    return w;
  }
  PV.credMarks = marksFor;
  PV.credSite = function () { return on ? marksFor(location.origin + "/") : null; };
  PV.credAnyInfo = anyInfo;
  PV.credWorst = worst;
  PV.credOn = function () { return on; };
  PV.credSrcOn = function (id) { return !!srcOn[id]; };
  PV.credColor = function (tier) { return TIER_COLORS[tier || "none"]; };
  PV.credTooltip = tooltip;

  // ---- the glyph: three stacked disks = a cylinder. 12x17 CSS px.
  function glyph(ms, size) {
    var NS = "http://www.w3.org/2000/svg", s = size || 1;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 12 17"); svg.setAttribute("width", 12 * s); svg.setAttribute("height", 17 * s);
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "display:inline-block;vertical-align:middle;overflow:visible;flex:none";
    // bottom disk first so the upper ones overlap it
    for (var i = ms.length - 1; i >= 0; i--) {
      var m = ms[i], el = document.createElementNS(NS, "ellipse");
      el.setAttribute("cx", "6"); el.setAttribute("cy", String(3 + i * 5.2)); el.setAttribute("rx", "5.2"); el.setAttribute("ry", "2.6");
      if (m.off) { el.setAttribute("fill", "rgba(127,127,127,.12)"); el.setAttribute("stroke", "rgba(127,127,127,.55)"); el.setAttribute("stroke-dasharray", "1.5 1.2"); }
      else { el.setAttribute("fill", TIER_COLORS[m.tier || "none"]); el.setAttribute("stroke", "rgba(0,0,0,.45)"); }
      el.setAttribute("stroke-width", ".8");
      svg.appendChild(el);
    }
    return svg;
  }
  PV.credGlyph = glyph;
  function tooltip(ms) {
    return ms.map(function (m) {
      var v = m.off ? "off" : !m.loaded ? "loading" : m.tier ? TIER_WORDS[m.tier] + " - " + m.label + (m.name ? " (" + m.name + ")" : "") + (m.last ? ", last discussed " + m.last : "") : "grey - no information";
      return m.src.short + ": " + v;
    }).join("\n");
  }
  // The hover card (replaces native title bubbles, which are unformatted):
  // a heading, one line per source - swatch, source, verdict - and a hint.
  // Plain rows, no bullets, no accent colour; near-black card, light text.
  var card = null, cardFor = null;
  function credCard(ms, hint) {
    var c = document.createElement("div");
    c.setAttribute("data-prism-ui", "1");
    c.style.cssText = "position:fixed;z-index:2147483647;max-width:320px;background:#0F1216;color:#F2F4F7;border:1px solid #3A4250;border-radius:10px;padding:9px 12px;" +
      "font:12px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.6);pointer-events:none;text-align:left;white-space:normal";
    var h = document.createElement("div"); h.textContent = "Source reliability"; h.style.cssText = "font-weight:600;color:#FFFFFF;margin:0 0 4px"; c.appendChild(h);
    ms.forEach(function (m) {
      var row = document.createElement("div"); row.style.cssText = "display:flex;align-items:baseline;gap:7px;margin:2px 0";
      var d = document.createElement("span"); d.style.cssText = "flex:none;display:inline-block;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.6);position:relative;top:1px;" +
        (m.off ? "background:transparent;box-shadow:inset 0 0 0 1px #9AA3AF" : "background:" + TIER_COLORS[m.tier || "none"]);
      row.appendChild(d);
      var t = document.createElement("span");
      var v = m.off ? "off" : !m.loaded ? "loading" : m.tier ? m.label + (m.name ? " (" + m.name + ")" : "") + (m.last ? " - last discussed " + m.last : "") : "no information";
      var nm = document.createElement("span"); nm.textContent = m.src.short; nm.style.cssText = "color:#FFFFFF;font-weight:600";
      t.appendChild(nm); t.appendChild(document.createTextNode(" " + v)); row.appendChild(t);
      c.appendChild(row);
    });
    if (hint) { var f = document.createElement("div"); f.textContent = hint; f.style.cssText = "color:#C0C8D2;margin:5px 0 0"; c.appendChild(f); }
    return c;
  }
  function showCredTip(anchor, ms, hint) {
    hideCredTip(); cardFor = anchor;
    card = credCard(ms, hint); (document.fullscreenElement || document.documentElement).appendChild(card);
    var r = anchor.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    card.style.left = left + "px"; card.style.top = top + "px";
  }
  function hideCredTip(anchor) { if (anchor && cardFor !== anchor) return; if (card) { try { card.remove(); } catch (e) {} } card = null; cardFor = null; }
  PV.credCard = credCard; PV.showCredTip = showCredTip; PV.hideCredTip = hideCredTip;
  PV.showTextTip = function (anchor, text) {
    hideCredTip(); cardFor = anchor;
    card = document.createElement("div"); card.setAttribute("data-prism-ui", "1"); card.textContent = text;
    card.style.cssText = "position:fixed;z-index:2147483647;max-width:320px;background:#0F1216;color:#F2F4F7;border:1px solid #3A4250;border-radius:10px;padding:9px 12px;" +
      "font:12px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.6);pointer-events:none;text-align:left;white-space:normal";
    (document.fullscreenElement || document.documentElement).appendChild(card);
    var r = anchor.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    var top = r.top - h - 8; if (top < 8) top = r.bottom + 8;
    card.style.left = left + "px"; card.style.top = top + "px";
  };
  function firstWhy(ms) { for (var i = 0; i < ms.length; i++) if (ms[i].why) return ms[i]; return null; }

  // ---- marks on links
  function mark(ms) {
    var s = document.createElement("span");
    s.setAttribute("data-prism-ui", "1"); s.setAttribute("data-prism-mark", "1"); s.setAttribute("role", "link");
    s.style.cssText = "display:inline-block;margin:0 0 0 4px;vertical-align:middle;line-height:0;font-size:0;cursor:help;position:relative;z-index:1;flex:none;" +
      "filter:drop-shadow(0 0 1px rgba(255,255,255,.9))";
    s.appendChild(glyph(ms, 0.85));
    var w = firstWhy(ms);
    var hint = w ? "Click for " + w.src.short + "\u2019s discussion of this source" : "";
    s.addEventListener("mouseenter", function () { showCredTip(s, ms, hint); });
    s.addEventListener("mouseleave", function () { hideCredTip(s); });
    s.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (w) { try { chrome.runtime.sendMessage({ type: "prism-cred-open", url: w.why }); } catch (err) {} }
    }, true);
    ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick"].forEach(function (t) {
      s.addEventListener(t, function (e) { e.stopPropagation(); }, true);
    });
    return s;
  }
  function markAnchor(a) {
    if (count >= MAX || a.hasAttribute("data-prism-marked")) return;
    var href = a.getAttribute("href"); if (!href || href.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(href)) return;
    var u; try { u = new URL(href, location.href); } catch (e) { return; }
    if (regDomain(u.hostname) === SITE) return;             // stays on this site: not a source mark
    if (a.closest && a.closest("[data-prism-ui]")) return;   // our own UI
    a.setAttribute("data-prism-marked", "");                 // scanned once; an unrated link is left as-is
    var ms = marksFor(u.href); if (!anyInfo(ms)) return;
    var text = (a.textContent || "").trim();
    if (!text) return;                                       // image-only / icon anchors: a glyph would float oddly
    a.appendChild(mark(ms)); count++;
  }
  function scan() {
    timer = 0;
    if (!on || !loadedAny()) return;
    var roots = (PV.collectRoots && PV.collectRoots()) || [document];
    for (var r = 0; r < roots.length; r++) {
      var list; try { list = roots[r].querySelectorAll("a[href]:not([data-prism-marked])"); } catch (e) { continue; }
      for (var i = 0; i < list.length && count < MAX; i++) markAnchor(list[i]);
    }
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 400); }
  function unmark() {
    var roots = (PV.collectRoots && PV.collectRoots()) || [document];
    roots.forEach(function (root) {
      try {
        root.querySelectorAll("[data-prism-mark]").forEach(function (d) { d.remove(); });
        root.querySelectorAll("[data-prism-marked]").forEach(function (a) { a.removeAttribute("data-prism-marked"); });
      } catch (e) {}
    });
    count = 0;
  }
  function rescan() { unmark(); scan(); }
  function loadedAny() { return SOURCES.some(function (s) { return srcOn[s.id] && IDX[s.id]; }); }
  function watch() {
    if (mo) return;
    mo = new MutationObserver(schedule);
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }

  // This site's own marks -> the Prism pill and the toolbar tooltip (per tab).
  function announceSite() {
    var ms = PV.credSite();
    if (PV.setPillMark) { try { PV.setPillMark(ms); } catch (e) {} }
    try { chrome.runtime.sendMessage({ type: "prism-cred-site", text: ms && anyInfo(ms) ? tooltip(ms) : "" }); } catch (e) {}
  }
  function changed() { announceSite(); if (PV.onCredChange) PV.onCredChange(); }

  function askIndex(src) {
    if (IDX[src.id] || asked[src.id]) return;
    asked[src.id] = true;
    try {
      chrome.runtime.sendMessage({ type: "prism-cred-get", src: src.file }, function (idx) {
        asked[src.id] = false;
        if (chrome.runtime.lastError || !idx) return;
        IDX[src.id] = build(src, idx);
        if (on) { rescan(); changed(); }
      });
    } catch (e) { asked[src.id] = false; }
  }
  function apply(prefs) {
    var next = !!(prefs && prefs.srcMarks), cs = (prefs && prefs.credSrc) || {}, moved = false;
    SOURCES.forEach(function (s) { var v = cs[s.id] !== false; if (v !== srcOn[s.id]) { srcOn[s.id] = v; moved = true; } });
    if (next === on && !moved) return;
    on = next;
    if (on) { SOURCES.forEach(function (s) { if (srcOn[s.id]) askIndex(s); }); watch(); rescan(); } else unmark();
    changed();
  }
  try {
    chrome.storage.local.get("pv:ui", function (r) { apply((r && r["pv:ui"]) || {}); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:ui"]) apply(ch["pv:ui"].newValue || {}); });
  } catch (e) {}
})();
