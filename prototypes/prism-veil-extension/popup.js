/*
  Prism - toolbar popup: the SETTINGS home (everything Prism-wide, once) plus
  this site's popup summary. Short labels; the explanation of every control
  is its tooltip. Reads and writes storage directly (pv:ui and friends), so
  it works on any page; the on-page Prism button is this-site-only and links
  here. Presentation only: the page's content script owns the visit ledger,
  core owns policy, bg.js owns fetching.
*/
(function () {
  // Tooltip panel: hover or keyboard-focus a [data-tip] row and its text
  // (our own HTML) shows in one styled panel below or above the row.
  (function tips() {
    var tip = document.getElementById("tip"), cur = null;
    if (!tip) return;
    function show(el) {
      cur = el; tip.innerHTML = el.getAttribute("data-tip") || ""; tip.hidden = false;
      var r = el.getBoundingClientRect(), h = tip.offsetHeight, below = r.bottom + 6;
      tip.style.top = (below + h <= innerHeight - 8 ? below : Math.max(8, r.top - h - 6)) + "px";
    }
    function hide() { cur = null; tip.hidden = true; }
    document.addEventListener("mouseover", function (e) { var el = e.target.closest && e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
    document.addEventListener("mouseleave", hide);
    document.addEventListener("focusin", function (e) { var el = e.target.closest && e.target.closest("[data-tip]"); if (el) show(el); });
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
  })();
  "use strict";
  var core = (typeof PrismPopups !== "undefined" && PrismPopups) || window.PrismPopups;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, fn) { var b = el("button", "btn", text); b.type = "button"; b.addEventListener("click", fn); return b; }
  function ago(ms) { var s = Math.max(0, (Date.now() - ms) / 1000); if (s < 60) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " d ago"; }
  function fmt(sec) { sec = Math.round(sec || 0); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60; if (h) return h + "h " + m + "m"; if (m) return m + "m " + s2 + "s"; return s2 + "s"; }

  var cache = {};
  var store = {
    get: function (k) { return Promise.resolve(cache[k] == null ? null : cache[k]); },
    set: function (k, v) { cache[k] = v; var o = {}; o["pv:" + k] = v; chrome.storage.local.set(o); },
  };
  var policy = new core.PopupPolicy(store);
  var tabId = null, curSite = null;

  // ---- this site's popups (the page's visit ledger) --------------------------
  function render(v) {
    var view = $("view"); view.textContent = "";
    if (!v) { $("site").textContent = ""; view.appendChild(el("div", "empty", "Prism isn't running on this page (browser pages, the store, PDFs).")); $("open-here").disabled = true; return; }
    $("site").textContent = v.site; curSite = v.site;
    var pf0 = policy.prefs(v.site); $("pill-on").checked = !pf0.hidden;
    var total = 0; v.rows.forEach(function (r) { total += r.count; });
    view.appendChild(el("div", "sum", total
      ? total + (total === 1 ? " popup" : " popups") + " intercepted on this visit (" + ago(v.since) + "), none loaded."
      : "No popups intercepted on this visit (" + ago(v.since) + ")."));
    v.rows.forEach(function (r) {
      var row = el("div", "row"); row.title = r.reason + " · last " + ago(r.last);
      var d = el("div", "dest"); d.appendChild(el("b", null, r.dest)); row.appendChild(d);
      row.appendChild(el("span", "count", r.count + "×"));
      row.appendChild(btn("Open", function () { try { chrome.tabs.create({ url: r.url, active: true }); } catch (e) {} }));
      var al = btn("Allow", function () { policy.allow(v.site, r.dest); refresh(); }); al.title = "Always let this site open " + r.dest;
      row.appendChild(al);
      view.appendChild(row);
    });
    var allowed = policy.listAllowed().filter(function (a) { return a.site === v.site; });
    allowed.forEach(function (a) {
      var row = el("div", "row"); row.title = a.sentence + " (since " + a.since.slice(0, 10) + ")";
      var d = el("div", "dest"); d.appendChild(el("b", null, "Allowed: " + a.dest)); row.appendChild(d);
      row.appendChild(btn("Remove", function () { policy.remove(a.site, a.dest); refresh(); }));
      view.appendChild(row);
    });
  }
  function refresh() {
    if (tabId == null) { render(null); return; }
    chrome.tabs.sendMessage(tabId, { type: "prism-popup-visit" }, function (v) {
      if (chrome.runtime.lastError || !v) { render(null); return; }
      render(v);
    });
  }

  // ---- Prism-wide prefs (pv:ui) - the content scripts apply changes live ----
  var ui = {}, uiLoaded = false;
  // Written at once from the copy the popup holds (read at boot, kept current
  // by onChanged): a read-then-write could be cut off by Firefox closing the
  // popup the moment it loses focus, and the toggle never landed.
  function setUi(k, v) {
    if (!uiLoaded) return chrome.storage.local.get("pv:ui", function (r) { ui = (r && r["pv:ui"]) || {}; uiLoaded = true; setUi(k, v); });
    var cur = {}; Object.keys(ui).forEach(function (x) { cur[x] = ui[x]; });
    cur[k] = v; ui = cur;
    chrome.storage.local.set({ "pv:ui": cur });
    paintUi();
  }
  function paintUi() {
    $("report-chip").checked = !!ui.reportChip;
    $("ai-veil").checked = !!ui.aiVeil;
    $("src-marks").checked = !!ui.srcMarks;
    $("sources").hidden = !ui.srcMarks;
    var cs = ui.credSrc || {};
    Array.prototype.forEach.call(document.querySelectorAll("#sources input"), function (i) { i.checked = cs[i.dataset.src] !== false; });
    var hud = ui.hud || "interactive";
    Array.prototype.forEach.call(document.querySelectorAll("#hud label"), function (l) { var on = l.querySelector("input").value === hud; l.classList.toggle("on", on); l.querySelector("input").checked = on; });
    $("art-weekly").checked = !!ui.artWeekly;
  }
  $("report-chip").addEventListener("change", function () { setUi("reportChip", $("report-chip").checked); });
  $("ai-veil").addEventListener("change", function () { setUi("aiVeil", $("ai-veil").checked); });
  $("src-marks").addEventListener("change", function () { setUi("srcMarks", $("src-marks").checked); });
  Array.prototype.forEach.call(document.querySelectorAll("#sources input"), function (i) {
    i.addEventListener("change", function () { var n = {}; var cs = ui.credSrc || {}; for (var k in cs) n[k] = cs[k]; n[i.dataset.src] = i.checked; setUi("credSrc", n); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#hud input"), function (r) { r.addEventListener("change", function () { if (r.checked) setUi("hud", r.value); }); });
  $("art-weekly").addEventListener("change", function () { setUi("artWeekly", $("art-weekly").checked); });

  // ---- photos (bg.js fetches; pv:art holds the set) ---------------------------
  function paintArt(rec) {
    var n = rec && rec.urls ? rec.urls.length : 0;
    $("photos-text").textContent = n ? n + " from the server · fetched " + ago(rec.at || 0) : "24 built-in";
    $("photos-get").textContent = n ? "Get 24 new" : "Get 24 photos";
    $("photos-get").title = n ? "Swap these for a different random 24 from the pool" : "Fetch 24 random photos from the signed pool on prism.entangled.world";
    $("photos-reset").hidden = !n;
    $("photos-reset").title = "Back to the 24 photos that ship inside Prism (no server involved)";
  }
  $("photos-get").addEventListener("click", function () {
    var b = $("photos-get"); b.disabled = true; b.textContent = "Fetching…"; $("photos-err").hidden = true;
    try {
      chrome.runtime.sendMessage({ type: "prism-art-refresh" }, function (r) {
        b.disabled = false;
        if (!(r && r.ok)) { $("photos-err").textContent = "Couldn't fetch: " + ((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "no answer"); $("photos-err").hidden = false; paintArt(null); return; }
        chrome.storage.local.get("pv:art", function (x) { paintArt(x && x["pv:art"]); });
      });
    } catch (e) { b.disabled = false; $("photos-err").textContent = "Couldn't fetch: " + e; $("photos-err").hidden = false; }
  });
  $("photos-reset").addEventListener("click", function () { try { chrome.runtime.sendMessage({ type: "prism-art-reset" }, function () { paintArt(null); }); } catch (e) {} });

  // ---- time reclaimed (pv:reclaimed:days; core derives the windows) ---------
  function paintReclaimed(days) {
    try {
      var R = (typeof PrismReclaimed !== "undefined" && PrismReclaimed) || window.PrismReclaimed;
      var c2 = {}; var st = { get: function (k) { return Promise.resolve(c2[k] == null ? null : c2[k]); }, set: function (k, v) { c2[k] = v; var o = {}; o["pv:" + k] = v; chrome.storage.local.set(o); } };
      c2["reclaimed:days"] = days || null;
      var led = new R.ReclaimedLedger(st);
      var paint = function () { var w = led.windows(); $("reclaimed").textContent = ""; [["Week", w.week], ["Month", w.month], ["All", w.all]].forEach(function (p, i) { if (i) $("reclaimed").appendChild(document.createTextNode("  ·  ")); $("reclaimed").appendChild(document.createTextNode(p[0] + " ")); $("reclaimed").appendChild(el("span", "mono", fmt(p[1]))); }); };
      var lp = led.load ? led.load() : null; if (lp && lp.then) lp.then(paint); else paint();
      $("reclaimed-reset").onclick = function () { led.reset(); chrome.storage.local.remove("pv:reclaimed:days"); c2["reclaimed:days"] = null; paint(); };
    } catch (e) { $("reclaimed").textContent = "—"; }
  }

  // ---- veil: pill visibility + reveal + open the on-page controls -----------
  $("pill-on").addEventListener("change", function () {
    if (!curSite) return;
    var show = $("pill-on").checked;
    if (show) {
      Object.keys(policy.prefsBySite || {}).forEach(function (st) { policy.setHidden(st, false); policy.setCollapsed(st, false); });
      policy.setHidden(curSite, false); policy.setCollapsed(curSite, false);
    } else policy.setHidden(curSite, true);
    if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: show ? "prism-popup-show-pill" : "prism-popup-hide-pill" }); } catch (e) {} }
  });
  $("reveal-15").addEventListener("click", function () {
    if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: "prism-popup-reveal", ms: 15000 }); } catch (e) {} }
    window.close();
  });
  $("open-here").addEventListener("click", function () {
    if (tabId != null) { try { chrome.tabs.sendMessage(tabId, { type: "prism-popup-open-panel" }); } catch (e) {} }
    window.close();
  });

  // ---- Prism page (opt-in; "tabs" is an optional permission asked on the click)
  function withTabs(cb) { try { chrome.permissions.request({ permissions: ["tabs"] }, function (g) { cb(!!g); }); } catch (e) { cb(false); } }
  $("startpage-on").addEventListener("change", function () {
    var on = $("startpage-on").checked;
    if (!on) return chrome.storage.local.set({ ntpEnabled: false });
    withTabs(function (ok) {
      if (!ok) { $("startpage-on").checked = false; return; }
      chrome.storage.local.set({ ntpEnabled: true }, function () { try { chrome.tabs.create({ url: chrome.runtime.getURL("ntp.html") }); } catch (e) {} window.close(); });
    });
  });
  $("homepage-on").addEventListener("change", function () {
    var on = $("homepage-on").checked;
    if (!on) return chrome.storage.local.set({ startEnabled: false });
    withTabs(function (ok) { if (!ok) { $("homepage-on").checked = false; return; } chrome.storage.local.set({ startEnabled: true }); });
  });

  // ---- boot -----------------------------------------------------------------
  chrome.storage.local.get(null, function (all) {
    all = all || {};
    $("startpage-on").checked = !!all.ntpEnabled;
    $("homepage-on").checked = !!all.startEnabled;
    ui = all["pv:ui"] || {}; uiLoaded = true; paintUi();
    paintArt(all["pv:art"]);
    paintReclaimed(all["pv:reclaimed:days"]);
    Object.keys(all).forEach(function (k) { if (k.indexOf("pv:") === 0) cache[k.slice(3)] = all[k]; });
    policy.load().then(function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        tabId = (tabs && tabs[0] && tabs[0].id != null) ? tabs[0].id : null;
        refresh();
      });
    });
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch["pv:ui"]) { ui = ch["pv:ui"].newValue || {}; paintUi(); }
    if (ch["pv:art"]) paintArt(ch["pv:art"].newValue);
  });
})();
