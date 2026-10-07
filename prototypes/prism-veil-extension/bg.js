/*
  Prism - background service worker (spec section 30). Local-only.

  1. Toolbar badge: per-tab count of popups intercepted on that page (the
     fallback surface when the on-page button is hidden); toolbar click opens
     the Control Center panel in the page.

  2. The BACKSTOP: tab-creation/opener tracking. Anything that gets past the
     in-page hook - a cross-origin frame's open(), a synthetic anchor click,
     a form with target=_blank, an about:blank bounce - still surfaces as a
     new tab whose opener is the page. The opener's content script evaluates
     the new tab's FINAL URL with core (against the human's last click, so a
     real ctrl-click on a link passes as "matches your click"); an intercept
     closes the tab at once and lands in the ledger. A deliberate Open from
     the Control Center announces itself first and is never touched.
*/
var frameTraces = {};      // tabId -> frameId -> { at, href, errs } (embed frames' trace rings, for reports)
var pendingByOpener = {};   // openerTabId -> [{ tabId, at }]
var BOUNCE_MS = 3000;       // a background about:blank popup is navigated by its opener well within this
var HUMAN_BOUNCE_MS = 500;  // a tab the human is in: a real bounce is tens of ms; typing is not
// (webNavigation would tell us HOW a tab navigated - typed vs script - but its
// install warning reads "access browser activity" / "read browsing history",
// which no privacy-first extension should carry for one heuristic. Timing it
// is. Known residual: a FOREGROUND popup that waits >0.5 s before navigating
// slips the backstop; the in-page window.open hook is the primary defence.)
var deliberate = {};        // openerTabId -> [url] the human just asked to open

// Start page (opt-in from the popup). There is deliberately NO
// chrome_url_overrides in the manifest - that cannot be toggled at runtime in
// any browser. Instead, while ntpEnabled is on, a freshly created new-tab page
// is navigated to ntp.html; off, the browser's own new tab is never touched.
var NEWTAB_URL = /^(?:chrome|edge|brave|opera|vivaldi):\/\/(?:newtab|new-tab-page|startpage)\/?$|^chrome-search:\/\/local-ntp\/|^about:(?:newtab|home)$/i;
var ntpEnabled = null;
function withNtpPref(cb) {
  if (ntpEnabled !== null) return cb(ntpEnabled);
  chrome.storage.local.get("ntpEnabled", function (r) { ntpEnabled = !!(r && r.ntpEnabled); cb(ntpEnabled); });
}
chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch.ntpEnabled) ntpEnabled = !!ch.ntpEnabled.newValue; });
function routeNewTab(tab, url) {
  if (!tab || tab.id == null) return;
  var u = url || tab.pendingUrl || tab.url || "";
  if (!NEWTAB_URL.test(u)) return;
  withNtpPref(function (on) {
    if (!on) return;
    chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("ntp.html") }, function () { void chrome.runtime.lastError; });
  });
}
chrome.tabs.onCreated.addListener(function (tab) { routeNewTab(tab); });
chrome.tabs.onUpdated.addListener(function (id, info, tab) { if (info.url) routeNewTab(tab, info.url); });

// Start page (opt-in, startEnabled). No browser exposes a runtime API for the
// homepage / startup page, so: when a window is created (including the first
// one at browser start), if its tab is the browser's blank/new-tab/home page,
// route it to Prism. A window opened on a real URL (a link, a restored
// session) is left alone.
var START_URL = /^(?:chrome|edge|brave|opera|vivaldi):\/\/(?:newtab|new-tab-page|startpage|start)\/?$|^about:(?:newtab|home|blank)$|^$/i;
function routeStart(win) {
  chrome.storage.local.get("startEnabled", function (r) {
    if (!(r && r.startEnabled)) return;
    chrome.tabs.query({ windowId: win.id }, function (tabs) {
      if (!tabs || tabs.length !== 1) return;                 // a restored session has many - leave it
      var t = tabs[0], u = t.pendingUrl || t.url || "";
      if (!START_URL.test(u) && !NEWTAB_URL.test(u)) return;
      chrome.tabs.update(t.id, { url: chrome.runtime.getURL("ntp.html") }, function () { void chrome.runtime.lastError; });
    });
  });
}
try { chrome.windows.onCreated.addListener(function (win) { if (win.type === "normal") setTimeout(function () { routeStart(win); }, 150); }); } catch (e) {}
try { chrome.runtime.onStartup.addListener(function () { chrome.windows.getAll({ windowTypes: ["normal"] }, function (ws) { (ws || []).forEach(routeStart); }); }); } catch (e) {}

// "Report ad" -> the Prism report inbox. Only ever on a user's explicit click
// (src/report.js offerSend). Sent from here, not the page, so the request
// carries no page Origin/Referer and is not subject to the page's CSP.
// Entangled's own address for the inbox (2026-09-26; the same Fly app as prism-reports.fly.dev). No host permission is needed: the inbox
// answers the extension's own origin with CORS, and adding one would put a warning in front of every user on update.
var REPORT_URL = "https://reports.entangled.world/v1/report";
function sendReport(report, done) {
  // sent as the person chose it in the panel (src/report.js sendable) - nothing is added here, not even the browser (2026-09-26)
  fetch(REPORT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report),
    referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store" })
    .then(function (r) { done({ ok: r.status === 204, error: r.status === 204 ? "" : "http " + r.status }); })
    .catch(function () { done({ ok: false, error: "network" }); });
}

// Source reliability list (spec section 5, "Credibility labeling"): Wikipedia's
// Perennial Sources table, hosted signed at prism.entangled.world. Fetched
// here ONCE a day at most (unparameterized, no referrer - sections 19/22), the
// signature verified against the same key as the art pool, and cached in
// storage.local so pages never fetch it themselves. A failed refresh keeps
// serving the last good copy; nothing is downloaded unless a page asks, and a
// page only asks while the person has marks switched on.
var CRED_HOST = "https://prism.entangled.world/veil/credibility/";
var CRED_PUBKEY = {"kty":"EC","x":"RRm7HBVLCL9Yl3rz-6pYtOdEHzFRG03Yu5nssSOvqkA","y":"hWgDhLZnqKak1Vn6uzOk5ZSyXlMQkfSsRIcyC3-qTNA","crv":"P-256"};
var CRED_TTL = 24 * 3600 * 1000;
var credInflight = {};   // file -> promise
var CRED_FILES = { list: 1, iffy: 1, sb: 1 };   // list = Wikipedia RSP (kept for the start page), iffy = Iffy Index, sb = Steven Black fakenews
function b64ToBuf(b64) { var bin = atob(b64.trim()), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
function fetchSignedCred(file) {
  var opts = { referrerPolicy: "no-referrer", cache: "no-cache", credentials: "omit" };
  return Promise.all([
    fetch(CRED_HOST + file + ".json", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    fetch(CRED_HOST + file + ".sig", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
    crypto.subtle.importKey("jwk", CRED_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  ]).then(function (x) {
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, x[2], b64ToBuf(x[1]), x[0]).then(function (ok) {
      if (!ok) throw new Error("bad signature");
      var idx = JSON.parse(new TextDecoder().decode(x[0]));
      if (!idx || idx.v !== 1 || !idx.entries) throw new Error("bad index");
      return idx;
    });
  });
}
// Photos for the veil (opt-in): 24 random photos from the SIGNED art pool at
// prism.entangled.world/veil/art/ (CC0 / public domain, Commons provenance in
// the pool manifest). The index signature is verified with the same key as
// the credibility lists; each chosen photo is fetched once and its SHA-256
// checked against the index (which also warms the browser cache). Stored as
// pv:art {at, urls}; the content scripts draw from it, bundled art otherwise.
// No identifiers, no referrer, no cookies. Weekly refresh via chrome.alarms
// when the person switched it on (pv:ui.artWeekly).
var ART_HOST = "https://prism.entangled.world/veil/art/", ART_N = 24, ART_ALARM = "prism-art-weekly";
var artInflight = null;
function fetchSignedArt() {
  var opts = { referrerPolicy: "no-referrer", cache: "no-cache", credentials: "omit" };
  return Promise.all([
    fetch(ART_HOST + "list.json", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    fetch(ART_HOST + "list.sig", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
    crypto.subtle.importKey("jwk", CRED_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  ]).then(function (x) {
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, x[2], b64ToBuf(x[1]), x[0]).then(function (ok) {
      if (!ok) throw new Error("bad signature");
      var idx = JSON.parse(new TextDecoder().decode(x[0]));
      if (!idx || idx.v !== 1 || !idx.files) throw new Error("bad index");
      return idx.files.filter(function (e) { return e && /^[\w.-]+\.jpe?g$/i.test(e.f) && /^[0-9a-f]{64}$/.test(e.sha256); });
    });
  });
}
function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
function artRefresh(cb) {
  if (artInflight) { artInflight.then(cb); return; }
  artInflight = fetchSignedArt().then(function (files) {
    var pool = files.slice(); for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    var pick = pool.slice(0, ART_N), good = [];
    return pick.reduce(function (chain, e) {
      return chain.then(function () {
        return fetch(ART_HOST + e.f, { referrerPolicy: "no-referrer", credentials: "omit" })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(function (buf) { return crypto.subtle.digest("SHA-256", buf); })
          .then(function (d) { if (hex(d) === e.sha256) good.push(ART_HOST + e.f); })
          .catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      if (good.length < 6) throw new Error("too few verified photos (" + good.length + ")");
      var rec = { at: Date.now(), urls: good };
      return new Promise(function (res) { chrome.storage.local.set({ "pv:art": rec }, function () { res({ ok: true, count: good.length, at: rec.at }); }); });
    });
  }).catch(function (e) { return { ok: false, error: String(e && (e.stack || e.message) || e).slice(0, 300) }; }).then(function (r) { artInflight = null; try { chrome.storage.local.set({ "pv:art:last": { at: Date.now(), ok: !!r.ok, error: r.error || "", count: r.count || 0 } }); } catch (e2) {} return r; });
  artInflight.then(cb);
}
function artWeeklyApply(on) {
  try {
    if (on) chrome.alarms.create(ART_ALARM, { periodInMinutes: 7 * 24 * 60 });
    else chrome.alarms.clear(ART_ALARM);
  } catch (e) {}
}
try {
  chrome.alarms.onAlarm.addListener(function (a) { if (a && a.name === ART_ALARM) artRefresh(function () {}); });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:ui"]) artWeeklyApply(!!(ch["pv:ui"].newValue && ch["pv:ui"].newValue.artWeekly)); });
  // catch up: weekly on and the set is older than a week (browser was closed at alarm time)
  chrome.storage.local.get(["pv:ui", "pv:art"], function (r) {
    var on = !!(r && r["pv:ui"] && r["pv:ui"].artWeekly); artWeeklyApply(on);
    var at = r && r["pv:art"] && r["pv:art"].at || 0;
    if (on && Date.now() - at > 7 * 24 * 3600 * 1000) artRefresh(function () {});
  });
} catch (e) {}
function credGet(file, cb) {
  if (!CRED_FILES[file]) return cb(null);
  var key = "pv:cred:" + file;
  chrome.storage.local.get(key, function (r) {
    var c = r && r[key];
    if (c && c.idx && Date.now() - (c.at || 0) < CRED_TTL) return cb(c.idx);
    if (!credInflight[file]) {
      credInflight[file] = fetchSignedCred(file).then(function (idx) {
        var o = {}; o[key] = { at: Date.now(), idx: idx }; chrome.storage.local.set(o);
        return idx;
      }).catch(function () {
        // keep the stale copy; retry in an hour, not on every page
        if (c && c.idx) { var o = {}; o[key] = { at: Date.now() - CRED_TTL + 3600 * 1000, idx: c.idx }; chrome.storage.local.set(o); }
        return (c && c.idx) || null;
      }).then(function (idx) { credInflight[file] = null; return idx; });
    }
    credInflight[file].then(cb);
  });
}

// A tab Prism muted for a veil is put back when the page goes away under it
// (a navigation while the veil is up, the tab closing): the content script
// that asked is gone, so the record is the only way back.
function tabMuteRestore(tid, andUpdate) {
  var mk = "pv:tabmute:" + tid;
  // in the tab's own queue (2026-09-29 review): run beside a mute it could remove the record between the mute's write and its update
  tabMuteChain(tid, function (done) {
    try {
      chrome.storage.local.get(mk, function (r) {
        var rec = r && r[mk]; if (!rec) { done(); return; }
        chrome.storage.local.remove(mk, function () {
          if (!andUpdate) { done(); return; }
          try { chrome.tabs.update(tid, { muted: !!rec.was }, function () { void chrome.runtime.lastError; done(); }); } catch (e) { done(); }
        });
      });
    } catch (e2) { done(); }
  });
}
try { chrome.tabs.onRemoved.addListener(function (tid) { tabMuteRestore(tid, false); }); } catch (e) {}
try { chrome.tabs.onUpdated.addListener(function (tid, info) { if (info && info.status === "loading") tabMuteRestore(tid, true); }); } catch (e) {}

// Per-tab queue for the veil's tab mutes: each request runs when the one before it on that tab has answered.
var tabMuteQueues = {};
function tabMuteChain(tid, job) {
  var prev = tabMuteQueues[tid] || Promise.resolve();
  var next = prev.then(function () { return new Promise(function (res) { var t = setTimeout(res, 5000); job(function () { clearTimeout(t); res(); }); }); });
  tabMuteQueues[tid] = next.catch(function () {});
}
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "prism-report-send") { sendReport(msg.report || {}, sendResponse); return true; }
  if (msg && msg.type === "prism-open-settings") {
    // chrome.action.openPopup exists in Chrome 127+ / Firefox; it may refuse
    // without a user gesture - the page then shows a hint instead.
    try { var pr = chrome.action.openPopup && chrome.action.openPopup({ windowId: sender && sender.tab && sender.tab.windowId }); if (pr && pr.then) { pr.then(function () { sendResponse({ ok: true }); }, function () { sendResponse({ ok: false }); }); return true; } sendResponse({ ok: !!pr }); } catch (e) { sendResponse({ ok: false }); }
    return;
  }
  if (msg && msg.type === "prism-art-refresh") { try { artRefresh(sendResponse); } catch (eA) { sendResponse({ ok: false, error: "threw: " + eA }); } return true; }
  if (msg && msg.type === "prism-art-reset") { chrome.storage.local.remove("pv:art", function () { sendResponse({ ok: true }); }); return true; }
  // Embed frames' trace rings: kept in storage, not memory - Firefox's event
  // page (and Chrome's service worker) is unloaded after idle and an in-memory
  // map vanished before the report asked (2026-08-29).
  if (msg && msg.type === "prism-frame-trace" && sender.tab) {
    var fk = "pv:frames:" + sender.tab.id, fid = String(sender.frameId), rec = { at: Date.now(), href: msg.href || "", errs: msg.errs || [] };
    chrome.storage.local.get(fk, function (r) { var ft = (r && r[fk]) || {}; ft[fid] = rec; var o = {}; o[fk] = ft; chrome.storage.local.set(o); });
    return;
  }
  if (msg && msg.type === "prism-frame-traces-get" && sender.tab) { var gk = "pv:frames:" + sender.tab.id; chrome.storage.local.get(gk, function (r) { sendResponse((r && r[gk]) || null); }); return true; }
  // Tab-level mute for the video veil (2026-09-12): the page cannot observe
  // it - no `muted` flip, no volumechange - so a player watching its own
  // media state (Pandora paused its rewarded ad at ~7s with "Resume your
  // video" once its <audio> was muted) sees nothing. The tab's own mute
  // state before the veil is kept in storage (the worker may sleep) and put
  // back on unmute; a tab the person had muted stays muted. Needs no
  // permission (tabs.update's muted field is unprivileged).
  // One tab's mutes are done IN ORDER (2026-09-29, a YouTube report: "Audio is coming through, veil was up"): each is several async steps, and
  // an ad's end (unmute) followed at once by the next ad's start (mute) could finish the other way round - the mute answered first, the page
  // gave its elements their sound back, then the late unmute left the tab loud under the veil (and the record it removed left the tab muted
  // after the next ad). Each request now waits for the one before it on the same tab.
  if (msg && msg.type === "prism-tab-mute" && sender.tab) {
    var tid = sender.tab.id, mk = "pv:tabmute:" + tid, want = !!msg.muted;
    tabMuteChain(tid, function (done) {
      var answer = function (ok) { try { sendResponse({ ok: ok }); } catch (e1) {} done(); };
      try {
        chrome.tabs.get(tid, function (tab) {
          var was = !!(tab && tab.mutedInfo && tab.mutedInfo.muted);
          if (want) {
            chrome.storage.local.get(mk, function (r) {
              var go = function () { chrome.tabs.update(tid, { muted: true }, function () { answer(!chrome.runtime.lastError); }); };
              if (!(r && r[mk])) { var o = {}; o[mk] = { was: was, at: Date.now() }; chrome.storage.local.set(o, go); } else go();
            });
          } else {
            chrome.storage.local.get(mk, function (r) {
              var rec = r && r[mk];
              if (!rec) { answer(true); return; }   // we never muted it: leave it
              chrome.storage.local.remove(mk, function () { chrome.tabs.update(tid, { muted: !!rec.was }, function () { answer(!chrome.runtime.lastError); }); });
            });
          }
        });
      } catch (e) { answer(false); }
    });
    return true;
  }
  if (msg && msg.type === "prism-cred-get") { credGet(String(msg.src || "list"), sendResponse); return true; }
  if (msg && msg.type === "prism-cred-open") { var u = String(msg.url || ""); if (/^https:\/\/(en\.wikipedia\.org|mediabiasfactcheck\.com|iffy\.news|github\.com\/StevenBlack)\//.test(u)) { try { chrome.tabs.create({ url: u, active: true }); } catch (e) {} } return; }
  if (!msg || !sender.tab) return;
  var id = sender.tab.id;
  if (msg.type === "prism-cred-site") {
    var t = String(msg.text || ""), base = "Prism - popups intercepted on this site (click for the summary)";
    try { chrome.action.setTitle({ tabId: id, title: t ? "Source reliability\n" + t + "\n" + base : base }); } catch (e) {}
  } else if (msg.type === "prism-popup-badge") {
    var n = msg.count | 0;
    try {
      chrome.action.setBadgeText({ tabId: id, text: n ? String(n) : "" });
      chrome.action.setBadgeBackgroundColor({ tabId: id, color: "#2A2F38" });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId: id, color: "#F0A83C" });
    } catch (e) {}
  } else if (msg.type === "prism-dev-reload") {
    // only src/popups-guard.js sends this, and only from 127.0.0.1 / localhost pages
    try { if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(sender.tab.url || "")) chrome.runtime.reload(); } catch (e) {}
  } else if (msg.type === "prism-popup-deliberate") {
    (deliberate[id] = deliberate[id] || []).push(String(msg.url || ""));
    setTimeout(function () { var l = deliberate[id]; if (l) { var i = l.indexOf(String(msg.url || "")); if (i >= 0) l.splice(i, 1); } }, 15000);
    sendResponse && sendResponse(true);
  }
});
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || tab.id == null) return;
  try { chrome.tabs.sendMessage(tab.id, { type: "prism-popup-open-panel" }); } catch (e) {}
});

// A web popup is a web address. A tab on a local file, or on the browser's own pages, came from the browser itself - Edge's downloads menu opens a
// PDF as a new tab and names the tab you were on as its opener; that page saw no click, called it a popup, and the tab closed as it opened
// (2026-09-25, "i click the pdf in my downloads ... i see the tab flash and close immediately"). Web pages cannot open file:// at all.
function isWeb(url) { return !!url && /^(https?:|blob:|data:)/i.test(url); }
function isReal(url) { return !!url && !/^(about:|chrome:|edge:|chrome-extension:|extension:|file:|devtools:|view-source:)/i.test(url); }
function wasDeliberate(opener, url) {
  var l = deliberate[opener]; if (!l) return false;
  for (var i = 0; i < l.length; i++) { if (l[i] === url || (l[i] && url.indexOf(l[i].split("#")[0]) === 0)) { l.splice(i, 1); return true; } }
  return false;
}
function evaluateNewTab(opener, tabId, url) {
  if (!isWeb(url)) return;   // only a web address can be a web popup
  if (wasDeliberate(opener, url)) return;
  try {
    chrome.tabs.sendMessage(opener, { type: "prism-popup-evaluate", url: url, tabId: tabId }, function (decision) {
      if (chrome.runtime.lastError || !decision) return;   // no Prism on the opener (edge:// etc.): leave it alone
      if (decision.action === "intercept") { try { chrome.tabs.remove(tabId); } catch (e) {} }
    });
  } catch (e) {}
}
chrome.tabs.onCreated.addListener(function (tab) {
  if (tab.openerTabId == null || tab.id == null) return;
  var url = tab.pendingUrl || tab.url || "";
  if (isReal(url)) { evaluateNewTab(tab.openerTabId, tab.id, url); return; }
  // about:blank now, navigated by the opener a moment later (a bounce): wait for the real URL
  (pendingByOpener[tab.openerTabId] = pendingByOpener[tab.openerTabId] || []).push({ tabId: tab.id, opener: tab.openerTabId, at: Date.now(), activeAtCreate: !!tab.active });
});
chrome.tabs.onUpdated.addListener(function (tabId, change, tab) {
  var url = change.url || (change.status === "loading" && tab && tab.url) || "";
  if (!isReal(url)) return;
  for (var opener in pendingByOpener) {
    var list = pendingByOpener[opener];
    for (var i = 0; i < list.length; i++) {
      if (list[i].tabId === tabId) {
        var age = Date.now() - (list[i].at || 0), human = list[i].activeAtCreate || !!(tab && tab.active);
        list.splice(i, 1);
        if (age > (human ? HUMAN_BOUNCE_MS : BOUNCE_MS)) return;
        evaluateNewTab(+opener, tabId, url); return;
      }
    }
  }
});
chrome.tabs.onRemoved.addListener(function (tabId) {
  for (var opener in pendingByOpener) pendingByOpener[opener] = pendingByOpener[opener].filter(function (p) { return p.tabId !== tabId; });
  delete deliberate[tabId]; delete frameTraces[tabId];
  try { chrome.storage.local.remove("pv:frames:" + tabId); } catch (e) {}
});
