/*
  PRISM - in-page pops (spec section 30), isolated world, top frame.

  A pop ad on a phone often opens no window: the same script draws its unit in the page (a full-screen interstitial, a box in a
  corner, a strip that slides up) at the top of the page's stack, over everything and over the PRISM button (2026-11-21, aether.ist
  in Safari on an iPhone; on a computer its popups are windows and were held). Decision 2026-11-21: such a unit is treated as a
  popup, counted on the PRISM button and listed in the settings with the popups, judged by the same policy (src/core-popups.js)
  with the unit's destination as the popup's address. The person's Always allow for that destination puts it back at once, and the
  panel's Open opens its link in a tab of its own.

  Held means TUCKED AWAY, never hidden (decisions 2026-11-22): a site that walls off ad blockers checks whether its ad is missing,
  hidden, of no size or failed to load, so the unit stays loaded, laid out at its own size, displayed, opaque and on the screen. It
  is drawn small, the keyhole's way (covers.js lookOpen scales the page's own element into a view): a transform shrinks its box to
  a speck of 6 px at most and moves it under the PRISM button at the bottom right, where the button paints over it. A transform
  changes neither the layout size (offsetWidth, offsetHeight, clientHeight) nor opacity, display or visibility, and the speck lies
  wholly on the screen, so IntersectionObserver, on the page and inside the ad's own frame, still reads the ad as fully in view
  (measured in Chrome 2026-11-22: 1.0 both, as unchanged). Opacity 0 measured the same but made the ad itself transparent; a
  clip-path window read 0% in view; a move off the screen reads 0% too. Every press reaches the page where the ad was, and presses
  are switched off on the unit and everything inside it, its frames too, so the speck takes none. Two cases are covered instead (src/rules.js takes them from PV.inpageCovers; the display covers cut the unit's close out):
  a page that stopped scrolling while the unit is up, which would look frozen under a clear unit, and a unit with a video that
  plays with sound, which the covers mute.

  What counts as a unit: a child of <body> or <html>, or a fixed box a few levels inside a child that has no size of its own, laid
  out fixed, at a z-index of 2147483600 or more (pop units sit at 2147483646 to 2147483648), on the screen and larger than 30 px
  each way, that holds a link or a frame to another site. Its reason names what was found: the display rules' named ad signal
  (PV.adSignalIn: an ad server's element, an AdChoices link, a slot selector), else PRISM's own rule "at the top of the stack" (pop
  networks serve from throwaway domains, aether.ist's two among them, so no list of hosts can name them). Left alone, by their own
  markers: consent dialogs, sign-in and payment frames, accessibility tools, a page in full screen, PRISM's own; and, unless an ad
  signal is in them, chat and help widgets, surveys, notification prompts, app banners and video players.
  Observe-only otherwise: nothing is clicked, removed or loaded.
*/
(function () {
  "use strict";
  if (window !== window.top) return;
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  var site = location.hostname;
  if (!site) return;

  var Z_MIN = 2147483600, MIN_SIDE = 30, MAX_INNER = 400;
  // never held, whatever is in them
  var LEAVE_HARD = /consent|cookie|gdpr|ccpa|\bcmp\b|qc-cmp|onetrust|didomi|usercentrics|trustarc|truste|sp_message|privacy|recaptcha|hcaptcha|turnstile|challenge|paypal|stripe|applepay|apple-pay|klarna|affirm|accounts\.google|appleid|login|signin|sign-in|userway|accessibe|acsb|equalweb|audioeye|recite|eye-able|accessib|\ba11y\b/i;
  // left alone unless an ad signal is in them: the services' own widgets that also sit at the top of the stack
  var LEAVE_SOFT = /\bchat|launcher|helpdesk|intercom|hubspot|drift|zendesk|zopim|crisp|tawk|livechat|olark|freshchat|helpscout|beacon|messenger|qualtrics|\bQSI|hotjar|_hj|survicate|usabilla|medallia|kampyle|typeform|onesignal|pushengage|webpushr|smartbanner|smart-banner|app-banner|branch-banner|branch-journeys|jwplayer|jw-|brightcove|video-js|\bvjs|plyr|youtube\.com\/embed|player\.vimeo/i;

  var held = [];               // [{ el, url, mode: "clear" | "cover", saved }]
  var seen = new WeakMap();    // element -> its record, so a unit is counted once however often it shows itself again
  PV.inpageCovers = PV.inpageCovers || new Map();   // element -> { reason }: units held by a cover (src/rules.js)

  function sameSite(a, b) {
    var cut = function (h) { var p = String(h || "").toLowerCase().split("."); return p.slice(-2).join("."); };
    return cut(a) === cut(b);
  }
  function hostOf(u) { try { return new URL(u, location.href).hostname; } catch (e) { return ""; } }
  function marks(el) {
    var s = "";
    try { s = (el.id || "") + " " + (typeof el.className === "string" ? el.className : "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "") + " " + (el.getAttribute("name") || "") + " " + (el.getAttribute("src") || ""); } catch (e) {}
    return s;
  }
  function anyMark(el, re) {
    if (re.test(marks(el))) return true;
    try { var inner = el.querySelectorAll("[id],[class],[aria-label],[title],iframe"); for (var i = 0; i < inner.length && i < 80; i++) if (re.test(marks(inner[i]))) return true; } catch (e) {}
    return false;
  }
  // the first link or frame in the unit that goes to another site: the popup's address
  function destOf(el) {
    var found = "", look = function (root, depth) {
      if (found || !root || depth > 2) return;
      var list = [];
      try { list = [root].concat(Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("a[href],iframe,area[href]") : [], 0, 60)); } catch (e) {}
      for (var i = 0; i < list.length && !found; i++) {
        var n = list[i]; if (!n || !n.tagName) continue;
        var t = n.tagName, u = "";
        if (t === "A" || t === "AREA") u = n.href;
        else if (t === "IFRAME") {
          u = n.src;
          if (!u || /^about:|^javascript:/i.test(u)) { try { look(n.contentDocument, depth + 1); } catch (e2) {} continue; }   // a frame of its own drawing: read inside
        }
        if (!u || !/^https?:/i.test(u)) continue;
        var h = hostOf(u);
        if (h && !sameSite(h, site)) found = u;
      }
      try { if (!found && root.shadowRoot) look(root.shadowRoot, depth + 1); } catch (e3) {}
      try { if (!found && root.querySelectorAll) Array.prototype.slice.call(root.querySelectorAll("*"), 0, 200).forEach(function (c) { if (!found && c.shadowRoot) look(c.shadowRoot, depth + 1); }); } catch (e4) {}
    };
    look(el, 0);
    return found;
  }
  // The site's own message that asks the person to allow ads (2026-11-25, a report from allrecipes.com on an iPhone with another
  // ad blocker installed: the message filled the screen, linked to its vendor's help pages, and was covered as an ad). It is the
  // site's word to the person, not an ad, and the page does not go on until it is answered: never held and never covered. Read
  // from the words the box shows, in its own tree, its shadow trees and the frames the page may read, and from the vendors' marks.
  var ASK_WORDS = /allow(ing)? ads|(disable|turn off|pause|deactivate|switch off)[^.]{0,40}ad[\s-]?block|(using|use|detected)[^.]{0,30}ad[\s-]?block|ad[\s-]?block(er)?[^.]{0,20}detected|whitelist (us|this site|our site)/i;
  var ASK_MARKS = /fc-ab-root|fundingchoices|getadmiral|blockthrough|anti-?adblock|adblock-?(wall|detect|notice|modal|message|warning)/i;
  function adsAsk(el) {
    try {
      if (anyMark(el, ASK_MARKS)) return true;
      var text = "", add = function (root, depth) {
        if (!root || depth > 2 || text.length > 6000) return;
        try { text += " " + String(root.textContent || "").slice(0, 3000); } catch (e) {}
        var all = [];
        try { all = Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("*") : [], 0, 300); } catch (e1) {}
        if (root.shadowRoot) add(root.shadowRoot, depth + 1);
        all.forEach(function (n) {
          try { if (n.shadowRoot) add(n.shadowRoot, depth + 1); } catch (e2) {}
          try { if (n.tagName === "IFRAME" && n.contentDocument && n.contentDocument.body) add(n.contentDocument.body, depth + 1); } catch (e3) {}
        });
      };
      add(el, 0);
      return ASK_WORDS.test(text.replace(/\s+/g, " "));
    } catch (e4) { return false; }
  }
  function zOf(cs) { var z = parseInt(cs.zIndex, 10); return isNaN(z) ? -Infinity : z; }
  function onScreen(el) {
    var r = el.getBoundingClientRect();
    return !(r.width < MIN_SIDE || r.height < MIN_SIDE || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight);
  }
  // A unit is a page-level child, or a fixed box up to three levels inside a child that has no size of its own (GumGum on Fox News
  // keeps its unit in a 0 by 0 div). The z-index that counts is the highest on the way down from the child.
  function unitIn(child) {
    var cs; try { cs = getComputedStyle(child); } catch (e) { return null; }
    if (cs.position === "fixed" && zOf(cs) >= Z_MIN && onScreen(child)) return child;
    var r = child.getBoundingClientRect();
    if (r.width >= MIN_SIDE && r.height >= MIN_SIDE) return null;
    var walk = function (el, depth, zTop) {
      if (depth > 3) return null;
      var kids = el.children || [];
      for (var i = 0; i < kids.length && i < 20; i++) {
        var k = kids[i], ks; try { ks = getComputedStyle(k); } catch (e) { continue; }
        var z = Math.max(zTop, zOf(ks));
        if (ks.position === "fixed" && z >= Z_MIN && onScreen(k)) return k;
        var deeper = walk(k, depth + 1, z); if (deeper) return deeper;
      }
      return null;
    };
    return walk(child, 1, zOf(cs));
  }
  // a unit at the top of the stack, or null: { dest, reason }
  PV.inpagePopOf = function (el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.hasAttribute("data-prism-ui") || el.hasAttribute("data-prism-veil") || el.closest("[data-prism-ui],[data-prism-veil]")) return null;
    var cs; try { cs = getComputedStyle(el); } catch (e) { return null; }
    if (cs.position !== "fixed") return null;
    if (cs.display === "none" || cs.visibility === "hidden" || (parseFloat(cs.opacity) < 0.05 && el.getAttribute("data-prism-held") !== "clear")) return null;
    if (!onScreen(el)) return null;
    try { var fs = document.fullscreenElement || document.webkitFullscreenElement; if (fs && (fs === el || el.contains(fs) || fs.contains(el))) return null; } catch (e5) {}
    if (anyMark(el, LEAVE_HARD) || adsAsk(el)) return null;
    var signal = PV.adSignalIn ? PV.adSignalIn(el) : "";
    if (!signal && anyMark(el, LEAVE_SOFT)) return null;
    var dest = destOf(el);
    if (dest) return { dest: dest, reason: signal || "at the top of the stack" };
    // No link at all (2026-11-22, aether.ist on a phone: two corner units at z-index 2147483646, each a frame with no address and a
    // close control, the frame taking the press by a script). Such a unit counts when a frame fills most of it: the frame is the
    // creative. It is listed under the host its picture, video or script comes from, read where the browser lets the page read the
    // frame, else under a reserved name that never resolves, so Always allow has an address to keep.
    var cr = creativeFrame(el);
    if (cr) return { dest: cr, reason: (signal || "at the top of the stack") + ", a frame with no link" };
    if (!asked(el) && ownOffer(el)) return { dest: OFFER, reason: "the site's own offer over the page, with a close control", kind: "offer" };
    return null;
  };
  // What the person opened themselves is theirs (a press on Subscribe, on Share): a box first seen within 2.5 s of a click is never
  // held as an offer or a dialog. A drag to scroll makes no click, so a box that comes up as the page scrolls is not excused.
  var lastClick = -1e9, firstSeen = new WeakMap(), askedFor = new WeakSet();
  try { addEventListener("click", function (e) { if (e.isTrusted !== false) lastClick = Date.now(); }, true); } catch (eC) {}
  function asked(el) {
    if (askedFor.has(el)) return true;
    if (!firstSeen.has(el)) { firstSeen.set(el, Date.now()); if (Date.now() - lastClick < 2500) { askedFor.add(el); return true; } }
    return false;
  }
  // A dialog over the page below the top of the stack (2026-11-24, a report from AP News on an iPhone: a marketing dialog with an
  // ad frame in it and a close control, not held). The same judgement as at the top of the stack, for a box the page itself marks
  // as a dialog: held when it leads to another site or is the site's own offer, and the person did not open it.
  function dialogBoxes() {
    var out = [], ds = [];
    try { ds = document.querySelectorAll("[role='dialog'],[role='alertdialog'],[aria-modal='true']"); } catch (e) {}
    var fixedBox = function (n) { try { return getComputedStyle(n).position === "fixed" && onScreen(n); } catch (e) { return false; } };
    for (var i = 0; i < ds.length && i < 10; i++) {
      var d = ds[i], box = null;
      try {
        if (d.hasAttribute("data-prism-ui") || d.closest("[data-prism-ui],[data-prism-veil],[data-prism-held]")) continue;
        if (fixedBox(d)) box = d;
        if (!box) { var q = [[d, 0]]; while (q.length && !box) { var it = q.shift(), kids = it[0].children || []; for (var k = 0; k < kids.length && k < 12 && !box; k++) { if (fixedBox(kids[k])) box = kids[k]; else if (it[1] < 2) q.push([kids[k], it[1] + 1]); } } }
        if (!box) { for (var n = d.parentElement, u = 0; n && u < 3 && n !== document.body && n !== document.documentElement; n = n.parentElement, u++) { if (fixedBox(n)) { box = n; break; } } }
        if (!box || box.getAttribute("data-prism-held")) continue;
        var r = box.getBoundingClientRect();
        if (r.width * r.height < innerWidth * innerHeight * 0.25) continue;
        if (out.indexOf(box) < 0) out.push(box);
      } catch (e2) {}
    }
    return out;
  }
  function dialogPop(el) {
    try { var fs = document.fullscreenElement || document.webkitFullscreenElement; if (fs && (fs === el || el.contains(fs) || fs.contains(el))) return null; } catch (e) {}
    if (asked(el)) return null;
    if (anyMark(el, LEAVE_HARD) || anyMark(el, WALL_WORDS) || adsAsk(el)) return null;
    var signal = PV.adSignalIn ? PV.adSignalIn(el) : "";
    if (!signal && anyMark(el, LEAVE_SOFT)) return null;
    if (!closeControl(el)) return null;
    var dest = destOf(el);
    if (dest) return { dest: dest, reason: signal || "a dialog over the page that leads to another site", kind: "offer" };
    if (ownOffer(el)) return { dest: OFFER, reason: "the site's own offer over the page, with a close control", kind: "offer" };
    return null;
  }
  // The site's own offer (2026-11-24, USA Today: a subscribe offer in a dialog over the whole page, the page's scroll stopped
  // under it; asked that it go the way a pop goes). It links nowhere else, so the rules above pass it. It counts when it is a
  // dialog or takes most of the window, names an offer in its own marks, and carries a close control: a thing the page lets a
  // person close. A wall in front of what is read (a paywall, a sign-in wall) has no close control or names itself, and is left.
  var OFFER = "https://site-offer.invalid/", PLAYER = "https://floating-video.invalid/";
  var OFFER_WORDS = /offer|subscri|newsletter|sign[\s-]?up|promo|discount|membership|\bsale\b|\bdeal/i, WALL_WORDS = /paywall|regwall|reg-wall|pay-wall|metered|\bgate\b|gateway/i;
  var CLOSE_WORDS = /^\s*(close|dismiss|no,? thanks|not now|maybe later|skip)\b|^\s*[x\u00d7\u2715\u2716]\s*$/i;
  function closeControl(el) {
    try {
      var list = el.querySelectorAll("button,[role='button'],a[aria-label],[aria-label^='Close'],[aria-label^='close']");
      for (var i = 0; i < list.length && i < 60; i++) {
        var n = list[i], t = (n.getAttribute("aria-label") || n.getAttribute("title") || n.textContent || "").slice(0, 60);
        if (CLOSE_WORDS.test(t)) return n;
      }
    } catch (e) {}
    return null;
  }
  function ownOffer(el) {
    try {
      var r = el.getBoundingClientRect();
      var dialog = /dialog/.test(el.getAttribute("role") || "") || el.getAttribute("aria-modal") === "true" || !!el.querySelector("[role='dialog'],[role='alertdialog'],[aria-modal='true']");
      if (!dialog && r.width * r.height < innerWidth * innerHeight * 0.6) return false;
      if (anyMark(el, WALL_WORDS)) return false;
      if (!closeControl(el)) return false;
      return anyMark(el, OFFER_WORDS);
    } catch (e) { return false; }
  }
  // A video the page floats in a corner (2026-11-24, USA Today: its player leaves the article and docks at the bottom right as the
  // page scrolls, playing without sound). Held when it is a fixed box of a third of the window or less, with a close control, and
  // its video is one the person did not start: without sound, or paused. A video that sounds is the person's own and is left; so is
  // a camera or a call (a stream, not a file), a page in full screen and picture in picture.
  function floatingPlayers() {
    var out = [], vs = [];
    try { vs = document.querySelectorAll("video"); } catch (e) {}
    for (var i = 0; i < vs.length && i < 12; i++) {
      var v = vs[i];
      try {
        if (v.srcObject || !(v.muted || v.paused || v.volume === 0)) continue;
        if (document.pictureInPictureElement === v) continue;
        var vr = v.getBoundingClientRect(); if (vr.width < 120 || vr.height < 60) continue;
        for (var n = v.parentElement, d = 0; n && d < 12 && n !== document.body && n !== document.documentElement; n = n.parentElement, d++) {
          if (getComputedStyle(n).position !== "fixed") continue;
          var r = n.getBoundingClientRect();
          if (onScreen(n) && r.width * r.height <= innerWidth * innerHeight * 0.34 && vr.width * vr.height >= r.width * r.height * 0.4 && closeControl(n) && out.indexOf(n) < 0) out.push(n);
          break;
        }
      } catch (e2) {}
    }
    return out;
  }
  function playerPop(el) {
    try { var fs = document.fullscreenElement || document.webkitFullscreenElement; if (fs && (fs === el || el.contains(fs) || fs.contains(el))) return null; } catch (e) {}
    if (anyMark(el, LEAVE_HARD)) return null;
    return { dest: PLAYER, reason: "a video the page floats in a corner, without sound", kind: "player" };
  }
  // The scroll the offer stopped is put back while the offer is tucked away (overflow on <html> and <body>, as an inline style
  // that is taken off again when the offer goes or is allowed). A body pinned in place is not undone: such an offer is covered.
  var unlock = null;
  function unlockOn(rec) {
    if (unlock) return true;
    try {
      var b = document.body, bs = b ? getComputedStyle(b) : null;
      if (bs && bs.position === "fixed") return false;
      var saved = [];
      [document.documentElement, b].forEach(function (n) {
        if (!n) return;
        var cs = getComputedStyle(n), y = cs.overflowY || String(cs.overflow || "").split(" ").pop();
        if (!/hidden|clip/.test(y)) return;
        saved.push([n, n.style.getPropertyValue("overflow-y"), n.style.getPropertyPriority("overflow-y")]);
        n.style.setProperty("overflow-y", "auto", "important");
      });
      unlock = { saved: saved, rec: rec };
      return true;
    } catch (e) { return false; }
  }
  // An offer let through (Show, Always allow) gets the page's own stop on the scroll back only when it is there to be seen and
  // closed (2026-11-24, on an iPhone: after Always allow the page could not be scrolled until it was loaded again; not reproduced,
  // and which unit it was is not known). An offer that is not on the screen then, or has no close control left, would leave a
  // page that cannot move and nothing to press: there the scroll stays free for the rest of the visit.
  function handBack(rec) {
    if (!unlock || unlock.rec !== rec) return;
    var there = false;
    try { var cs = getComputedStyle(rec.el); there = shown(rec.el) && onScreen(rec.el) && !(parseFloat(cs.opacity) < 0.1) && !!closeControl(rec.el); } catch (e) {}
    if (there) unlockOff(); else unlock.keep = true;
  }
  function unlockOff() {
    if (!unlock) return;
    unlock.saved.forEach(function (x) { try { if (x[1]) x[0].style.setProperty("overflow-y", x[1], x[2]); else x[0].style.removeProperty("overflow-y"); } catch (e) {} });
    unlock = null;
  }
  function shown(el) { try { var cs = getComputedStyle(el); return el.isConnected && cs.display !== "none" && cs.visibility !== "hidden"; } catch (e) { return false; } }
  var NO_LINK = "https://in-page-ad.invalid/";
  function creativeFrame(el) {
    var r = el.getBoundingClientRect(), area = r.width * r.height, frames = [];
    try { frames = el.querySelectorAll("iframe"); } catch (e) {}
    for (var i = 0; i < frames.length && i < 10; i++) {
      var f = frames[i], fr = f.getBoundingClientRect();
      if (!(fr.width * fr.height >= area * 0.5)) continue;
      var src = (f.getAttribute("src") || "").trim();
      if (src && !/^about:|^javascript:/i.test(src)) { var h = hostOf(src); return h && !sameSite(h, site) ? f.src : NO_LINK; }
      try {
        var d = f.contentDocument;
        var media = d ? d.querySelectorAll("img[src], video, source[src], script[src], iframe[src]") : [];
        for (var j = 0; j < media.length && j < 60; j++) {
          var u = media[j].currentSrc || media[j].getAttribute("src") || "", hh = hostOf(u);
          if (hh && /^https?:/i.test(new URL(u, location.href).href) && !sameSite(hh, site)) return new URL(u, location.href).href;
        }
      } catch (e2) {}
      return NO_LINK;
    }
    return null;
  }

  // the page no longer scrolls: overflow hidden on <html> or <body>, or a body pinned in place (the usual scroll locks)
  function scrollLocked() {
    try {
      var h = getComputedStyle(document.documentElement), b = document.body ? getComputedStyle(document.body) : null;
      // up and down alone: a page that hides its sideways overflow (Fox News, 2026-11-22: the bottom banner got a cover that stayed on the
      // screen in place of being tucked away) still scrolls, and the two-word overflow value read "hidden" for it
      var stops = function (cs) { var y = cs.overflowY || String(cs.overflow || "").split(" ").pop(); return /hidden|clip/.test(y); };
      return stops(h) || (b && (stops(b) || b.position === "fixed"));
    } catch (e) { return false; }
  }
  function soundingVideo(el) {
    try {
      var vs = el.querySelectorAll("video, audio");
      for (var i = 0; i < vs.length; i++) if (!vs[i].paused && !vs[i].muted && vs[i].volume > 0) return true;
    } catch (e) {}
    return false;
  }

  // tucked: the unit drawn as a speck under the PRISM button (a transform from its own layout box), presses off on the unit and
  // everything inside it; what was there is kept to be put back. The numbers are worked out again at each look (a turned phone).
  var SPECK = 6;
  function tuck(el) {
    var w = el.offsetWidth, h = el.offsetHeight, x = el.offsetLeft, y = el.offsetTop;   // its layout box, before any transform
    if (!(w > 0 && h > 0)) return "";
    var k = Math.min(SPECK / w, SPECK / h, 1);
    var cx = innerWidth - 34, cy = innerHeight - 29;   // the middle of the PRISM button (popups-ui.js: 14 px from the corner, 30 px tall; 44 px on a touch screen, and the point is inside both)
    var tx = cx - (w * k) / 2 - x, ty = cy - (h * k) / 2 - y;
    return { tx: tx, ty: ty, k: k, w: w, h: h, left: cx - (w * k) / 2, top: cy - (h * k) / 2, text: "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(5) + ")" };
  }
  // Drawn where it was meant to be (2026-11-25, a preview that showed only with the page at its top, in Safari on an iPhone): the
  // move is worked out from the unit's layout place, and browsers do not agree on that place for a fixed box once the page has
  // scrolled, nor does it hold under an ancestor that is itself moved. So the move is written, the unit is measured, and what is
  // off is added. Only a measure that shows the unit at the size asked for is believed.
  function settle(el, tx, ty, k, w, h, left, top) {
    var text = function () { return "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(5) + ")"; };
    el.style.setProperty("transform", text(), "important");
    try {
      var br = el.getBoundingClientRect();
      if (Math.abs(br.width - w * k) <= Math.max(1, w * k * 0.05) && (Math.abs(br.left - left) > 1 || Math.abs(br.top - top) > 1)) {
        tx += left - br.left; ty += top - br.top;
        el.style.setProperty("transform", text(), "important");
      }
    } catch (e) {}
    return el.style.getPropertyValue("transform");
  }
  function clearOn(rec) {
    var el = rec.el;
    if (!rec.saved) rec.saved = new Map();
    var keep = function (n, p) { if (!rec.saved.has(n)) rec.saved.set(n, {}); var s = rec.saved.get(n); if (!(p in s)) s[p] = [n.style.getPropertyValue(p), n.style.getPropertyPriority(p)]; };
    try {
      var tk = rec.previewing ? "" : tuck(el);
      // written only when it changes: a box that is watched for changes would be looked at again for each write, without end
      if (tk && !(rec.tfFrom === tk.text && el.style.getPropertyValue("transform") === rec.tfDone)) {
        ["transform", "transform-origin", "transition", "translate", "scale", "rotate"].forEach(function (p) { keep(el, p); });
        el.style.setProperty("transition", "none", "important");
        ["translate", "scale", "rotate"].forEach(function (p) { el.style.setProperty(p, "none", "important"); });
        el.style.setProperty("transform-origin", "0 0", "important");
        rec.tfDone = settle(el, tk.tx, tk.ty, tk.k, tk.w, tk.h, tk.left, tk.top); rec.tfFrom = tk.text;
      }
      var all = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*"), 0, MAX_INNER));
      all.forEach(function (n) { if (n.style && n.style.getPropertyValue("pointer-events") !== "none") { keep(n, "pointer-events"); n.style.setProperty("pointer-events", "none", "important"); } });
      el.setAttribute("data-prism-held", "clear");
    } catch (e) {}
  }
  function clearOff(rec) {
    try {
      if (rec.saved) rec.saved.forEach(function (props, n) {
        for (var p in props) { try { if (props[p][0]) n.style.setProperty(p, props[p][0], props[p][1]); else n.style.removeProperty(p); } catch (e) {} }
      });
      rec.saved = null;
      rec.el.removeAttribute("data-prism-held");
    } catch (e2) {}
  }
  function coverOn(rec) { clearOff(rec); rec.lockCover = scrollLocked() && !soundingVideo(rec.el); rec.mode = "cover"; rec.el.setAttribute("data-prism-held", "cover"); PV.inpageCovers.set(rec.el, { reason: rec.reason }); }
  function coverOff(rec) { PV.inpageCovers.delete(rec.el); try { rec.el.removeAttribute("data-prism-held"); } catch (e) {} }
  function hold(rec) {
    if (rec.kind === "offer") {
      // tucked away with the page's scroll put back; covered where the scroll cannot be put back
      if (!scrollLocked() || unlockOn(rec)) { rec.mode = "clear"; clearOn(rec); } else coverOn(rec);
      return;
    }
    if (rec.kind === "player") { rec.mode = "clear"; rec.parked = false; clearOn(rec); return; }
    if (scrollLocked() || soundingVideo(rec.el)) coverOn(rec);
    else { rec.mode = "clear"; clearOn(rec); }
  }
  // a held unit, looked at again: its inside may have grown (a new frame that takes presses), the page may have locked its scroll
  function keepHeld(rec) {
    if (rec.kind === "player") {
      // back in the article (no longer fixed) or given sound by the person: it is theirs again, and is tucked away once more only
      // when it docks without sound
      var docked = false; try { docked = getComputedStyle(rec.el).position === "fixed"; } catch (e) {}
      var mine = !docked || soundingVideo(rec.el);
      if (mine && !rec.parked) { clearOff(rec); rec.parked = true; }
      else if (!mine && rec.parked) { rec.parked = false; clearOn(rec); }
      else if (!mine) clearOn(rec);
      return;
    }
    if (rec.kind === "offer") { if (rec.mode === "clear") clearOn(rec); return; }
    // covered only because the page had stopped scrolling, and it scrolls again (an offer that stopped it has gone): tucked away
    if (rec.mode === "cover" && rec.lockCover && !scrollLocked() && !soundingVideo(rec.el)) { coverOff(rec); rec.mode = "clear"; clearOn(rec); return; }
    if (rec.mode === "clear") {
      if (scrollLocked() || soundingVideo(rec.el)) { coverOn(rec); return; }
      // an ad that grew or scrolled back into the place the page keeps for it: put back there, for the display cover
      if (rec.ad && !rec.previewing) {
        var home = inOwnPlace(rec.el, !rec.parked);
        if (home && !rec.parked) { clearOff(rec); rec.parked = true; return; }
        if (rec.parked) { if (home) return; rec.parked = false; }
      }
      clearOn(rec);
    }
  }

  // An ad fixed over the page at any z-index (2026-11-22, Fox News on an iPhone, 0.9.66: the banner fixed to the bottom of the
  // screen, `.ad-container` at z-index 999, kept a cover on it over what the person read; asked that it go like any pop). The pop
  // guard looked only at the top of the stack. A box the display rules have already covered as an ad, when it sits in a fixed
  // layer that is mostly that ad and takes half the screen or less, is a pop too: tucked away, counted and listed, and its cover
  // goes with it. The source is the display rule that named the ad; the same things are left alone as for any pop.
  // In its own place (2026-11-25, a report from CNN on an iPhone: a black space where the ad at the head of the page is). CNN's
  // head ad is a fixed box, and the page keeps a box of the same size for it in the flow, black, right under it. Tucked away, the
  // ad left that black box bare. A fixed ad whose parent keeps its place, at its size and on the screen, lies in the page and not
  // over it: it is covered like any ad in the page, and tucked away only while that place is off the screen and the ad is not.
  function inOwnPlace(el, tucked) {
    try {
      var p = el.parentElement;
      if (!p || p === document.body || p === document.documentElement) return false;
      if (getComputedStyle(p).position === "fixed") return false;
      var w = el.offsetWidth, h = el.offsetHeight, pr = p.getBoundingClientRect();
      if (!(w >= MIN_SIDE && h >= MIN_SIDE)) return false;
      if (pr.width < w * 0.9 || pr.height < h * 0.9 || pr.width > w * 1.3 + 20 || pr.height > h * 1.3 + 20) return false;
      var over = function (a, b) { return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)); };
      var win = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      if (over(pr, win) < w * h * 0.7) return false;                    // the place is off the screen: the ad floats over the page
      return tucked ? true : over(pr, el.getBoundingClientRect()) >= w * h * 0.7;
    } catch (e) { return false; }
  }
  function fixedOver(t) {
    var n = t;
    for (var i = 0; n && n.nodeType === 1 && i < 8 && n !== document.body && n !== document.documentElement; i++, n = n.parentElement) {
      var cs; try { cs = getComputedStyle(n); } catch (e) { return null; }
      if (cs.position !== "fixed") continue;
      if (n.hasAttribute("data-prism-ui") || n.hasAttribute("data-prism-veil") || n.getAttribute("data-prism-held")) return null;
      if (!onScreen(n)) return null;
      var r = n.getBoundingClientRect(), tr = t.getBoundingClientRect(), a = r.width * r.height;
      if (a > innerWidth * innerHeight * 0.5 || tr.width * tr.height < a * 0.3) return null;
      if (inOwnPlace(n, false)) return null;
      return n;
    }
    return null;
  }
  function adPop(el, why) {
    try { var fs = document.fullscreenElement || document.webkitFullscreenElement; if (fs && (fs === el || el.contains(fs) || fs.contains(el))) return null; } catch (e) {}
    if (anyMark(el, LEAVE_HARD) || adsAsk(el)) return null;
    return { dest: destOf(el) || creativeFrame(el) || NO_LINK, reason: "fixed over the page, " + String(why || "an ad").split(":")[0] };
  }
  function judge(el, adWhy, popIn) {
    var policy = PV.popupPolicy; if (!policy) return;
    var rec = seen.get(el);
    if (rec) { if (rec.held) keepHeld(rec); return; }
    var pop = popIn || PV.inpagePopOf(el) || (adWhy ? adPop(el, adWhy) : null); if (!pop) return;
    var attempt = { site: site, url: pop.dest }, d;
    try { d = policy.evaluate(attempt); } catch (e) { return; }
    rec = { el: el, url: pop.dest, reason: pop.reason, held: d.action === "intercept", mode: "", ad: !!adWhy, kind: pop.kind || "" };
    seen.set(el, rec);
    if (!rec.held) return;
    hold(rec); held.push(rec);
    try { policy.record(attempt, { action: "intercept", reason: "in the page: " + pop.reason + " (" + d.reason + ")" }); } catch (e2) {}
  }
  function scan() {
    if (window.__prismVeilNS !== PV) return;   // a newer copy took the namespace over (a reload of the scripts): it does the looking
    var kids = [];
    try { kids = Array.prototype.slice.call(document.documentElement.children); } catch (e) {}
    try { if (document.body) kids = kids.concat(Array.prototype.slice.call(document.body.children)); } catch (e2) {}
    kids.forEach(function (k) {
      if (k === document.body || k === document.head) return;
      var u = null; try { u = unitIn(k); } catch (e3) {}
      if (u) judge(u);
      var w = u || k;
      if (!seen.has(w) && (u || maybeUnit(k))) watch(w);
    });
    try {
      (PV.coveredEls ? PV.coveredEls() : []).forEach(function (t) {
        var w = PV.whyFor ? PV.whyFor(t) || "" : "";
        if (/^in-page pop/.test(w)) return;   // a pop this guard holds by a cover already
        var f = fixedOver(t); if (f) judge(f, w || "an ad");
      });
      held.forEach(function (rec) { if (rec.ad && rec.el.isConnected) keepHeld(rec); });
    } catch (e4) {}
    try {
      floatingPlayers().forEach(function (f) { if (!seen.has(f)) { var pp = playerPop(f); if (pp) judge(f, "", pp); } });
      dialogBoxes().forEach(function (b) { if (!seen.has(b)) { var dp = dialogPop(b); if (dp) judge(b, "", dp); } });
      held.forEach(function (rec) { if ((rec.kind === "player" || rec.kind === "offer") && rec.el.isConnected) keepHeld(rec); });
      if (unlock && !unlock.keep && !(unlock.rec.held && shown(unlock.rec.el))) unlockOff();   // the offer has gone, by the page or by the person's Always allow
    } catch (e5) {}
    held = held.filter(function (rec) { if (rec.el.isConnected) return true; coverOff(rec); return false; });
    tidyWatch();
  }
  // A unit that is not yet a pop is watched closely for a short time (2026-11-22, a report from aether.ist on an iPhone: a pop
  // showed for a second or two before it was held; measured in Firefox as a phone, two units stood in view for 991 and 609 ms).
  // The page puts the box in first and fills or shows it after, by a change inside it or a style that fades in, and neither is a
  // change to the page's own children, so only the look once a second found it. Watched: a page-level box at the top of the
  // stack, or one of no size (the kind that carries a unit). While one is watched every change in it brings a look before the next
  // frame, and a look is taken every 100 ms for a fade. At most 8 boxes, 20 seconds each; the page's own content is never watched.
  var watching = new Map(), fast = 0, WATCH_MS = 20000, WATCH_MAX = 8;
  function maybeUnit(k) {
    try {
      if (k.hasAttribute("data-prism-ui") || k.hasAttribute("data-prism-veil") || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(k.tagName)) return false;
      var cs = getComputedStyle(k);
      if (cs.position === "fixed" && zOf(cs) >= Z_MIN) return true;
      var r = k.getBoundingClientRect();
      return (r.width < MIN_SIDE || r.height < MIN_SIDE) && k.children.length > 0;
    } catch (e) { return false; }
  }
  function watch(el) {
    if (watching.has(el) || watching.size >= WATCH_MAX || watchedOnce.has(el)) return;
    var mo = null;
    try { mo = new MutationObserver(function () { scanWatched(); }); mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "src", "hidden"] }); } catch (e) {}
    watching.set(el, { mo: mo, until: Date.now() + WATCH_MS }); watchedOnce.add(el);
    if (!fast) fast = setInterval(scanWatched, 100);
  }
  // The close watch looks at the watched boxes alone (2026-11-26, B-567: it ran the whole look, every page-level box, the dialogs
  // and the players, ten times a second and on every change in a watched box, 1.6 s of a large news page's first 20 s). The whole
  // look stays once a second and on a change to the page's own children.
  function scanWatched() {
    if (window.__prismVeilNS !== PV) return;
    watching.forEach(function (w, el) {
      if (!el.isConnected) return;
      var u = null; try { u = unitIn(el); } catch (e) {}
      if (u) judge(u);
    });
    tidyWatch();
  }
  var watchedOnce = new WeakSet();   // a box that was watched its time and never became a pop is not watched again
  function tidyWatch() {
    if (!watching.size) return;
    var now = Date.now();
    watching.forEach(function (w, el) {
      if (!seen.has(el) && el.isConnected && now < w.until) return;
      try { if (w.mo) w.mo.disconnect(); } catch (e) {}
      watching.delete(el);
    });
    if (!watching.size && fast) { clearInterval(fast); fast = 0; }
  }
  // the person's Always allow (or a removed one) is read again over the units already held
  function rejudge() {
    var policy = PV.popupPolicy; if (!policy) return;
    held = held.filter(function (rec) {
      if (!rec.el.isConnected) { coverOff(rec); return false; }
      var d; try { d = policy.evaluate({ site: site, url: rec.url }); } catch (e) { return true; }
      if (d.action !== "intercept") { rec.held = false; if (rec.mode === "cover") coverOff(rec); else clearOff(rec); handBack(rec); return false; }
      return true;
    });
  }

  // ---- for the panel (popups-ui.js, 2026-11-24, asked that a held unit can be let through and looked at before that). A row of
  // the panel names a destination; the units held under it are found by that name.
  function heldFor(dest) { return held.filter(function (rec) { return rec.held && rec.el.isConnected && hostOf(rec.url) === dest; }); }
  PV.inpageHeld = function (dest) { return heldFor(dest).length > 0; };
  // Show: the unit is put back for this visit and is not held again on this page; nothing is remembered (Always allow remembers)
  PV.inpageShow = function (dest) {
    previewOff();
    var list = heldFor(dest);
    list.forEach(function (rec) { rec.held = false; if (rec.mode === "cover") coverOff(rec); else clearOff(rec); handBack(rec); });
    held = held.filter(function (rec) { return rec.held; });
    return list.length;
  };
  // Preview: the keyhole's way. The unit is tucked away by a transform that draws it as a speck; for a preview the same transform
  // draws it small but readable, in the upper part of the window, over the page, for a few seconds. It takes no press, and the first
  // press or scroll anywhere ends it. Only a unit that is tucked away has one (a covered unit is on the screen already).
  var preview = null, PREVIEW_MS = 6000;
  function previewOff() {
    if (!preview) return;
    var pv = preview; preview = null;
    clearTimeout(pv.timer);
    try { removeEventListener("pointerdown", pv.end, true); removeEventListener("scroll", pv.end, true); removeEventListener("keydown", pv.end, true); } catch (e) {}
    pv.props.forEach(function (x) { try { if (x[1]) pv.rec.el.style.setProperty(x[0], x[1], x[2]); else pv.rec.el.style.removeProperty(x[0]); } catch (e) {} });
    (pv.raised || []).forEach(function (x) { try { if (x[1]) x[0].style.setProperty("z-index", x[1], x[2]); else x[0].style.removeProperty("z-index"); } catch (e) {} });
    pv.rec.previewing = false;
    if (pv.rec.held && pv.rec.mode === "clear" && pv.rec.el.isConnected) clearOn(pv.rec);   // back to the speck
    if (pv.onEnd) { try { pv.onEnd(); } catch (e) {} }
  }
  PV.inpagePreviewEnd = function () { previewOff(); };
  // onEnd: told when the preview ends, however it ends. ms: how long it stays (the panel's own, with buttons under it, stays longer).
  // The answer is the place the unit is drawn at, or false.
  PV.inpagePreview = function (dest, onEnd, ms) {
    var was = preview && hostOf(preview.rec.url) === dest;
    previewOff();
    if (was) return false;   // a second press on the same row ends it
    var rec = heldFor(dest).filter(function (r) { return r.mode === "clear" && !r.parked; })[0];
    if (!rec) return false;
    var el = rec.el, w = el.offsetWidth, h = el.offsetHeight;
    if (!(w > 0 && h > 0)) return false;
    var maxW = Math.min(innerWidth - 28, 360), maxH = Math.min(innerHeight * 0.4, 280);
    var k = Math.min(maxW / w, maxH / h, 1);
    var left = (innerWidth - w * k) / 2, top = Math.max(14, Math.round(innerHeight * 0.18));
    var tx = left - el.offsetLeft, ty = top - el.offsetTop;   // below a page's own top bar, which a unit low in the page's stack would be drawn under
    var props = ["transform", "z-index", "outline", "outline-offset", "box-shadow"].map(function (n) { return [n, el.style.getPropertyValue(n), el.style.getPropertyPriority(n)]; });
    rec.previewing = true;
    settle(el, tx, ty, k, w, h, left, top);
    el.style.setProperty("z-index", "2147483646", "important");
    // The unit's own z-index counts only inside the layer it lies in (2026-11-25, CNN in Safari on an iPhone: the preview's buttons
    // came and no preview; the head ad lies in the page's sticky header, a layer the stories paint over). Every layer on the way
    // up is lifted for the time of the preview and put back after.
    var raised = [];
    try {
      for (var up = el.parentElement, lv = 0; up && lv < 12 && up !== document.documentElement; up = up.parentElement, lv++) {
        if (getComputedStyle(up).position === "static") continue;
        raised.push([up, up.style.getPropertyValue("z-index"), up.style.getPropertyPriority("z-index")]);
        up.style.setProperty("z-index", "2147483646", "important");
      }
    } catch (eR) {}
    el.style.setProperty("outline", Math.max(2, Math.round(2 / k)) + "px solid #F2B14C", "important");
    el.style.setProperty("box-shadow", "0 0 0 " + Math.round(8 / k) + "px rgba(8,10,14,.72)", "important");
    // a press on PRISM's own controls (the buttons under the preview) is theirs to answer and does not end it here
    var end = function (e) {
      try { if (e && e.type === "pointerdown" && e.composedPath && e.composedPath().some(function (n) { return n && n.tagName === "PRISM-POPUP-BUTTON"; })) return; } catch (e2) {}
      previewOff();
    };
    preview = { rec: rec, props: props, raised: raised, end: end, onEnd: onEnd, timer: setTimeout(function () { previewOff(); }, ms > 0 ? ms : PREVIEW_MS) };
    // the press that asked for the preview is over before these listen
    setTimeout(function () { if (preview && preview.rec === rec) { addEventListener("pointerdown", end, true); addEventListener("scroll", end, true); addEventListener("keydown", end, true); } }, 0);
    var at = null; try { var br = el.getBoundingClientRect(); at = { top: br.top, bottom: br.bottom, left: br.left, width: br.width }; } catch (e3) {}
    return at || true;
  };

  // For a report (2026-11-25): what is held in the page and how it lies, so a preview that shows nothing can be read from one
  // report. Tags, class names, boxes and styles only.
  PV.inpageDiag = function () {
    var d = function (n) {
      try {
        var r = n.getBoundingClientRect(), g = getComputedStyle(n);
        return n.tagName + "." + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || "").slice(0, 40) + " " + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " lay " + n.offsetLeft + "," + n.offsetTop + " " + n.offsetWidth + "x" + n.offsetHeight +
          " " + g.position + " z" + g.zIndex + " o" + g.opacity + " " + g.visibility + " " + g.display + (g.transform !== "none" ? " tf" + String(g.transform).slice(0, 48) : "") + (/hidden|clip/.test(g.overflow) ? " ov" : "") + (g.clipPath && g.clipPath !== "none" ? " clip" : "");
      } catch (e) { return "?"; }
    };
    return held.slice(0, 4).map(function (rec) {
      var o = { mode: rec.mode, parked: !!rec.parked, previewing: !!rec.previewing, why: String(rec.reason || "").slice(0, 60), win: innerWidth + "x" + innerHeight + " y" + Math.round(scrollY), el: d(rec.el), inside: [], up: [] };
      try { Array.prototype.slice.call(rec.el.children, 0, 3).forEach(function (c) { o.inside.push(d(c)); if (c.firstElementChild) o.inside.push(d(c.firstElementChild)); }); } catch (e) {}
      try { for (var n = rec.el.parentElement, i = 0; n && i < 5 && n !== document.documentElement; n = n.parentElement, i++) o.up.push(d(n)); } catch (e2) {}
      return o;
    });
  };

  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan(); }); }
  function start() {
    try {
      var mo = new MutationObserver(soon);
      mo.observe(document.documentElement, { childList: true });
      if (document.body) mo.observe(document.body, { childList: true });
    } catch (e) {}
    // a unit put in place empty or hidden and filled or shown later by a change of its style is found by the next look (no watch on
    // every style change of the page: a busy page makes thousands)
    setInterval(scan, 1000);
    try { if (PV.popupPolicy) PV.popupPolicy.on(function (ev) { if (ev.type === "policy") rejudge(); }); } catch (e2) {}
    scan();
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
