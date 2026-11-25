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

  var toldStopped = false;
  function pushSnapshot() {
    // Only this site's entry goes to the page's world (2026-11-18): the hook judges this page's popups and needs no more, and any
    // script of the page can listen here, so what other sites were allowed must not be in it
    try {
      var all = policy.snapshot(), mine = { global: all.global, sites: {} }, here = location.hostname;
      if (all.sites && Object.prototype.hasOwnProperty.call(all.sites, here)) mine.sites[here] = all.sites[here];
      // stoppedHere: a pop was stopped on this page in this visit, one of the signs the hook needs to stop a redirect of the tab
      document.dispatchEvent(new CustomEvent("prism-popup-policy", { detail: { state: JSON.stringify(mine), stoppedHere: toldStopped } }));
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
      if (!toldStopped) { toldStopped = true; pushSnapshot(); }
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
.scrim{position:fixed;inset:0;z-index:2147483646;background:transparent}.pvbar{position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(360px,92vw);box-sizing:border-box;padding:10px 12px;border-radius:14px;background:#14171C;border:1px solid #2C333E;box-shadow:0 12px 40px rgba(0,0,0,.7)}.pvname{font:600 13px/1.3 'Segoe UI',-apple-system,Roboto,sans-serif;color:#E8ECF2;margin:0 0 8px;text-align:center}.pvacts{display:flex;gap:8px}.pvacts .btn{flex:1;padding:0 6px;height:34px}.panel{position:fixed;right:14px;bottom:52px;z-index:2147483647;width:min(400px,92vw);max-height:70vh;overflow:auto;padding:0;border-radius:14px;\
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
    var style = document.createElement("style"); style.textContent = CSS + QCSS; root.appendChild(style);
    pill = document.createElement("div"); pill.className = "pill"; pill.setAttribute("role", "button"); pill.setAttribute("tabindex", "0");
    pill.setAttribute("aria-label", "PRISM popup control center"); pill.setAttribute("aria-live", "polite");
    label = document.createElement("span"); label.className = "lbl"; label.textContent = "PRISM";
    mk = document.createElement("span"); mk.className = "mk"; pill.appendChild(mk);
    var x = document.createElement("span"); x.className = "x"; x.textContent = "›"; x.title = "Collapse";
    pill.appendChild(label); pill.appendChild(x);
    pill.addEventListener("click", function (e) { e.stopPropagation(); if (PV.cancelReportPick && PV.cancelReportPick()) return; if (autoSmall && !prefs.collapsed) { autoSmall = false; applyPrefs(prefs); togglePanel(); return; } if (pill.classList.contains("collapsed")) { setCollapsed(false); return; } togglePanel(); });
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
  // On a phone the button rests small (2026-11-25, asked for): a notice holds its 5 s and goes back to the name as before, and
  // the name, left alone for SMALL_MS, goes down to the circle. This is the button's own and is not kept: a new page starts at
  // the name, a notice brings the words back, and one press on the circle opens the panel (a circle the person made with the
  // arrow opens to the name first, as it did). Not while the panel is open, a report is being picked, or PRISM is off (those
  // words stay to be read).
  var SMALL_MS = 5000, autoSmall = false, smallTimer = 0, touchy = false;
  try { touchy = matchMedia("(pointer:coarse)").matches; } catch (e) {}
  function armSmall() {
    if (smallTimer) { clearTimeout(smallTimer); smallTimer = 0; }
    if (!touchy || autoSmall || !pill) return;
    smallTimer = setTimeout(function () {
      smallTimer = 0;
      if (!pill || panelOpen || picking || veilIsOff() || prefs.hidden || prefs.collapsed || pill.classList.contains("glow")) return;
      autoSmall = true; pill.classList.add("collapsed");
    }, SMALL_MS);
  }
  function applyPrefs(p) {
    prefs = p || {};
    if (!pill) return;
    pill.classList.toggle("collapsed", !!prefs.collapsed || autoSmall);
    armSmall();
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
    lastLift = lift; placePanel();
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
      autoSmall = false; if (smallTimer) { clearTimeout(smallTimer); smallTimer = 0; }
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
  function restLabel() { if (!pill) return; pill.classList.toggle("off", veilIsOff() && !picking); setLabel(baseLabel(), picking); if (autoSmall && (picking || veilIsOff())) { autoSmall = false; applyPrefs(prefs); } else armSmall(); }
  PV.onReportPick = function (on) { picking = !!on; if (on) closePanel(); restLabel(); if (!on) scheduleMorph(); };
  PV.onVeilToggle = function () { restLabel(); if (panelOpen) renderPanel(); };

  // ---- the panel ------------------------------------------------------------
  function togglePanel() { if (panelOpen) closePanel(); else openPanel(); }
  function openPanel(which) {
    view = which === "menu" ? "menu" : "bar"; sub = ""; popsUp = false; if (view === "menu") tab = "site";
    if (!panel) {
      panel = document.createElement("div"); panel.className = "panel"; panel.setAttribute("role", "dialog");
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
    panelOpen = false; if (pill) pill.classList.remove("on"); armSmall();
    if (pvBar) { previewBarOff(); try { PV.inpagePreviewEnd(); } catch (e) {} } if (panel) panel.remove(); panel = null; if (scrim) scrim.remove(); scrim = null;
    removeEventListener("click", tapAway, true); removeEventListener("keydown", escClose, true); removeEventListener("scroll", scrollAway, { capture: true });
  }
  PV.panelIsOpen = function () { return panelOpen; };
  PV.panelClose = closePanel;
  function tapAway(e) { if (e.composedPath && e.composedPath().indexOf(host) >= 0) return; closePanel(); }
  // The preview with its own buttons (2026-11-24, asked for after the first preview on an iPhone: Show and Always allow right under
  // the unit, and a way back to the panel). The panel steps aside; Back brings it back; Show and Always allow act and everything
  // goes; a press anywhere else, a scroll, a key or half a minute ends the preview and closes the panel with it.
  var pvBar = null;
  function previewBarOff() { if (pvBar) { try { pvBar.remove(); } catch (e) {} pvBar = null; } }
  function previewWith(site, dest) {
    if (!PV.inpagePreview || !panel) return;
    var p0 = panel, back = false;
    var at = PV.inpagePreview(dest, function () {
      previewBarOff();
      if (back && p0 === panel && panelOpen) { p0.style.display = ""; renderPanel(); } else closePanel();
    }, 30000);
    if (!at) return;
    p0.style.display = "none";
    pvBar = el("div", "pvbar");
    pvBar.addEventListener("click", function (e) { e.stopPropagation(); });
    var name = el("div", "pvname", plainDest(dest)); pvBar.appendChild(name);
    var acts = el("div", "pvacts");
    acts.appendChild(btn("Show", false, function () { if (PV.inpageShow) PV.inpageShow(dest); else PV.inpagePreviewEnd(); }));
    acts.appendChild(btn("Always allow", false, function () { PV.inpagePreviewEnd(); policy.allow(site, dest); }));
    acts.appendChild(btn("Back", true, function () { back = true; PV.inpagePreviewEnd(); }));
    pvBar.appendChild(acts);
    var top = (at === true || !(at.bottom > 0)) ? Math.round(innerHeight * 0.6) : Math.min(Math.round(at.bottom) + 14, innerHeight - 110);
    pvBar.style.top = top + "px";
    root.appendChild(pvBar);
  }
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

  // ---- the quick bar and the menu (2026-11-25, decided from pictures: option C) --------------------------------------------
  // One press on the button opens a small bar: Popups (only when something was stopped on this visit), Reveal 15 s, Report, the
  // PRISM switch for this site, More. Where the site has feed switches (suggested posts, AI-made posts) they sit over the bar.
  // More opens the menu: two tabs, This site and All sites, rows of a symbol, one or two words and a control, and one page a tap
  // in for each group. Every setting is on one of these pages, so nothing needs the settings page; that page is still what the
  // toolbar opens. A site's own answer (pv:ui.siteChoice): the globe lit means the site follows the setting for all sites and
  // the eye beside it is greyed and shows that setting; a press on the eye gives the site its own answer and the globe goes out;
  // a press on the globe takes the answer away.
  var view = "bar", tab = "site", sub = "", popsUp = false, artRec = null, artBusy = false, artErr = "", logNote = "", lastLift = 0;
  var HAS_SUG = /(^|\.)(facebook|linkedin)\.com$/i.test(site), HAS_AI = /(^|\.)(youtube|facebook|instagram|threads|tiktok)\.com$/i.test(site);
  var QCSS = [
    ".qbarwrap,.qsheet{font:15px/1.3 'Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7}",
    ".panel.qbarwrap{background:none;border:0;box-shadow:none;overflow:visible;max-height:none;width:auto;max-width:calc(100vw - 28px);border-radius:0}",
    ".panel.qsheet{width:min(390px,calc(100vw - 28px));max-height:80vh;border-radius:16px}",
    ".qbody{padding:14px 14px 4px}",
    "button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:left}",
    "button:focus-visible{outline:2px solid #F0A83C;outline-offset:2px}",
    ".qi{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}",
    ".qbar{display:flex;align-items:stretch;height:64px;border-radius:20px;background:rgba(20,23,28,.97);border:1px solid #F0A83C;box-shadow:0 6px 24px rgba(0,0,0,.6);overflow:hidden}",
    ".qc{flex:1;min-width:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font:600 11.5px/1 'Segoe UI',-apple-system,Roboto,sans-serif;color:#D4DAE3;white-space:nowrap;border-left:1px solid rgba(255,255,255,.08);position:relative;padding:0 6px}",
    ".qc:first-child{border-left:0}.qc .qi{color:#F0A83C;width:24px;height:24px}.qc.on{background:rgba(240,168,60,.2);color:#F2F4F7}",
    ".qc:hover{color:#F2F4F7}",
    ".qbd{position:absolute;top:7px;left:50%;margin-left:6px;min-width:18px;height:18px;border-radius:9px;background:#F0A83C;color:#0A0C0F;font:700 11px/18px 'Segoe UI',-apple-system,Roboto,sans-serif;text-align:center;padding:0 4px}",
    ".qstrip{display:flex;gap:8px;margin-bottom:8px}",
    ".qchip{flex:1;height:44px;border-radius:14px;background:rgba(20,23,28,.97);border:1px solid #2C333E;display:flex;align-items:center;justify-content:center;gap:8px;font:600 14px/1 'Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7;box-shadow:0 6px 24px rgba(0,0,0,.6);padding:0 12px;white-space:nowrap}",
    ".qchip.on{border-color:#F0A83C;background:rgba(58,44,22,.98)}.qchip.on .qi{color:#F0A83C}",
    ".qover{margin-bottom:8px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.6);max-height:50vh;overflow:auto}.qover .qlist{margin:0}",
    ".qsw{flex:none;display:inline-block;width:60px;height:30px;border-radius:9px;border:1px solid #2C333E;background:#0A0C0F;position:relative}",
    ".qsw span{position:absolute;left:2px;top:2px;width:30px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font:600 11px/1 'Segoe UI',-apple-system,Roboto,sans-serif;color:#F2F4F7;background:linear-gradient(#4A5362,#2F3642)}",
    ".qsw.on{border-color:#F0A83C}.qsw.on span{left:26px;color:#0A0C0F;background:linear-gradient(#F7C469,#E39A2C)}",
    ".qsw:disabled{opacity:.45;cursor:default}",
    ".qc .qsw{transform:scale(.8);margin:-3px 0}",
    ".qtabs{display:flex;padding:3px;border-radius:11px;background:#0A0C0F;border:1px solid #2C333E;margin-bottom:14px}",
    ".qtabs button{flex:1;text-align:center;font:600 14px/34px 'Segoe UI',-apple-system,Roboto,sans-serif;color:#8F99A6;border-radius:8px}.qtabs button.on{background:#2A303A;color:#F2F4F7}",
    ".qhead{display:flex;align-items:center;gap:10px;margin:0 4px 12px;min-height:32px}",
    ".qhead b{flex:1;min-width:0;font:600 19px/1.2 'Segoe UI',-apple-system,Roboto,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".qback{color:#F0A83C;display:flex;margin-left:-6px;padding:4px}",
    ".qstat{margin:-6px 4px 12px;color:#8F99A6;font-size:14px}.qstat b{color:#F0A83C;font-weight:600}",
    ".qacts{display:flex;gap:10px;margin-bottom:12px}",
    ".qact{flex:1;height:48px;border-radius:12px;background:linear-gradient(#333A45,#262B34);border:1px solid #0A0C0F;display:flex;align-items:center;justify-content:center;gap:9px;font:600 15px/1 'Segoe UI',-apple-system,Roboto,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.14);white-space:nowrap}.qact .qi{color:#F0A83C}",
    ".qlist{background:#1D222A;border:1px solid #2C333E;border-radius:14px;overflow:hidden;margin-bottom:12px}",
    ".qrow{display:flex;align-items:center;gap:10px;min-height:50px;padding:0 14px;border-top:1px solid rgba(255,255,255,.07);width:100%;box-sizing:border-box}",
    ".qrow:first-child{border-top:0}.qrow>.qi:first-child{color:#F0A83C;margin-right:2px}",
    ".qrow .l{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".qrow .v{color:#8F99A6;font-size:14px;white-space:nowrap}.qrow .v.n{color:#F0A83C;font-weight:600}",
    ".qrow.go>.qi:last-child{color:#5B6572;width:18px;height:18px;margin-left:-4px}.qrow.go:hover{background:rgba(255,255,255,.04)}",
    ".qlbl{margin:12px 6px 7px;color:#8F99A6;font:600 12px/1.3 'Segoe UI',-apple-system,Roboto,sans-serif;letter-spacing:.06em;text-transform:uppercase}.qlbl.dn{text-transform:none;letter-spacing:0;font-size:14px}",
    ".qhead+.qlbl{margin-top:0}",
    ".qseg{display:flex;padding:3px;border-radius:11px;background:#0A0C0F;border:1px solid #2C333E;margin-bottom:4px}",
    ".qseg button{flex:1;text-align:center;font:600 14px/36px 'Segoe UI',-apple-system,Roboto,sans-serif;color:#D4DAE3;border-radius:8px;white-space:nowrap}",
    ".qseg button.on{background:linear-gradient(#F7C469,#E39A2C);color:#0A0C0F}",
    ".qseg.sm{flex:none;margin:0}.qseg.sm button{flex:none;padding:0 9px;font-size:13px;line-height:26px}",
    ".qmini{flex:none;font:600 13px/30px 'Segoe UI',-apple-system,Roboto,sans-serif;padding:0 12px;border-radius:8px;background:#2A303A;border:1px solid #0A0C0F;color:#F2F4F7;white-space:nowrap}.qmini:disabled{opacity:.5}",
    ".qeye{flex:none;width:60px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#0A0C0F;border:1px solid #2C333E;color:#F2F4F7}",
    ".qeye .qi{width:24px;height:24px}.qeye.on{background:linear-gradient(#F7C469,#E39A2C);border-color:#F0A83C;color:#0A0C0F}",
    ".qeye.dim{opacity:.4;border-style:dashed}.qeye.own{border-color:#F0A83C;box-shadow:0 0 0 1px #F0A83C}",
    ".qglb{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#0A0C0F;border:1px solid #2C333E;color:#5B6572}",
    ".qglb .qi{width:21px;height:21px}.qglb.on{border-color:#F0A83C;color:#F0A83C;background:rgba(240,168,60,.16)}",
    ".qdots{display:flex;gap:5px;margin-right:2px}.qdot{width:12px;height:12px;border-radius:50%;flex:none;display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.5)}",
    ".qchips{display:flex;gap:8px;margin-bottom:12px}.qchips button{flex:1;text-align:center;font:600 14px/40px 'Segoe UI',-apple-system,Roboto,sans-serif;border-radius:11px;background:#1D222A;border:1px solid #2C333E;color:#D4DAE3}",
    ".qchips button.on{background:rgba(240,168,60,.16);border-color:#F0A83C;color:#F2F4F7}",
    ".qinp{flex:1;min-width:0;height:34px;border-radius:8px;background:#0A0C0F;border:1px solid #2C333E;color:#F2F4F7;font:15px/32px 'Segoe UI',-apple-system,Roboto,sans-serif;padding:0 10px}",
    ".qnote{color:#8F99A6;font-size:13px;margin:-4px 6px 10px}",
    "@media (pointer:coarse){.pill.on{visibility:hidden}.panel.qbarwrap{left:14px;right:14px;width:auto;max-width:none}.panel.qsheet{left:0;right:0;width:auto;max-height:82vh;border-radius:22px 22px 0 0;border-bottom:0}.qbody{padding:16px 16px calc(14px + env(safe-area-inset-bottom,0px))}}"
  ].join("");
  var IC = {
    eye: "p:M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z|c:12,12,3",
    eyeoff: "p:M3 9c2.2 3.3 5.3 5 9 5s6.8-1.7 9-5M12 14v3.5M6.5 12.5L4.5 15.5M17.5 12.5l2 3",
    flag: "p:M5 21V4h12l-2.5 4 2.5 4H5", peel: "p:M4 4h16v9l-7 7H4z|p:M20 13h-7v7",
    win: "r:3,4,14,12,2|p:M8 20h11a2 2 0 002-2V9", more: "c:5,12,1.3|c:12,12,1.3|c:19,12,1.3",
    ch: "p:M9 6l6 6-6 6", back: "p:M15 5l-7 7 7 7",
    globe: "c:12,12,8.5|p:M3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z",
    sug: "c:9,8,3.5|p:M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M19 7v6M16 10h6",
    ai: "p:M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z",
    star: "p:M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z",
    btn: "c:12,12,8.5|c:12,12,3", video: "r:3,5,18,14,3|p:M10 9l5 3-5 3z", tv: "r:3,7,18,12,2|p:M9 3l3 4 3-4",
    feed: "p:M4 6h16M4 12h16M4 18h10", shield: "p:M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z|p:M9 12l2 2 4-4",
    pic: "r:3,5,18,14,2|p:M3 17l5-5 4 4 3-3 6 5|c:16,9.5,1.5",
    sync: "p:M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3|p:M18 3v4h-4M6 21v-4h4",
    sun: "c:12,12,4|p:M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3L7 7M17 17l1.7 1.7M5.3 18.7L7 17M17 7l1.7-1.7",
    zoom: "r:3,5,18,14,2|r:12,11,7,6,1", clock: "c:12,12,8.5|p:M12 7.5V12l3 2", doc: "p:M7 3h7l4 4v14H7z|p:M10 12h5M10 16h5",
    x: "p:M6 6l12 12M18 6L6 18", scan: "p:M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3|c:12,12,3", undo: "p:M4 9h10a5 5 0 010 10H9|p:M8 5L4 9l4 4"
  };
  function ico(name) {
    var NS = "http://www.w3.org/2000/svg", s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "qi"); s.setAttribute("aria-hidden", "true");
    String(IC[name] || "").split("|").forEach(function (part) {
      var k = part.slice(0, 1), a = part.slice(2).split(","), n = null;
      if (k === "p") { n = document.createElementNS(NS, "path"); n.setAttribute("d", part.slice(2)); }
      else if (k === "c") { n = document.createElementNS(NS, "circle"); n.setAttribute("cx", a[0]); n.setAttribute("cy", a[1]); n.setAttribute("r", a[2]); }
      else if (k === "r") { n = document.createElementNS(NS, "rect"); ["x", "y", "width", "height", "rx"].forEach(function (nm, i) { if (a[i] != null) n.setAttribute(nm, a[i]); }); }
      if (n) s.appendChild(n);
    });
    return s;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) { var k = arguments[i]; if (k != null && k !== false) parent.appendChild(typeof k === "string" ? document.createTextNode(k) : k); } return parent; }
  function tapBtn(cls, kids, fn, name) {
    var b = el("button", cls || null); b.type = "button"; if (name) b.setAttribute("aria-label", name);
    (kids || []).forEach(function (k) { add(b, k); });
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); });
    return b;
  }
  function ui(k) { return PV.uiPrefs ? PV.uiPrefs[k] : undefined; }
  function setUi(k, v) { if (PV.setUiPref) PV.setUiPref(k, v); }
  function swLook(on) { return add(el("span", "qsw" + (on ? " on" : "")), el("span", null, on ? "On" : "Off")); }
  function qsw(name, on, fn, disabled) {
    var b = tapBtn("qsw" + (on ? " on" : ""), [el("span", null, on ? "On" : "Off")], function () { fn(!on); renderPanel(); }, name);
    b.setAttribute("role", "switch"); b.setAttribute("aria-checked", on ? "true" : "false"); if (disabled) b.disabled = true;
    return b;
  }
  function qeye(name, hidden, st, fn) {
    var b = tapBtn("qeye" + (hidden && st !== "dim" ? " on" : "") + (st ? " " + st : ""), [ico(hidden ? "eyeoff" : "eye")], function () { fn(); renderPanel(); }, name + (hidden ? ": hidden" : ": shown"));
    b.setAttribute("data-hidden", hidden ? "1" : "0");
    return b;
  }
  function qseg(items, cur, fn, small) {
    var s = el("div", "qseg" + (small ? " sm" : ""));
    items.forEach(function (it) { s.appendChild(tapBtn(it[1] === cur ? "on" : "", [it[0]], function () { fn(it[1]); renderPanel(); })); });
    return s;
  }
  function qmini(text, fn) { return tapBtn("qmini", [text], function (b) { fn(b); renderPanel(); }); }
  function qrow(icon, label, right, go) {
    var r = go ? tapBtn("qrow go", [], go) : el("div", "qrow");
    if (icon) r.appendChild(typeof icon === "string" ? ico(icon) : icon);
    r.appendChild(el("span", "l", label));
    (right || []).forEach(function (k) { if (k) r.appendChild(typeof k === "string" ? el("span", "v", k) : k); });
    if (go) r.appendChild(ico("ch"));
    return r;
  }
  function qlist(rows) { var l = el("div", "qlist"), n = 0; (rows || []).forEach(function (r) { if (r) { l.appendChild(r); n++; } }); return n ? l : null; }
  function qlbl(t, c) { return el("div", "qlbl" + (c ? " " + c : ""), t); }
  function goTo(name) {
    sub = name; logNote = "";
    if (name === "pics") { try { chrome.storage.local.get("pv:art", function (x) { void chrome.runtime.lastError; artRec = (x && x["pv:art"]) || null; if (panelOpen && sub === "pics") renderPanel(); }); } catch (e) {} }
    renderPanel();
  }
  function placePanel() { if (panel) panel.style.bottom = (touchy ? (view === "menu" ? 0 : 14 + lastLift) : 52 + lastLift) + "px"; }
  function reveal15() { closePanel(); if (PV.dismissAll) PV.dismissAll(15000); }
  function reportPick() { closePanel(); if (PV.enterReportPick) PV.enterReportPick(); }
  function allOff() { return !!ui("veilOff"); }
  function prefHere(k) { return PV.prefHere ? PV.prefHere(k) : !!ui(k); }
  function covered() {
    var s = 0; try { s = (PV.reclaimWindows && PV.reclaimWindows().all) || 0; } catch (e) {}
    var m = Math.round(s / 60), h = Math.floor(m / 60);
    return h ? h + " h " + (m % 60) + " min" : m + " min";
  }
  // what was stopped on this visit, one row each: a window opens by Open, a unit held in the page is looked at by Preview
  function blockedRows() {
    return visitRows().map(function (v) {
      var dest = v.dest, inPage = !!(PV.inpageHeld && PV.inpageHeld(dest)), noAddress = /\.invalid$/.test(dest), right = [];
      if (inPage) right.push(qmini("Preview", function () { previewWith(site, dest); }));
      else if (!noAddress) right.push(qmini("Open", function () {
        var o = policy.open(site, dest); if (!o) return;
        var go = function () { try { window.open(o.url, "_blank", "noopener"); } catch (e) {} };   // now, visibly, by the person's choice
        try { chrome.runtime.sendMessage({ type: "prism-popup-deliberate", url: o.url }, function () { go(); }); } catch (e) { go(); }
      }));
      right.push(qmini("Allow", function () { policy.allow(site, dest); }));
      var r = qrow("", plainDest(dest), right); r.title = v.count + " stopped: " + v.reason;
      return r;
    });
  }
  function renderPanel() {
    if (!panel) return;
    panel.textContent = "";
    panel.className = "panel " + (view === "menu" ? "qsheet" : "qbarwrap");
    panel.setAttribute("aria-label", view === "menu" ? "PRISM menu" : "PRISM quick bar");
    if (view === "menu") renderMenu(); else renderBar();
    placePanel();
  }
  // ---- the bar
  function renderBar() {
    var vtotal = 0; visitRows().forEach(function (r) { vtotal += r.count; });
    if (!vtotal) popsUp = false;
    var off = veilIsOff();
    if (popsUp) add(panel, add(el("div", "qover"), qlist(blockedRows())));
    else if ((HAS_SUG || HAS_AI) && !off) {
      var chip = function (label, k) {
        var hidden = prefHere(k);
        var c = tapBtn("qchip" + (hidden ? " on" : ""), [ico(hidden ? "eyeoff" : "eye"), label], function () {
          var nv = !hidden; if (PV.setSiteChoice) PV.setSiteChoice(k, nv === !!ui(k) ? null : nv);
          renderPanel();
        }, label + (hidden ? ": hidden" : ": shown"));
        c.setAttribute("data-k", k);
        return c;
      };
      add(panel, add(el("div", "qstrip"), HAS_SUG && chip("Suggested", "suggestedVeil"), HAS_AI && chip("AI-made", "aiVeil")));
    }
    var bar = el("div", "qbar");
    var cell = function (id, kids, fn, cls) { var c = tapBtn("qc" + (cls ? " " + cls : ""), kids, fn); c.setAttribute("data-q", id); return c; };
    if (vtotal) bar.appendChild(cell("popups", [ico("win"), el("span", "qbd", String(vtotal)), el("span", null, "Popups")], function () { popsUp = !popsUp; renderPanel(); }, popsUp ? "on" : ""));
    bar.appendChild(cell("reveal", [ico("peel"), el("span", null, "Reveal 15 s")], reveal15));
    bar.appendChild(cell("report", [ico("flag"), el("span", null, "Report")], reportPick));
    var pc = cell("prism", [swLook(!off), el("span", null, "PRISM")], function () {
      if (allOff()) { view = "menu"; tab = "all"; sub = ""; renderPanel(); return; }   // off for every site: that switch is on the All sites tab
      if (PV.setVeilOffHere) PV.setVeilOffHere(!off);
      renderPanel();
    });
    pc.setAttribute("role", "switch"); pc.setAttribute("aria-checked", off ? "false" : "true"); pc.setAttribute("aria-label", "PRISM on this site");
    bar.appendChild(pc);
    bar.appendChild(cell("more", [ico("more"), el("span", null, "More")], function () { view = "menu"; tab = "site"; sub = ""; popsUp = false; renderPanel(); }));
    panel.appendChild(bar);
  }
  // ---- the menu
  function head(title, right, back) {
    var h = el("div", "qhead");
    if (back) h.appendChild(tapBtn("qback", [ico("back")], function () { sub = ""; renderPanel(); }, "Back"));
    h.appendChild(el("b", null, title));
    if (right) h.appendChild(right);
    return h;
  }
  function renderMenu() {
    var b = el("div", "qbody"); panel.appendChild(b);
    if (sub && PAGES[sub]) { PAGES[sub](b); return; }
    var tabs = el("div", "qtabs");
    tabs.appendChild(tapBtn(tab === "site" ? "on" : "", ["This site"], function () { tab = "site"; renderPanel(); }));
    tabs.appendChild(tapBtn(tab === "all" ? "on" : "", ["All sites"], function () { tab = "all"; renderPanel(); }));
    b.appendChild(tabs);
    if (tab === "all") allTab(b); else siteTab(b);
  }
  function hereRow(icon, label, k) {
    var own = PV.siteChoice ? PV.siteChoice(k) : null, val = own === null ? !!ui(k) : own;
    var g = tapBtn("qglb" + (own === null ? " on" : ""), [ico("globe")], function () { if (own !== null && PV.setSiteChoice) PV.setSiteChoice(k, null); renderPanel(); },
      own === null ? label + ": follows the setting for all sites" : label + ": use the setting for all sites");
    g.setAttribute("data-k", k);
    var e = qeye(label, val, own === null ? "dim" : "own", function () { if (PV.setSiteChoice) PV.setSiteChoice(k, !val); });
    e.setAttribute("data-k", k);
    return qrow(icon, label, [g, e]);
  }
  function ratingDots() {
    var ms = PV.credSite ? PV.credSite() : null, d = el("span", "qdots");
    (PV.CRED_SOURCES || []).forEach(function (src, i) { var m = ms ? ms[i] : null, x = el("span", "qdot"); x.style.background = PV.credColor(m && !m.off && m.tier ? m.tier : null); d.appendChild(x); });
    return d;
  }
  function siteTab(b) {
    var off = veilIsOff(), vtotal = 0; visitRows().forEach(function (r) { vtotal += r.count; });
    add(b, head(site, qsw("PRISM on this site", !off, function (on) { if (PV.setVeilOffHere) PV.setVeilOffHere(!on); }, allOff())));
    var acts = el("div", "qacts");
    add(acts, tapBtn("qact", [ico("peel"), "Reveal 15 s"], reveal15), tapBtn("qact", [ico("flag"), "Report"], reportPick));
    b.appendChild(acts);
    var chan = ""; try { chan = (ui("livePicture") && PV.liveChannelName && PV.liveChannelName()) || ""; } catch (e) {}
    if (chan) {
      add(b, qlbl("This channel: " + chan), qseg([["All breaks", "all"], ["Sure only", "sure"], ["None", "off"]], (ui("liveChannels") || {})[chan] || "all", function (mode) {
        var n = {}, cur = ui("liveChannels") || {}; for (var k in cur) n[k] = cur[k]; n[chan] = mode; setUi("liveChannels", n);
      }));
      b.lastChild.style.marginBottom = "12px";
    }
    add(b, qlist([
      HAS_SUG && hereRow("sug", "Suggested", "suggestedVeil"),
      HAS_AI && hereRow("ai", "AI-made", "aiVeil"),
      qrow("win", "Popups", [vtotal ? add(el("span", "v n"), String(vtotal)) : null], function () { goTo("pops"); }),
      (PV.credOn && PV.credOn() && PV.CRED_SOURCES) ? qrow("star", "Rating", [ratingDots()], function () { goTo("rating"); }) : null,
      qrow("btn", "PRISM button", [qsw("PRISM button on this site", true, function () { policy.setHidden(site, true); })])
    ]));
  }
  function allTab(b) {
    add(b, head("PRISM", qsw("PRISM on all sites", !allOff(), function (on) { setUi("veilOff", !on); })));
    add(b, add(el("div", "qstat"), el("b", null, covered()), " of ads covered"));
    var go = function (icon, label, name) { return qrow(icon, label, [], function () { goTo(name); }); };
    add(b, qlist([go("video", "Video ads", "video"), go("tv", "Live TV", "livetv"), go("feed", "Feeds", "feeds"), go("shield", "Source ratings", "ratings"),
      go("pic", "Pictures", "pics"), go("win", "Popups", "popsall"), go("more", "More", "more")]));
  }
  var PAGES = {
    pops: function (b) {
      add(b, head("Popups", null, true));
      var rows = blockedRows();
      if (rows.length) add(b, qlbl("Blocked"), qlist(rows));
      var allowed = policy.listAllowed().filter(function (a) { return a.site === site; });
      if (allowed.length) add(b, qlbl("Allowed"), qlist(allowed.map(function (a) { return qrow("", plainDest(a.dest), [qmini("Remove", function () { policy.remove(a.site, a.dest); })]); })));
      add(b, qlist([qrow("x", "Block all", [qsw("Block all popups on this site", !!policy.blockAll(site), function (on) { policy.setBlockAll(site, on); })])]));
    },
    rating: function (b) {
      add(b, head("Rating", null, true));
      var ms = PV.credSite ? PV.credSite() : null;
      add(b, qlist((PV.CRED_SOURCES || []).map(function (src, i) {
        var m = ms ? ms[i] : null, d = el("span", "qdot"); d.style.background = PV.credColor(m && !m.off && m.tier ? m.tier : null);
        var word = m && !m.off && m.tier ? m.label : (m && m.off ? "Off" : (m && !m.loaded ? "Loading" : "No rating"));
        return qrow(d, src.short, [word, m && m.why ? qmini("Why", function () { try { chrome.runtime.sendMessage({ type: "prism-cred-open", url: m.why }); } catch (e) {} }) : null]);
      })));
    },
    video: function (b) {
      var look = ui("breakLook") === "mute" || ui("breakLook") === "show" ? ui("breakLook") : "veil";
      add(b, head("Video ads", null, true),
        qlbl("During ads"), qseg([["Veil", "veil"], ["Mute", "mute"], ["Show", "show"]], look, function (v) { setUi("breakLook", v === "veil" ? undefined : v); }),
        qlbl("Card"), qseg([["Full", "interactive"], ["Corner", "minimal"]], ui("hud") || "interactive", function (v) { setUi("hud", v); }),
        qlbl("Sound"), qseg([["Off", ""], ["River", "river"], ["Chimes", "chimes"], ["Stars", "stars"]], ui("breakSound") || "", function (v) { setUi("breakSound", v || undefined); }));
      b.lastChild.style.marginBottom = "12px";
    },
    livetv: function (b) {
      var sites = Array.isArray(ui("liveTvSites")) ? ui("liveTvSites") : ["tv.youtube.com"], canPicture = !touchy;
      add(b, head("Live TV", null, true), qlist([
        qrow("flag", "Marked ad slots", [qsw("Marked ad slots", ui("ytvVeil") !== false, function (on) { setUi("ytvVeil", on); })]),
        canPicture && qrow("scan", "Picture detection", [qsw("Picture detection", !!ui("livePicture"), function (on) {
          setUi("livePicture", on);
          if (on && PV.toast) PV.toast("On the live TV tab, press the PRISM icon in the toolbar once to start.", "#F0A83C");
        })])
      ]));
      if (canPicture && ui("livePicture")) {
        var inp = el("input", "qinp"); inp.type = "text"; inp.placeholder = "example.com"; inp.spellcheck = false; inp.setAttribute("aria-label", "A live TV site to add");
        inp.addEventListener("click", function (e) { e.stopPropagation(); }); inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
        var addSite = function () {
          var h = String(inp.value || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[\/?#:]/)[0].replace(/^www\./, "");
          if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && sites.indexOf(h) < 0) setUi("liveTvSites", sites.concat([h]));
        };
        add(b, qlbl("Sites"), qlist(sites.map(function (h) { return qrow("", h, [qmini("Remove", function () { setUi("liveTvSites", sites.filter(function (y) { return y !== h; })); })]); })
          .concat([add(el("div", "qrow"), inp, qmini("Add", addSite))])));
      }
    },
    feeds: function (b) {
      add(b, head("Feeds", null, true), qlbl("All sites"), qlist([
        qrow("ai", "AI-made", [qeye("AI-made on all sites", !!ui("aiVeil"), "", function () { setUi("aiVeil", !ui("aiVeil")); })]),
        qrow("sug", "Suggested", [qeye("Suggested on all sites", !!ui("suggestedVeil"), "", function () { setUi("suggestedVeil", !ui("suggestedVeil")); })])
      ]));
      var sc = ui("siteChoice") || {}, rows = [], NAME = { aiVeil: "AI-made", suggestedVeil: "Suggested" };
      Object.keys(sc).sort().forEach(function (h) {
        Object.keys(NAME).forEach(function (k) {
          if (!sc[h] || typeof sc[h][k] !== "boolean") return;
          rows.push(qrow("", h, [NAME[k] + (sc[h][k] ? " hidden" : " shown"), qmini("Reset", function () {
            var m = {}; Object.keys(sc).forEach(function (x) { var c = {}; Object.keys(sc[x] || {}).forEach(function (kk) { if (!(x === h && kk === k)) c[kk] = sc[x][kk]; }); if (Object.keys(c).length) m[x] = c; });
            setUi("siteChoice", m);
          })]));
        });
      });
      if (rows.length) add(b, qlbl("Different on"), qlist(rows));
    },
    ratings: function (b) {
      var on = !!ui("srcMarks"), cs = ui("credSrc") || {}, ids = (PV.CRED_SOURCES || []).map(function (s) { return s.id; });
      var lit = function (id) { return on && cs[id] !== false; };
      add(b, head("Source ratings", qsw("Source ratings", on, function (v) {
        if (v) { var n = {}; ids.forEach(function (id) { n[id] = true; }); setUi("credSrc", n); }
        setUi("srcMarks", v);
      }), true));
      add(b, qlist((PV.CRED_SOURCES || []).map(function (src) {
        return qrow("", src.short, [qsw(src.short, lit(src.id), function (v) {
          var n = {}, any = false; ids.forEach(function (id) { n[id] = id === src.id ? v : lit(id); if (n[id]) any = true; });
          setUi("credSrc", n); setUi("srcMarks", any);   // the marks are on while any source is lit
        })]);
      })));
    },
    pics: function (b) {
      var n = artRec && artRec.urls ? artRec.urls.length : 0, sets = ui("artSets") || ["nature"];
      var get = function (btn) {
        if (artBusy) return; artBusy = true; artErr = "";
        try {
          chrome.runtime.sendMessage({ type: "prism-art-refresh" }, function (r) {
            artBusy = false;
            if (!(r && r.ok)) { artErr = "Could not fetch: " + ((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "no answer"); if (panelOpen && sub === "pics") renderPanel(); return; }
            chrome.storage.local.get("pv:art", function (x) { artRec = (x && x["pv:art"]) || null; if (panelOpen && sub === "pics") renderPanel(); });
          });
        } catch (e) { artBusy = false; artErr = "Could not fetch"; }
      };
      var gb = qmini(artBusy ? "Fetching" : (n ? "Get new" : "Get 24"), get); gb.disabled = artBusy;
      add(b, head("Pictures", null, true), qlist([
        qrow("pic", "Photos", [n ? String(n) : "Built-in", gb]),
        qrow("sync", "Weekly refresh", [qsw("Weekly refresh", !!ui("artWeekly"), function (on) { setUi("artWeekly", on); })]),
        n ? qrow("undo", "Defaults", [qmini("Restore", function () { try { chrome.runtime.sendMessage({ type: "prism-art-reset" }, function () { void chrome.runtime.lastError; artRec = null; if (panelOpen && sub === "pics") renderPanel(); }); } catch (e) {} })]) : null
      ]));
      if (artErr) add(b, el("div", "qnote", artErr));
      var chips = el("div", "qchips");
      [["Nature", "nature"], ["Cosmos", "cosmos"], ["Museum art", "gallery"]].forEach(function (s) {
        var isOn = sets.indexOf(s[1]) >= 0;
        chips.appendChild(tapBtn(isOn ? "on" : "", [s[0]], function (btn) {
          var next = isOn ? sets.filter(function (x) { return x !== s[1]; }) : sets.concat([s[1]]);
          if (!next.length) return;   // never none
          setUi("artSets", next); if (n) get(btn);
          renderPanel();
        }));
      });
      add(b, qlbl("Sets"), chips);
    },
    popsall: function (b) {
      add(b, head("Popups", null, true));
      var by = {}, all = policy.listAllowed();
      all.forEach(function (a) { (by[a.site] = by[a.site] || []).push(a); });
      Object.keys(by).sort().forEach(function (s) {
        add(b, qlbl(s, "dn"), qlist(by[s].map(function (a) { return qrow("", plainDest(a.dest), [qmini("Remove", function () { policy.remove(a.site, a.dest); })]); })));
      });
      if (!all.length) add(b, el("div", "qnote", "Nothing allowed yet"));
    },
    more: function (b) {
      var copy = function () {
        try {
          chrome.runtime.sendMessage({ type: "pv:veil-log-get" }, function (a) {
            void chrome.runtime.lastError; a = Array.isArray(a) ? a : [];
            var two = function (x) { return (x < 10 ? "0" : "") + x; };
            var text = a.map(function (r) {
              var d = new Date(r.at || 0), s = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
              s += " " + (r.ev || "?") + " " + (r.src || "?") + (r.chan ? " " + r.chan : "") + " " + (r.site || "");
              if (r.ev === "up") s += (typeof r.p === "number" ? " " + r.p.toFixed(2) : "") + (r.why ? " " + r.why : "");
              else s += (typeof r.s === "number" ? " " + r.s + " s" : "") + (r.why ? " (" + r.why + ")" : "");
              return s;
            }).join("\n") + (a.length ? "\n" : "");
            var done = function (ok) { logNote = ok ? (a.length ? a.length + " lines copied" : "Nothing logged yet") : "Could not copy"; if (panelOpen && sub === "more") renderPanel(); };
            try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
          });
        } catch (e) {}
      };
      add(b, head("More", null, true), qlist([
        !touchy && qrow("zoom", "Small view", [qsw("Small view", ui("smallView") !== false, function (on) { setUi("smallView", on); })]),
        qrow("sun", "Button glow", [qseg([["Normal", "normal"], ["Strong", "strong"]], ui("ringGlow") === "strong" ? "strong" : "normal", function (v) { setUi("ringGlow", v === "strong" ? "strong" : undefined); }, true)]),
        qrow("sync", "Rule updates", [qsw("Rule updates", !!ui("packUpdates"), function (on) {
          setUi("packUpdates", on);
          if (on) { try { chrome.runtime.sendMessage({ type: "pv:pack-check" }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
        })]),
        qrow("clock", "Ads covered", [covered(), qmini("Reset", function () { if (PV.reclaimReset) PV.reclaimReset(); })]),
        qrow("doc", "Log", [qmini("Copy", copy), qmini("Clear", function () { try { chrome.runtime.sendMessage({ type: "pv:veil-log-clear" }, function () { void chrome.runtime.lastError; }); } catch (e) {} logNote = "Cleared"; })])
      ]));
      if (logNote) add(b, el("div", "qnote", logNote));
    }
  };
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
      if (msg.type === "prism-popup-open-panel") { settingsClose();   /* the settings go as the controls open (2026-11-18): the menu came up dimmed under them */ if (!host) mount(); if (prefs.hidden) { pill.classList.remove("hidden"); } openPanel("menu"); }
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
