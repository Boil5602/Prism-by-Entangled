/*
  PRISM Veil - DISPLAY covers. Paints art over each detected ad element at
  exactly its own rectangle, riding the page's own scroll/clipping. Owns the
  veil registry, the sweep, row-shared art, and the sticky-bar clip.
  Observe-only (spec section 26): the ad still loads; clicks on the art are
  swallowed, never forwarded.
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});

  var veils = new Map();   // ad element -> cover element
  var why = new Map();     // ad element -> the rule that flagged it (report tool)

  // A cover is a plain div dropped into the page, so the page's own rules
  // reach it: PCMag's article column styles its children to max-width 48rem,
  // and a 970px ad's cover came out 768px wide - the right 200px of every
  // in-content ad open and clickable (five reports 2026-09-13). The box
  // properties a page could size us with are pinned inline, !important.
  function hardBox(el) {
    var hard = { "max-width": "none", "max-height": "none", "min-width": "0", "min-height": "0", "margin": "0", "padding": "0", "border": "0", "box-sizing": "border-box", "transform": "none", "float": "none", "clear": "none", "outline": "0" };   // never the inset shorthands: left/top/right/bottom are set per mode
    for (var k in hard) { try { el.style.setProperty(k, hard[k], "important"); } catch (e) {} }
  }
  function styleCover(cover, art, glyph) {
    cover.setAttribute("data-prism-veil", "1");
    hardBox(cover);
    cover.style.background = "#0A0C0F center/cover no-repeat";
    cover.__artUrl = art;
    if (PV.artOnto) PV.artOnto(cover, art); else cover.style.backgroundImage = "url('" + art + "')";
    // Swallow clicks so a tap on the art can't open the covered ad's link.
    cover.style.pointerEvents = "auto";
    cover.style.cursor = "default";
    ["click", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup"].forEach(function (ty) {
      cover.addEventListener(ty, function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    });
    cover.style.overflow = "hidden";
    cover.style.transition = "opacity .2s";
    cover.style.opacity = "0";
    cover.style.display = "flex";
    cover.style.alignItems = "center";
    cover.style.justifyContent = "center";
    cover.style.containerType = "inline-size";
    // The intermission glyph alone, top-left, so a covered banner reads as
    // intentional without a caption over the art (was a centred "Intermission"
    // chip; 2026-09-12 - the VIDEO
    // intermission keeps its centred card, clock and controls). Half-moon for
    // an ad, four-point star for platform-labelled AI content (0.7.148's
    // glyphs), passed in by the sweep.
    var lbl = document.createElement("div");
    lbl.setAttribute("data-prism-veil", "1");
    lbl.textContent = glyph || String.fromCharCode(0x25D0);
    lbl.style.cssText = "position:absolute;top:6px;left:6px;font:600 clamp(9px,4cqi,16px)/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-shadow:0 1px 6px #000;background:rgba(10,12,15,.5);padding:.3em .45em;border-radius:6px;white-space:nowrap;backdrop-filter:blur(2px)";
    // The photo's credit on the symbol, on hover (2026-10-15):
    // read when the pointer arrives, so a photo swapped for a bundled one
    // (a strict page CSP) is credited as the one on screen.
    lbl.style.cursor = "help";
    // 2026-11-11: the card with the small preview in place of the browser's title bubble (lookOpen below)
    // 2026-11-11: the panel with the small view in place of the browser's title bubble (lookOpen below), opened and closed as the
    // video veil's peep is
    var isAi = !!(glyph && glyph !== String.fromCharCode(0x25D0));
    lbl.addEventListener("mouseenter", function () { lookKeep(); if (!(look && look.cover === cover)) { try { lookOpen(cover, lbl, isAi); } catch (e) {} } });
    lbl.addEventListener("mouseleave", lookLeave);
    cover.addEventListener("mousemove", function (ev) { if (look && look.cover === cover && ev.target !== lbl) lookLeave(); });
    cover.appendChild(lbl);
    requestAnimationFrame(function () { cover.style.opacity = "1"; });
  }


  // ---- the look under a display cover (2026-11-11, asked for a small preview of the covered ad or post on the symbol, with the
  // picture's credit, in a card that reads well; then asked for the element's present state, as the video veil's peep shows it).
  // Resting the pointer on the symbol opens a card: what was covered and by which of the page's own signals, the covered element
  // itself, small, and the credit of the picture on the cover. The small view is a KEYHOLE, the video peep's second way
  // (video.js): a hole in the cover (paintClip's holes) and the page's own element scaled down into it for as long as the card is
  // open. It is the live element as it is now, an ad in a frame too; nothing is copied and nothing is loaded again. The hole lies
  // inside the element's own box, since the page's clipping keeps the element there, and the card is laid around the hole. A
  // window in the card over the hole takes the pointer, so nothing under it can be pressed. An inside cover is a child of its
  // element, so there the element's other children are scaled, each to its place; an element with a shadow tree of its own gets
  // a line of text and no view. Closes when the pointer leaves the symbol, on a scroll, when the cover goes, or after 20 s; the
  // sweep leaves a cover alone while its look is open (__lookOn).
  var look = null;
  // The card is the video peep's panel (video.js, 2026-11-07) for a display cover, and behaves as it does (2026-11-11, asked to
  // mirror it): the same dark panel under the symbol, the small view at its top, a Reveal 15 s button at its foot; it stays open
  // while the pointer is on the symbol or on the panel, and closes a quarter second after the pointer leaves both, when the pointer
  // moves elsewhere on the cover, or after twenty seconds.
  var LOOK_BG = "rgba(20,23,28,.92)";
  // One size (2026-11-11, asked for: every panel the same, never one large and one small). The panel is 260 px wide and its view is
  // a frame of LOOK_W x LOOK_H; what is under the cover is shrunk to fit the frame, with blank space at the sides of a tall element
  // and above and below a wide one.
  var LOOK_W = 192, LOOK_H = 108;   // the video peep's size (video.js), asked for the same day
  var LOOK_CSS = ":host{all:initial}" +
    ".card{display:flex;flex-direction:column;width:260px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.12);color:#D7DCE3;font:500 13px/1.35 -apple-system,'Segoe UI',Roboto,sans-serif;cursor:default}" +
    ".pre{display:flex;justify-content:center;overflow:hidden;padding:10px 10px 8px;border-radius:12px 12px 0 0}" +
    ".frame{position:relative;flex:none;width:" + LOOK_W + "px;height:" + LOOK_H + "px}" +
    ".win{position:absolute;border-radius:4px;box-shadow:0 0 0 2000px " + LOOK_BG + "}" +
    ".shade,.edge{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:6px;pointer-events:none}" +
    ".shade{background:rgba(0,0,0,.3)}.edge{box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}" +
    ".card.up{flex-direction:column-reverse}" +
    ".card.up .pre{border-radius:0 0 12px 12px;padding:8px 10px 10px}.card.up .bot{border-radius:12px 12px 0 0;padding:10px 10px 0}" +
    ".pre.plain{background:" + LOOK_BG + "}.note{color:#9AA4B2;font-size:12px}" +
    ".bot{background:" + LOOK_BG + ";border-radius:0 0 12px 12px;padding:0 10px 10px;display:flex;flex-direction:column;gap:8px}" +
    ".bot.only{border-radius:12px;padding-top:10px}" +
    ".t{display:flex;align-items:baseline;gap:8px}.t b{font-size:13.5px;font-weight:600;color:#E8ECF2}.t span{color:#F0A83C;font-size:12.5px}" +
    ".row{display:grid;grid-template-columns:52px 1fr;gap:8px;align-items:baseline}.k{color:#9AA4B2;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase}.v{color:#E8ECF2;overflow-wrap:anywhere;min-width:0}" +
    ".rule{height:1px;background:rgba(255,255,255,.1)}" +
    "button{cursor:pointer;font:600 13px -apple-system,'Segoe UI',Roboto,sans-serif;color:#0A0C0F;background:#F0A83C;border:0;border-radius:9px;padding:7px 14px;align-self:flex-start;margin-top:2px}";
  // what was covered and why, in words, from the rule's own reason (data-prism-why)
  PV.coverWhy = function (reason, ai) {
    reason = String(reason || "");
    var d = reason.replace(/^[a-z0-9-]+:\s*/i, "");
    if (ai) return { kind: "Labelled AI content", source: "The platform's own label" + (d ? ": " + d : "") };
    if (/^facebook-suggested/.test(reason)) return { kind: "A suggested post", source: /Interested/.test(d) ? "Facebook's own Interested and Not interested buttons on the post" : "Facebook's own " + (/Join/.test(d) ? "Join" : "Follow") + " button in the post's header" };
    if (/^facebook-sponsored/.test(reason)) return { kind: "An ad", source: "Facebook's own Sponsored or Ad label in the post's header" };
    if (/^(badge-label|section-label)/.test(reason)) return { kind: "An ad", source: "The page's own label" + (d ? ": " + d : "") };
    if (/^(slot-selector|ad-stack)/.test(reason)) return { kind: "An ad", source: "An ad slot in the page" };
    return { kind: "An ad", source: d || reason || "The page's own markers" };
  };
  // Where the small view goes: the element's box tr scaled to fit maxW x maxH (never enlarged), placed in the part of the box that is
  // on the screen (vis), `dx`,`dy` in from that part's corner where there is room. Returns { k, x, y, w, h } in viewport px.
  PV.lookHole = function (tr, vis, maxW, maxH, dx, dy) {
    var k = Math.min(maxW / tr.width, maxH / tr.height, 1), w = tr.width * k, h = tr.height * k;
    var x = Math.max(vis.left, Math.min(vis.left + dx, vis.right - w)), y = Math.max(vis.top, Math.min(vis.top + dy, vis.bottom - h));
    return { k: k, x: x, y: y, w: w, h: h };
  };
  // A picture's credit set out in rows (2026-11-11, asked for: it ran together in one line). The credit is a title on its first
  // line, then parts joined by a middle dot: "Photo: <who>", the license, the source (art-credits.js). Each part gets its own row.
  PV.creditParts = function (credit) {
    var lines = String(credit || "").split("\n"), out = [];
    if (lines[0]) out.push(["Picture", lines[0].trim()]);
    lines.slice(1).join(" \u00B7 ").split(" \u00B7 ").forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = /^Photo:\s*(.+)$/i.exec(part);
      if (m) out.push(["Photo", m[1]]);
      else if (/^(public domain|cc[ -]|creative commons)/i.test(part)) out.push(["License", part]);
      else out.push(["Source", part]);
    });
    return out;
  };
  // Where the panel and its view go along one axis. The panel is `size` long and holds a frame `F` long that starts `f` in from the
  // panel's edge; the view, `len` long, lies in the frame `a` in from the frame's edge. Two things must hold: the panel is on a
  // screen `screen` long with 6 px to spare, and the view is inside [lo, hi] (the element's part on the screen). The view is in the
  // middle of the frame where that can be, the panel at `pref` where that can be. Returns { p, a }, or null when no place does both.
  PV.lookPlace = function (pref, f, size, F, len, lo, hi, screen) {
    var pMax = screen - size - 6, aLo = Math.max(0, lo - f - pMax), aHi = Math.min(F - len, hi - len - f - 6);
    if (pMax < 6 || aLo > aHi) return null;
    var a = Math.max(aLo, Math.min((F - len) / 2, aHi));
    var pLo = Math.max(6, lo - f - a), pHi = Math.min(pMax, hi - len - f - a);
    if (pLo > pHi) return null;
    return { p: Math.max(pLo, Math.min(pref, pHi)), a: a };
  };
  function lookCredit(cover) {
    try {
      var f = String(cover.__artUrl || "").split(/[\/?#]/).filter(Boolean);
      var name = f.length ? decodeURIComponent(f[f.length - 1]) : "";
      return (PV.ART_CREDITS && PV.ART_CREDITS[name]) || "";
    } catch (e) { return ""; }
  }
  var LOOK_PROPS = ["transform", "transform-origin", "transition", "display"];
  var lookLeaveT = 0;
  function lookKeep() { if (lookLeaveT) { clearTimeout(lookLeaveT); lookLeaveT = 0; } }
  function lookLeave() { lookKeep(); lookLeaveT = setTimeout(function () { lookLeaveT = 0; lookClose(); }, 250); }
  // Reveal 15 s, the video peep's button: the cover is hidden for that long and comes back by itself
  function lookReveal(cover, ms) {
    lookClose();
    try {
      cover.style.setProperty("visibility", "hidden", "important");
      clearTimeout(cover.__revealT); cover.__revealT = setTimeout(function () { try { cover.style.removeProperty("visibility"); } catch (e) {} }, ms);
    } catch (e2) {}
  }
  PV.lookReveal = lookReveal;
  function lookClose() {
    lookKeep();
    var l = look; look = null; if (!l) return;
    clearTimeout(l.timer); clearInterval(l.watch);
    try { removeEventListener("scroll", lookClose, true); } catch (e) {}
    try { l.host.remove(); } catch (e2) {}
    (l.moved || []).forEach(function (m) {
      LOOK_PROPS.forEach(function (p, i) { try { if (m.saved[i][0]) m.el.style.setProperty(p, m.saved[i][0], m.saved[i][1]); else m.el.style.removeProperty(p); } catch (e3) {} });
    });
    l.cover.__lookOn = false; l.cover.__lookBox = null;
    try { paintClip(l.cover); } catch (e4) {}
  }
  // The children of an inside cover's element that are scaled into the small view. A child laid out as display:contents has no box
  // of its own, so a transform on it does nothing (Facebook wraps a feed post in one, seen live 2026-11-11: the view showed the
  // post's corner at full size): its children are taken in its place, a few levels down at most.
  function lookMovers(el, depth) {
    var out = [];
    Array.prototype.forEach.call(el.children, function (c) {
      if (c.hasAttribute("data-prism-veil") || c.hasAttribute("data-prism-ui")) return;
      var contents = false; try { contents = getComputedStyle(c).display === "contents"; } catch (e) {}
      if (contents && depth < 6) out = out.concat(lookMovers(c, depth + 1)); else out.push(c);
    });
    return out;
  }
  function lookOpen(cover, lbl, ai) {
    lookClose();
    if (!cover.isConnected) return;
    var mk = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    var target = cover.__target, tr = null, movers = null, note = "";
    try {
      tr = target.getBoundingClientRect();
      if (cover.__mode === "inside") movers = target.shadowRoot ? null : lookMovers(target, 0);
      else movers = [target];
    } catch (e0) { movers = null; }
    var vis = tr ? { left: Math.max(tr.left, 0), top: Math.max(tr.top, 0), right: Math.min(tr.right, innerWidth), bottom: Math.min(tr.bottom, innerHeight) } : null;
    if (!movers || !movers.length || !tr || tr.width < 20 || tr.height < 20 || vis.right - vis.left < 20 || vis.bottom - vis.top < 20) { movers = null; note = "No small view for this one."; }
    // the small view can be switched off in the popup (pv:ui.smallView, on unless set false; 2026-11-11, asked for it on by default
    // with a way to turn it off): the panel then has its words and its Reveal button, and nothing on the page is moved
    var viewOff = !!(PV.uiPrefs && PV.uiPrefs.smallView === false); if (viewOff) movers = null;
    // under the symbol, as the video peep's panel is: the panel 8 px below it, its view 10 px in
    var lr0 = lbl.getBoundingClientRect();
    // no larger than the part of the element that is on the screen: an element half off the screen gets a smaller view, not none
    var hole = movers ? PV.lookHole(tr, vis, Math.min(LOOK_W, vis.right - vis.left - 24), Math.min(LOOK_H, vis.bottom - vis.top - 24), lr0.left - vis.left + 10, lr0.bottom - vis.top + 18) : null;

    var host = document.createElement("div");
    host.setAttribute("data-prism-ui", "1"); host.setAttribute("data-prism-look", "1"); host.setAttribute("aria-hidden", "true");
    hardBox(host);
    var hs = { position: "fixed", left: "0", top: "0", "z-index": "2147483647", "pointer-events": "auto", display: "block", opacity: "1", visibility: "visible", background: "none" };
    for (var k in hs) host.style.setProperty(k, hs[k], "important");
    var root = host.attachShadow({ mode: "closed" });
    var st = document.createElement("style"); st.textContent = LOOK_CSS; root.appendChild(st);
    var w = PV.coverWhy(cover.getAttribute("data-prism-why"), ai);
    var card = mk("div", "card"), t = mk("div", "t");
    var pre = mk("div", "pre"), win = null, frame = null, shade = null;
    if (hole) {
      win = mk("div", "win"); win.style.width = hole.w.toFixed(1) + "px"; win.style.height = hole.h.toFixed(1) + "px";
      ["click", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup", "contextmenu"].forEach(function (ty) { win.addEventListener(ty, function (e) { e.preventDefault(); e.stopPropagation(); }, true); });
      // the frame is always LOOK_W x LOOK_H; the view inside it has the element's shape, the rest of the frame is blank
      frame = mk("div", "frame"); shade = mk("div", "shade");
      frame.appendChild(win); frame.appendChild(shade); frame.appendChild(mk("div", "edge")); pre.appendChild(frame);
    } else { pre.className = "pre plain"; pre.appendChild(mk("div", "note", note)); }
    if (!viewOff) card.appendChild(pre);
    var bot = mk("div", viewOff ? "bot only" : "bot");
    t.appendChild(mk("b", "", "Covered by PRISM")); t.appendChild(mk("span", "", w.kind)); bot.appendChild(t);
    var row = function (key, val) { var r = mk("div", "row"); r.appendChild(mk("span", "k", key)); r.appendChild(mk("span", "v", val)); bot.appendChild(r); };
    row("Why", w.source);
    var credit = lookCredit(cover);
    if (credit) { bot.appendChild(mk("div", "rule")); PV.creditParts(credit).forEach(function (kv) { row(kv[0], kv[1]); }); }
    var reveal = mk("button", "", "Reveal 15 s"); reveal.type = "button"; reveal.title = "Shows what is under the cover for fifteen seconds, then the cover comes back";
    reveal.addEventListener("click", function (ev) { ev.stopPropagation(); lookReveal(cover, 15000); });
    bot.appendChild(reveal);
    card.appendChild(bot); root.appendChild(card);
    host.addEventListener("mouseenter", lookKeep); host.addEventListener("mouseleave", lookLeave);
    document.documentElement.appendChild(host);

    var moved = [];
    try {
      var hr = host.getBoundingClientRect(), x, y;
      var ox = 0, oy = 0;
      if (hole) {
        // The panel never leaves the screen (2026-11-11, asked for). Two things must hold at once: the view lies inside the part of
        // the element that is on the screen, and the whole panel is on the screen (PV.lookPlace). The panel opens under the symbol
        // with its frame at the top; where that leaves no place (an element at the bottom edge), the frame goes to the panel's foot
        // with the words above it. Where no way fits both, the panel opens on the screen without its view.
        var off = function () { var a = host.getBoundingClientRect(), b = frame.getBoundingClientRect(); return { x: b.left - a.left, y: b.top - a.top, w: a.width, h: a.height }; };
        var m = off(), px = PV.lookPlace(lr0.left, m.x, m.w, LOOK_W, hole.w, vis.left, vis.right, innerWidth);
        var py = PV.lookPlace(lr0.bottom + 8, m.y, m.h, LOOK_H, hole.h, vis.top, vis.bottom, innerHeight);
        if (py === null) { card.classList.add("up"); m = off(); py = PV.lookPlace(lr0.top - m.h - 8, m.y, m.h, LOOK_H, hole.h, vis.top, vis.bottom, innerHeight); }
        if (px === null || py === null) { card.classList.remove("up"); pre.style.display = "none"; bot.className = "bot only"; hole = null; }
        else {
          x = px.p; y = py.p; ox = m.x + px.a; oy = m.y + py.a;
          win.style.left = px.a.toFixed(1) + "px"; win.style.top = py.a.toFixed(1) + "px";
          // the blank part of the frame is a shade darker than the panel, so the frame reads as one box
          var q = function (n) { return n.toFixed(1) + "px"; }, x0 = q(px.a), y0 = q(py.a), x1 = q(px.a + hole.w), y1 = q(py.a + hole.h);
          shade.style.clipPath = "polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, " + x0 + " " + y0 + ", " + x0 + " " + y1 + ", " + x1 + " " + y1 + ", " + x1 + " " + y0 + ", " + x0 + " " + y0 + ")";
        }
      }
      if (!hole) {
        var lr = lbl.getBoundingClientRect(); hr = host.getBoundingClientRect();
        x = lr.left; y = lr.bottom + 8;
        if (y + hr.height > innerHeight - 6) y = lr.top - hr.height - 8;
        x = Math.max(6, Math.min(x, innerWidth - hr.width - 6)); y = Math.max(6, Math.min(y, innerHeight - hr.height - 6));
      }
      host.style.setProperty("left", Math.round(x) + "px", "important"); host.style.setProperty("top", Math.round(y) + "px", "important");
      if (hole) {
        hole.x = Math.round(x) + ox; hole.y = Math.round(y) + oy;
        var cr = cover.getBoundingClientRect();
        cover.__lookOn = true;
        cover.__lookBox = { x0: hole.x - cr.left, y0: hole.y - cr.top, x1: hole.x - cr.left + hole.w, y1: hole.y - cr.top + hole.h };
        paintClip(cover);
        movers.forEach(function (el) {
          var er = el.getBoundingClientRect();
          var tx = hole.x + (er.left - tr.left) * hole.k - er.left, ty = hole.y + (er.top - tr.top) * hole.k - er.top;
          moved.push({ el: el, saved: LOOK_PROPS.map(function (p) { return [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; }) });
          el.style.setProperty("transition", "none", "important");
          // a transform does nothing on an inline box: it is made an inline block for as long as the view is open
          try { if (getComputedStyle(el).display === "inline") el.style.setProperty("display", "inline-block", "important"); } catch (eD) {}
          el.style.setProperty("transform-origin", "0 0", "important");
          el.style.setProperty("transform", "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + hole.k.toFixed(4) + ")", "important");
        });
      }
    } catch (e) {}
    // what the small view did, kept on the cover for a report (2026-11-12: three reports of a cover with no small view said
    // nothing about why): shapes and numbers only, never the page's text
    try {
      var R4 = function (r) { return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; };
      cover.__lookDiag = {
        note: note || null, off: viewOff, hole: hole ? { k: +hole.k.toFixed(3), x: Math.round(hole.x), y: Math.round(hole.y), w: Math.round(hole.w), h: Math.round(hole.h) } : null,
        target: R4(tr), screen: [innerWidth, innerHeight], symbol: R4(lr0), moved: moved.length,
        movers: (movers || []).slice(0, 6).map(function (el) {
          var cs = getComputedStyle(el), up = el.parentElement, clip = 0, tf = 0;
          for (var n = 0; up && n < 30; n++, up = up.parentElement) { var us = getComputedStyle(up); if (us.overflow !== "visible" || us.contain !== "none") clip++; if (us.transform !== "none") tf++; }
          return { tag: el.tagName, display: cs.display, position: cs.position, box: R4(el.getBoundingClientRect()), kids: el.children.length, clipsAbove: clip, transformsAbove: tf, applied: (el.style.transform || "").slice(0, 60) };
        }),
      };
    } catch (eDiag) { cover.__lookDiag = { error: String(eDiag).slice(0, 80) }; }
    look = { host: host, cover: cover, moved: moved, timer: setTimeout(lookClose, 20000), watch: setInterval(function () { if (!cover.isConnected) lookClose(); }, 500) };
    addEventListener("scroll", lookClose, true);
  }
  PV.lookOpen = lookOpen; PV.lookClose = lookClose;

  // Correct a parent-mode cover by measurement: offsets lie when a transform
  // sits between the target and its offsetParent (YouTube Shorts).
  // The glyph at the cover's VISIBLE top-left (2026-11-04, a report from Yahoo News: a Taboola unit 19 px wider than the overflow-hidden
  // wrapper around it, so the page clipped the cover's left edge and half the half-moon with it). Every ancestor that clips (an
  // overflow other than visible) cuts the cover's box down to its own; the glyph moves in by what was cut, never past the far edge.
  PV.glyphInset = function (coverRect, clipRects) {
    var dx = 0, dy = 0;
    for (var i = 0; i < clipRects.length; i++) { var c = clipRects[i]; dx = Math.max(dx, c.left - coverRect.left); dy = Math.max(dy, c.top - coverRect.top); }
    return { dx: Math.round(Math.min(dx, Math.max(0, coverRect.width - 40))), dy: Math.round(Math.min(dy, Math.max(0, coverRect.height - 30))) };
  };
  function placeGlyph(cover) {
    try {
      var lbl = cover.firstElementChild; if (!lbl) return;
      var cr = cover.getBoundingClientRect(); var clips = []; var p = cover.parentElement; var d = 0;
      while (p && p !== document.documentElement && d < 24) {
        var cs = getComputedStyle(p);
        if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") clips.push(p.getBoundingClientRect());
        p = p.parentElement; d++;
      }
      var o = PV.glyphInset(cr, clips);
      lbl.style.left = (6 + o.dx) + "px"; lbl.style.top = (6 + o.dy) + "px";
    } catch (e) {}
  }

  function trueUp(cover, target) {
    placeGlyph(cover);
    try {
      var tr = target.getBoundingClientRect(), cr = cover.getBoundingClientRect();
      var dx = tr.left - cr.left, dy = tr.top - cr.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { cover.style.left = (target.offsetLeft + dx) + "px"; cover.style.top = (target.offsetTop + dy) + "px"; }
    } catch (e) {}
  }

  /**
   * Place the cover INSIDE the page near the ad: inside the ad element itself;
   * else inside its offsetParent at the ad's offset box; last resort a
   * document overlay (the only mode that needs per-scroll work).
   */
  // The MSN infopane is a rotating article SLIDER; one slide can be a native ad.
  // Its pager (a small centered [role=tablist] at the card's bottom) is a
  // SEPARATE sibling overlay, not part of the ad card - so rather than leave a
  // strip of ad uncovered, we cover the card FULLY and RAISE the pager above the
  // veil. The viewer pages to a (safe) article with no ad showing at all. On
  // uncover the pager's original stacking is restored (refcounted, since the
  // pager is shared across slides).
  function infopaneNav(target) {
    var n = target, d = 0;
    while (n && d < 16) { if (n.tagName === "CS-RESPONSIVE-INFOPANE") break; n = PV.parentAcross(n); d++; }
    if (!n || n.tagName !== "CS-RESPONSIVE-INFOPANE") return null;
    try { return (n.shadowRoot || n).querySelector(".navigation, [role=tablist]"); } catch (e) { return null; }
  }
  function raisePager(target, cover) {
    if (!/infopane/i.test(target.id || "")) return;
    var nav = infopaneNav(target); if (!nav) return;
    if (nav.__prismRaise === undefined) nav.__prismRaise = { z: nav.style.zIndex, pos: nav.style.position, n: 0 };
    nav.__prismRaise.n++;
    try { if (getComputedStyle(nav).position === "static") nav.style.position = "relative"; nav.style.zIndex = "2147483000"; } catch (e) {}
    cover.__pager = nav;
  }
  function lowerPager(cover) {
    var nav = cover.__pager; if (!nav) return; cover.__pager = null;
    if (!nav.__prismRaise) return;
    if (--nav.__prismRaise.n <= 0) { try { nav.style.zIndex = nav.__prismRaise.z; nav.style.position = nav.__prismRaise.pos; } catch (e) {} delete nav.__prismRaise; }
  }

  // Position an overlay cover over its target. A position:fixed target (Fox's
  // collapsed STICKY masthead ad) needs a FIXED cover glued to the viewport - an
  // absolute one offset by page scroll drifts off it as you scroll.
  function isFixedTarget(el) {
    try { for (var n = el, d = 0; n && d < 6; d++, n = n.parentElement) { if (getComputedStyle(n).position === "fixed") return true; } } catch (e) {}
    return false;
  }
  function positionOverlay(cover, target) {
    // Fullscreen paints only the fullscreen element's subtree: an overlay
    // cover for a target inside it must live inside it too (and come back).
    try {
      var fs = document.fullscreenElement || document.webkitFullscreenElement;
      var host = (fs && (fs === target || fs.contains(target))) ? fs : document.documentElement;
      if (cover.parentNode !== host) host.appendChild(cover);
    } catch (eF) {}
    var r = target.getBoundingClientRect();
    if (isFixedTarget(target)) {
      cover.style.position = "fixed"; cover.style.left = r.left + "px"; cover.style.top = r.top + "px"; cover.__fixed = true;
    } else {
      cover.style.position = "absolute"; cover.style.left = (r.left + scrollX) + "px"; cover.style.top = (r.top + scrollY) + "px"; cover.__fixed = false;
    }
    cover.style.width = r.width + "px"; cover.style.height = r.height + "px";
  }

  // Drop a slot cover the moment its element balloons to page size - in the
  // same frame, not at the next sweep (MSN's .ad-banner-wrapper: the art
  // "bled out" full page for up to a second, 2026-08-29).
  var growRO = null;
  function watchGrowth(t, cover) {
    if (!/^slot-selector/.test(why.get(t) || "")) return;
    try {
      if (!growRO && typeof ResizeObserver !== "undefined") growRO = new ResizeObserver(function (entries) {
        entries.forEach(function (en) {
          var el = en.target, cv = veils.get(el); if (!cv) { try { growRO.unobserve(el); } catch (e) {} return; }
          var r = el.getBoundingClientRect();
          if (PV.pageSized(r)) {
            el.__prismTooBigAt = Date.now();
            if (PV.recordError && !cv.__prismBigLogged) { cv.__prismBigLogged = true; PV.recordError("cover dropped (grew) " + Math.round(r.width) + "x" + Math.round(r.height) + " " + el.tagName + "." + PV.classStr(el).slice(0, 40)); }
            lowerPager(cv); cv.remove(); veils.delete(el); unmuteUnder(el);
            try { growRO.unobserve(el); } catch (e) {}
          }
        });
      });
      if (growRO) growRO.observe(t);
    } catch (e) {}
  }
  function makeCover(target, glyph) {
    var art = PV.pickArt();
    var cover = document.createElement("div");
    cover.__target = target;   // for the look under the cover (lookOpen)
    // __prismForceOverlay: a deeply-layered ad unit (Fox's masthead stacks a
    // video + click-layer above a normal inside cover). Skip inside/parent modes
    // and go straight to a top-level overlay, which paints above all of it.
    // A shadow host takes an inside cover only through a default <slot> and only when the cover then fills the host exactly (2026-11-04,
    // Reddit's ad cards are shadow hosts: their covers went to the top layer, where a sticky header is clipped around them by script a
    // frame late; inside the card the page's own header paints over the cover with no lag)
    var slotted = false;
    if (target.shadowRoot) { try { slotted = !!target.shadowRoot.querySelector("slot:not([name])"); } catch (e0) {} }
    if (!target.__prismForceOverlay && target.tagName !== "IFRAME" && (!target.shadowRoot || slotted) && getComputedStyle(target).display !== "contents") {
      try {
        if (getComputedStyle(target).position === "static") target.style.position = "relative";
        // Cage the cover's z-index INSIDE the slot (same fix as the host,
        // 2026-08-31): a full-width background ad's cover (Twitch headliner)
        // otherwise paints over content the page floats above it - the live
        // carousel. isolation only contains OUR z; the slot's own stacking
        // against its siblings is untouched.
        target.style.isolation = "isolate";
        cover.style.position = "absolute";
        cover.style.left = cover.style.top = cover.style.right = cover.style.bottom = "0";
        cover.style.zIndex = "2000000000";  // above ad content, below the pager (2147483000) and the pill
        styleCover(cover, art, glyph);
        target.appendChild(cover);
        cover.__mode = "inside";
        // An inside cover must actually take its element's box. A custom
        // element that lays out like display:contents (YouTube's
        // ytd-in-feed-ad-layout-renderer) reports its children's union as its
        // rect but gives an absolute child NO containing block - the cover came
        // out 0 px wide three reloads running (Firefox, 2026-08-29). Verify,
        // and fall through to the parent/overlay modes if it did not take.
        var tr0 = target.getBoundingClientRect(), cr0 = cover.getBoundingClientRect();
        var fit = slotted ? 0.97 : 0.5;   // through a slot the containing block may be the shadow tree's, not the host's: only an exact fit stays
        if (tr0.width >= 60 && (cr0.width < tr0.width * fit || cr0.height < tr0.height * fit || (slotted && (Math.abs(cr0.left - tr0.left) > 3 || Math.abs(cr0.top - tr0.top) > 3)))) { cover.remove(); cover.__mode = null; }
        else { placeGlyph(cover); return cover; }
      } catch (e) { /* fall through */ }
    }
    var op = target.__prismForceOverlay ? null : target.offsetParent;
    if (op && op !== document.body && op !== document.documentElement) {
      cover.style.position = "absolute";
      cover.style.left = target.offsetLeft + "px";
      cover.style.top = target.offsetTop + "px";
      cover.style.width = target.offsetWidth + "px";
      cover.style.height = target.offsetHeight + "px";
      cover.style.zIndex = "2000000000";
      styleCover(cover, art, glyph);
      op.appendChild(cover);
      cover.__mode = "parent"; cover.__op = op;
      trueUp(cover, target);
      return cover;
    }
    positionOverlay(cover, target);
    cover.style.zIndex = "2147483647";  // max: a forced overlay must beat a max-z-index floating ad (Daily Mail sticky video)
    styleCover(cover, art, glyph);
    document.documentElement.appendChild(cover);
    cover.__mode = "overlay";
    return cover;
  }

  // ---- overlay-mode covers: clip under a sticky top bar (never fade - a
  // translucent cover shows the ad through it).
  var barTop = 0, barEl = null, anyOverlay = false;
  // ... and a bar fixed to the BOTTOM of the viewport (MSN's article page, report
  // 2026-10-15): covers clip above it as they clip under a top bar.
  var botTop = 0, botEl = null;
  // (jpmasthead / jpfixed / jpstage: Jetpack's collapsed masthead is a fixed,
  // full-width, opaque strip - the ad, not the site's header; Fox 2026-09-11.)
  var AD_BAND_CLS = /(^|[\s_-])(ad|ads|adv|advert|advertisement|ad-slot|adslot|adSlot|ad-slot-header|sponsor|jpmasthead|jpfixed|jpstage)([\s_-]|$)/i;
  // Does this element (or a wrapper within 2 levels) paint a solid background?
  function paintsOpaque(e) {
    var n = e, d = 0;
    while (n && d < 3) {
      var cs = getComputedStyle(n);
      var m = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/.exec(cs.backgroundColor || "");
      if (m && (m[1] === undefined || parseFloat(m[1]) >= 0.5)) return true;
      if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
      if (cs.backdropFilter && cs.backdropFilter !== "none") return true;
      n = n.parentElement; d++;
    }
    // ... or a child of (about) its own box paints it (2026-11-04, Reddit: <reddit-header-large> is the fixed strip and transparent, its
    // <header> inside it, across its shadow root, is the white; the bar went unseen and covers scrolled over the search box)
    try {
      var r = e.getBoundingClientRect(), kids = [];
      var add = function (n) { [].slice.call(n.children || []).forEach(function (c) { kids.push(c); }); if (n.shadowRoot) [].slice.call(n.shadowRoot.children || []).forEach(function (c) { kids.push(c); }); };
      add(e);
      for (var i = 0; i < kids.length && i < 24; i++) {
        var k = kids[i], kr = k.getBoundingClientRect();
        if (getComputedStyle(k).display === "contents") { add(k); continue; }   // a wrapper with no box of its own (Reddit's action-items)
        if (kr.width < r.width * 0.9 || kr.height < r.height * 0.8) continue;
        var kc = getComputedStyle(k), km = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/.exec(kc.backgroundColor || "");
        if (km && (km[1] === undefined || parseFloat(km[1]) >= 0.5)) return true;
        if (kc.backgroundImage && kc.backgroundImage !== "none") return true;
      }
    } catch (x) {}
    return false;
  }
  // Two halves. scanBarCandidates (at the sweep) walks the tree for every
  // fixed / sticky, wide, opaque, non-ad strip - including a sticky nav that
  // is NOT stuck yet (position:sticky computes as sticky regardless). pickTopBar
  // (at the sweep AND on every scroll, cheap: it only measures the candidates)
  // chooses the one at the top of the viewport right now. It used to be one
  // walk at sweep time that also required top <= 2, so CBS News's nav - sticky
  // only once you scroll past the masthead - was never the bar, and covers
  // rode over it as the page scrolled (report 2026-09-13, topBar empty).
  var barCands = [];
  function scanBarCandidates() {
    barCands = [];
    if (!document.body) return;
    // Walk the light tree AND every open shadow root: MSN's sticky search bar
    // lives inside a shadow root, so a body-only walk never found it and the
    // covers scrolled over it (reported 2026-08-28; same fix as the earlier
    // shadow-hosted masthead).
    var roots = [document.body];
    try { if (PV.collectRoots) roots = roots.concat(PV.collectRoots()); } catch (e) {}
    var budget = 6000;
    for (var ri = 0; ri < roots.length && budget > 0; ri++) {
      var all; try { all = roots[ri].querySelectorAll("*"); } catch (e) { continue; }
      for (var i = 0; i < all.length && budget-- > 0; i++) {
        var e = all[i];
        if (e.hasAttribute("data-prism-veil") || e.hasAttribute("data-prism-ui")) continue;
        var cs = getComputedStyle(e);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        var r = e.getBoundingClientRect();
        if (r.width < innerWidth * 0.5 || r.height <= 0 || r.height > innerHeight * 0.4) continue;
        // Not a bar: an ad-slot band (CNN's sticky .ad-slot-header - transparent
        // except the banner in the middle; clipping covers under it exposed the
        // page's ads, Firefox report 2026-08-28), or a strip that paints no
        // opaque background (nothing to hide under).
        if (AD_BAND_CLS.test(PV.classStr(e) + " " + (e.id || ""))) continue;
        if (!paintsOpaque(e)) continue;
        barCands.push(e);
        if (barCands.length >= 12) break;
      }
    }
    // The strips at the viewport's top and bottom edges, by a deep hit-test:
    // what is drawn there, walked up to its fixed / sticky ancestor. Cheap, and
    // it finds a bar the walk above never reaches (its budget runs out in MSN's
    // dozens of shadow roots before the header's).
    try {
      [3, innerHeight - 3].forEach(function (y) {
        [0.2, 0.5, 0.8].forEach(function (fx) {
          var n = deepHit(innerWidth * fx, y), d = 0;
          for (; n && d < 40; n = PV.parentAcross(n), d++) {
            if (n === document.body || n === document.documentElement || n.nodeType !== 1) break;
            if (n.hasAttribute("data-prism-veil") || n.hasAttribute("data-prism-ui")) break;
            var cs = getComputedStyle(n);
            if (cs.position !== "fixed" && cs.position !== "sticky") continue;
            var r = n.getBoundingClientRect();
            if (r.width < innerWidth * 0.5 || r.height <= 0 || r.height > innerHeight * 0.4) break;
            if (!paintsOpaque(n)) break;
            if (barCands.indexOf(n) < 0) barCands.push(n);
            break;
          }
        });
      });
    } catch (eD) {}
  }
  // The topmost page element at a point, through open shadow roots, PRISM's
  // own layers skipped at every level.
  function deepHit(x, y) {
    var pick = function (list) { for (var i = 0; i < list.length; i++) { if (list[i].hasAttribute && (list[i].hasAttribute("data-prism-veil") || list[i].hasAttribute("data-prism-ui"))) continue; return list[i]; } return null; };
    var el = pick(document.elementsFromPoint(x, y)), guard = 0;
    while (el && el.shadowRoot && guard++ < 30) {
      var inner = pick(el.shadowRoot.elementsFromPoint(x, y));
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }
  function pickTopBar() {
    var t = 0, el = null;
    for (var i = 0; i < barCands.length; i++) {
      var e = barCands[i];
      if (!e.isConnected) continue;
      var r = e.getBoundingClientRect();
      if (r.width < innerWidth * 0.5 || r.height <= 0 || r.height > innerHeight * 0.4) continue;
      if (r.top > 2 || r.bottom <= t) continue;
      // Anything holding a veiled ad is the ad, not the bar - and so is
      // anything INSIDE one: PCMag's top-anchored Pogo unit is a fixed
      // [aria-label=Advertisement] box whose opaque inner div was taken for
      // the site's bar, and the unit's own cover was then clipped under it to
      // nothing (report 2026-09-13: clipPath inset(345.8px), the ad in full view).
      if (adIsBar(e, r)) continue;
      t = r.bottom; el = e;
    }
    barTop = t; barEl = t ? el : null;
    PV.topBar = { top: barTop, el: barEl };
    // the bottom bar: the highest top among the fixed strips that reach the
    // viewport's bottom edge
    var b = innerHeight, bel = null;
    for (var j = 0; j < barCands.length; j++) {
      var e2 = barCands[j];
      if (!e2.isConnected) continue;
      var r2 = e2.getBoundingClientRect();
      if (r2.width < innerWidth * 0.5 || r2.height <= 0 || r2.height > innerHeight * 0.4) continue;
      if (r2.bottom < innerHeight - 2 || r2.top < innerHeight * 0.5 || r2.top >= b) continue;
      if (getComputedStyle(e2).position !== "fixed") continue;   // a sticky footer sits in the flow until it sticks; only a fixed one rides the bottom
      if (adIsBar(e2, r2)) continue;
      b = r2.top; bel = e2;
    }
    botTop = bel ? b : innerHeight; botEl = bel;
    PV.bottomBar = { top: bel ? botTop : 0, el: botEl };
  }
  // A strip holding a veiled ad is the ad, not the bar, when the ad IS the
  // strip: the strip is the covered element, lies inside it (PCMag's Pogo unit,
  // whose opaque inner div was taken for the site's bar: report 2026-09-13), or
  // the ad spans most of its width. A wide bar with a banner IN it is still the
  // page's bar: MSN's article header carries its top banner, and refusing it
  // let every cover scroll over the header (report 2026-10-15).
  function adIsBar(e, r) {
    var is = false;
    veils.forEach(function (c, tgt) {
      if (is) return;
      if (tgt === e || PV.deepContains(tgt, e)) { is = true; return; }
      if (PV.deepContains(e, tgt)) { var tr = tgt.getBoundingClientRect(); if (tr.width >= r.width * 0.8) is = true; }
    });
    return is;
  }
  function findTopBar() { scanBarCandidates(); pickTopBar(); }
  // ---- the ad's own close control stays reachable THROUGH the cover.
  // Many units carry an X (Jetpack's masthead strip, sticky footers, AdChoices
  // closes). PRISM clicks nothing (spec section 26) - but the person's own
  // click on the page's own X is theirs to make, and once the ad is gone the
  // cover goes with it (the sweep drops a cover whose element is hidden). So
  // the cover is cut away over the X: a clip-path hole hit-tests, so the real
  // click lands on the control itself - no synthetic event, no forwarding.
  // Only a control that plainly says close / dismiss (aria-label, title, id
  // or a class token) or reads as a lone x / multiplication-sign glyph, at
  // most 64px a side, and that a hit-test at its centre actually reaches once
  // PRISM's own layers are skipped (a click-layer over it means a click there
  // would open the advertiser: no hole).
  // Two kinds of candidate, each small (at most 64px a side) and each still
  // subject to the hit-test:
  //   - it says so: close / dismiss in aria-label, title, id or a class token,
  //     or a lone x / multiplication-sign glyph;
  // - Jetpack (Fox's masthead, 2026-09-12): its controls are `*_ButtonModule_*` modules - the
  // full-size ones are the click-layers, the small ones its collapse /
  // close / sound buttons, and every one of those is the person's to press.
  // A token STARTING with close counts (Jetpack's X on Fox is class
  // "closeleavebehind", report 2026-09-12; closeBtn, closebutton), "closed" not.
  //... and a token that is a SHORT prefix plus close, with at most a
  // button-ish suffix: Ziff Davis's Pogo unit on PCMag closes through
  // <span class="pgCloseBtn"><span class="pgClose"> (its script, 2026-09-13);
  // jsClose, adClose, btnClose fit the same shape. "disclosure", "enclosed"
  // and "closest" do not.
  var CLOSE_TOK = /(^|[\s_-])(close(?!d([\s_-]|$))[a-z]*|[a-z]{1,3}close(btn|button|icon|x)?|dismiss|collapse|btn-close)([\s_-]|$)/i;
  var CLOSE_GLYPH = /^[xX\u00D7\u2715\u2716\u2A2F]$/;
  var MAX_HOLES = 6;
  // A carousel's own controls under a cover: MSN's digest and infopane cards
  // mix ads and articles in one slider, and its Previous / Next buttons and
  // the slide dots sat under the cover with no way on to the next slide
  // (reports 2026-10-09, 2026-10-15). The person's own press
  // moves the slider; the cover goes when the slide is no longer an ad. Only
  // controls that say so: an aria-label / title of Previous or Next (slide,
  // item...), a nav-button / flipper / prev / next class token, or a dots
  // strip (CS-SEQUENCE-DOTS, a pagination / dots / indicators class).
  var NAV_LABEL = /^(previous|next|prev)( (slide|item|page|story|stories|card|set|image|photo))?$/i;
  var NAV_TOK = /(^|[\s_-])(nav-button|flipper|carousel-(prev|next)|slick-(prev|next)|swiper-button-(prev|next)|(prev|next)-button|button-(prev|next))([\s_-]|$)/i;
  var DOTS_TOK = /(^|[\s_-])(pagination-dots|sequence-dots|slick-dots|swiper-pagination|carousel-indicators|carousel-dots|slider-dots|pager-dots|dots)([\s_-]|$)/i;
  function navKind(e) {
    if (e.tagName === "CS-SEQUENCE-DOTS" || DOTS_TOK.test(PV.classStr(e))) return "dots";
    var lab = ((e.getAttribute("aria-label") || e.getAttribute("title") || "") + "").trim();
    if (NAV_LABEL.test(lab) || NAV_TOK.test(PV.classStr(e))) return "nav";
    return "";
  }
  // The unit across shadow boundaries: MSN's card is a shadow host whose own
  // tree holds the slide and the controls, so the walk climbs through hosts of
  // (about) the covered element's size and searches their shadow trees too.
  function unitDeep(target) {
    var u = target, r0 = target.getBoundingClientRect();
    for (var d = 0; d < 8; d++) {
      var p = PV.parentAcross(u);
      if (!p || p === document.body || p === document.documentElement || p.nodeType !== 1) break;
      var pr = p.getBoundingClientRect();
      if (Math.abs(pr.height - r0.height) > Math.max(12, r0.height * 0.15) || Math.abs(pr.width - r0.width) > Math.max(12, r0.width * 0.15)) break;
      u = p;
    }
    return u;
  }
  // Every element under a root, its own shadow tree and the shadow trees
  // inside it included, up to a cap.
  function deepAll(root, cap) {
    var out = [], q = [root];
    if (root.shadowRoot) q.push(root.shadowRoot);
    for (var i = 0; i < q.length && out.length < cap; i++) {
      var list; try { list = q[i].querySelectorAll("*"); } catch (e) { continue; }
      for (var j = 0; j < list.length && out.length < cap; j++) { out.push(list[j]); if (list[j].shadowRoot) q.push(list[j].shadowRoot); }
    }
    return out;
  }
  // The X may sit in the ad's WRAPPER rather than the covered element: CNN's
  // Wunderkind header (2026-09-12) covers the inner .celtra-banner while
  // a.bx-close lives four wrappers up, all the same box. Search the unit:
  // the target plus ancestors of (about) the same size, up to 6 levels.
  function unitAround(target) { return PV.unitAround ? PV.unitAround(target, 6) : target; }   // rules.js owns the walk
  // A control that SAYS it in its own text: IMDb's premium-slot collapser
  // draws a "Collapse" button (report 2026-09-23). A word button runs wider
  // than an X, so it may be up to 160px across.
  var CLOSE_TEXT = /^(close|collapse|dismiss|hide)( (the )?ad)?$/i;
  // The control may live INSIDE the unit's creative frame: IMDb's expandable
  // slot is a srcless (same-origin) iframe whose template draws the Collapse
  // button in its own document. Such a frame is searched too; a cross-origin
  // one cannot be read and stays covered. Rects come back in page coordinates.
  function frameOf(e) { try { var fe = e.ownerDocument.defaultView.frameElement; return fe && fe.ownerDocument === document ? fe : null; } catch (x) { return null; } }
  function pageRect(e) {
    var r = e.getBoundingClientRect(), fe = frameOf(e);
    if (!fe) return r;
    var fr = fe.getBoundingClientRect(), dx = fr.left + fe.clientLeft, dy = fr.top + fe.clientTop;
    return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy, width: r.width, height: r.height };
  }
  function closeControls(target) {
    var out = [], all, unit = target;
    try { unit = unitAround(target); } catch (eU) {}
    try { all = [].slice.call(unit.querySelectorAll("*")); } catch (e) { return out; }
    try {
      var frames = unit.tagName === "IFRAME" ? [unit] : [];
      [].forEach.call(unit.querySelectorAll("iframe"), function (f) { frames.push(f); });
      frames.slice(0, 4).forEach(function (f) {
        var d = null; try { d = f.contentDocument; } catch (eF) {}
        if (d && d.body) all = all.concat([].slice.call(d.body.querySelectorAll("*"), 0, 600));
      });
    } catch (eI) {}
    // the shadow trees of the unit (and of the hosts around it)
    try {
      var ud = unitDeep(target);
      var seen = new Set(all);
      deepAll(ud, 1600).forEach(function (x) { if (!seen.has(x)) all.push(x); });
    } catch (eS) {}
    var jetpack = false;
    try { jetpack = unit.id === "jpmasthead" || !!(unit.closest && unit.closest("#jpmasthead")) || !!unit.querySelector("#jpmasthead, .jpstage"); } catch (eJ) {}
    for (var i = 0; i < all.length && i < 1800 && out.length < MAX_HOLES; i++) {
      var e = all[i];
      if (e.hasAttribute("data-prism-veil") || e.hasAttribute("data-prism-ui")) continue;
      var r = e.getBoundingClientRect();
      var nk = "";
      try { nk = navKind(e); } catch (eN) {}
      if (nk) {
        // a dots strip is long and thin (MSN's is 318 x 8); a nav button an X's size
        if (nk === "dots" ? (r.width < 16 || r.width > 420 || r.height < 4 || r.height > 40) : (r.width < 14 || r.width > 72 || r.height < 14 || r.height > 72)) continue;
        if (!PV.elVisible(e)) continue;
        var nestedN = false; for (var kN = 0; kN < out.length; kN++) { if (PV.deepContains(out[kN], e)) { nestedN = true; break; } } if (nestedN) continue;
        var hN = null; try { hN = deepHit(r.left + r.width / 2, r.top + r.height / 2); } catch (eH) {}
        if (hN && (hN === e || PV.deepContains(e, hN))) { e.__prismNav = nk; out.push(e); }
        continue;
      }
      if (r.width < 10 || r.height < 10 || r.height > 64) continue;
      var lab = (e.getAttribute("aria-label") || "") + " " + (e.getAttribute("title") || "") + " " + (e.id || "") + " " + PV.classStr(e);
      var own = "";
      try { own = (e.textContent || "").replace(/\s+/g, " ").trim(); } catch (eT) {}
      var worded = own.length <= 16 && CLOSE_TEXT.test(own);
      if (r.width > (worded ? 160 : 64)) continue;
      var ok = worded || CLOSE_TOK.test(lab) || CLOSE_GLYPH.test(PV.ownText(e));
      if (!ok && jetpack && /ButtonModule/.test(PV.classStr(e))) ok = true;
      // (0.7.151-0.7.153 also took any small pointer control at the unit's top
      // corners. YouTube grows "Watch later" / "Add to queue" there on HOVER,
      // so holes opened into in-feed ads under the mouse and closed when it
      // left - 2026-09-12. Gone: a
      // hole needs the control to say what it is.)
      if (!ok) continue;
      if (!PV.elVisible(e)) continue;
      // Skip an element nested in one already taken (an icon inside the button).
      var nested = false; for (var k = 0; k < out.length; k++) { if (out[k].contains(e)) { nested = true; break; } } if (nested) continue;
      // The hit-test runs where the control lives: in a frame, the page must
      // reach the frame at that point (PRISM's layers skipped) and the frame's
      // own document must reach the control.
      var hit = null, fe = frameOf(e), pr = pageRect(e);
      try {
        var st = document.elementsFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
        for (var s = 0; s < st.length; s++) { if (st[s].hasAttribute && st[s].hasAttribute("data-prism-veil")) continue; hit = st[s]; break; }
        if (fe) hit = (hit === fe) ? e.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      } catch (e2) {}
      if (hit && (hit === e || e.contains(hit))) out.push(e);
    }
    return out;
  }
  function closeControl(target) { var c = closeControls(target); return c.length ? c[0] : null; }
  // One clip per cover, composed from the sticky-bar inset (`__under`, set on
  // every scroll) and the holes (`__holeBoxes`, cover-relative px, set at the
  // sweep). The polygon walks the outer box with a zero-width slit down from
  // the top edge into each hole (same trick as the video veil's Skip hole);
  // the outer box runs clockwise, each hole counter-clockwise, so the nonzero
  // rule leaves the holes out - and a clip-path hole hit-tests.
  function paintClip(cover) {
    var u = cover.__under || 0, o = cover.__over || 0, lo = o > 0 ? (cover.offsetHeight || cover.getBoundingClientRect().height) - o : Infinity;
    var holes = (cover.__holeBoxes || []).concat(cover.__lookBox ? [cover.__lookBox] : []).filter(function (h) { return h.y1 > u + 2 && h.y0 < lo - 2; })
      .map(function (h) { return { x0: h.x0, y0: Math.max(h.y0, u), x1: h.x1, y1: Math.min(h.y1, lo) }; })
      .sort(function (a, b) { return a.x0 - b.x0; });
    if (!holes.length) { cover.style.clipPath = (u > 0 || o > 0) ? "inset(" + u.toFixed(1) + "px 0 " + (o > 0 ? o.toFixed(1) + "px" : "0") + " 0)" : ""; return; }
    var pts = ["0 " + u + "px"];
    holes.forEach(function (h) {
      pts.push(h.x0 + "px " + u + "px", h.x0 + "px " + h.y1 + "px", h.x1 + "px " + h.y1 + "px", h.x1 + "px " + h.y0 + "px", h.x0 + "px " + h.y0 + "px", h.x0 + "px " + u + "px");
    });
    pts.push("100% " + u + "px", o > 0 ? "100% " + lo.toFixed(1) + "px" : "100% 100%", o > 0 ? "0 " + lo.toFixed(1) + "px" : "0 100%");
    cover.style.clipPath = "polygon(" + pts.join(", ") + ")";
  }
  function applyCloseHole(cover, target) {
    var ctrls = [], boxes = [];
    try { ctrls = closeControls(target); } catch (e) {}
    if (ctrls.length) {
      var cr = cover.getBoundingClientRect(), pad = 3;
      ctrls.forEach(function (x) {
        var r = pageRect(x);
        // clamp to the cover (Jetpack's stage runs a few px past its masthead)
        var py = x.__prismNav === "dots" ? 10 : pad;
        var x0 = Math.max(0, r.left - pad - cr.left), y0 = Math.max(0, r.top - py - cr.top), x1 = Math.min(cr.width, r.right + pad - cr.left), y1 = Math.min(cr.height, r.bottom + py - cr.top);
        if (x1 - x0 >= 6 && y1 - y0 >= 6) boxes.push({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), el: x, py: py });
      });
    }
    var key = boxes.map(function (b) { return [b.x0, b.y0, b.x1, b.y1].join(","); }).join(";");
    if (key !== (cover.__holeKey || "")) {
      cover.__holeKey = key; cover.__holeBoxes = boxes;
      if (boxes.length && PV.recordError && !cover.__holeLogged) {
        cover.__holeLogged = true;
        PV.recordError("cover holes " + boxes.map(function (b) { return b.el.tagName + "." + PV.classStr(b.el).slice(0, 30) + " " + (b.x1 - b.x0) + "x" + (b.y1 - b.y0); }).join(" | "));
      }
      // a glowing ring around each opening, so it is seen (2026-10-25); its corners follow the
      // control's own, plus the margin
      if (PV.ringHoles) PV.ringHoles(cover, boxes.map(function (b) {
        var r = 0;
        try { var cs = getComputedStyle(b.el), br = parseFloat(cs.borderTopLeftRadius); if (isFinite(br)) r = /%$/.test(cs.borderTopLeftRadius) ? br / 100 * Math.min(b.x1 - b.x0, b.y1 - b.y0) : br + b.py; } catch (e) {}
        return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, r: Math.min((b.y1 - b.y0) / 2, (b.x1 - b.x0) / 2, r) };
      }));
    }
    paintClip(cover);
  }
  // A page's own modal over the ad (2026-11-04, Reddit: an image opened in its lightbox blurs the page behind it, and a Veil cover on the
  // page's top layer painted over the blur and the lightbox). A cover outside its ad's own box (overlay and parent modes, whose z-index
  // is not caged by the ad) steps back while the first page element at the ad's centre is something viewport-sized that is neither the
  // ad nor around it: a lightbox, a dialog, a full-screen sheet. It comes back when that element goes. Only a viewport-sized element
  // counts, so a click layer or a sibling over an ad (Fox's masthead) never uncovers anything.
  function occludedByPage(cover, target) {
    if (cover.__mode !== "overlay" && cover.__mode !== "parent") return false;
    try {
      var r = target.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
      var x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2);
      var els = document.elementsFromPoint(x, y);
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e === cover || (e.closest && e.closest("[data-prism-why],[data-prism-veil],[data-prism-ui]"))) continue;
        if (e === target || PV.deepContains(target, e) || PV.deepContains(e, target)) return false;
        var b = e.getBoundingClientRect();
        return b.width >= innerWidth * 0.8 && b.height >= innerHeight * 0.8;
      }
    } catch (e) {}
    return false;
  }
  // The return waits until the page has finished closing its modal and then fades in (2026-11-04: the cover was the first thing back on
  // Reddit, before the lightbox's own close animation had cleared the feed): 150 ms with the ad's centre clear, then the usual fade
  // (400 ms was too slow, the person said; the instant return a little too soon).
  var RETURN_MS = 150;
  function stepBack(cover, target) {
    var o = occludedByPage(cover, target);
    if (o) {
      cover.__clearSince = 0;
      if (!cover.__occluded) { cover.__occluded = true; cover.style.visibility = "hidden"; if (PV.recordError) PV.recordError("cover stepped back under a page modal why=" + (why.get(target) || "?")); }
      return;
    }
    if (!cover.__occluded) return;
    var now = Date.now();
    if (!cover.__clearSince) { cover.__clearSince = now; setTimeout(clipOverlays, RETURN_MS + 30); return; }
    if (now - cover.__clearSince < RETURN_MS) return;
    cover.__occluded = false; cover.__clearSince = 0;
    cover.__fadeUntil = now + 300; cover.style.opacity = "0"; cover.style.visibility = "";
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (!cover.__occluded) cover.style.opacity = "1"; }); });
  }
  function clipOverlays() {
    veils.forEach(function (cover, target) {
      stepBack(cover, target);
      if (cover.__fixed) { cover.__under = 0; cover.__over = 0; paintClip(cover); if (!(cover.__fadeUntil > Date.now())) cover.style.opacity = "1"; return; }   // a fixed cover rides the viewport - it IS the sticky bar, never clip it under one
      // "inside" covers (MSN cards) sit at a huge z-index INSIDE the card, so
      // they too paint over a sticky bar (reported 2026-08-28: MSN search bar).
      // Clip them by their own box, same as overlays by their target's.
      // An ad INSIDE the sticky bar (CNN's masthead banner lives in the sticky
      // header) is part of the bar: clipping it "under" the bar would erase the
      // cover entirely (Firefox report 2026-08-28: target in targets, 12 veils,
      // banner still visible). Never clip a cover under a bar containing it.
      var inBot = !!(botEl && (botEl === target || PV.deepContains(botEl, target)));
      if (barEl && (barEl === target || PV.deepContains(barEl, target))) { cover.__under = 0; cover.__over = 0; paintClip(cover); if (!(cover.__fadeUntil > Date.now())) cover.style.opacity = "1"; return; }
      var r = cover.__mode === "overlay" ? target.getBoundingClientRect() : cover.getBoundingClientRect();
      if (r.height <= 0) { cover.style.opacity = "0"; return; }
      if (!(cover.__fadeUntil > Date.now())) cover.style.opacity = "1";
      // an inside cover the bar already paints over needs no clip from here: the page's own stacking hides it under the bar in the same
      // frame as the scroll, and a script clip a frame late would only open a strip of ad below the bar (2026-11-04, Reddit). Asked once
      // per cover, the first time it reaches the bar: is the bar above the cover at a point where both are?
      var underBar = false;
      if (cover.__mode === "inside" && barEl && r.top < barTop && r.bottom > barTop) {
        if (cover.__barOver === undefined || cover.__barOverEl !== barEl) {
          cover.__barOverEl = barEl; cover.__barOver = false;
          try {
            var px = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2), stack = document.elementsFromPoint(px, Math.max(1, barTop - 2));
            for (var si = 0; si < stack.length; si++) {
              if (stack[si] === cover || cover.contains(stack[si])) break;
              if (stack[si] === barEl || PV.deepContains(barEl, stack[si])) { cover.__barOver = true; break; }
            }
          } catch (eB) {}
        }
        underBar = cover.__barOver;
      }
      cover.__under = underBar ? 0 : Math.max(0, Math.min(r.height, barTop - r.top));
      cover.__over = (botEl && !inBot) ? Math.max(0, Math.min(r.height, r.bottom - botTop)) : 0;
      paintClip(cover);
    });
  }
  // Clip SYNCHRONOUSLY in the scroll handler: a scroll event runs before that
  // frame paints, so the new clip lands in the same frame as the new scroll
  // position. Deferring to rAF painted one frame with the OLD clip per scroll
  // step - the cover visibly smeared over CNN's sticky nav while scrolling
  // (reported 2026-08-29). The rAF only swallows further events this frame.
  var raf = false;
  addEventListener("scroll", function () {
    if (!anyOverlay || raf) return;
    raf = true;
    pickTopBar();   // a sticky nav sticks only once the page has scrolled past what sits above it
    clipOverlays();
    requestAnimationFrame(function () { raf = false; clipOverlays(); });
  }, { passive: true, capture: true });
  addEventListener("resize", function () { findTopBar(); }, { passive: true });
  // a modal opens on a click or a key and without a scroll: look again just after, and once a second while any cover sits outside its ad
  // every frame for a second and a half after the click (2026-11-04: checked at 250 and 900 ms, the cover stood over Reddit's lightbox
  // until its image had loaded); the frames cost one elementsFromPoint per cover outside its ad, and only after a click or a key
  var burstUntil = 0, bursting = false;
  function burst() { if (!bursting) return; clipOverlays(); if (performance.now() < burstUntil) requestAnimationFrame(burst); else bursting = false; }
  ["click", "keyup", "pointerup"].forEach(function (t) { addEventListener(t, function () {
    if (!anyOverlay) return;
    burstUntil = performance.now() + 1500;
    if (!bursting) { bursting = true; requestAnimationFrame(burst); }
  }, { passive: true, capture: true }); });
  setInterval(function () { if (anyOverlay && !document.hidden) clipOverlays(); }, 1000);
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (t) { document.addEventListener(t, function () { try { sweep(); } catch (e) {} }, true); });

  // ---- sound under a cover (Reddit/Instagram video ads): mute while covered,
  // restore the prior state on uncover. The veil never forces audio on.
  function muteUnder(t) {
    try { t.querySelectorAll("video,audio").forEach(function (v) {
      if (v.__prismMuted === undefined) { v.__prismMuted = v.muted; }
      if (!v.muted) v.muted = true;
    }); } catch (e) {}
  }
  function unmuteUnder(t) {
    try { t.querySelectorAll("video,audio").forEach(function (v) {
      if (v.__prismMuted !== undefined) { v.muted = v.__prismMuted; delete v.__prismMuted; }
    }); } catch (e) {}
  }

  // ---- side-by-side covers at the same top/height share ONE photo across the
  // row (each keeps its own element; the image is sized to the union and
  // offset to the cover's slice).
  function mergeArtRows() {
    var list = [];
    veils.forEach(function (c) {
      var r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) list.push({ c: c, r: r });
    });
    list.sort(function (a, b) { return (a.r.top - b.r.top) || (a.r.left - b.r.left); });
    var groups = [];
    list.forEach(function (it) {
      var g = null;
      for (var i = groups.length - 1; i >= 0; i--) {
        var G = groups[i];
        if (Math.abs(G.top - it.r.top) <= 4 && Math.abs(G.height - it.r.height) <= 4 &&
            it.r.left - G.right >= -4 && it.r.left - G.right <= 48) { g = G; break; }
      }
      if (g) { g.items.push(it); g.right = Math.max(g.right, it.r.right); }
      else groups.push({ top: it.r.top, height: it.r.height, left: it.r.left, right: it.r.right, items: [it] });
    });
    groups.forEach(function (g) {
      if (g.items.length < 2) {
        var c1 = g.items[0].c;
        if (c1.__rowArt) { c1.__rowArt = null; c1.style.backgroundImage = "url('" + c1.__artUrl + "')"; c1.style.backgroundSize = "cover"; c1.style.backgroundPosition = "center"; }
        return;
      }
      var shared = g.items[0].c.__rowArt || g.items[0].c.__artUrl;
      var uw = g.right - g.left, uh = g.height;
      g.items.forEach(function (it) {
        var c = it.c;
        c.__rowArt = shared;
        c.style.backgroundImage = "url('" + shared + "')";
        c.style.backgroundSize = uw + "px " + uh + "px";
        c.style.backgroundPosition = (-(it.r.left - g.left)) + "px " + (-(it.r.top - g.top)) + "px";
      });
    });
  }

  /** One pass: detect, cover new ads, drop stale covers, resync the rest. */
  function sweep() {
    if (veilOff || (PV.suppressed && PV.suppressed())) return;
    PV.videoAdBreak();
    var res = PV.collectTargets(), targets = res.targets;
    why = res.why;
    // A cover the page took out of its tree is made again: MSN's ad SDK
    // redraws its banner container and drops our cover with the old children
    // (report 2026-10-15:, the cover
    // disconnected while the target was still counted as covered).
    veils.forEach(function (cover, t) {
      if (cover.isConnected) return;
      lowerPager(cover); veils.delete(t);
      if (PV.recordError && !t.__prismReattachLogged) { t.__prismReattachLogged = true; PV.recordError("cover re-made (page removed it) " + t.tagName + "." + PV.classStr(t).slice(0, 40)); }
    });
    // A cover that is on the page and is no target's cover is taken away: a page that takes a cover out and puts the same node
    // back later (CNN's Dianomi strip, seen 2026-11-12) left two covers on one ad, and the look's hole in one showed the other.
    try {
      var live = new Set(); veils.forEach(function (c) { live.add(c); });
      document.querySelectorAll("[data-prism-why]").forEach(function (c) { if (!live.has(c)) c.remove(); });
    } catch (eO) {}
    // While a look is open its element is shrunk into the cover's hole, so the element's own wrapper can read as an ad with nothing
    // covered in it and get a cover of its own behind the hole (2026-11-12, reported on CNN: a second cover came up behind the one
    // looked under). Nothing that holds the looked-under element, or is held by it, gets a new cover until the look closes.
    var lookT = (look && look.cover && look.cover.__lookOn) ? look.cover.__target : null;
    targets.forEach(function (t) {
      if (veils.has(t)) return;
      if (lookT && t !== lookT && (PV.deepContains(t, lookT) || PV.deepContains(lookT, t))) return;
      var cv = makeCover(t, /^ai-(lookup|label)/.test(why.get(t) || "") ? "\u2726" : "\u25D0"); veils.set(t, cv); cv.setAttribute("data-prism-why", String(why.get(t) || "").slice(0, 60)); raisePager(t, cv); muteUnder(t); if (PV.reclaimDisplaySlot) PV.reclaimDisplaySlot(t);
      watchGrowth(t, cv);
      // Trace any cover that takes more than half the viewport (MSN: a full-
      // screen veil for a moment at load, 2026-08-29) - rule + target, once.
      try {
        var br = t.getBoundingClientRect();
        if (!t.__prismBigLogged && br.width * br.height >= innerWidth * innerHeight * 0.5) {
          t.__prismBigLogged = true;
          if (PV.recordError) PV.recordError("cover big " + Math.round(br.width) + "x" + Math.round(br.height) + " why=" + (why.get(t) || "?") + " " + t.tagName + "#" + (t.id || "") + "." + PV.classStr(t).slice(0, 60));
        }
      } catch (eB) {}
    });
    veils.forEach(function (cover, t) {
      if (cover.__lookOn && t.isConnected) return;   // its look is open: the element is scaled into the cover's hole for now (lookOpen), nothing here is to be judged by its box
      if (!targets.has(t) || !t.isConnected || !PV.isVisible(t)) {
        lowerPager(cover); cover.remove(); veils.delete(t); unmuteUnder(t); return;
      }
      muteUnder(t);
      if (cover.__mode === "parent") {
        // The target's offsetParent can CHANGE (YouTube Shorts re-parents its
        // single player between reels): keep the cover in the current one.
        var op2 = t.offsetParent;
        if (op2 && op2 !== cover.__op && op2 !== document.body && op2 !== document.documentElement) { op2.appendChild(cover); cover.__op = op2; }
        cover.style.left = t.offsetLeft + "px"; cover.style.top = t.offsetTop + "px";
        cover.style.width = t.offsetWidth + "px"; cover.style.height = t.offsetHeight + "px";
        trueUp(cover, t);
      } else if (cover.__mode === "overlay") {
        positionOverlay(cover, t);
      }
      // Trace a cover that has GROWN past half the viewport since creation
      // (an "inside" cover follows its target's size; MSN full-screen flash).
      try {
        if (!cover.__prismBigLogged) {
          var cr2 = cover.getBoundingClientRect();
          if (PV.pageSized(cr2)) {
            cover.__prismBigLogged = true;
            var w2 = why.get(t) || "?";
            if (PV.recordError) PV.recordError("cover grew " + Math.round(cr2.width) + "x" + Math.round(cr2.height) + " mode=" + cover.__mode + " why=" + w2 + " " + t.tagName + "#" + (t.id || "") + "." + PV.classStr(t).slice(0, 60));
            // A slot-selector cover the size of the page is a wrapper, not an
            // ad: drop it now and keep the element out of the slot pass a while.
            // ... and no cover of ANY rule may run three screens tall: that is a
            // column, never an ad (AP News's .dianomi_context, 980x13042, 2026-09-13).
            if (/^slot-selector/.test(w2) || cr2.height > innerHeight * 3) { t.__prismTooBigAt = Date.now(); lowerPager(cover); cover.remove(); veils.delete(t); unmuteUnder(t); return; }
          }
        }
      } catch (eG) {}
    });
    veils.forEach(function (cover, t) { applyCloseHole(cover, t); });
    mergeArtRows();
    anyOverlay = veils.size > 0;   // any cover needs the sticky-bar clip on scroll, not just overlays
    if (anyOverlay) { findTopBar(); clipOverlays(); }
  }

  /** Remove every display cover (Escape / hold-to-reveal). */
  function clearCovers() {
    veils.forEach(function (c, t) { lowerPager(c); c.remove(); unmuteUnder(t); });
    veils.clear();
  }

  // The main switch (pv:ui.veilOff, 2026-10-27): off drops every cover and the video veil at once and keeps the
  // sweep and the break detector idle; on sweeps again at once. Popups and the
  // reliability marks are not the veil and keep running.
  var veilOff = false;
  function setVeilOff(off) {
    off = !!off;
    if (off === veilOff) return;
    veilOff = off;
    if (off) { clearCovers(); if (PV.uncoverVideo) { try { PV.uncoverVideo(); } catch (e) {} } }
    else sweep();
    if (PV.onVeilToggle) { try { PV.onVeilToggle(off); } catch (e2) {} }
  }
  PV.veilOff = function () { return veilOff; };
  PV.setVeilOff = setVeilOff;

  PV.veils = veils;
  PV.closeControl = closeControl;   // tests
  PV.__styleCover = styleCover;     // tests
  PV.closeControls = closeControls; // tests
  PV.paintClip = paintClip;         // tests
  PV.whyFor = function (target) { return why.get(target); };
  PV.sweep = sweep;
  PV.clearCovers = clearCovers;
})();
