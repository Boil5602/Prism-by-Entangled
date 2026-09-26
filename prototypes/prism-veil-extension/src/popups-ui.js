/*
  Prism - the Prism button + Popup Control Center (spec section 30). Isolated
  world. This is a SUBSCRIBER: it renders what prism-core's PopupPolicy says
  and forwards the human's taps back to it. It never computes policy.

  - Store of record: chrome.storage.local via a StoreDriver shim; the policy
    snapshot is pushed to the main-world hook (which intercepts window.open).
  - The pill: Shadow-DOM isolated, bottom-right, translucent, collapsible to
    an edge tab (remembered per site). Event-driven label morph paced by
    core's MorphCoalescer: bursts coalesce, one morph per ~10s, ~3s hold,
    aria-live. No pulsing, no alarm colors, no unprompted expansion; reduced
    motion dissolves instead of morphing.
  - The panel: ledger rows with exactly two verbs, Open and Always allow;
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
  var morph = new core.MorphCoalescer();

  function pushSnapshot() {
    try { document.dispatchEvent(new CustomEvent("prism-popup-policy", { detail: { state: JSON.stringify(policy.snapshot()) } })); } catch (e) {}
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
      if (hit) policy.load().then(function () { applyPrefs(policy.prefs(site)); pushSnapshot(); if (panelOpen) renderPanel(); badge(); });
    });
  } catch (e) {}

  // ---- the human's last click (for the tab backstop's click-consistency) ----
  var gesture = { url: "", at: 0 };
  ["pointerdown", "mousedown", "auxclick", "keydown"].forEach(function (ev) {
    addEventListener(ev, function (e) {
      var href = "";
      try { var a = e.target && e.target.closest ? e.target.closest("a[href]") : null; if (a) href = a.href; } catch (x) {}
      gesture = { url: href, at: Date.now() };
    }, true);
  });
  function recentGesture() { return (Date.now() - gesture.at < 1500) ? { url: gesture.url, windowsThisGesture: 1 } : null; }

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
    if (ev.type === "prefs" && ev.site === site) applyPrefs(ev.prefs);
  });
  function badge() {
    var n = 0; visitRows().forEach(function (r) { n += r.count; });
    try { chrome.runtime.sendMessage({ type: "prism-popup-badge", count: n }); } catch (e) {}
  }

  // ---- the pill -------------------------------------------------------------
  var host, root, pill, label, mk, panel, panelOpen = false, prefs = {};
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
.pill.dissolve .lbl{opacity:0}\
.pill.collapsed{right:0;padding:0;width:10px;height:44px;border-radius:8px 0 0 8px;justify-content:center;border-right:0;opacity:.35}\
.pill.collapsed .lbl,.pill.collapsed .x{display:none}\
.pill .x{opacity:.5;font-size:11px;margin-left:2px}\
.pill .x:hover{opacity:1}\
.pill.hidden{display:none}\
.pill .mk{display:none;line-height:0;flex:none;filter:drop-shadow(0 0 1px rgba(255,255,255,.7))}\
.srcrow{display:flex;align-items:center;gap:8px;padding:5px 0}\
.srcrow .nm{flex:1;min-width:0}\
.srcrow .nm .meta{color:#C0C8D2;font-size:11px;display:block}\
.disk{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.5)}\
.pill.marked .mk{display:inline-block}\
.pill.marked{opacity:.8}\
.pill.collapsed .mk{display:none}\
.panel{position:fixed;right:14px;bottom:52px;z-index:2147483647;width:min(400px,92vw);max-height:70vh;overflow:auto;padding:14px 16px;border-radius:14px;\
background:#1E232B;color:#F2F4F7;border:1px solid #2C333E;box-shadow:0 18px 60px rgba(0,0,0,.5);font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif}\
.panel h2{margin:0 0 4px;font-size:15px;font-weight:600}\
.panel .sub{color:#8A93A0;font-size:12px;margin-bottom:10px}\
.panel h3{margin:14px 0 6px;font:600 11px/1 'IBM Plex Mono',Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8A93A0}\
.row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(255,255,255,.06)}\
.row:first-of-type{border-top:0}\
.row .dest{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\
.row .meta{color:#5A6270;font-size:11px;display:block}\
.btn{font:600 12px -apple-system,Segoe UI,Roboto,sans-serif;color:#F2F4F7;background:#2A2F38;border:1px solid #2C333E;border-radius:8px;padding:5px 10px;cursor:pointer;white-space:nowrap}\
.btn:hover{border-color:#F0A83C}\
.btn.primary{background:#F0A83C;color:#0A0C0F;border-color:#F0A83C}\
.nudge{display:flex;align-items:center;gap:8px;margin:6px 0 2px;padding:7px 10px;border-radius:9px;background:rgba(240,168,60,.12);border:1px solid rgba(240,168,60,.35);font-size:13px}\
.nudge span{flex:1}\
.empty{color:#8A93A0;font-size:13px;padding:6px 0}\
.toggle{display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0;cursor:pointer}\
.toggle input{accent-color:#F0A83C}\
@media (prefers-reduced-motion:reduce){.pill{transition:none}}\
";

  function mount() {
    if (host) return;
    host = document.createElement("prism-popup-button");
    host.setAttribute("data-prism-veil", "1");
    root = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style"); style.textContent = CSS; root.appendChild(style);
    pill = document.createElement("div"); pill.className = "pill"; pill.setAttribute("role", "button"); pill.setAttribute("tabindex", "0");
    pill.setAttribute("aria-label", "Prism popup control center"); pill.setAttribute("aria-live", "polite");
    label = document.createElement("span"); label.className = "lbl"; label.textContent = "Prism";
    mk = document.createElement("span"); mk.className = "mk"; pill.appendChild(mk);
    var x = document.createElement("span"); x.className = "x"; x.textContent = "›"; x.title = "Collapse";
    pill.appendChild(label); pill.appendChild(x);
    pill.addEventListener("click", function (e) { e.stopPropagation(); if (pill.classList.contains("collapsed")) { setCollapsed(false); return; } togglePanel(); });
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
  function setCollapsed(c) { policy.setCollapsed(site, c); }
  function applyPrefs(p) {
    prefs = p || {};
    if (!pill) return;
    pill.classList.toggle("collapsed", !!prefs.collapsed);
    pill.classList.toggle("hidden", !!prefs.hidden || fullscreenNow());
    if (prefs.collapsed || prefs.hidden) closePanel();
  }
  function fullscreenNow() {
    try { return !!(document.fullscreenElement || document.pictureInPictureElement); } catch (e) { return false; }
  }
  document.addEventListener("fullscreenchange", function () { applyPrefs(prefs); });
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
  function paintMorph() {
    var m = morph.next(Date.now());
    if (!m) { scheduleMorph(); return; }
    if (!pill || prefs.hidden) { return; }
    setLabel(m.label, true);
    if (revertTimer) clearTimeout(revertTimer);
    revertTimer = setTimeout(function () { revertTimer = 0; setLabel("Prism", false); scheduleMorph(); }, m.until - Date.now());
  }
  function setLabel(text, accent) {
    if (!pill) return;
    var apply = function () { label.textContent = text; pill.classList.toggle("morph", !!accent); pill.classList.remove("dissolve"); };
    if (reduced) { pill.classList.add("dissolve"); setTimeout(apply, 180); }   // dissolve, no movement
    else apply();
  }

  // ---- the panel ------------------------------------------------------------
  function togglePanel() { if (panelOpen) closePanel(); else openPanel(); }
  function openPanel() {
    if (!panel) {
      panel = document.createElement("div"); panel.className = "panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Popup control center");
      panel.addEventListener("click", function (e) { e.stopPropagation(); });
      root.appendChild(panel);
    }
    panelOpen = true; pill.classList.add("on"); renderPanel(); dodge();
    setTimeout(function () { addEventListener("click", tapAway, true); addEventListener("keydown", escClose, true); }, 0);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false; if (pill) pill.classList.remove("on"); if (panel) panel.remove(); panel = null;
    removeEventListener("click", tapAway, true); removeEventListener("keydown", escClose, true);
  }
  function tapAway(e) { if (e.composedPath && e.composedPath().indexOf(host) >= 0) return; closePanel(); }
  function escClose(e) { if (e.key === "Escape") closePanel(); }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, primary, fn) { var b = el("button", "btn" + (primary ? " primary" : ""), text); b.type = "button"; b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); }); return b; }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " d ago";
  }
  var nudgeFor = null;   // dest awaiting "Open these automatically next time?"

  function renderPanel() {
    if (!panel) return;
    panel.textContent = "";
    panel.appendChild(el("h2", null, "Popups on " + site));
    var vrows = visitRows(), vtotal = 0; vrows.forEach(function (r) { vtotal += r.count; });
    panel.appendChild(el("div", "sub", vtotal ? vtotal + (vtotal === 1 ? " popup" : " popups") + " intercepted since you arrived, none loaded." : "Nothing intercepted since you arrived."));

    // since you arrived, by destination (the store's entry carries opens/nudge state)
    var rows = vrows.map(function (v) {
      var e = policy.ledger(site).find(function (x) { return x.dest === v.dest; });
      return Object.assign({}, e || { dest: v.dest, lastUrl: v.url, opens: 0, nudgeDismissed: 0 }, { count: v.count, lastSeen: new Date(v.last).toISOString(), context: v.reason });
    });
    if (rows.length) panel.appendChild(el("h3", null, "Since you arrived"));
    rows.forEach(function (r) {
      var row = el("div", "row");
      var d = el("div", "dest"); d.textContent = r.dest;
      var meta = el("span", "meta", r.count + "× · " + ago(r.lastSeen) + " · " + r.context);
      d.appendChild(meta); row.appendChild(d);
      row.appendChild(btn("Open", false, function () {
        var o = policy.open(site, r.dest); if (!o) return;
        var go = function () { try { window.open(o.url, "_blank", "noopener"); } catch (e) {} };   // now, visibly, by the human's choice
        try { chrome.runtime.sendMessage({ type: "prism-popup-deliberate", url: o.url }, function () { go(); }); } catch (e) { go(); }
        nudgeFor = o.nudge ? r.dest : null; renderPanel();
      }));
      row.appendChild(btn("Always allow", false, function () { policy.allow(site, r.dest); nudgeFor = null; renderPanel(); }));
      panel.appendChild(row);
      if (nudgeFor === r.dest) {
        var n = el("div", "nudge"); n.setAttribute("role", "status");
        n.appendChild(el("span", null, "Open these automatically next time?"));
        n.appendChild(btn("Yes", true, function () { policy.allow(site, r.dest); nudgeFor = null; renderPanel(); }));
        n.appendChild(btn("No", false, function () { policy.dismissNudge(site, r.dest); nudgeFor = null; renderPanel(); }));
        var t = n.querySelector(".btn"); t.title = core.allowSentence(site, r.dest);
        panel.appendChild(n);
      }
    });

    // allowed list - plain sentences, one Remove each
    var allowed = policy.listAllowed();
    panel.appendChild(el("h3", null, "Popups you’ve allowed"));
    if (!allowed.length) panel.appendChild(el("div", "empty", "None yet. Allowing is one tap on a row above, whenever you need it."));
    allowed.forEach(function (a) {
      var row = el("div", "row");
      var d = el("div", "dest", a.sentence); d.title = "since " + a.since.slice(0, 10);
      row.appendChild(d);
      row.appendChild(btn("Remove", false, function () { policy.remove(a.site, a.dest); renderPanel(); }));
      panel.appendChild(row);
    });

    // This site: two switches (tooltips carry the explanations).
    panel.appendChild(el("h3", null, "This site"));
    var t1 = el("label", "toggle"); t1.title = "Intercept every popup this site tries to open, except destinations you have allowed above."; var c1 = document.createElement("input"); c1.type = "checkbox"; c1.checked = policy.blockAll(site);
    c1.addEventListener("change", function () { policy.setBlockAll(site, c1.checked); });
    t1.appendChild(c1); t1.appendChild(document.createTextNode("Block all popups here")); panel.appendChild(t1);
    var t2 = el("label", "toggle"); t2.title = "Hide this button on this site. Popups are still intercepted; the toolbar badge shows the count. Bring it back from the toolbar popup."; var c2 = document.createElement("input"); c2.type = "checkbox"; c2.checked = !!prefs.hidden;
    c2.addEventListener("change", function () { policy.setHidden(site, c2.checked); });
    t2.appendChild(c2); t2.appendChild(document.createTextNode("Hide the Prism button here")); panel.appendChild(t2);

    // This site's reliability rating (only while marks are on; the switch and
    // the source credits live in the toolbar popup).
    if (PV.credOn && PV.credOn() && PV.CRED_SOURCES) {
      panel.appendChild(el("h3", null, "This site\u2019s reliability"));
      var ms = PV.credSite ? PV.credSite() : null;
      var TIP = { rsp: "Wikipedia\u2019s Perennial Sources list (CC BY-SA). Community-adjudicated; every rating links to the discussion that set it.",
                  iffy: "Iffy Index (CC BY 4.0). Sites Media Bias/Fact Check rates low credibility; the colour is MBFC\u2019s factual-reporting grade. Why? opens the MBFC review.",
                  sb: "Steven Black hosts, fakenews list (MIT). A plain domain list: red if listed, grey if not. No per-site rationale exists." };
      PV.CRED_SOURCES.forEach(function (src, i) {
        var m = ms ? ms[i] : null, row = el("div", "srcrow");
        (function (text, rowEl) { rowEl.addEventListener("mouseenter", function () { if (PV.showTextTip) PV.showTextTip(rowEl, text); }); rowEl.addEventListener("mouseleave", function () { if (PV.hideCredTip) PV.hideCredTip(rowEl); }); })(TIP[src.id] || src.name, row);
        var disk = el("span", "disk"); disk.style.background = m && !m.off && m.tier ? PV.credColor(m.tier) : (m && m.off ? "transparent" : PV.credColor(null));
        if (m && m.off) disk.style.boxShadow = "inset 0 0 0 1px #7d8590"; row.appendChild(disk);
        var nm = el("div", "nm"); nm.textContent = src.short + (m && !m.off && m.tier ? ": " + m.label + (m.name && m.name !== site ? " (" + m.name + ")" : "") : (m && m.off ? ": off" : (m && !m.loaded ? ": loading\u2026" : ": no information")));
        row.appendChild(nm);
        if (m && m.why) row.appendChild(btn("Why?", false, function () { try { chrome.runtime.sendMessage({ type: "prism-cred-open", url: m.why }); } catch (e) {} }));
        panel.appendChild(row);
      });
    }

    // Everything Prism-wide (veil, content, photos, start page, time
    // reclaimed) lives in the toolbar popup - one place, not two.
    var srow = el("div", "toggle"); srow.style.cssText = "justify-content:flex-end;gap:10px;margin-top:10px;cursor:default";
    var hint = el("span", null, "Veil, content, photos, time reclaimed:"); hint.style.color = "#A3ABB7"; hint.style.fontSize = "12px";
    srow.appendChild(hint);
    var sb = btn("Settings", true, function () {
      try {
        chrome.runtime.sendMessage({ type: "prism-open-settings" }, function (r) {
          if (!(r && r.ok) && PV.toast) PV.toast("Click the Prism icon in the browser toolbar for settings.", "#F0A83C");
        });
      } catch (e) { if (PV.toast) PV.toast("Click the Prism icon in the browser toolbar for settings.", "#F0A83C"); }
    });
    sb.title = "Open Prism\u2019s settings (the toolbar popup): veil behaviour, AI and reliability marks, photos, start page, time reclaimed";
    srow.appendChild(sb);
    panel.appendChild(srow);
  }
  function btnLike(text, fn) { var b = el("button", null, text); b.type = "button"; b.style.cssText = "font:600 12px -apple-system,Segoe UI,Roboto,sans-serif;color:#F2F4F7;background:#2A2F38;border:1px solid var(--edge,#2C333E);border-radius:8px;padding:5px 10px;cursor:pointer"; b.addEventListener("click", function (e) { e.stopPropagation(); fn(); }); return b; }

  // messages from bg.js: the tab backstop asks us to judge a new tab this
  // page opened (by its final URL, against the human's last click); the
  // toolbar icon opens the panel (fallback surface when the button is hidden)
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg) return;
      if (msg.type === "prism-popup-open-panel") { if (!host) mount(); if (prefs.hidden) { pill.classList.remove("hidden"); } openPanel(); }
      if (msg.type === "prism-popup-show-pill") { if (!host) mount(); prefs = policy.prefs(site); prefs.hidden = false; prefs.collapsed = false; applyPrefs(prefs); }
      if (msg.type === "prism-popup-hide-pill") { prefs = policy.prefs(site); prefs.hidden = true; applyPrefs(prefs); }
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
            try { prefs = policy.prefs(site); pushSnapshot(); mount(); badge(); if (PV.recordError) PV.recordError("pill mounted hidden=" + !!prefs.hidden + " collapsed=" + !!prefs.collapsed); } catch (e) { fail(e); }
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
