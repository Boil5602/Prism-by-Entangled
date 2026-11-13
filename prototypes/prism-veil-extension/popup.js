/*
  PRISM - toolbar popup: the SETTINGS home (everything PRISM-wide, once) plus
  this site's popup summary. Short labels; the explanation of every control
  is its tooltip. Reads and writes storage directly (pv:ui and friends), so
  it works on any page; the on-page PRISM button is this-site-only and links
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
    if (!v) { $("site").textContent = ""; view.appendChild(el("div", "empty", "PRISM isn't running on this page (browser pages, the store, PDFs).")); $("open-here").disabled = true; return; }
    $("site").textContent = v.site; curSite = v.site; try { paintLiveSites(); } catch (e) {}
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
  // ---- every allowance, every site: a count, the list on request, a filter
  // once it is long (2026-10-27) --------
  var allowedOpen = false;
  function paintAllowedAll() {
    var rows = policy.listAllowed(), sites = {};
    rows.forEach(function (r) { sites[r.site] = 1; });
    var nSites = Object.keys(sites).length;
    $("allowed-all").hidden = !rows.length;
    if (!rows.length) return;
    $("allowed-text").textContent = rows.length + (rows.length === 1 ? " popup allowed" : " popups allowed") + " on " + nSites + (nSites === 1 ? " site" : " sites");
    $("allowed-show").textContent = allowedOpen ? "Hide" : "Show";
    var list = $("allowed-list"); list.hidden = !allowedOpen; list.textContent = "";
    if (!allowedOpen) return;
    var q = "", box = el("div");
    if (rows.length > 12) {
      var f = el("input", "filter"); f.type = "search"; f.placeholder = "Filter by site or destination";
      f.addEventListener("input", function () { q = f.value.trim().toLowerCase(); draw(); });
      list.appendChild(f);
    }
    list.appendChild(box);
    function draw() {
      box.textContent = "";
      var shown = rows.filter(function (r) { return !q || (r.site + " " + r.dest).toLowerCase().indexOf(q) >= 0; });
      shown.slice(0, 200).forEach(function (a) {
        var row = el("div", "row"); row.title = a.sentence + " (since " + a.since.slice(0, 10) + ")";
        var d = el("div", "dest"); d.appendChild(el("b", null, a.site)); d.appendChild(el("span", "meta", "→ " + a.dest)); row.appendChild(d);
        row.appendChild(btn("Remove", function () { policy.remove(a.site, a.dest); paintAllowedAll(); refresh(); }));
        box.appendChild(row);
      });
      if (shown.length > 200) box.appendChild(el("div", "sum", (shown.length - 200) + " more. Narrow the filter."));
      if (!shown.length) box.appendChild(el("div", "sum", "No match."));
    }
    draw();
  }
  $("allowed-show").addEventListener("click", function () { allowedOpen = !allowedOpen; paintAllowedAll(); });

  function refresh() {
    if (tabId == null) { render(null); return; }
    chrome.tabs.sendMessage(tabId, { type: "prism-popup-visit" }, function (v) {
      if (chrome.runtime.lastError || !v) { render(null); return; }
      render(v);
    });
  }

  // ---- PRISM-wide prefs (pv:ui) - the content scripts apply changes live ----
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
    $("veil-on").checked = !ui.veilOff;
    $("ai-veil").checked = !!ui.aiVeil;
    $("suggested-veil").checked = !!ui.suggestedVeil;
    $("small-view").checked = ui.smallView !== false;   // on unless switched off
    var look = ui.breakLook === "mute" || ui.breakLook === "show" ? ui.breakLook : "veil";
    Array.prototype.forEach.call(document.querySelectorAll("#sound-seg label"), function (l) { l.classList.toggle("on", l.dataset.snd === (ui.breakSound || "")); });
    $("sound-row").hidden = !chrome.offscreen;   // Firefox has no offscreen page to play it from
    Array.prototype.forEach.call(document.querySelectorAll("#look-seg label"), function (l) { l.classList.toggle("on", l.dataset.look === look); });
    $("ytv-veil").checked = ui.ytvVeil !== false;   // the safe detection (the service's own marks) is on by default (decision 2026-11-07)
    $("pack-updates").checked = !!ui.packUpdates;
    paintPack();
    $("live-picture").checked = !!ui.livePicture && !!chrome.tabCapture;
    $("live-sites").hidden = !(ui.livePicture && chrome.tabCapture);
    if (!ui.livePicture) $("live-now").hidden = true;
    paintLiveSites();
    $("src-marks").checked = !!ui.srcMarks;
    $("sources").hidden = !ui.srcMarks;
    var cs = ui.credSrc || {};
    Array.prototype.forEach.call(document.querySelectorAll("#sources input"), function (i) { i.checked = cs[i.dataset.src] !== false; });
    var hud = ui.hud || "interactive";
    Array.prototype.forEach.call(document.querySelectorAll("#hud label"), function (l) { var on = l.querySelector("input").value === hud; l.classList.toggle("on", on); l.querySelector("input").checked = on; });
    $("art-weekly").checked = !!ui.artWeekly;
    var sets = ui.artSets || ["nature"];
    Array.prototype.forEach.call(document.querySelectorAll("#art-sets input"), function (i) { i.checked = sets.indexOf(i.value) >= 0; });
  }
  $("veil-on").addEventListener("change", function () { setUi("veilOff", !$("veil-on").checked); });
  $("ai-veil").addEventListener("change", function () { setUi("aiVeil", $("ai-veil").checked); });
  $("suggested-veil").addEventListener("change", function () { setUi("suggestedVeil", $("suggested-veil").checked); });
  $("small-view").addEventListener("change", function () { setUi("smallView", $("small-view").checked); });
  Array.prototype.forEach.call(document.querySelectorAll("#sound-seg label"), function (l) {
    l.addEventListener("click", function () { setUi("breakSound", l.dataset.snd || undefined); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#look-seg label"), function (l) {
    l.addEventListener("click", function () { setUi("breakLook", l.dataset.look === "veil" ? undefined : l.dataset.look); });
  });
  $("ytv-veil").addEventListener("change", function () { setUi("ytvVeil", $("ytv-veil").checked); });
  // The pack (2026-11-07): the one opt-in; the note names the pack held, or the bundled one, and the last check's word
  function paintPack() {
    chrome.storage.local.get(["pv:pack", "pv:pack:last"], function (r) {
      var held = r && r["pv:pack"], last = r && r["pv:pack:last"], note = $("pack-note");
      if (!$("pack-updates").checked && !held) { note.hidden = true; return; }
      var s = held ? "Detections: pack " + held.pack + (held.date ? " (" + held.date + ")" : "") + (held.notes ? ". " + held.notes : "") : "Detections: the ones that came with this version.";
      if (last && !last.ok && last.error) s += " Last check: " + last.error + ".";
      else if (last && last.same) s += " Checked: nothing newer.";
      note.textContent = s; note.hidden = false;
    });
  }
  $("pack-updates").addEventListener("change", function () {
    setUi("packUpdates", $("pack-updates").checked);
    if ($("pack-updates").checked) { $("pack-note").textContent = "Checking..."; $("pack-note").hidden = false; chrome.runtime.sendMessage({ type: "pv:pack-check" }, function () { void chrome.runtime.lastError; paintPack(); }); }
    else paintPack();
  });
  // the tab's stream exists in Chromium only: elsewhere the option stays visible, disabled, with the reason
  if (!chrome.tabCapture) {
    $("live-picture").disabled = true;
    $("live-picture-row").setAttribute("data-tip", "This browser does not let an extension read a tab's picture, so this needs Edge or Chrome. Marked ad slots are still covered when that option is on.");
  }
  $("live-picture").addEventListener("change", function () { setUi("livePicture", $("live-picture").checked); askPicture(); });
  // The list of live TV sites whose picture is read (tv.youtube.com to start with): a host, or a site above it (example.com covers
  // www.example.com and watch.example.com)
  function liveSites() { return Array.isArray(ui.liveTvSites) ? ui.liveTvSites : ["tv.youtube.com"]; }
  function siteOf(text) {
    var h = String(text || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[\/?#:]/)[0].replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : "";
  }
  function onSites(host) { host = String(host || "").toLowerCase(); return liveSites().some(function (h) { return host === h || host.slice(-(h.length + 1)) === "." + h; }); }
  function addSite(h) {
    if (!h || liveSites().indexOf(h) >= 0) return;
    setUi("liveTvSites", liveSites().concat([h])); askPicture();
  }
  function paintLiveSites() {
    var box = $("live-site-list"); box.textContent = "";
    liveSites().forEach(function (h) {
      var c = el("span", "chip", h), x = document.createElement("button");
      x.textContent = "\u00d7"; x.title = "Remove " + h; x.setAttribute("aria-label", "Remove " + h);
      x.addEventListener("click", function () { setUi("liveTvSites", liveSites().filter(function (y) { return y !== h; })); });
      c.appendChild(x); box.appendChild(c);
    });
    if (!liveSites().length) box.appendChild(el("span", "empty", "No sites. Add one below."));
    var here = siteOf(curSite);
    $("live-site-here").hidden = !here || onSites(curSite);
    if (here) $("live-site-here").textContent = "Add " + here;
  }
  $("live-site-add").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var h = siteOf(e.target.value);
    if (h) { addSite(h); e.target.value = ""; } else e.target.select();
  });
  $("live-site-here").addEventListener("click", function () { addSite(siteOf(curSite)); });
  // Chromium hands a tab's stream only once Veil was invoked on that tab: opening this panel is that, so a YouTube TV tab waiting on it starts
  // ... and the panel says when this tab's picture is being read (the browser's own sharing mark names no one)
  // the channel on this tab and the person's choice for it (all breaks / sure breaks only / none), as the PRISM app's channel covers
  var liveChannel = "";
  function paintChannel(name, mode) {
    liveChannel = name || "";
    $("live-chan").hidden = !liveChannel;
    if (!liveChannel) return;
    $("live-chan-name").textContent = liveChannel + ": ";
    var cur = (ui.liveChannels || {})[liveChannel] || mode || "all";
    Array.prototype.forEach.call(document.querySelectorAll("#live-chan-seg label"), function (l) { l.classList.toggle("on", l.dataset.mode === cur); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#live-chan-seg label"), function (l) {
    l.addEventListener("click", function () {
      if (!liveChannel) return;
      var n = {}, cur = ui.liveChannels || {}; for (var k in cur) n[k] = cur[k];
      n[liveChannel] = l.dataset.mode;   // "all" is kept too: a choice the channel gate leaves alone
      setUi("liveChannels", n); paintChannel(liveChannel);
    });
  });
  function askPicture(again) {
    if (tabId == null || !chrome.tabCapture || !ui.livePicture) { $("live-now").hidden = true; $("live-chan").hidden = true; return; }
    try {
      chrome.tabs.sendMessage(tabId, { type: "pv:live-picture-start" }, function (st) {
        void chrome.runtime.lastError;
        $("live-now").hidden = !(st && st.state === "on");
        paintChannel(st && st.channel, st && st.mode);
        if (st && st.state === "starting" && !again) setTimeout(function () { askPicture(true); }, 1500);
      });
    } catch (e) {}
  }
  // Opened from a spotted veil's "Turn this detection off" (popup.html?highlight=live, 2026-11-07): the two live TV switches lit and
  // scrolled into view, with a line on what they do; the light goes out when one is touched.
  try {
    var hl = new URLSearchParams(location.search).get("highlight");
    if (hl === "live") {
      var rows = [$("ytv-veil-row"), $("live-picture-row")].filter(Boolean);
      rows.forEach(function (r) { r.classList.add("hl"); });
      $("live-note").hidden = false;
      setTimeout(function () { if (rows[0] && rows[0].scrollIntoView) rows[0].scrollIntoView({ block: "center" }); }, 50);
      rows.forEach(function (r) { r.addEventListener("change", function () { rows.forEach(function (x) { x.classList.remove("hl"); }); }); });
    }
  } catch (e) {}
  // The veil log (2026-11-07): the records bg.js keeps (pv:veil-log), copied as one line a record, newest last, like the PRISM app's
  // calls.log: the date and time, up or down, marked or spotted, the channel and site, then at a raise the chance and the rule, at a
  // drop how long the veil stood and the reason in brackets.
  function veilLogLine(r) {
    var d = new Date(r.at || 0), two = function (n) { return (n < 10 ? "0" : "") + n; };
    var when = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds());
    var s = when + " " + (r.ev || "?") + " " + (r.src || "?") + (r.chan ? " " + r.chan : "") + " " + (r.site || "");
    if (r.ev === "up") s += (typeof r.p === "number" ? " " + r.p.toFixed(2) : "") + (r.why ? " " + r.why : "");
    else s += (typeof r.s === "number" ? " " + r.s + " s" : "") + (r.why ? " (" + r.why + ")" : "");
    return s;
  }
  $("veil-log-copy").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "pv:veil-log-get" }, function (a) {
      void chrome.runtime.lastError;
      a = Array.isArray(a) ? a : [];
      var text = a.map(veilLogLine).join("\n") + (a.length ? "\n" : "");
      var done = function (ok) { $("veil-log-note").textContent = ok ? (a.length ? a.length + " lines copied" : "Nothing logged yet") : "Could not copy"; };
      try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    });
  });
  $("veil-log-clear").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "pv:veil-log-clear" }, function () { void chrome.runtime.lastError; $("veil-log-note").textContent = "Cleared"; });
  });
  $("src-marks").addEventListener("change", function () { setUi("srcMarks", $("src-marks").checked); });
  Array.prototype.forEach.call(document.querySelectorAll("#sources input"), function (i) {
    i.addEventListener("change", function () { var n = {}; var cs = ui.credSrc || {}; for (var k in cs) n[k] = cs[k]; n[i.dataset.src] = i.checked; setUi("credSrc", n); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#hud input"), function (r) { r.addEventListener("change", function () { if (r.checked) setUi("hud", r.value); }); });
  $("art-weekly").addEventListener("change", function () { setUi("artWeekly", $("art-weekly").checked); });
  // the picture sets (2026-10-15): nature on by default, Cosmos and Museum art from PRISM's server, never none; photos already fetched from the
  // server are fetched again from the new sets
  Array.prototype.forEach.call(document.querySelectorAll("#art-sets input"), function (i) {
    i.addEventListener("change", function () {
      var on = Array.prototype.filter.call(document.querySelectorAll("#art-sets input"), function (x) { return x.checked; }).map(function (x) { return x.value; });
      if (!on.length) { i.checked = true; $("art-sets-note").textContent = "Keep at least one set of pictures on."; $("art-sets-note").hidden = false; return; }
      $("art-sets-note").hidden = true;
      setUi("artSets", on);
      chrome.storage.local.get("pv:art", function (x) { if (x && x["pv:art"] && x["pv:art"].urls && x["pv:art"].urls.length) $("photos-get").click(); });
    });
  });

  // ---- photos (bg.js fetches; pv:art holds the set) ---------------------------
  function paintArt(rec) {
    var n = rec && rec.urls ? rec.urls.length : 0;
    $("photos-text").textContent = n ? n + " from the server · fetched " + ago(rec.at || 0) : "24 built-in";
    $("photos-get").textContent = n ? "Get 24 new" : "Get 24 photos";
    $("photos-get").title = n ? "Swap these for a different random 24 from the pool" : "Fetch 24 random photos from the signed pool on prism.entangled.world";
    $("photos-reset").hidden = !n;
    $("photos-reset").title = "Back to the 24 photos that ship inside PRISM (no server involved)";
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

  // ---- PRISM page (opt-in; "tabs" is an optional permission asked on the click)
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
      paintAllowedAll();
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        tabId = (tabs && tabs[0] && tabs[0].id != null) ? tabs[0].id : null;
        refresh();
        askPicture();
      });
    });
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local") return;
    if (ch["pv:ui"]) { ui = ch["pv:ui"].newValue || {}; paintUi(); }
    if (ch["pv:art"]) paintArt(ch["pv:art"].newValue);
    var pop = false;
    Object.keys(ch).forEach(function (k) { if (k.indexOf("pv:popups:") === 0) { cache[k.slice(3)] = ch[k].newValue; pop = true; } });
    if (pop) policy.load().then(function () { paintAllowedAll(); refresh(); });
  });
})();
