/*
  Prism Veil - the "Report ad" tool. A corner chip; click it, then click an
  ad (or a veil). Produces a compact, PII-free description of the element,
  its ancestry across shadow boundaries, any nearby ad label, and - when the
  pick lands on a veil - WHICH rule placed it. Copied to the clipboard.
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});

  function prismReport(el, pt) {
    var out_card = null;
    function inVeil(n) { while (n) { if (n.hasAttribute && n.hasAttribute("data-prism-veil")) return true; n = PV.parentAcross(n); } return false; }
    function host(n) { try { return (n.tagName === "IFRAME" && n.src) ? new URL(n.src).host : ""; } catch (e) { return ""; } }
    function desc(n) {
      var r = n.getBoundingClientRect(), attrs = [];
      try { for (var i = 0; i < n.attributes.length; i++) { var a = n.attributes[i]; if (/^(data-ad|data-google|data-slot|data-adunit|data-t|aria-label|role|name|is-ads-overlay|aria-posinset)$/i.test(a.name)) attrs.push(a.name + "=" + ("" + a.value).slice(0, 48)); } } catch (e) {}
      var txt = "";
      try { if (n.childElementCount === 0) txt = (n.textContent || "").trim().slice(0, 40); } catch (e) {}
      return { tag: n.tagName, id: (n.id || "").slice(0, 48), cls: PV.classStr(n).slice(0, 120), text: txt, w: Math.round(r.width), h: Math.round(r.height), kids: n.childElementCount, shadow: !!n.shadowRoot, iframeHost: host(n), attrs: attrs };
    }
    var chain = [], n = el, d = 0;
    while (n && n !== document.body && n !== document.documentElement && d < 24) { chain.push(desc(n)); n = PV.parentAcross(n); d++; }
    var label = null, p = el, k = 0;
    while (p && k < 8) {
      var hit = (p.querySelectorAll ? [].slice.call(p.querySelectorAll("*")) : []).find(function (x) {
        var tx = PV.ownText(x);
        return tx.length < 28 && /^(ad|advertisement|sponsored|ad\s*\d+\s*of\s*\d+|paid partner content|promoted stories|sponsored stories)$/i.test(tx);
      });
      if (hit) { label = (hit.textContent || "").trim().slice(0, 28); break; }
      p = PV.parentAcross(p); k++;
    }
    var veil = null;
    if (inVeil(el)) {
      PV.veils.forEach(function (cover, target) {
        if (veil) return;
        var m = el; while (m && m !== cover) m = PV.parentAcross(m);
        if (m === cover) veil = { rule: PV.whyFor(target) || "?", mode: cover.__mode || "video", covers: desc(target) };
      });
      var vv = PV.vidVeil();
      if (!veil && vv) veil = { rule: "video-ad-break", mode: "video", covers: desc(vv.box || vv.video) };
    }
    // The enclosing CARD's interior, label-grade only (the chain above is
    // ancestors; a "Sponsored" tag, a data-a-target, or an ad-CDN media host
    // lives BELOW the target's card - Twitch front page, 2026-08-28). Own
    // text only when short and label-like (<= 20 chars, <= 3 words); URLs
    // reduced to their hostname. Never titles, never body copy.
    var card = null;
    try {
      var th = Math.max(1, el.getBoundingClientRect().height), c = PV.parentAcross(el), lvl = 0;
      // Never for our own veil (its card would be <html>); never past <body>.
      if (inVeil(el)) c = null;
      while (c && c !== document.body && c !== document.documentElement && lvl < 8) {
        var ch = c.getBoundingClientRect().height;
        if (ch > th * 4 || ch > 900) break;
        card = c; c = PV.parentAcross(c); lvl++;
      }
      if (!card && !inVeil(el)) { card = PV.parentAcross(el); lvl = 1; }   // the height cap tripped at once: still show the parent
      if (card) {
        var lines = [], all = card.querySelectorAll("*");
        for (var q = 0; q < all.length && lines.length < 40; q++) {
          var x = all[q], bits = [];
          if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(x.tagName)) continue;
          try { for (var ai = 0; ai < x.attributes.length; ai++) { var at = x.attributes[ai]; if (/^(data-|aria-)/.test(at.name) && !/^(data-prism)/.test(at.name)) bits.push(at.name + "=" + ("" + at.value).slice(0, 40)); } } catch (e6) {}
          var hsrc = ""; try { var u = x.getAttribute("src") || x.getAttribute("href") || x.getAttribute("poster") || ""; if (/^https?:/i.test(u)) hsrc = new URL(u).host; else if (x.currentSrc) hsrc = new URL(x.currentSrc).host; } catch (e7) {}
          if (hsrc) bits.push("host=" + hsrc);
          var ot = PV.ownText(x); if (ot && ot.length <= 20 && ot.split(/\s+/).length <= 3) bits.push("\"" + ot + "\"");
          if (bits.length) lines.push(x.tagName + " " + PV.classStr(x).slice(0, 40) + " " + bits.join(" "));
        }
        out_card = { tag: card.tagName, cls: PV.classStr(card).slice(0, 80), levelsUp: lvl, lines: lines };
      }
    } catch (e8) { out_card = { err: "" + e8 }; }
    var out = { site: location.hostname, url: location.href.slice(0, 120), version: PV.VERSION || "", coveredByPrism: inVeil(el), veil: veil, nearbyAdLabel: label, target: desc(el), chain: chain, card: out_card };
    // Everything UNDER the click, top to bottom (the same label-grade shape):
    // a player's full-size click-cover is what the pick lands on, and the ad
    // it hides is a sibling beneath (SOOP, 2026-08-29). Prism's own layers skipped.
    try {
      if (pt) {
        var st = document.elementsFromPoint(pt.x, pt.y), stack = [];
        for (var si = 0; si < st.length && stack.length < 10; si++) {
          var sn = st[si]; if (sn === document.documentElement || sn === document.body) continue;
          if (sn.hasAttribute("data-prism-veil") || sn.hasAttribute("data-prism-ui") || (sn.closest && sn.closest("[data-prism-veil],[data-prism-ui]"))) continue;
          var sd = desc(sn); try { var ss = sn.currentSrc || sn.src || sn.getAttribute("src") || ""; if (ss) sd.srcHost = /^data:/.test(ss) ? "data:" : new URL(ss, location.href).host; } catch (e9) {}
          stack.push(sd);
        }
        out.stack = stack;
      }
    } catch (e10) {}
    // Facebook: what the post's top band actually says, glyph-exact, so a
    // missed label is measurable (non-ASCII shown as \u escapes).
    try {
      var post = el.closest && el.closest("[aria-posinset]");
      if (post && /(^|\.)facebook\.com$/i.test(location.hostname)) {
        var top = post.getBoundingClientRect().top, band = [], seen = 0;
        var cand = post.querySelectorAll("span,div,a,b,h2,h3,h4");
        var esc = function (x) { return x.replace(/[^\x20-\x7E]/g, function (ch) { return "\\u" + ("000" + ch.charCodeAt(0).toString(16)).slice(-4); }); };
        for (var i = 0; i < cand.length && band.length < 40 && seen < 1500; i++, seen++) {
          var c = cand[i]; if (c.childElementCount > 2) continue;
          var tx = (c.textContent || "").trim(); if (!tx || tx.length > 24) continue;
          var r = c.getBoundingClientRect(); if (r.height <= 0 || r.top - top > 160 || r.top - top < -50) continue;   // skip offscreen a11y text
          band.push({ tag: c.tagName, text: esc(tx).slice(0, 48), dy: Math.round(r.top - top), kids: c.childElementCount, al: (c.getAttribute("aria-label") || "").slice(0, 20) });
        }
        // raw text of the header row (name heading's ancestor just below the body)
        var hdr = post.querySelector("h2,h3,h4"), row = hdr, rowText = "";
        while (hdr && row.parentElement && row.parentElement !== post && row.parentElement.getBoundingClientRect().height <= 120) row = row.parentElement;
        if (row) rowText = esc((row.innerText || "").replace(/\n+/g, " | ")).slice(0, 300);
        // header links: text after invisible chars, size, pseudo content, svg
        var hlinks = [];
        post.querySelectorAll("a").forEach(function (a2) {
          var r3 = a2.getBoundingClientRect(); if (hlinks.length >= 10 || r3.height <= 0 || r3.top - top > 160 || r3.top - top < -50) return;
          var pa = "", pb = ""; try { pa = getComputedStyle(a2, "::after").content; pb = getComputedStyle(a2, "::before").content; } catch (e) {}
          hlinks.push({ text: esc((a2.textContent || "").slice(0, 30)), w: Math.round(r3.width), h: Math.round(r3.height), dy: Math.round(r3.top - top), href: (a2.getAttribute("href") || "").slice(0, 60), after: pa, before: pb, svg: a2.querySelectorAll("svg,use").length, aria: (a2.getAttribute("aria-label") || "").slice(0, 20) });
        });
        var labels = [];
        post.querySelectorAll("[aria-label]").forEach(function (x) { var r2 = x.getBoundingClientRect(); if (labels.length < 12 && r2.top - top < 200 && r2.top - top > -50) labels.push(esc(x.getAttribute("aria-label")).slice(0, 30)); });
        var pr = post.getBoundingClientRect();
        out.fb = { posinset: post.getAttribute("aria-posinset"), postH: Math.round(pr.height), postW: Math.round(pr.width), viewH: innerHeight, viewW: innerWidth,
                   headings: post.querySelectorAll("h2,h3,h4").length, names: post.querySelectorAll('[data-ad-rendering-role="profile_name"]').length,
                   labelFound: !!(PV.fbLabelElement && PV.fbLabelElement(post)), headerRow: rowText, headerLinks: hlinks, ariaLabels: labels, band: band };
      }
    } catch (e) { out.fbErr = "" + e; }
    // Engine diagnostics (any site): did detection see this element, and why not.
    try {
      var d = { ua: /Firefox\/(\d+)/.test(navigator.userAgent) ? "firefox" : "chromium", errors: document.documentElement.getAttribute("data-prism-errors") || "",
                veils: PV.veils ? PV.veils.size : -1, roots: PV.collectRoots ? PV.collectRoots().length : -1,
                isVisible: !!(PV.isVisible && PV.isVisible(el)), inViewport: (function () { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })(),
                slotMatch: null, inTargets: null, targetsTotal: null };
      if (PV.SLOT_SELECTORS) for (var si = 0; si < PV.SLOT_SELECTORS.length; si++) { try { if (el.matches(PV.SLOT_SELECTORS[si])) { d.slotMatch = PV.SLOT_SELECTORS[si]; break; } } catch (e2) { d.slotMatch = "ERR " + PV.SLOT_SELECTORS[si] + ": " + e2.message; break; } }
      try { document.querySelectorAll(PV.SLOT_SELECTORS.join(",")); d.slotQueryOk = true; } catch (e3) { d.slotQueryOk = "ERR " + e3.message; }
      if (PV.collectTargets) { var ct = PV.collectTargets(); d.targetsTotal = ct.targets.size; d.inTargets = ct.targets.has(el); var anc = el, up = 0; while (anc && up < 24 && !ct.targets.has(anc)) { anc = PV.parentAcross(anc); up++; } d.ancestorTargetLevels = (anc && ct.targets.has(anc)) ? up : null; if (anc && ct.targets.has(anc)) d.ancestorWhy = ct.why.get(anc); }
      // cover-side: the veil for this element (or its nearest covered ancestor)
      try {
        var ct2 = null, a2 = el, up2 = 0;
        while (a2 && up2 < 24) { if (PV.veils && PV.veils.has(a2)) { ct2 = PV.veils.get(a2); break; } a2 = PV.parentAcross(a2); up2++; }
        if (ct2) {
          var cr = ct2.getBoundingClientRect(), ccs = getComputedStyle(ct2);
          d.cover = { levelsUp: up2, mode: ct2.__mode, fixed: !!ct2.__fixed, connected: ct2.isConnected, rect: { x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height) },
                      display: ccs.display, opacity: ccs.opacity, clipPath: ct2.style.clipPath || ccs.clipPath, z: ccs.zIndex, position: ccs.position, parent: ct2.parentElement && ct2.parentElement.tagName,
                      bg: (ccs.backgroundImage || "").slice(0, 40), atPoint: (function () { var m = document.elementFromPoint(cr.left + cr.width / 2, cr.top + Math.min(cr.height / 2, innerHeight / 2)); return m ? (m.tagName + (m.hasAttribute("data-prism-veil") ? "#veil" : "")) : null; })() };
        } else d.cover = null;
        d.topBar = PV.topBar ? { top: PV.topBar.top, el: PV.topBar.el && (PV.topBar.el.tagName + "." + PV.classStr(PV.topBar.el).slice(0, 40)), containsTarget: !!(PV.topBar.el && PV.deepContains(PV.topBar.el, el)) } : null;
      } catch (e5) { d.coverErr = "" + e5; }
      // iframes on the page (host + path only) and which of them said hello
      try {
        d.iframes = Array.prototype.slice.call(document.querySelectorAll("iframe")).filter(function (f) { return f.getBoundingClientRect().width > 200; }).slice(0, 8).map(function (f) { var u = null; try { u = new URL(f.src); } catch (e) {} return (u ? u.host + u.pathname.slice(0, 40) : "(no src)") + " " + Math.round(f.getBoundingClientRect().width) + "x" + Math.round(f.getBoundingClientRect().height); });
        d.frameHello = (PV.frameHello || []).slice(0, 8);
      } catch (eI) {}
      try { d.family = PV.playerFamily ? PV.playerFamily() : null; } catch (eF) {}
      try { d.adStack = PV.adStackHere ? PV.adStackHere() : null; } catch (eS) {}
      try { d.prefs = PV.uiPrefs ? { srcMarks: !!PV.uiPrefs.srcMarks, aiVeil: !!PV.uiPrefs.aiVeil, veilPaused: PV.uiPrefs.veilPaused !== false, hud: PV.uiPrefs.hud || "interactive", pauseAfter: !!(PV.pauseAfterPref && PV.pauseAfterPref()) } : null; } catch (e9) {}
      // The video veil's state at the pick (a Paramount+ show sat "Paused"
      // under the veil with nothing in the report saying why, 2026-09-12).
      try {
        var vv = PV.vidVeil ? PV.vidVeil() : null;
        d.vidVeil = vv ? { mode: vv.mode, ageMs: vv.artAt ? Date.now() - vv.artAt : null, pauseAfter: !!vv.pauseAfter, byPrism: !!vv.byPrism, videoPaused: !!(vv.video && vv.video.paused), videoT: vv.video ? Math.round(vv.video.currentTime || 0) : null } : null;
      } catch (e10) {}
      out.diag = d;
    } catch (e4) { out.diagErr = "" + e4; }
    return out;
  }

  var CHIP_LABEL = "⚑ Report ad";
  var pick = null, chip = null;
  // One toast at a time: a new one replaces the old, cancelling a pick clears
  // the prompt at once (it lingered after Cancel, 2026-08-29), and a click on
  // a toast dismisses it.
  var curToast = null;
  function clearToast() { if (curToast) { try { curToast.remove(); } catch (e) {} curToast = null; } }
  function toast(msg, color) {
    clearToast();
    var t = document.createElement("div"); curToast = t;
    t.setAttribute("data-prism-ui", "1");
    t.textContent = msg;
    t.addEventListener("click", function (e) { e.stopPropagation(); if (curToast === t) curToast = null; t.remove(); }, true);
    t.style.cssText = "position:fixed;left:12px;bottom:46px;z-index:2147483647;background:#12131aee;color:" +
      (color || "#F0A83C") + ";font:600 12px/1.45 system-ui,sans-serif;padding:8px 12px;border-radius:8px;" +
      "border:1px solid #ffffff22;max-width:62vw;pointer-events:auto;cursor:pointer;box-shadow:0 4px 18px #0009";
    document.documentElement.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} if (curToast === t) curToast = null; }, 4600);
  }
  function exitPick() {
    clearToast();
    if (pick) { try { pick.remove(); } catch (e) {} pick = null; }
    if (chip) chip.textContent = CHIP_LABEL;
  }
  function doReport(el, pt) {
    var report;
    try { report = prismReport(el, pt); } catch (x) { report = { error: "" + x }; }
    // Ask every iframe under the click what IT has at that point (the IMA
    // bridge frame answers into its trace ring, which the send attaches).
    // The person's confirm click comes well after the answer.
    try {
      if (pt) document.querySelectorAll("iframe").forEach(function (fr) {
        var fb = fr.getBoundingClientRect();
        if (pt.x < fb.left || pt.x > fb.right || pt.y < fb.top || pt.y > fb.bottom) return;
        try { fr.contentWindow.postMessage({ __prismProbe: 1, x: pt.x - fb.left, y: pt.y - fb.top }, "*"); } catch (e) {}
      });
    } catch (eP) {}
    var json = JSON.stringify(report, null, 2);
    console.log("%cPRISM AD REPORT:", "color:#F0A83C;font-weight:bold;font-size:13px");
    console.log(json);
    var lbl = (report && report.nearbyAdLabel) ? (" “" + report.nearbyAdLabel + "”") : "";
    offerSend(report, json, "✓ Ad captured" + lbl);
  }
  // Sending is a per-report choice (spec section 19/22: nothing leaves the
  // machine unasked). What is sent matches what the panel says, and nothing more
  // (2026-09-26, "Fix the report payload ... so it matches what the user is told.
  // By default send only the site's domain, the element details, the kind of ad,
  // the note, and the version. Send the full page address only if the user ticks
  // 'Include the full page address', and drop the embedded video addresses unless
  // that box is ticked"). Copy to clipboard still gives the whole local report:
  // it never leaves the machine unless the person pastes it somewhere.
  var AD_KINDS = [["video", "Video ad"], ["display", "Banner or display ad"], ["sponsored", "Sponsored post or result"], ["popup", "Pop-up"], ["other", "Something else"]];
  function guessKind(r) {
    try {
      if ((r.veil && r.veil.mode === "video") || (r.diag && r.diag.vidVeil) || (r.target && r.target.tag === "VIDEO")) return "video";
      if (/sponsor|promot|paid/i.test(r.nearbyAdLabel || "")) return "sponsored";
    } catch (e) {}
    return "display";
  }
  // The element's own diagnostics that say nothing about the page beyond the ad itself.
  var DIAG_KEEP = ["isVisible", "inViewport", "slotMatch", "slotQueryOk", "targetsTotal", "inTargets", "ancestorTargetLevels", "ancestorWhy", "cover", "topBar", "family", "vidVeil"];
  function sendable(report, opt, version) {
    var d = (report && report.diag) || {}, diag = {};
    DIAG_KEEP.forEach(function (k) { if (d[k] !== undefined) diag[k] = d[k]; });
    var p = {
      site: report.site, kind: opt.kind, veil: version,
      rule: (report.veil && report.veil.rule) ? (report.veil.rule + " [" + (report.veil.mode || "?") + "]") : undefined,
      coveredByPrism: !!report.coveredByPrism, nearbyAdLabel: report.nearbyAdLabel,
      target: report.target, chain: report.chain, card: report.card, stack: report.stack, diag: diag,
    };
    if (opt.note) p.note = opt.note.slice(0, 280);
    if (opt.full) {
      p.url = location.href.slice(0, 200);
      if (d.iframes) diag.iframes = d.iframes;   // the embedded players' addresses (host + path)
    }
    return p;
  }
  function whatSent(site, full) {
    return "Sends the site (" + (site || "this site") + "), the ad's element details (its tags, classes and sizes, and the short labels and domains inside it), the kind of ad, your note if you write one, and Prism's version" +
      (full ? ", plus the full page address and the addresses of the video players embedded in the page" : "") + ". No page text, no account, no cookies.";
  }
  function offerSend(report, json, headline) {
    var t = document.createElement("div");
    t.setAttribute("data-prism-ui", "1");
    t.style.cssText = "position:fixed;left:12px;bottom:46px;z-index:2147483647;background:#12131aee;color:#c9cbd6;font:12px/1.45 system-ui,sans-serif;padding:10px 12px;border-radius:8px;border:1px solid #ffffff22;max-width:62vw;min-width:320px;";
    var h = document.createElement("div"); h.style.cssText = "color:#7fd08a;font-weight:600;margin-bottom:6px"; h.textContent = headline;
    var ctl = "background:#1c1e27;color:#e8ecf2;border:1px solid #ffffff33;border-radius:6px;padding:4px 6px;font:12px system-ui,sans-serif;";
    var kindRow = document.createElement("label"); kindRow.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px";
    kindRow.appendChild(document.createTextNode("Kind of ad"));
    var kind = document.createElement("select"); kind.style.cssText = ctl;
    AD_KINDS.forEach(function (k) { var o = document.createElement("option"); o.value = k[0]; o.textContent = k[1]; kind.appendChild(o); });
    kind.value = guessKind(report);
    kindRow.appendChild(kind);
    var note = document.createElement("input"); note.type = "text"; note.maxLength = 280; note.placeholder = "A note (optional)";
    note.style.cssText = ctl + "width:100%;box-sizing:border-box;margin-bottom:6px";
    // typing here is ours, never the page's shortcuts
    ["keydown", "keyup", "keypress"].forEach(function (ev) { note.addEventListener(ev, function (e) { if (e.key !== "Escape") e.stopPropagation(); }, true); });
    var fullRow = document.createElement("label"); fullRow.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;cursor:pointer";
    var full = document.createElement("input"); full.type = "checkbox";
    fullRow.appendChild(full); fullRow.appendChild(document.createTextNode("Include the full page address"));
    var p = document.createElement("div"); p.style.cssText = "opacity:.85;margin-bottom:8px";
    var say = function () { p.textContent = whatSent(report.site, full.checked); };
    say(); full.addEventListener("change", say);
    var row = document.createElement("div"); row.style.cssText = "display:flex;gap:8px";
    var send = document.createElement("button"); send.textContent = "Send to Prism";
    send.style.cssText = "background:#F0A83C;color:#12131a;border:0;border-radius:6px;padding:6px 10px;font:600 12px system-ui,sans-serif;cursor:pointer";
    var no = document.createElement("button"); no.textContent = "Copy to clipboard";
    no.style.cssText = "background:transparent;color:#c9cbd6;border:1px solid #ffffff33;border-radius:6px;padding:6px 10px;font:12px system-ui,sans-serif;cursor:pointer";
    var timer = setTimeout(function () { try { t.remove(); } catch (e) {} }, 60000);
    var hold = function () { clearTimeout(timer); };   // a person filling it in keeps it up
    [kind, note, full].forEach(function (x) { x.addEventListener("focus", hold, true); x.addEventListener("input", hold, true); });
    no.addEventListener("click", function () {
      clearTimeout(timer); t.remove();
      try { navigator.clipboard.writeText(json).then(function () { toast("✓ Copied to clipboard.", "#7fd08a"); }, function () { toast("Couldn't copy - the report is in the console (F12).", "#F0A83C"); }); }
      catch (x) { toast("Couldn't copy - the report is in the console (F12).", "#F0A83C"); }
    }, true);
    send.addEventListener("click", function () {
      clearTimeout(timer); send.disabled = true; send.textContent = "Sending…";
      // A stale page (extension reloaded under it) throws "Extension context
      // invalidated" on the first chrome.runtime call - stuck on "Sending…"
      // (2026-08-29). Detect it up front and say what fixes it.
      var payload, wantFull = full.checked;
      try { payload = sendable(report, { kind: kind.value, note: (note.value || "").trim(), full: wantFull }, (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ""); }
      catch (eCtx) { t.remove(); toast("Couldn't send - Prism was updated under this page. Reload the page (F5) and report again.", "#F0A83C"); return; }
      // A tab still running the PREVIOUS build after an extension reload has
      // no background to talk to: sendMessage never answers ("Sending…"
      // forever, 2026-08-29). Time out, say so, and say what fixes it.
      var done = false, to = setTimeout(function () {
        if (done) return; done = true; t.remove();
        toast("Couldn't send - Prism was updated under this page. Reload the page (F5) and report again.", "#F0A83C");
      }, 12000);
      var go = function () {
        chrome.runtime.sendMessage({ type: "prism-report-send", report: payload }, function (r) {
          if (done) return; done = true; clearTimeout(to); t.remove();
          if (chrome.runtime.lastError) { toast("Couldn't send - reload the page (F5) and report again.", "#F0A83C"); return; }
          if (r && r.ok) toast("✓ Sent. Thank you.", "#7fd08a");
          else toast("Couldn't send (" + ((r && r.error) || "offline") + ") - the report is in the console (F12).", "#F0A83C");
        });
      };
      try {
        // the embedded players' traces carry their video addresses: only with the box ticked
        if (!wantFull) { go(); return; }
        chrome.runtime.sendMessage({ type: "prism-frame-traces-get" }, function (fr) {
          try { if (fr && Object.keys(fr).length) payload.frames = fr; } catch (eF) {}
          try { var ft = PV.frameTraces; if (ft && Object.keys(ft).length) payload.framesDirect = ft; } catch (eG) {}
          go();
        });
      } catch (e) { if (!done) { done = true; clearTimeout(to); t.remove(); toast("Couldn't send - reload the page (F5) and report again.", "#F0A83C"); } }
    }, true);
    row.appendChild(send); row.appendChild(no);
    t.appendChild(h); t.appendChild(kindRow); t.appendChild(note); t.appendChild(fullRow); t.appendChild(p); t.appendChild(row);
    document.documentElement.appendChild(t);
    // Click anywhere outside the panel, or Esc, to dismiss it (nothing sent).
    setTimeout(function () {
      var away = function (e) { if (!t.isConnected) { off(); return; } if (t.contains(e.target)) return; off(); t.remove(); toast("Report discarded", "#A3ABB7"); };
      var esc = function (e) { if (e.key === "Escape") { off(); t.remove(); toast("Report discarded", "#A3ABB7"); } };
      var off = function () { removeEventListener("click", away, true); removeEventListener("keydown", esc, true); };
      addEventListener("click", away, true); addEventListener("keydown", esc, true);
      t.__off = off;
    }, 0);
  }
  // While picking, a full-viewport transparent catcher receives the click even
  // over a cross-origin iframe; we briefly drop its pointer-events and read
  // elementFromPoint under the click to get the real element.
  function enterPick() {
    if (pick) { exitPick(); return; }
    var c = document.createElement("div");
    c.setAttribute("data-prism-ui", "1");
    c.style.cssText = "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:#0b0c1410;";
    c.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var x = e.clientX, y = e.clientY;
      c.style.pointerEvents = "none";
      var el = PV.deepElementFromPoint(x, y);
      c.style.pointerEvents = "";
      exitPick();
      // A click on Prism's own UI (pill, chip, panel) is a way OUT, not a pick.
      if (el && el.closest && el.closest("[data-prism-ui]")) { toast("Report cancelled", "#A3ABB7"); return; }
      if (el) doReport(el, { x: x, y: y }); else toast("Couldn't read that spot - try again", "#F0A83C");
    }, true);
    // Right-click cancels (an accidental Report needs a way out that is not a pick).
    c.addEventListener("contextmenu", function (e) { e.preventDefault(); e.stopPropagation(); exitPick(); toast("Report cancelled", "#A3ABB7"); }, true);
    document.documentElement.appendChild(c);
    pick = c;
    if (chip) chip.textContent = "✕ Cancel";
    toast("Click the ad to report it · Esc to cancel", "#F0A83C");
  }
  function unmountChip() {
    if (chip) { if (PV.releaseOnTop) PV.releaseOnTop(chip); try { chip.remove(); } catch (e) {} chip = null; }
    exitPick();
  }
  function mountChip() {
    // Also inside player EMBED frames (the veil runs there): a report sent from
    // inside the player carries that frame's own trace as its diag - the only
    // route that has worked for the Google/YouTube embed (2026-08-29).
    if (chip) return;
    chip = document.createElement("button");
    chip.setAttribute("data-prism-ui", "1");
    chip.textContent = CHIP_LABEL;
    chip.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#12131abb;" +
      "color:#c9cbd6;font:600 11px/1 system-ui,sans-serif;padding:7px 10px;border:1px solid #ffffff22;" +
      "border-radius:8px;cursor:pointer;opacity:.32;transition:opacity .15s;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);";
    chip.addEventListener("mouseenter", function () { chip.style.opacity = "1"; });
    chip.addEventListener("mouseleave", function () { chip.style.opacity = pick ? "1" : ".32"; });
    chip.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); enterPick(); }, true);
    try { document.documentElement.appendChild(chip); } catch (e) {}
    if (PV.keepOnTop) PV.keepOnTop(chip);   // stay above late floating ads at max z-index
  }
  addEventListener("keydown", function (e) { if (e.key === "Escape" && pick) exitPick(); }, true);

  // Prism-wide UI prefs (chrome.storage.local "pv:ui"): the chip is OFF by
  // default and switched on from the Prism button's panel. Live-toggled.
  PV.uiPrefs = {};
  function applyUiPrefs() { if (PV.uiPrefs.reportChip) mountChip(); else unmountChip(); if (PV.applyHud) { try { PV.applyHud(); } catch (e) {} } }
  PV.setUiPref = function (k, v) {
    PV.uiPrefs[k] = v; applyUiPrefs();
    // Not read yet: merge into what is stored rather than write our defaults.
    if (!PV.uiPrefsLoaded) {
      try { chrome.storage.local.get("pv:ui", function (r) { if (chrome.runtime.lastError || !r) return; var cur = r["pv:ui"] || {}; cur[k] = v; chrome.storage.local.set({ "pv:ui": cur }); }); } catch (e0) {}
      return;
    }
    try { chrome.storage.local.set({ "pv:ui": PV.uiPrefs }); } catch (e) {}
  };
  function loadUiPrefs() {
    try {
      // One key per read, and a failed read is retried, never taken as "no
      // prefs". On YouTube in Firefox a get of a key LIST fails every load
      // ("An unexpected error occurred", r undefined; a single-key get at the
      // same moment works) - the prefs read as defaults, so the pause veil
      // came up with "Veil the screen while paused" off (2026-09-23), and a
      // setUiPref from that tab would have written the defaults back.
      var tries = 0;
      (function readUi() {
        chrome.storage.local.get("pv:ui", function (r) {
          if (chrome.runtime.lastError || !r) {
            if (PV.recordError) PV.recordError("ui prefs read failed: " + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || "no result"));
            if (++tries < 6) setTimeout(readUi, 250 * tries);
            return;
          }
          if (!PV.uiPrefsLoaded) PV.uiPrefs = r["pv:ui"] || {};
          PV.uiPrefsLoaded = true;
          // One-time (0.7.164): the "Corner chip" HUD had been switched on by a
          // click on the card's glyph and read as a regression ("the symbol and
          // clock are now at the top left and options ... hidden by default",
          // 2026-09-12). Back to the full card once; the popup's Intermission
          // setting still offers the corner chip deliberately.
          chrome.storage.local.get("pv:hudReset164", function (h) {
            if (chrome.runtime.lastError || !h || h["pv:hudReset164"]) return;
            try { chrome.storage.local.set({ "pv:hudReset164": 1 }); } catch (e0) {}
            if (PV.uiPrefs.hud === "minimal") { PV.uiPrefs.hud = "interactive"; try { chrome.storage.local.set({ "pv:ui": PV.uiPrefs }); } catch (e1) {} applyUiPrefs(); }
          });
          applyUiPrefs();
        });
      })();
      chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:ui"]) { PV.uiPrefs = ch["pv:ui"].newValue || {}; PV.uiPrefsLoaded = true; applyUiPrefs(); } });
    } catch (e) {}
  }

  PV.prismReport = prismReport;
  PV.mountReportChip = loadUiPrefs;
  PV.toast = toast;
})();
