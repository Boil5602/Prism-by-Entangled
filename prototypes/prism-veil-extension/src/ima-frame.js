/*
  Prism - inside Google IMA's ad iframe (imasdk.googleapis.com). The page
  cannot see into this frame, so the Skip button IMA draws here is invisible
  to the veil's cutter. This script watches for it and tells the parent where
  it is (rect within the frame, corner radius, label); the parent cuts the
  hole at the frame's position + that rect, and the human's real click passes
  through the hole into this frame onto the button. Nothing is clicked here.
*/
(function () {
  "use strict";
  if (window === window.top) return;
  var last = "", lastDiag = "", errs = [];
  function say(line) { errs.push(Math.round(performance.now()) + "ms " + line); if (errs.length > 12) errs.shift(); try { window.parent.postMessage({ __prismFrameTrace: 1, href: location.href.slice(0, 120), errs: errs.slice() }, "*"); } catch (e) {} }
  try { window.parent.postMessage({ __prismFrameHello: 1, href: location.href.slice(0, 120) }, "*"); } catch (e) {}
  say("ima-frame up");
  // What the ad UI holds (label-grade), for reports: every button / skip-ish
  // element with its class, size and text - so a Skip that never reached the
  // page can be seen (SOOP, 2026-08-29).
  function diag() {
    var out = [], els = document.querySelectorAll("button,[role=button],[class*='kip']");
    for (var i = 0; i < els.length && out.length < 8; i++) {
      var e = els[i], r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
      out.push(e.tagName + "." + String(e.className || "").slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " '" + ((e.innerText || e.textContent || "") + "").trim().slice(0, 20) + "'");
    }
    var key = out.join(" | ");
    if (key !== lastDiag) { lastDiag = key; say("ui " + (key || "(no buttons)")); }
  }
  // Documents to search: this one plus every nested iframe we can reach
  // (the creative's own frame - SOOP 2026-08-29: Skip sits in a full-size
  // child iframe of the bridge). Each entry carries the frame's offset.
  function docs() {
    var out = [{ doc: document, dx: 0, dy: 0 }], frs = document.querySelectorAll("iframe");
    for (var i = 0; i < frs.length; i++) {
      try { var cd = frs[i].contentDocument; if (!cd || !cd.body) continue; var r = frs[i].getBoundingClientRect(); out.push({ doc: cd, dx: r.left, dy: r.top, host: (frs[i].src || "").replace(/^https?:\/\//, "").slice(0, 60) }); } catch (e) {}
    }
    return out;
  }
  function find() {
    var ds = docs();
    for (var d = 0; d < ds.length; d++) { var hit = findIn(ds[d].doc, ds[d].dx, ds[d].dy); if (hit) return hit; }
    return null;
  }
  function findIn(doc, dx, dy) {
    var cands = doc.querySelectorAll(".videoAdUiSkipButton, .videoAdUiSkipContainer button, [class*='SkipButton'], [class*='skip-button'], [class*='skipButton'], button[aria-label*='skip' i], [role=button][aria-label*='skip' i]");
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i], r = e.getBoundingClientRect();
      if (r.width < 16 || r.height < 12 || r.width > 320 || r.height > 160) continue;
      var cs = (doc.defaultView || window).getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.2) continue;
      if (e.disabled || e.getAttribute("aria-disabled") === "true") continue;
      var txt = ((e.innerText || e.textContent || "") + " " + (e.getAttribute("aria-label") || "")).trim();
      if (!/skip/i.test(txt) && !/skip/i.test(e.className + "")) continue;
      return { x: r.left + dx, y: r.top + dy, w: r.width, h: r.height, radius: parseFloat(cs.borderTopLeftRadius) || 0, label: txt.slice(0, 30) || "Skip" };
    }
    return null;
  }
  function el2s(e) { var r = e.getBoundingClientRect(), cs = getComputedStyle(e); return e.tagName + "#" + (e.id || "").slice(0, 20) + "." + String(e.className || "").slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height) + (cs.cursor === "pointer" ? " ptr" : "") + " '" + ((e.innerText || e.textContent || "") + "").trim().slice(0, 20) + "'"; }
  // The page asks what is at a point (a report's click, translated into this
  // frame): answer with the element stack there plus every visible element
  // that carries text, into the trace ring the report attaches.
  addEventListener("message", function (ev) {
    try {
      var m = ev.data; if (!m || m.__prismProbe !== 1) return;
      var st = document.elementsFromPoint(+m.x, +m.y).slice(0, 8).map(el2s);
      say("probe " + Math.round(+m.x) + "," + Math.round(+m.y) + ": " + st.join(" < "));
      var frs = document.querySelectorAll("iframe");
      for (var fi = 0; fi < frs.length; fi++) {
        var fr = frs[fi], fb = fr.getBoundingClientRect(), src = (fr.src || (fr.hasAttribute("srcdoc") ? "srcdoc" : "")).replace(/^https?:\/\//, "").split(/[?#]/)[0].slice(0, 60);
        var cd = null; try { cd = fr.contentDocument; } catch (e) {}
        if (!cd) { say("nested " + src + " " + Math.round(fb.width) + "x" + Math.round(fb.height) + " unreachable"); continue; }
        try {
          var st2 = cd.elementsFromPoint(+m.x - fb.left, +m.y - fb.top).slice(0, 8).map(el2s);
          say("nested " + src + " probe: " + st2.join(" < "));
          var a2 = cd.querySelectorAll("button,[role=button],[class*='kip'],a"), l2 = [];
          for (var j = 0; j < a2.length && l2.length < 8; j++) { var r2 = a2[j].getBoundingClientRect(); if (r2.width > 0 && r2.height > 0) l2.push(el2s(a2[j])); }
          say("nested ui " + (l2.join(" | ") || "(no buttons)"));
        } catch (e2) { say("nested " + src + " threw " + e2); }
      }
      var all = document.querySelectorAll("*"), txt = [];
      for (var i = 0; i < all.length && txt.length < 8; i++) { var e = all[i]; if (e.children.length) continue; var t = ((e.innerText || e.textContent || "") + "").trim(); if (!t) continue; var r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue; txt.push(el2s(e)); }
      say("text " + (txt.join(" | ") || "(none)"));
    } catch (e) {}
  });
  function tick() {
    try { diag(); } catch (e) {}
    var sk = find(), key = sk ? [Math.round(sk.x), Math.round(sk.y), Math.round(sk.w), Math.round(sk.h)].join(",") : "";
    if (key === last && !sk) return;
    last = key;
    try { window.parent.postMessage({ __prismSkipRect: 1, rect: sk }, "*"); } catch (e) {}
  }
  setInterval(tick, 250);
})();
