/*
  PRISM - the PRISM button + Popup Control Center (spec section 30). Isolated
  world. This is a SUBSCRIBER: it renders what prism-core's PopupPolicy says
  and forwards the human's taps back to it. It never computes policy.

  - Store of record: chrome.storage.local via a StoreDriver shim; the policy
    snapshot is pushed to the main-world hook (which intercepts window.open).
  - The pill: Shadow-DOM isolated, bottom-right, translucent, collapsible to
    an edge tab (remembered per site). Event-driven label morph paced by
    core's MorphCoalescer: bursts coalesce, one morph per ~10s, ~3s hold,
    aria-live. No pulsing, no alarm colors, no unprompted expansion; reduced
    motion dissolves instead of morphing.
  - The panel (one button on the page, 2026-10-27): the main switch, Report
    an ad and Reveal 15 s on top; then the popup ledger rows with exactly two
    verbs, Open and Always allow;
    the post-open nudge; "Popups you've allowed" with Remove; per-site block
    all; hide the button here (interception continues; the toolbar badge is
    the fallback surface).
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  // Chromium 151 stopped exposing a content script's top-level `var` on
  // window (measured 2026-08-28: window.PrismPopups undefined while the bare
  // identifier resolves). Resolve the bare name first, window second.
  var core = (typeof PrismPopups !== "undefined" && PrismPopups) || window.PrismPopups;
  if (!core) { if (PV.recordError) PV.recordError("popups-ui: PrismPopups missing (core-popups.js did not load)"); return; }
  if (window !== window.top) return;   // one button per page, top frame only
  if (PV.recordError) PV.recordError("popups-ui: loaded");

  var site = location.hostname;
  if (!site) return;

  // ---- store shim (chrome.storage.local) ----------------------------------
  var cache = {};
  var store = {
    get: function (k) { return Promise.resolve(cache[k] == null ? null : cache[k]); },
    set: function (k, v) { cache[k] = v; try { var o = {}; o["pv:" + k] = v; chrome.storage.local.set(o); } catch (e) {} },
  };
  var policy = new core.PopupPolicy(store);
  PV.popupPolicy = policy;   // the in-page pops (src/inpage-pops.js) are judged and counted by the same policy
  var morph = new core.MorphCoalescer({ hold: 5000 });

  function pushSnapshot() {
    // Only this site's entry goes to the page's world (2026-11-18): the hook judges this page's popups and needs no more, and any
    // script of the page can listen here, so what other sites were allowed must not be in it
    try {
      var all = policy.snapshot(), mine = { global: all.global, sites: {} }, here = location.hostname;
      if (all.sites && Object.prototype.hasOwnProperty.call(all.sites, here)) mine.sites[here] = all.sites[here];
      document.dispatchEvent(new CustomEvent("prism-popup-policy", { detail: { state: JSON.stringify(mine) } }));
    } catch (e) {}
  }
  document.addEventListener("prism-popup-ready", pushSnapshot);
  PV.onReclaimChange = function () { if (panelOpen) renderPanel(); };
  PV.onCredChange = function () { if (panelOpen) renderPanel(); };
  PV.onArtChange = function () { if (panelOpen) renderPanel(); };
  // The toolbar popup edits the same store: re-read on change so an
  // allowance, a cleared ledger, or "Show it" takes effect here at once.
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== "local") return;
      var hit = false;
      Object.keys(ch).forEach(function (k) { if (k.indexOf("pv:popups:") === 0) { cache[k.slice(3)] = ch[k].newValue; hit = true; } });
      if (hit) policy.load().then(function () { applyPrefs(effectivePrefs()); pushSnapshot(); if (panelOpen) renderPanel(); badge(); });
    });
  } catch (e) {}

  // ---- the human's last click (for the tab backstop's click-consistency) ----
  var gesture = { url: "", at: 0 };
  // The link under an event. Inside an open shadow root the window is told only the outermost host, so the event's own path is read first.
  function linkOf(e) {
    try {
      var p = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < p.length; i++) { if (p[i] && p[i].matches && p[i].matches("a[href]")) return p[i]; }
      return e.target && e.target.closest ? e.target.closest("a[href]") : null;
    } catch (x) { return null; }
  }
  ["pointerdown", "mousedown", "auxclick", "keydown"].forEach(function (ev) {
    addEventListener(ev, function (e) {
      var a = linkOf(e), href = "";
      try { if (a) href = a.href; } catch (x) {}
      gesture = { url: href, at: Date.now() };
      if (ev !== "auxclick" && e.button !== 2) menuPick = null;   // a new press on the page: the menu is gone and its link with it
    }, true);
  });
  function recentGesture() { return (Date.now() - gesture.at < 1500) ? { url: gesture.url, windowsThisGesture: 1 } : null; }
  // A link opened from the browser's own menu (right-click, "Open link in new tab" or "in new window") is the person's ask however long
  // they read the menu (2026-11-10: such a window to another site closed as it opened, the press being older than a plain click's
  // 1.5 s). The page hears nothing while the menu is up, so the link under the menu stays the person's pick until their next press
  // on the page, for two minutes at most, for one open, and only for that link's own address: a tab to anywhere else is judged as before.
  var MENU_MS = 120000, menuPick = null;
  addEventListener("contextmenu", function (e) {
    var a = linkOf(e), href = "";
    try { if (a) href = a.href; } catch (x) {}
    menuPick = href ? { a: a, url: href, at: Date.now() } : null;
  }, true);
  function sameAddress(x, y) { return !!x && !!y && String(x).split("#")[0] === String(y).split("#")[0]; }
  function menuAsk(url) {
    var m = menuPick; if (!m || Date.now() - m.at > MENU_MS) { menuPick = null; return false; }
    var now = ""; try { now = m.a.href; } catch (x) {}   // a page may rewrite the link after the menu opened (a click tracker)
    if (!sameAddress(url, m.url) && !sameAddress(url, now)) return false;
    menuPick = null; return true;
  }

  // ---- events from the hook -------------------------------------------------
  document.addEventListener("prism-popup", function (e) {
    var d = e.detail; if (!d || !d.attempt || !d.decision) return;
    policy.record(d.attempt, d.decision);
  });
  // This visit: what the page tried to open since it loaded - the toolbar's
  // one view, and the top of the panel. Memory only; the store keeps history.
  var visitSince = Date.now(), visit = {};
  function visitRows() {
    return Object.keys(visit).map(function (d) { return visit[d]; }).sort(function (a, b) { return b.count - a.count || b.last - a.last; });
  }
  policy.on(function (ev) {
    if (ev.type === "intercepted") {
      var v = visit[ev.dest] || (visit[ev.dest] = { dest: ev.dest, count: 0, url: ev.url, reason: ev.reason, last: 0 });
      v.count += 1; v.url = ev.url || v.url; v.reason = ev.reason; v.last = Date.now();
      morph.add(1); scheduleMorph(); badge(); if (panelOpen) renderPanel();
    }
    if (ev.type === "policy") { pushSnapshot(); if (panelOpen) renderPanel(); }
    if (ev.type === "prefs" && (ev.site === site || ev.site === "*")) applyPrefs(effectivePrefs());
  });
  function badge() {
    var n = 0; visitRows().forEach(function (r) { n += r.count; });
    try { chrome.runtime.sendMessage({ type: "prism-popup-badge", count: n }); } catch (e) {}
  }

  // ---- the pill -------------------------------------------------------------
  var host, root, pill, label, mk, panel, scrim = null, panelOpen = false, prefs = {};
  // Source reliability of THIS site (spec section 5) on the pill: the
  // three-disk cylinder (one disk per source) + a border tinted by the worst
  // disk. Purely informative; the panel carries the words and Why? buttons.
  function paintMark(ms) {
    if (!pill) return;
    var show = !!(ms && PV.credAnyInfo && PV.credAnyInfo(ms));
    pill.classList.toggle("marked", show);
    mk.textContent = "";
    if (show) {
      mk.appendChild(PV.credGlyph(ms, 0.9));
      var w = PV.credWorst(ms); pill.style.borderColor = w ? PV.credColor(w) : "";
      pill.__credMs = ms; pill.title = "";
    } else { pill.style.borderColor = ""; pill.title = ""; pill.__credMs = null; }
  }
  PV.setPillMark = paintMark;
  var reduced = false;
  try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var CSS = "\
:host{all:initial}\
*{box-sizing:border-box}\
.pill{position:fixed;right:14px;bottom:14px;z-index:2147483647;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px;border-radius:15px;\
background:rgba(20,23,28,.55);color:#F2F4F7;border:1px solid rgba(255,255,255,.12);font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em;\
opacity:.45;cursor:pointer;user-select:none;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:opacity .25s,transform .25s,right .25s,width .25s}\
.pill:hover,.pill.on{opacity:1}\
.pill .lbl{white-space:nowrap;transition:opacity .35s}\
.pill.morph .lbl{color:#F0A83C}\
.pill.glow{opacity:1;border-color:#F0A83C;box-shadow:0 0 12px 3px rgba(240,168,60,.75)}\
.pill.off .lbl{color:#A3ABB7}\
.pill.off{opacity:.6}\
.acts{display:flex;gap:8px;margin:6px 0 2px}\
.acts .btn{flex:1}\
.pill.dissolve .lbl{opacity:0}\
.pill.collapsed{right:14px;padding:0;width:12px;height:44px;border-radius:7px;justify-content:center;opacity:.7;background:rgba(240,168,60,.9);border-color:rgba(0,0,0,.55);box-shadow:0 0 0 1px rgba(255,255,255,.4),0 2px 6px rgba(0,0,0,.45);-webkit-backdrop-filter:none;backdrop-filter:none}\
.pill.collapsed .lbl,.pill.collapsed .x{display:none}\
.pill .x{opacity:.7;font-size:33px;line-height:1;display:inline-flex;align-items:center;justify-content:center;align-self:stretch;width:36px;margin:0 -12px 0 -6px;padding-bottom:7px;border-radius:0 14px 14px 0}\
.pill .x:hover{opacity:1;background:rgba(255,255,255,.14)}\
.pill.hidden{display:none}\
.pill .mk{display:none;line-height:0;flex:none;filter:drop-shadow(0 0 1px rgba(255,255,255,.7))}\
.srcrow{display:flex;align-items:center;gap:10px;min-height:36px;padding:3px 0;border-top:1px solid rgba(255,255,255,.07);color:#D4DAE3}\
h3+.srcrow{border-top:0}\
.srcrow .nm{flex:1;min-width:0}\
.srcrow .nm .meta{color:#C0C8D2;font-size:11px;display:block}\
.disk{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}\
.pill.marked .mk{display:inline-block}\
.pill.marked{opacity:.8}\
.pill.collapsed .mk{display:none}\
@media (pointer:coarse){.pill{height:44px;padding:0 16px;border-radius:22px;font-size:15px;opacity:.9;background:rgba(20,23,28,.82);border-color:rgba(255,255,255,.3);box-shadow:0 2px 8px rgba(0,0,0,.45)}.pill.off{opacity:.8}.pill .x{width:46px;margin:0 -16px 0 -6px;border-radius:0 22px 22px 0}.pill.collapsed{width:44px;height:44px;border-radius:50%;opacity:.9}.panel{bottom:66px}}\
.scrim{position:fixed;inset:0;z-index:2147483646;background:transparent}.panel{position:fixed;right:14px;bottom:52px;z-index:2147483647;width:min(400px,92vw);max-height:70vh;overflow:auto;padding:0;border-radius:14px;\
background:#14171C;color:#F2F4F7;border:1px solid #2C333E;box-shadow:0 18px 60px rgba(0,0,0,.5);font:13px/1.45 'Segoe UI Variable Text','Segoe UI',-apple-system,Roboto,sans-serif}\
.panel h2{display:flex;align-items:center;gap:8px;margin:16px 0 4px;font-size:18px;line-height:1.2;font-weight:600}\
.panel h2 span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.panel h2 img{flex:none;width:18px;height:18px;border-radius:4px}\
.panel h2 img[hidden]{display:none}\
.ptop{display:flex;align-items:center;gap:16px;padding:12px 24px;background:#0A0C0F;border-bottom:1px solid #2C333E;position:sticky;top:0;z-index:1}\
.ptop .brand{font:700 15px/1 'Segoe UI Variable Display','Segoe UI',-apple-system,Roboto,sans-serif;letter-spacing:.34em;color:#F0A83C}\
.pbody{padding:0 24px 16px}\
.pfoot{display:flex;align-items:center;gap:10px;padding:10px 24px;background:#0A0C0F;border-top:1px solid #2C333E;color:#C0C8D2;font-size:12px}\
.pfoot span{flex:1}\
.toggle.master input{margin:0}\
.toggle.master{border:0;min-height:0;padding:0;margin-left:auto;gap:14px;color:#F2F4F7;font:600 18px/1.2 'Segoe UI Variable Display','Segoe UI',-apple-system,Roboto,sans-serif}\
h2+.row{border-top:0}\
.toggle input{width:108px;height:28px;border-radius:8px;border:1px solid #2C333E;background:#0A0C0F;box-shadow:inset 0 2px 4px rgba(0,0,0,.7)}\
.toggle input::before{content:'Off';left:2px;top:2px;width:52px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font:600 11px/1 'Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7;background:linear-gradient(#4A5362,#2F3642);box-shadow:inset 0 1px 0 rgba(255,255,255,.22),0 1px 3px rgba(0,0,0,.8)}\
.toggle input:checked{background:#0A0C0F;border-color:#F0A83C}\
.toggle input:checked::before{content:'On';transform:translateX(50px);color:#0A0C0F;background:linear-gradient(#F7C469,#E39A2C);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 1px 3px rgba(0,0,0,.8)}\
.panel .sub{color:#D4DAE3;font-size:12px;margin-bottom:6px}\
.panel h3{margin:16px 0 2px;font:600 14px/1.3 'Segoe UI Variable Text','Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7}\
.row{display:flex;align-items:center;gap:10px;min-height:36px;padding:3px 0;border-top:1px solid rgba(255,255,255,.07);color:#D4DAE3}\
.row:first-of-type{border-top:0}\
.row .dest{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.row .meta{color:#C0C8D2;font-size:11px;display:block}\
.btn{font:600 12px/1 'Segoe UI Variable Text','Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7;background:#2A2F38;border:1px solid #2C333E;border-radius:8px;height:28px;padding:0 12px;cursor:pointer;white-space:nowrap}\
.panel .btn{min-width:108px;text-align:center}\
.panel .nudge .btn{min-width:56px}\
.btn:hover{border-color:#F0A83C}\
.btn{background:linear-gradient(#3A414D,#262B34);border-color:#0A0C0F;box-shadow:inset 0 1px 0 rgba(255,255,255,.16),0 1px 3px rgba(0,0,0,.7)}\
.btn.primary{background:linear-gradient(#F7C469,#E39A2C);color:#0A0C0F;border-color:#0A0C0F;box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 1px 3px rgba(0,0,0,.8)}\
.btn:active{box-shadow:inset 0 2px 4px rgba(0,0,0,.6);transform:translateY(1px)}\
.nudge{display:flex;align-items:center;gap:8px;margin:6px 0 2px;padding:7px 10px;border-radius:9px;background:rgba(240,168,60,.12);border:1px solid rgba(240,168,60,.35);font-size:13px}\
.nudge span{flex:1}\
.empty{color:#D4DAE3;font-size:13px;padding:6px 0}\
.toggle{display:flex;align-items:center;gap:10px;min-height:36px;font-size:13px;padding:3px 0;cursor:pointer;color:#D4DAE3;border-top:1px solid rgba(255,255,255,.07)}\
.toggle:hover{color:#F2F4F7}\
.toggle>.btn{margin-left:auto}\
h3+.row,.sub+.row{border-top:0}\
h2+.toggle,h3+.toggle,.sub+.toggle{border-top:0}\
.toggle input{-webkit-appearance:none;appearance:none;order:2;margin:0 0 0 auto;flex:none;position:relative;cursor:pointer}\
.toggle input::before{position:absolute;transition:transform .15s}\
.toggle input:disabled{opacity:.45;cursor:default}\
.toggle input:focus-visible,.btn:focus-visible{outline:2px solid #F0A83C;outline-offset:2px}\
@media (prefers-reduced-motion:reduce){.pill{transition:none}}\
";

  function mount() {
    if (host) return;
    host = document.createElement("prism-popup-button");
    host.setAttribute("data-prism-veil", "1");
    // the host is an unregistered custom element, and a page may hide every one it does not know (Reddit: :not(:defined) is hidden,
    // 2026-11-04, the button gone on Reddit and the popup's switch unable to bring it back): inline !important outranks the page
    host.style.setProperty("visibility", "visible", "important");
    host.style.setProperty("display", "inline", "important");
    host.style.setProperty("opacity", "1", "important");
    root = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style"); style.textContent = CSS; root.appendChild(style);
    pill = document.createElement("div"); pill.className = "pill"; pill.setAttribute("role", "button"); pill.setAttribute("tabindex", "0");
    pill.setAttribute("aria-label", "PRISM popup control center"); pill.setAttribute("aria-live", "polite");
    label = document.createElement("span"); label.className = "lbl"; label.textContent = "PRISM";
    mk = document.createElement("span"); mk.className = "mk"; pill.appendChild(mk);
    var x = document.createElement("span"); x.className = "x"; x.textContent = "›"; x.title = "Collapse";
    pill.appendChild(label); pill.appendChild(x);
    pill.addEventListener("click", function (e) { e.stopPropagation(); if (PV.cancelReportPick && PV.cancelReportPick()) return; if (pill.classList.contains("collapsed")) { setCollapsed(false); return; } togglePanel(); });
    // this site's reliability: the styled card above the pill (same card as
    // the link marks), not a browser title bubble
    pill.addEventListener("mouseenter", function () { if (pill.__credMs && PV.showCredTip && !panelOpen) PV.showCredTip(pill, pill.__credMs, "Open the panel for the Why? links"); });
    pill.addEventListener("mouseleave", function () { if (PV.hideCredTip) PV.hideCredTip(pill); });
    x.addEventListener("click", function (e) { e.stopPropagation(); setCollapsed(true); });
    pill.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pill.click(); } });
    root.appendChild(pill);
    if (PV.credSite) paintMark(PV.credSite());
    // The guard (src/popups-guard.js) stops page-bound input at window capture
    // and asks us which element inside the closed root it was really for.
    // Claim by COORDINATES, not by hit-testing: sites that paint an
    // invisible click-catcher above everything (aether.ist re-inserts one on
    // every pointer move) would otherwise receive the click. If the point is
    // inside the pill or the open panel, it is ours.
    function inRect(r, x, y) { return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    PV.uiHit = function (e) {
      if (!pill || prefs.hidden || typeof e.clientX !== "number") return false;
      if (inRect(pill.getBoundingClientRect(), e.clientX, e.clientY)) return true;
      if (panelOpen && panel && inRect(panel.getBoundingClientRect(), e.clientX, e.clientY)) return true;
      return false;
    };
    PV.uiPick = function (e) {
      if (e && typeof e.clientX === "number") {
        // smallest element of ours whose box contains the point
        var best = null, bestA = Infinity, all = root.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
          var n = all[i]; if (n.tagName === "STYLE") continue;
          var r = n.getBoundingClientRect(); if (!inRect(r, e.clientX, e.clientY)) continue;
          var a = r.width * r.height; if (a < bestA) { bestA = a; best = n; }
        }
        if (best) return best;
      }
      try { if (root.activeElement) return root.activeElement; } catch (x) {}
      return pill;
    };
    (document.body || document.documentElement).appendChild(host);
    applyPrefs(prefs);
    dodge();
    keepOnTop();
  }
  // A collapse is the person's, not the site's (2026-11-04): kept under "*" as well as the site, so the oval stays the
  // oval on every site until a press opens it again; opening it clears both. The per-site hidden switch is untouched.
  function setCollapsed(c) { policy.setCollapsed("*", c); policy.setCollapsed(site, c); }
  function effectivePrefs() { var p = policy.prefs(site); try { if (policy.prefs("*").collapsed) p.collapsed = true; } catch (e) {} return p; }
  function applyPrefs(p) {
    prefs = p || {};
    if (!pill) return;
    pill.classList.toggle("collapsed", !!prefs.collapsed);
    pill.classList.toggle("hidden", !!prefs.hidden || fullscreenNow());
    if (prefs.collapsed || prefs.hidden) closePanel();
    scheduleMorph();   // a notice that waited for the button (made, shown again, out of fullscreen) is due now
  }
  function fullscreenNow() {
    try { return !!(document.fullscreenElement || document.pictureInPictureElement); } catch (e) { return false; }
  }
  document.addEventListener("fullscreenchange", function () { applyPrefs(prefs); });
  document.addEventListener("visibilitychange", function () { scheduleMorph(); });
  document.addEventListener("enterpictureinpicture", function () { applyPrefs(prefs); }, true);
  document.addEventListener("leavepictureinpicture", function () { applyPrefs(prefs); }, true);

  // Dodge site cookie bars / players fixed to the bottom edge.
  function dodge() {
    if (!pill) return;
    var lift = 0;
    try {
      var all = document.body.querySelectorAll("*");
      for (var i = 0; i < all.length && i < 2500; i++) {
        var el = all[i];
        if (el === host || el.hasAttribute("data-prism-veil") || el.hasAttribute("data-prism-ui")) continue;
        var cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        var r = el.getBoundingClientRect();
        if (r.height <= 0 || r.height > innerHeight * 0.4 || r.width < innerWidth * 0.4) continue;
        if (r.bottom >= innerHeight - 2 && innerHeight - r.top > lift) lift = innerHeight - r.top;
      }
    } catch (e) {}
    pill.style.bottom = (14 + lift) + "px";
    if (panel) panel.style.bottom = (52 + lift) + "px";
  }
  addEventListener("resize", dodge, { passive: true });
  setInterval(dodge, 4000);

  // Stay reachable, above the page's own click-catchers (aether.ist) AND any
  // late-appended floating ad at the max z-index. PV.keepOnTop keeps the host a
  // top-most child of <html> and re-asserts it synchronously on DOM changes.
  var _keptTop = false;
  function keepOnTop() { if (_keptTop || !host || !PV.keepOnTop) return; _keptTop = true; PV.keepOnTop(host); }

  // ---- morph pacing (core decides when; we only paint) -----------------------
  var morphTimer = 0, revertTimer = 0;
  function scheduleMorph() {
    if (morphTimer) return;
    var wait = morph.wait(Date.now());
    if (!isFinite(wait)) return;
    morphTimer = setTimeout(function () { morphTimer = 0; paintMorph(); }, wait);
  }
  // A notice nobody can see is not used up (2026-11-10): the count was taken and painted on a button not yet made (a popup at the page's
  // load), hidden for fullscreen, or in a tab behind another, and the toolbar's count was then the only sign. It waits here, and
  // the moment the button can show it asks again (the button made, fullscreen left, the tab shown, a report pick ended).
  function canNotice() {
    if (!pill || prefs.hidden || picking || fullscreenNow()) return false;
    try { if (document.hidden) return false; } catch (e) {}
    return true;
  }
  function paintMorph() {
    if (!canNotice()) return;
    var m = morph.next(Date.now());
    if (!m) { scheduleMorph(); return; }
    setLabel(m.label, true);
    glow(true);
    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(function () { revertTimer = 0; restLabel(); glow(false); scheduleMorph(); }, m.until - Date.now());
  }
  // A held popup is easy to miss on a label alone (2026-10-27): for the hold the pill comes out
  // of its edge tab and its edge glows amber, the same ring a cover's close
  // hole wears (dom.js ringHoles), breathing unless motion is reduced. Then it
  // rests and goes back behind its tab, unless the person tapped it meanwhile,
  // in which case it stays out for good.
  var glowAnim = null;
  function glow(on) {
    if (!pill) return;
    if (glowAnim) { try { glowAnim.cancel(); } catch (e0) {} glowAnim = null; }
    if (on) {
      pill.classList.remove("collapsed");
      pill.classList.add("glow");
      if (!reduced) { try { glowAnim = pill.animate([{ boxShadow: "0 0 6px 1px rgba(240,168,60,.45)" }, { boxShadow: "0 0 18px 5px rgba(240,168,60,.95)" }], { duration: 1100, iterations: Infinity, direction: "alternate", easing: "ease-in-out" }); } catch (e1) {} }
      return;
    }
    pill.classList.remove("glow");
    if (panelOpen && prefs.collapsed) setCollapsed(false);
    else applyPrefs(prefs);
  }
  function setLabel(text, accent) {
    if (!pill) return;
    var apply = function () { label.textContent = text; pill.classList.toggle("morph", !!accent); pill.classList.remove("dissolve"); };
    if (reduced) { pill.classList.add("dissolve"); setTimeout(apply, 180); }   // dissolve, no movement
    else apply();
  }
  // The resting label: "PRISM", "PRISM off" while the main switch is off,
  // "Cancel report" while a report pick is on (the click then cancels it).
  var picking = false;
  function veilIsOff() { return !!(PV.veilOff && PV.veilOff()); }
  function baseLabel() { return picking ? "✕ Cancel report" : veilIsOff() ? "PRISM off" : "PRISM"; }
  function restLabel() { if (!pill) return; pill.classList.toggle("off", veilIsOff() && !picking); setLabel(baseLabel(), picking); }
  PV.onReportPick = function (on) { picking = !!on; if (on) closePanel(); restLabel(); if (!on) scheduleMorph(); };
  PV.onVeilToggle = function () { restLabel(); if (panelOpen) renderPanel(); };

  // ---- the panel ------------------------------------------------------------
  function togglePanel() { if (panelOpen) closePanel(); else openPanel(); }
  function openPanel() {
    if (!panel) {
      panel = document.createElement("div"); panel.className = "panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Popup control center");
      panel.addEventListener("click", function (e) { e.stopPropagation(); });
      // A press off the open panel closes it and goes no further (2026-11-22, on an iPhone: the tap that closed the panel also
      // opened the link under it; the cover's panel had the same fault, B-498). A clear layer under the panel, over the whole
      // page and its frames, takes that press; the guard (popups-guard.js) takes it too where a page has put a layer of its own
      // on top. A drag still scrolls the page.
      scrim = document.createElement("div"); scrim.className = "scrim";
      scrim.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); closePanel(); });
      // A drag off the panel scrolls the page, and the panel stayed up over it (2026-11-23, on an iPhone: once the page was moving,
      // the panel was hard to be rid of, as a tap on a moving page only stops it). The drag itself now closes the panel, as a
      // scroll closes a cover's small view: a finger that moves more than a few pixels on the clear layer is a scroll, no click
      // follows it, so nothing under it is pressed. Observe-only: the page scrolls as it would.
      var dragAt = null;
      function dragMove(x, y) { if (dragAt && (Math.abs(x - dragAt.x) > 10 || Math.abs(y - dragAt.y) > 10)) { dragAt = null; closePanel(); } }
      scrim.addEventListener("touchstart", function (e) { var t = e.touches && e.touches[0]; dragAt = t ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
      scrim.addEventListener("touchmove", function (e) { var t = e.touches && e.touches[0]; if (t) dragMove(t.clientX, t.clientY); }, { passive: true });
      // the same read from pointer events, for a browser that sends no touch events; a browser that takes the drag for its own
      // scroll says so with a cancel
      function byFinger(e) { return e.pointerType === "touch" || e.pointerType === "pen"; }
      scrim.addEventListener("pointerdown", function (e) { if (byFinger(e)) dragAt = { x: e.clientX, y: e.clientY }; }, { passive: true });
      scrim.addEventListener("pointermove", function (e) { if (byFinger(e)) dragMove(e.clientX, e.clientY); }, { passive: true });
      scrim.addEventListener("pointercancel", function (e) { if (byFinger(e) && dragAt) { dragAt = null; closePanel(); } }, { passive: true });
      root.appendChild(scrim);
      root.appendChild(panel);
    }
    panelOpen = true; pill.classList.add("on"); renderPanel(); dodge();
    scrollFrom = { x: scrollX, y: scrollY };
    setTimeout(function () { addEventListener("click", tapAway, true); addEventListener("keydown", escClose, true); addEventListener("scroll", scrollAway, { capture: true, passive: true }); }, 0);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false; if (pill) pill.classList.remove("on"); if (panel) panel.remove(); panel = null; if (scrim) scrim.remove(); scrim = null;
    removeEventListener("click", tapAway, true); removeEventListener("keydown", escClose, true); removeEventListener("scroll", scrollAway, { capture: true });
  }
  PV.panelIsOpen = function () { return panelOpen; };
  PV.panelClose = closePanel;
  function tapAway(e) { if (e.composedPath && e.composedPath().indexOf(host) >= 0) return; closePanel(); }
  function escClose(e) { if (e.key === "Escape") closePanel(); }
  // the page itself scrolled some way with the panel open (a wheel, a key, a flick that began elsewhere): closed too. Only the
  // document's own scroll counts, so a strip that moves by itself inside the page and the panel's own list close nothing.
  var scrollFrom = { x: 0, y: 0 };
  function scrollAway(e) {
    if (e.target !== document && e.target !== document.documentElement && e.target !== document.body) return;
    if (Math.abs(scrollY - scrollFrom.y) > 40 || Math.abs(scrollX - scrollFrom.x) > 40) closePanel();
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, primary, fn) { var b = el("button", "btn" + (primary ? " primary" : ""), text); b.type = "button"; b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); }); return b; }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " d ago";
  }
  // a unit held in the page with no address of its own is listed under a reserved name (inpage-pops.js); the panel says what it is
  var PLAIN = { "site-offer.invalid": "This site\u2019s own offer", "floating-video.invalid": "Floating video", "in-page-ad.invalid": "Ad drawn in the page" };
  function plainDest(dest) { return PLAIN[dest] || dest; }
  var nudgeFor = null;   // dest awaiting "Open these automatically next time?"

  function renderPanel() {
    if (!panel) return;
    panel.textContent = "";
    // The same build as the settings (2026-11-18): a dark band with the name and the main switch, the site as the heading, every
    // line with its words at the left and its control at the right, and a dark band at the foot.
    var top = el("div", "ptop"), body = el("div", "pbody"), foot = el("div", "pfoot");
    top.appendChild(el("span", "brand", "PRISM"));
    panel.appendChild(top); panel.appendChild(body); panel.appendChild(foot);
    // The site's own icon beside its address (2026-11-18): the address this page names as its icon, else /favicon.ico on this site,
    // the file the browser has already fetched for the tab. A page that forbids it, or has none, shows the address alone.
    var h2 = el("h2", null), ico = document.createElement("img"), icoUrl = "";
    try {
      var links = document.querySelectorAll('link[rel~="icon"][href]');
      for (var li = 0; li < links.length && !icoUrl; li++) { if (/^(https?:|data:image.)/i.test(links[li].href)) icoUrl = links[li].href; }
      if (!icoUrl && /^https?:$/.test(location.protocol)) icoUrl = location.origin + "/favicon.ico";
    } catch (e) {}
    ico.alt = ""; ico.width = 18; ico.height = 18; ico.referrerPolicy = "no-referrer"; ico.hidden = true;
    ico.addEventListener("load", function () { ico.hidden = false; });
    ico.addEventListener("error", function () { ico.remove(); });
    if (icoUrl) { ico.src = icoUrl; h2.appendChild(ico); }
    h2.appendChild(el("span", null, site));
    body.appendChild(h2);
    // The veil: the main switch, a report, a look underneath.
    var allOff = !!(PV.uiPrefs && PV.uiPrefs.veilOff);
    var tv = el("label", "toggle master"); tv.title = allOff ? "The veil is off for every site. Turn it on in the settings." : "The veil on this site only. Off: no covers on " + site + "; every other site is as it was. Popups are still intercepted. The switch for every site is in the settings.";
    var cv = document.createElement("input"); cv.type = "checkbox"; cv.checked = !veilIsOff(); cv.disabled = allOff;
    cv.addEventListener("change", function () { if (PV.setVeilOffHere) PV.setVeilOffHere(!cv.checked); else if (PV.setVeilOff) PV.setVeilOff(!cv.checked); });
    tv.appendChild(cv); tv.appendChild(document.createTextNode(allOff ? "Off everywhere" : "Veil site")); top.appendChild(tv);
    var lineOf = function (text, b) { var r = el("div", "row"); r.appendChild(el("div", "dest", text)); r.appendChild(b); body.appendChild(r); };
    var rb = btn("Report", false, function () { closePanel(); if (PV.enterReportPick) PV.enterReportPick(); });
    rb.title = "Then click an ad the veil missed, or a veil that should not be there. The report shows you exactly what it holds; nothing is sent without your click.";
    lineOf("Missed ad", rb);
    var rv = btn("Reveal 15 s", false, function () { closePanel(); if (PV.dismissAll) PV.dismissAll(15000); });
    rv.title = "Lift every veil on this page for 15 seconds. Also: press and hold a veil for 3 seconds, or Esc for 6 seconds.";
    lineOf("Covers", rv);

    body.appendChild(el("h3", null, "Popups"));
    var vrows = visitRows(), vtotal = 0; vrows.forEach(function (r) { vtotal += r.count; });
    body.appendChild(el("div", "sub", vtotal ? vtotal + " blocked on this visit" : "None blocked"));

    // since you arrived, by destination (the store's entry carries opens/nudge state)
    var rows = vrows.map(function (v) {
      var e = policy.ledger(site).find(function (x) { return x.dest === v.dest; });
      return Object.assign({}, e || { dest: v.dest, lastUrl: v.url, opens: 0, nudgeDismissed: 0 }, { count: v.count, lastSeen: new Date(v.last).toISOString(), context: v.reason });
    });
    if (rows.length) body.appendChild(el("h3", null, "Blocked"));
    rows.forEach(function (r) {
      var row = el("div", "row");
      var d = el("div", "dest"); d.textContent = plainDest(r.dest);
      var meta = el("span", "meta", r.count + "× · " + ago(r.lastSeen) + " · " + r.context);
      d.appendChild(meta); row.appendChild(d);
      // a unit held in the page (2026-11-24): Preview draws it small at the top of the window for a few seconds, Show puts it back
      // for this visit. Open, a tab on its address, is for a popup that has a real address.
      var inPage = !!(PV.inpageHeld && PV.inpageHeld(r.dest)), noAddress = /\.invalid$/.test(r.dest);
      if (inPage) {
        var pb = btn("Preview", false, function () { if (PV.inpagePreview) PV.inpagePreview(r.dest); });
        pb.title = "Look at it for a few seconds, small, without letting it through";
        row.appendChild(pb);
        var sb2 = btn("Show", false, function () { if (PV.inpageShow) PV.inpageShow(r.dest); renderPanel(); });
        sb2.title = "Put it back on this page for now. PRISM holds it again on your next visit.";
        row.appendChild(sb2);
      }
      if (!noAddress && !inPage) row.appendChild(btn("Open", false, function () {
        var o = policy.open(site, r.dest); if (!o) return;
        var go = function () { try { window.open(o.url, "_blank", "noopener"); } catch (e) {} };   // now, visibly, by the human's choice
        try { chrome.runtime.sendMessage({ type: "prism-popup-deliberate", url: o.url }, function () { go(); }); } catch (e) { go(); }
        nudgeFor = o.nudge ? r.dest : null; renderPanel();
      }));
      var ab = btn("Always allow", false, function () { policy.allow(site, r.dest); nudgeFor = null; renderPanel(); });
      if (noAddress) ab.title = "Always show " + plainDest(r.dest).toLowerCase() + " on " + site;
      row.appendChild(ab);
      body.appendChild(row);
      if (nudgeFor === r.dest) {
        var n = el("div", "nudge"); n.setAttribute("role", "status");
        n.appendChild(el("span", null, "Always allow?"));
        n.appendChild(btn("Yes", false, function () { policy.allow(site, r.dest); nudgeFor = null; renderPanel(); }));
        n.appendChild(btn("No", false, function () { policy.dismissNudge(site, r.dest); nudgeFor = null; renderPanel(); }));
        var t = n.querySelector(".btn"); t.title = core.allowSentence(site, r.dest);
        body.appendChild(n);
      }
    });

    // allowed list, THIS site only - plain sentences, one Remove each. The
    // list across every site grows for years (2026-10-27): that one lives in the toolbar popup, with a filter.
    var allowedAll = policy.listAllowed();
    var allowed = allowedAll.filter(function (a) { return a.site === site; });
    var elsewhere = allowedAll.length - allowed.length;
    body.appendChild(el("h3", null, "Allowed popups"));
    if (!allowed.length) body.appendChild(el("div", "empty", "None"));
    allowed.forEach(function (a) {
      var row = el("div", "row");
      var d = el("div", "dest", PLAIN[a.dest] ? site + " may show: " + PLAIN[a.dest].toLowerCase() : a.sentence); d.title = "since " + a.since.slice(0, 10);
      row.appendChild(d);
      row.appendChild(btn("Remove", false, function () { policy.remove(a.site, a.dest); renderPanel(); }));
      body.appendChild(row);
    });
    if (elsewhere) body.appendChild(el("div", "empty", "+" + elsewhere + " on other sites, in Settings"));

    // This site: two switches (tooltips carry the explanations).
    body.appendChild(el("h3", null, "This site"));
    var t1 = el("label", "toggle"); t1.title = "Unknown popups are always blocked. This also blocks the ones PRISM normally lets through: this site's own windows, sign-in windows, and popups that match your click. Destinations you allowed above still open."; var c1 = document.createElement("input"); c1.type = "checkbox"; c1.checked = policy.blockAll(site);
    c1.addEventListener("change", function () { policy.setBlockAll(site, c1.checked); });
    t1.appendChild(c1); t1.appendChild(document.createTextNode("Block all popups")); body.appendChild(t1);
    var t2 = el("label", "toggle"); t2.title = "Hide this button on this site. Popups are still intercepted; the toolbar badge shows the count. Bring it back from the toolbar popup."; var c2 = document.createElement("input"); c2.type = "checkbox"; c2.checked = !!prefs.hidden;
    c2.addEventListener("change", function () { policy.setHidden(site, c2.checked); });
    t2.appendChild(c2); t2.appendChild(document.createTextNode("Hide this button")); body.appendChild(t2);

    // This site's reliability rating (only while marks are on; the switch and
    // the source credits live in the toolbar popup).
    if (PV.credOn && PV.credOn() && PV.CRED_SOURCES) {
      body.appendChild(el("h3", null, "Reliability"));
      var ms = PV.credSite ? PV.credSite() : null;
      var TIP = { rsp: "Wikipedia\u2019s Perennial Sources list (CC BY-SA). Community-adjudicated; every rating links to the discussion that set it.",
                  iffy: "Iffy Index (CC BY 4.0). Sites Media Bias/Fact Check rates low credibility; the colour is MBFC\u2019s factual-reporting grade. Why? opens the MBFC review.",
                  sb: "Steven Black hosts, fakenews list (MIT). A plain domain list: red if listed, grey if not. No per-site rationale exists." };
      PV.CRED_SOURCES.forEach(function (src, i) {
        var m = ms ? ms[i] : null, row = el("div", "srcrow");
        (function (text, rowEl) { rowEl.addEventListener("mouseenter", function () { if (PV.showTextTip) PV.showTextTip(rowEl, text); }); rowEl.addEventListener("mouseleave", function () { if (PV.hideCredTip) PV.hideCredTip(rowEl); }); })(TIP[src.id] || src.name, row);
        var disk = el("span", "disk"); disk.style.background = m && !m.off && m.tier ? PV.credColor(m.tier) : (m && m.off ? "transparent" : PV.credColor(null));
        if (m && m.off) disk.style.boxShadow = "inset 0 0 0 1px #7d8590"; row.appendChild(disk);
        var nm = el("div", "nm"); nm.textContent = src.short + (m && !m.off && m.tier ? ": " + m.label : (m && m.off ? ": off" : (m && !m.loaded ? ": loading\u2026" : ": no rating")));
        row.appendChild(nm);
        if (m && m.why) row.appendChild(btn("Why?", false, function () { try { chrome.runtime.sendMessage({ type: "prism-cred-open", url: m.why }); } catch (e) {} }));
        body.appendChild(row);
      });
    }

    // Everything PRISM-wide (veil, content, photos, start page, time
    // reclaimed) lives in the toolbar popup - one place, not two.
    var srow = foot;
    srow.appendChild(el("span", null, ""));
    var sb = btn("Settings", false, function () {
      closePanel();   // the panel goes as the settings open (2026-11-18): two things were left open, and one press elsewhere closed both
      try {
        chrome.runtime.sendMessage({ type: "prism-open-settings" }, function (r) {
          if (!(r && r.ok) && PV.toast) PV.toast("Click the PRISM icon in the browser toolbar for settings.", "#F0A83C");
        });
      } catch (e) { if (PV.toast) PV.toast("Click the PRISM icon in the browser toolbar for settings.", "#F0A83C"); }
    });
    sb.title = "Open PRISM\u2019s settings: veil behaviour, AI and reliability marks, photos, start page, time reclaimed";
    srow.appendChild(sb);
  }
  function btnLike(text, fn) { var b = el("button", null, text); b.type = "button"; b.style.cssText = "font:600 12px -apple-system,Segoe UI,Roboto,sans-serif;color:#F2F4F7;background:#2A2F38;border:1px solid var(--edge,#2C333E);border-radius:8px;padding:5px 10px;cursor:pointer"; b.addEventListener("click", function (e) { e.stopPropagation(); fn(); }); return b; }

  // ---- the settings, drawn over this page (2026-11-18, asked for: a panel at the top centre that closes on a press beside it, not a
  // window that can get behind the browser). The settings page itself (popup.html) is in a frame of the extension's own, inside a
  // closed shadow root: this page cannot read it or press in it. A press on the dimmed page, or Escape, closes it. The frame is as
  // tall as the settings say they are, so nothing scrolls unless the browser window is too small to hold them.
  var setHost = null, setFrame = null, setKey = null, setWant = 0;
  addEventListener("resize", function () { if (setFrame && setWant) settingsSize(setWant); });
  function settingsClose() {
    try { if (setKey) removeEventListener("keydown", setKey, true); } catch (e) {}
    try { if (setHost) setHost.remove(); } catch (e) {}
    setHost = null; setFrame = null; setKey = null; setWant = 0;
  }
  function settingsSize(h) {
    if (!setFrame) return;
    setWant = +h || setWant;
    h = Math.max(240, Math.min(setWant, innerHeight - 32));
    setFrame.style.height = h + "px"; try { setHost.setAttribute("data-prism-settings-h", String(h)); } catch (e) {}   // read by the checks: the settings said how tall they are
  }
  function settingsToggle(tabId, pass) {
    if (setHost) { settingsClose(); return true; }
    try {
      closePanel();
      setHost = document.createElement("div"); setHost.setAttribute("data-prism-ui", "1");
      var root = setHost.attachShadow({ mode: "closed" });
      var st = document.createElement("style");
      st.textContent = ":host{all:initial}.dim{position:fixed;inset:0;z-index:2147483647;background:rgba(6,8,11,.62)}"
        + "iframe{position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);width:min(1100px,calc(100vw - 32px));height:620px;"
        + "border:1px solid #2C333E;border-radius:14px;background:#14171C;box-shadow:0 24px 80px rgba(0,0,0,.6);color-scheme:dark}";
      var dim = document.createElement("div"); dim.className = "dim";
      dim.addEventListener("click", function (ev) { ev.stopPropagation(); settingsClose(); });
      setFrame = document.createElement("iframe");
      setFrame.setAttribute("title", "PRISM settings");
      setFrame.setAttribute("allow", "clipboard-write");   // Copy in the settings (the veil log)
      setFrame.src = chrome.runtime.getURL("popup.html") + "?frame=1" + (tabId != null ? "&tab=" + tabId : "") + "&pass=" + encodeURIComponent(pass || "");
      root.appendChild(st); root.appendChild(dim); root.appendChild(setFrame);
      (document.fullscreenElement || document.documentElement).appendChild(setHost);
      setKey = function (ev) { if (ev.key === "Escape") { ev.stopPropagation(); settingsClose(); } };
      addEventListener("keydown", setKey, true);
   // the height never came: shown as it is
      return true;
    } catch (e) { settingsClose(); return false; }
  }

  // messages from bg.js: the tab backstop asks us to judge a new tab this
  // page opened (by its final URL, against the human's last click); the
  // toolbar icon opens the panel (fallback surface when the button is hidden)
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg) return;
      if (msg.type === "prism-settings-open") { if (window.top !== window) return; sendResponse({ ok: settingsToggle(msg.tab, msg.pass) }); return; }
      if (msg.type === "prism-settings-size") { settingsSize(msg.h); return; }
      if (msg.type === "prism-settings-close") { settingsClose(); return; }
      if (msg.type === "prism-popup-open-panel") { settingsClose();   /* the settings go as the controls open (2026-11-18): the menu came up dimmed under them */ if (!host) mount(); if (prefs.hidden) { pill.classList.remove("hidden"); } openPanel(); }
      // the toolbar popup has already written the switch to storage; this side reads it back and never writes (2026-11-04: the show
      // handler's own collapse write persisted this page's stale prefs, hidden still true, over the popup's, and the checkbox turned
      // itself back off a moment after it was ticked)
      if (msg.type === "prism-popup-show-pill" || msg.type === "prism-popup-hide-pill") {
        var showing = msg.type === "prism-popup-show-pill";
        if (showing && !host) mount();
        try {
          chrome.storage.local.get(["pv:" + "popups:policy", "pv:" + "popups:ledger", "pv:" + "popups:prefs"], function (got) {
            Object.keys(got || {}).forEach(function (k) { cache[k.slice(3)] = got[k]; });
            policy.load().then(function () { prefs = effectivePrefs(); if (showing) { prefs.hidden = false; prefs.collapsed = false; } else prefs.hidden = true; applyPrefs(prefs); });
          });
        } catch (e) { prefs = effectivePrefs(); prefs.hidden = !showing; if (showing) prefs.collapsed = false; applyPrefs(prefs); }
      }
      if (msg.type === "prism-popup-visit") {
        sendResponse({ site: site, since: visitSince, rows: visitRows().map(function (r) { return { dest: r.dest, count: r.count, url: r.url, reason: r.reason, last: r.last }; }) });
        return true;
      }
      if (msg.type === "prism-popup-evaluate") {
        var g = recentGesture();
        // A new tab that follows a real LINK click is the user navigating -
        // allow it, even through a redirector (Bing results are target=_blank
        // to a bing.com/ck/a wrapper that bounces to the real site). Only tabs
        // opened with no link click behind them - a synthetic click, a timer,
        // a form auto-submit - get the strict rule; that is the ad pattern.
        // (Laundering via window.open is still caught by the in-page hook.)
        if (g && g.url) { sendResponse({ action: "allow", reason: "you clicked a link" }); return true; }
        if (menuAsk(String(msg.url || ""))) { sendResponse({ action: "allow", reason: "you opened the link from its menu" }); return true; }
        var attempt = { site: site, url: String(msg.url || "") };
        if (g) attempt.gesture = g;
        var decision; try { decision = policy.evaluate(attempt); } catch (e) { decision = { action: "intercept", reason: "policy error" }; }
        if (decision.action === "intercept") { decision = { action: "intercept", reason: decision.reason + " (new tab)" }; policy.record(attempt, decision); }
        sendResponse(decision);
        return true;
      }
    });
  } catch (e) {}

  // ---- boot ----------------------------------------------------------------
  var booting = false;
  function boot() {
    if (host || booting) return;
    booting = true;
    var fail = function (e) { booting = false; try { console.error("[prism] pill boot failed:", e); } catch (x) {} if (PV.recordError) PV.recordError("pill boot failed: " + (e && (e.stack || e.message) || e)); };
    try {
      chrome.storage.local.get(null, function (all) {
        try {
          Object.keys(all || {}).forEach(function (k) { if (k.indexOf("pv:") === 0) cache[k.slice(3)] = all[k]; });
          policy.load().then(function () {
            try { prefs = effectivePrefs(); pushSnapshot(); mount(); badge(); if (PV.recordError) PV.recordError("pill mounted hidden=" + !!prefs.hidden + " collapsed=" + !!prefs.collapsed); } catch (e) { fail(e); }
          }, fail);
        } catch (e) { fail(e); }
      });
    } catch (e) { fail(e); }
  }
  // Boot once <body> exists (the bundle runs at document_start). main.js also
  // calls PV.ensurePill() from its start() and its 1.2s sweep as a backstop,
  // so a missed DOMContentLoaded or a page that rebuilt <body> still gets one.
  PV.ensurePill = function () { if (!host && document.body) boot(); else if (host && !host.isConnected) { try { (document.body || document.documentElement).appendChild(host); } catch (e) {} } };
  if (document.body) boot(); else addEventListener("DOMContentLoaded", boot, { once: true });

  PV.popups = policy;
})();
