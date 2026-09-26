/*
  Prism Veil - DISPLAY covers. Paints art over each detected ad element at
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
    // chip; "the symbol alone at the top left", 2026-09-12 - the VIDEO
    // intermission keeps its centred card, clock and controls). Half-moon for
    // an ad, four-point star for platform-labelled AI content (0.7.148's
    // glyphs), passed in by the sweep.
    var lbl = document.createElement("div");
    lbl.setAttribute("data-prism-veil", "1");
    lbl.textContent = glyph || String.fromCharCode(0x25D0);
    lbl.style.cssText = "position:absolute;top:6px;left:6px;font:600 clamp(9px,4cqi,16px)/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#F0A83C;text-shadow:0 1px 6px #000;background:rgba(10,12,15,.5);padding:.3em .45em;border-radius:6px;white-space:nowrap;backdrop-filter:blur(2px)";
    cover.appendChild(lbl);
    requestAnimationFrame(function () { cover.style.opacity = "1"; });
  }

  // Correct a parent-mode cover by measurement: offsets lie when a transform
  // sits between the target and its offsetParent (YouTube Shorts).
  function trueUp(cover, target) {
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
    // __prismForceOverlay: a deeply-layered ad unit (Fox's masthead stacks a
    // video + click-layer above a normal inside cover). Skip inside/parent modes
    // and go straight to a top-level overlay, which paints above all of it.
    if (!target.__prismForceOverlay && target.tagName !== "IFRAME" && !target.shadowRoot && getComputedStyle(target).display !== "contents") {
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
        if (tr0.width >= 60 && (cr0.width < tr0.width * 0.5 || cr0.height < tr0.height * 0.5)) { cover.remove(); cover.__mode = null; }
        else return cover;
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
      var holdsAd = false; veils.forEach(function (c, tgt) { if (!holdsAd && (tgt === e || PV.deepContains(e, tgt) || PV.deepContains(tgt, e))) holdsAd = true; }); if (holdsAd) continue;
      t = r.bottom; el = e;
    }
    barTop = t; barEl = t ? el : null;
    PV.topBar = { top: barTop, el: barEl };
  }
  function findTopBar() { scanBarCandidates(); pickTopBar(); }
  // ---- the ad's own close control stays reachable THROUGH the cover.
  // Many units carry an X (Jetpack's masthead strip, sticky footers, AdChoices
  // closes). Prism clicks nothing (spec section 26) - but the person's own
  // click on the page's own X is theirs to make, and once the ad is gone the
  // cover goes with it (the sweep drops a cover whose element is hidden). So
  // the cover is cut away over the X: a clip-path hole hit-tests, so the real
  // click lands on the control itself - no synthetic event, no forwarding.
  // Only a control that plainly says close / dismiss (aria-label, title, id
  // or a class token) or reads as a lone x / multiplication-sign glyph, at
  // most 64px a side, and that a hit-test at its centre actually reaches once
  // Prism's own layers are skipped (a click-layer over it means a click there
  // would open the advertiser: no hole).
  // Two kinds of candidate, each small (at most 64px a side) and each still
  // subject to the hit-test:
  //   - it says so: close / dismiss in aria-label, title, id or a class token,
  //     or a lone x / multiplication-sign glyph;
  //   - Jetpack (Fox's masthead, 2026-09-12: "collapse or close buttons don't
  //     pass through"): its controls are `*_ButtonModule_*` modules - the
  //     full-size ones are the click-layers, the small ones its collapse /
  //     close / sound buttons, and every one of those is the person's to press.
  // A token STARTING with close counts (Jetpack's X on Fox is class
  // "closeleavebehind", report 2026-09-12; closeBtn, closebutton), "closed" not.
  // ... and a token that is a SHORT prefix plus close, with at most a
  // button-ish suffix: Ziff Davis's Pogo unit on PCMag closes through
  // <span class="pgCloseBtn"><span class="pgClose"> (its script, 2026-09-13);
  // jsClose, adClose, btnClose fit the same shape. "disclosure", "enclosed"
  // and "closest" do not.
  var CLOSE_TOK = /(^|[\s_-])(close(?!d([\s_-]|$))[a-z]*|[a-z]{1,3}close(btn|button|icon|x)?|dismiss|collapse|btn-close)([\s_-]|$)/i;
  var CLOSE_GLYPH = /^[xX\u00D7\u2715\u2716\u2A2F]$/;
  var MAX_HOLES = 4;
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
    var jetpack = false;
    try { jetpack = unit.id === "jpmasthead" || !!(unit.closest && unit.closest("#jpmasthead")) || !!unit.querySelector("#jpmasthead, .jpstage"); } catch (eJ) {}
    for (var i = 0; i < all.length && i < 1800 && out.length < MAX_HOLES; i++) {
      var e = all[i];
      if (e.hasAttribute("data-prism-veil") || e.hasAttribute("data-prism-ui")) continue;
      var r = e.getBoundingClientRect();
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
      // left - "ads suddenly show up and are clickable", 2026-09-12. Gone: a
      // hole needs the control to say what it is.)
      if (!ok) continue;
      if (!PV.elVisible(e)) continue;
      // Skip an element nested in one already taken (an icon inside the button).
      var nested = false; for (var k = 0; k < out.length; k++) { if (out[k].contains(e)) { nested = true; break; } } if (nested) continue;
      // The hit-test runs where the control lives: in a frame, the page must
      // reach the frame at that point (Prism's layers skipped) and the frame's
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
    var u = cover.__under || 0, holes = (cover.__holeBoxes || []).filter(function (h) { return h.y1 > u + 2; })
      .map(function (h) { return { x0: h.x0, y0: Math.max(h.y0, u), x1: h.x1, y1: h.y1 }; })
      .sort(function (a, b) { return a.x0 - b.x0; });
    if (!holes.length) { cover.style.clipPath = u > 0 ? "inset(" + u.toFixed(1) + "px 0 0 0)" : ""; return; }
    var pts = ["0 " + u + "px"];
    holes.forEach(function (h) {
      pts.push(h.x0 + "px " + u + "px", h.x0 + "px " + h.y1 + "px", h.x1 + "px " + h.y1 + "px", h.x1 + "px " + h.y0 + "px", h.x0 + "px " + h.y0 + "px", h.x0 + "px " + u + "px");
    });
    pts.push("100% " + u + "px", "100% 100%", "0 100%");
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
        var x0 = Math.max(0, r.left - pad - cr.left), y0 = Math.max(0, r.top - pad - cr.top), x1 = Math.min(cr.width, r.right + pad - cr.left), y1 = Math.min(cr.height, r.bottom + pad - cr.top);
        if (x1 - x0 >= 6 && y1 - y0 >= 6) boxes.push({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), el: x });
      });
    }
    var key = boxes.map(function (b) { return [b.x0, b.y0, b.x1, b.y1].join(","); }).join(";");
    if (key !== (cover.__holeKey || "")) {
      cover.__holeKey = key; cover.__holeBoxes = boxes;
      if (boxes.length && PV.recordError && !cover.__holeLogged) {
        cover.__holeLogged = true;
        PV.recordError("cover holes " + boxes.map(function (b) { return b.el.tagName + "." + PV.classStr(b.el).slice(0, 30) + " " + (b.x1 - b.x0) + "x" + (b.y1 - b.y0); }).join(" | "));
      }
    }
    paintClip(cover);
  }
  function clipOverlays() {
    veils.forEach(function (cover, target) {
      if (cover.__fixed) { cover.__under = 0; paintClip(cover); cover.style.opacity = "1"; return; }   // a fixed cover rides the viewport - it IS the sticky bar, never clip it under one
      // "inside" covers (MSN cards) sit at a huge z-index INSIDE the card, so
      // they too paint over a sticky bar (reported 2026-08-28: MSN search bar).
      // Clip them by their own box, same as overlays by their target's.
      // An ad INSIDE the sticky bar (CNN's masthead banner lives in the sticky
      // header) is part of the bar: clipping it "under" the bar would erase the
      // cover entirely (Firefox report 2026-08-28: target in targets, 12 veils,
      // banner still visible). Never clip a cover under a bar containing it.
      if (barEl && (barEl === target || PV.deepContains(barEl, target))) { cover.__under = 0; paintClip(cover); cover.style.opacity = "1"; return; }
      var r = cover.__mode === "overlay" ? target.getBoundingClientRect() : cover.getBoundingClientRect();
      if (r.height <= 0) { cover.style.opacity = "0"; return; }
      cover.style.opacity = "1";
      cover.__under = Math.max(0, Math.min(r.height, barTop - r.top));
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
    if (PV.suppressed()) return;
    PV.videoAdBreak();
    var res = PV.collectTargets(), targets = res.targets;
    why = res.why;
    targets.forEach(function (t) {
      if (veils.has(t)) return;
      var cv = makeCover(t, /^ai-(lookup|label)/.test(why.get(t) || "") ? "\u2726" : "\u25D0"); veils.set(t, cv); raisePager(t, cv); muteUnder(t); if (PV.reclaimDisplaySlot) PV.reclaimDisplaySlot(t);
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

  PV.veils = veils;
  PV.closeControl = closeControl;   // tests
  PV.__styleCover = styleCover;     // tests
  PV.closeControls = closeControls; // tests
  PV.paintClip = paintClip;         // tests
  PV.whyFor = function (target) { return why.get(target); };
  PV.sweep = sweep;
  PV.clearCovers = clearCovers;
})();
