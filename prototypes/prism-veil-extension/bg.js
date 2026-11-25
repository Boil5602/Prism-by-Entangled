/*
  PRISM - background service worker (spec section 30). Local-only.

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
// The rule updates' reader (src/rules-pack.js, 0.9.0): a service worker loads it here; Firefox's background page lists it before
// this file in its manifest (build-firefox.mjs).
try { if (typeof importScripts === "function" && typeof PrismRulesPack === "undefined") importScripts("src/rules-pack.js"); } catch (eRP) {}
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

// @store-strip-begin (the start page is not in the Chromium store build, 2026-11-14; build-firefox.mjs cuts these lines)
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
// route it to PRISM. A window opened on a real URL (a link, a restored
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
// @store-strip-end
// After an install, an update, or being switched off and on again, the pages
// already open run no PRISM (the copy an update orphans tears itself down,
// main.js orphaned(), B-410), so the new version injects its content scripts
// into every open top frame the manifest matches, group by group in manifest
// order. Player embed frames (the all_frames groups) wait for their next
// load: listing a tab's frames needs a permission that carries an install
// warning. 2026-10-27,.
//
// This needs the all-sites host permissions in the manifest: the content
// scripts' own <all_urls> match does not let the background read a tab's
// address or inject into it (first try, B-414, injected nowhere; B-416). The
// install warning is the same one the content scripts always carried.
function urlMatches(p, url) {
  if (p === "<all_urls>") return /^(https?|file|ftp):/i.test(url);
  var i = p.indexOf("://"); if (i < 0) return false;
  var scheme = p.slice(0, i), rest = p.slice(i + 3), j = rest.indexOf("/"); if (j < 0) return false;
  var host = rest.slice(0, j), path = rest.slice(j);
  var u; try { u = new URL(url); } catch (e) { return false; }
  if (scheme === "*" ? !/^https?:$/.test(u.protocol) : u.protocol !== scheme + ":") return false;
  var h = u.hostname;
  if (host !== "*") {
    if (host.indexOf("*.") === 0) { var d = host.slice(2); if (h !== d && h.slice(-(d.length + 1)) !== "." + d) return false; }
    else if (h !== host) return false;
  }
  if (path === "/*") return true;
  var up = u.pathname + u.search, star = path.indexOf("*");
  if (star < 0) return up === path;
  return up.indexOf(path.slice(0, star)) === 0;   // one trailing star is all the manifest uses
}
// Runs in the page's isolated world first: a page whose copy is alive (the
// browser just started, or the worker woke for some other reason) is left
// alone; a torn-down copy marks itself dead (main.js orphaned()).
function probeTab() {
  var ns = window.__prismVeilNS;
  return { href: location.href, live: window.__prismVeil === true && !(ns && ns.__dead) };
}
function reinjectOpenTabs() {
  if (!chrome.scripting || !chrome.tabs) return;
  var groups = (chrome.runtime.getManifest().content_scripts || []).filter(function (g) { return !g.all_frames; });
  chrome.tabs.query({}, function (tabs) {
    if (chrome.runtime.lastError) return;
    (tabs || []).forEach(function (t) {
      if (t.id == null || t.discarded || t.status !== "complete" || !t.url || !/^https?:/i.test(t.url)) return;
      try {
        chrome.scripting.executeScript({ target: { tabId: t.id }, func: probeTab }, function (res) {
          if (chrome.runtime.lastError) return;
          var r = res && res[0] && res[0].result;
          if (!r || r.live || !r.href) return;
          var due = groups.filter(function (g) {
            var hit = (g.matches || []).some(function (p) { return urlMatches(p, r.href); });
            var ex = (g.exclude_matches || []).some(function (p) { return urlMatches(p, r.href); });
            return hit && !ex;
          });
          (function next(k) {
            if (k >= due.length) return;
            var g = due[k];
            try {
              chrome.scripting.executeScript({ target: { tabId: t.id }, files: g.js, world: g.world === "MAIN" ? "MAIN" : "ISOLATED", injectImmediately: true }, function () { void chrome.runtime.lastError; next(k + 1); });
            } catch (e) { next(k + 1); }
          })(0);
        });
      } catch (e0) {}
    });
  });
}
// One pass, 1.5 s on, so the copies an update orphaned have torn themselves
// down first (main.js checks every 1.2 s) and the probe sees them dead.
var reinjectT = 0;
function scheduleReinject() {
  if (reinjectT) return;
  reinjectT = setTimeout(function () { reinjectT = 0; reinjectOpenTabs(); }, 1500);
}
try { chrome.runtime.onInstalled.addListener(function (d) { if (d && (d.reason === "install" || d.reason === "update")) scheduleReinject(); }); } catch (e) {}
// Switched on again at edge://extensions, or the browser just started: no
// onInstalled, but a fresh worker with an empty session store. A worker that
// only woke from idle finds the mark and does nothing.
try {
  if (chrome.storage && chrome.storage.session) chrome.storage.session.get("booted", function (r) {
    if (chrome.runtime.lastError || (r && r.booted)) return;
    chrome.storage.session.set({ booted: Date.now() });
    scheduleReinject();
  });
} catch (e) {}

// @store-strip-begin
try { chrome.runtime.onStartup.addListener(function () { chrome.windows.getAll({ windowTypes: ["normal"] }, function (ws) { (ws || []).forEach(routeStart); }); }); } catch (e) {}
// @store-strip-end

// "Report ad" -> the PRISM report inbox. Only ever on a user's explicit click
// (src/report.js offerSend). Sent from here, not the page, so the request
// carries no page Origin/Referer and is not subject to the page's CSP.
// Entangled's own address for the inbox (2026-09-26; the same Fly app as prism-reports.fly.dev). No host permission is needed: the inbox
// answers the extension's own origin with CORS, and adding one would put a warning in front of every user on update.
var REPORT_URL = "https://reports.entangled.world/v1/report";
// Firefox's own data consent (2026-11-14): its manifest declares website content as optional data, so the browser's permission is
// asked for once before the first report goes (the settings page asks, from a press there: popup.html?highlight=report). Other
// browsers have no such permission and need nothing.
function reportConsentNeeded(cb) {
  try {
    var g = (chrome.runtime.getManifest().browser_specific_settings || {}).gecko || {};
    var opt = (g.data_collection_permissions || {}).optional || [];
    if (opt.indexOf("websiteContent") < 0 || !chrome.permissions) return cb(false);
    chrome.permissions.contains({ data_collection: ["websiteContent"] }, function (has) { if (chrome.runtime.lastError) return cb(false); cb(!has); });
  } catch (e) { cb(false); }
}
function sendReport(report, done) {
  reportConsentNeeded(function (need) {
    if (need) { done({ ok: false, error: "Firefox has not been allowed to send reports yet" }); return; }
    sendReportNow(report, done);
  });
}
function sendReportNow(report, done) {
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
// The picture sets (2026-10-15): nature is the pool itself; Cosmos and Museum art are PRISM's
// packs in folders beside it, each with its own signed list. pv:ui.artSets names the ones switched on (nature alone by default, never none).
var ART_SETS = { nature: "", cosmos: "cosmos/", gallery: "gallery/" };
function artSetsOn(ui) { var on = ((ui && ui.artSets) || ["nature"]).filter(function (k) { return ART_SETS.hasOwnProperty(k); }); return on.length ? on : ["nature"]; }
function fetchSignedArt(base) {
  base = base || ART_HOST;
  var opts = { referrerPolicy: "no-referrer", cache: "no-cache", credentials: "omit" };
  return Promise.all([
    fetch(base + "list.json", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    fetch(base + "list.sig", opts).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
    crypto.subtle.importKey("jwk", CRED_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  ]).then(function (x) {
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, x[2], b64ToBuf(x[1]), x[0]).then(function (ok) {
      if (!ok) throw new Error("bad signature");
      var idx = JSON.parse(new TextDecoder().decode(x[0]));
      if (!idx || idx.v !== 1 || !idx.files) throw new Error("bad index");
      return idx.files.filter(function (e) { return e && /^[\w.-]+\.jpe?g$/i.test(e.f) && /^[0-9a-f]{64}$/.test(e.sha256); }).map(function (e) { return { f: e.f, sha256: e.sha256, url: base + e.f }; });
    });
  });
}
function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
// The pictures themselves are kept on the device (2026-11-24, asked for: covers filled in late on a slow connection, because only
// the pictures' addresses were kept and each page asked the server for them, and a browser keeps a cache apart for each site).
// Each picture that passed its hash check is put in a database of the extension's own; a page asks this script for the bytes
// (prism-art-bytes) and draws them with no request to the network. pv:art.local says the set is stored. A picture that is not
// there is drawn from its address as before.
var ART_DB = "prism-art", ART_STORE = "img";
function artDb() {
  return new Promise(function (res, rej) {
    try {
      var q = indexedDB.open(ART_DB, 1);
      q.onupgradeneeded = function () { try { q.result.createObjectStore(ART_STORE); } catch (e) {} };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error || new Error("no database")); };
    } catch (e) { rej(e); }
  });
}
function artTx(mode, work) {
  return artDb().then(function (db) {
    return new Promise(function (res, rej) {
      try {
        var tx = db.transaction(ART_STORE, mode), out;
        tx.oncomplete = function () { try { db.close(); } catch (e) {} res(out); };
        tx.onerror = tx.onabort = function () { try { db.close(); } catch (e) {} rej(tx.error || new Error("database")); };
        work(tx.objectStore(ART_STORE), function (v) { out = v; });
      } catch (e) { try { db.close(); } catch (e2) {} rej(e); }
    });
  });
}
function artPut(url, buf) { return artTx("readwrite", function (st) { st.put(buf, url); }); }
function artGet(url) { return artTx("readonly", function (st, give) { var q = st.get(url); q.onsuccess = function () { give(q.result || null); }; }); }
// only the set in use is kept: the pictures of a set that was replaced go
function artKeep(urls) {
  return artTx("readwrite", function (st) {
    var q = st.getAllKeys();
    q.onsuccess = function () { (q.result || []).forEach(function (k) { if (urls.indexOf(k) < 0) st.delete(k); }); };
  });
}
function artClear() { return artTx("readwrite", function (st) { st.clear(); }).catch(function () {}); }
function bufToB64(buf) {
  var u = new Uint8Array(buf), s = "", step = 0x8000;
  for (var i = 0; i < u.length; i += step) s += String.fromCharCode.apply(null, u.subarray(i, i + step));
  return btoa(s);
}
// A set got before the pictures were kept (pv:art with no `local`): its own pictures are fetched once more, checked against the
// signed lists and stored, so the person keeps the pictures they have. Tried once a day at most until it is done.
function artBackfill() {
  try {
    chrome.storage.local.get(["pv:art", "pv:art:backfillAt"], function (r) {
      var rec = r && r["pv:art"];
      if (!rec || rec.local || !rec.urls || !rec.urls.length) return;
      if (Date.now() - (r["pv:art:backfillAt"] || 0) < 24 * 3600 * 1000) return;
      chrome.storage.local.set({ "pv:art:backfillAt": Date.now() });
      Promise.all(Object.keys(ART_SETS).map(function (k) { return fetchSignedArt(ART_HOST + ART_SETS[k]).catch(function () { return []; }); })).then(function (lists) {
        var sha = {}; [].concat.apply([], lists).forEach(function (e) { sha[e.url] = e.sha256; });
        var stored = 0;
        return rec.urls.reduce(function (chain, url) {
          return chain.then(function () {
            if (!sha[url]) return;
            return fetch(url, { referrerPolicy: "no-referrer", credentials: "omit" })
              .then(function (x) { if (!x.ok) throw new Error(x.status); return x.arrayBuffer(); })
              .then(function (buf) { return crypto.subtle.digest("SHA-256", buf).then(function (d) { if (hex(d) === sha[url]) return artPut(url, buf).then(function () { stored++; }); }); })
              .catch(function () {});
          });
        }, Promise.resolve()).then(function () {
          if (stored < rec.urls.length) return;
          chrome.storage.local.get("pv:art", function (r2) {
            var now = r2 && r2["pv:art"];
            if (!now || now.at !== rec.at) return;   // the person got a new set meanwhile
            chrome.storage.local.set({ "pv:art": { at: now.at, urls: now.urls, local: true } });
          });
        });
      }).catch(function () {});
    });
  } catch (e) {}
}
function artRefresh(cb) {
  if (artInflight) { artInflight.then(cb); return; }
  // every picture of every set switched on is one candidate, so each has the same chance whatever its set's size
  artInflight = new Promise(function (res) { chrome.storage.local.get("pv:ui", function (r) { res(artSetsOn(r && r["pv:ui"])); }); }).then(function (sets) {
    return Promise.all(sets.map(function (k) { return fetchSignedArt(ART_HOST + ART_SETS[k]).catch(function () { return []; }); }))
      .then(function (lists) { var all = [].concat.apply([], lists); if (!all.length) throw new Error("no verified list"); return all; });
  }).then(function (files) {
    var pool = files.slice(); for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    var pick = pool.slice(0, ART_N), good = [], stored = 0;
    return pick.reduce(function (chain, e) {
      return chain.then(function () {
        return fetch(e.url, { referrerPolicy: "no-referrer", credentials: "omit" })
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(function (buf) {
            return crypto.subtle.digest("SHA-256", buf).then(function (d) {
              if (hex(d) !== e.sha256) return;
              good.push(e.url);
              return artPut(e.url, buf).then(function () { stored++; }).catch(function () {});
            });
          })
          .catch(function () {});
      });
    }, Promise.resolve()).then(function () {
      if (good.length < 6) throw new Error("too few verified photos (" + good.length + ")");
      var rec = { at: Date.now(), urls: good };
      if (stored === good.length) rec.local = true;
      artKeep(good).catch(function () {});
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
    else artBackfill();
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

// A tab PRISM muted for a veil is put back when the page goes away under it
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
// The toolbar button's title for a tab (2026-11-06): the browser's own sharing mark cannot say who reads a tab, so while Veil reads a tab's
// live TV picture its button says so, above the source reliability line and the popups summary.
var titleParts = {};
var TITLE_BASE = "PRISM - popups intercepted on this site (click for the summary)";
var TITLE_LIVE = "PRISM is reading this tab's live TV picture to spot commercial breaks. Nothing leaves the browser.";
function paintTitle(id) {
  var p = titleParts[id] || {}, lines = [];
  if (p.live) lines.push(TITLE_LIVE);
  if (p.cred) lines.push("Source reliability\n" + p.cred);
  lines.push(TITLE_BASE);
  try { chrome.action.setTitle({ tabId: id, title: lines.join("\n") }); } catch (e) {}
}
function liveTitle(id, on) {
  if (id == null) return;
  var p = titleParts[id] = titleParts[id] || {};
  if (!!p.live === !!on) return;
  p.live = !!on; paintTitle(id);
}
// Development hooks (2026-11-07, before a store release): the self-reload from a localhost page, the version stamp and the live TV
// state attributes on <html> exist for an unpacked (development) install alone. The install type is asked once and kept in storage
// (pv:dev) for the content scripts, which cannot ask themselves.
// Where the settings window goes: the top centre of the browser window it was asked from.
function settingsPlace(bw, w) {
  // A screen above or left of the main one has places below zero (2026-11-18: the window opened on the screen under the browser's,
  // because a place below zero was moved up to zero). The place is the browser window's own, wherever that is.
  return { left: Math.round((bw.left || 0) + ((bw.width || w) - w) / 2), top: Math.round((bw.top || 0) + 70) };
}
// The settings in a window of their own, at the top centre of the browser window they were asked from (2026-11-18, asked for: the
// toolbar's popup is placed, sized and closed by the browser, and people had to fight it). The toolbar icon and the button's Settings
// both open it. One such window: a second press brings it forward for the new tab. The page is told which tab it is for, since the
// window's own tab is the page itself. Where no window can be made the settings open in a tab.
// The settings page can be put in a frame by a web page too (it has to be, to be drawn over one), so a page could draw it unseen
// under its own buttons and have the person press PRISM's switches. The settings in a frame therefore stay hidden and dead until
// this side says the frame is one it asked for: a random pass, made here for one tab, good once and for ten seconds (2026-11-18).
var settingsPasses = {};
function settingsPass(tabId) {
  var a = new Uint8Array(16); crypto.getRandomValues(a);
  var p = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  for (var k in settingsPasses) { if (Date.now() - settingsPasses[k].at > 10000) delete settingsPasses[k]; }
  settingsPasses[p] = { tab: tabId, at: Date.now() };
  return p;
}
function settingsPassGood(p, sender) {
  var r = p && Object.prototype.hasOwnProperty.call(settingsPasses, p) ? settingsPasses[p] : null;
  if (!r) return false;
  delete settingsPasses[p];
  return Date.now() - r.at <= 10000 && !!(sender && sender.tab && sender.tab.id === r.tab) && sender.id === chrome.runtime.id;
}
var SAFARI = false;
try { SAFARI = chrome.runtime.getURL("").indexOf("safari-web-extension:") === 0; } catch (eS) {}
function openSettings(tab, done) {
  // The panel is drawn over the web page itself (src/popups-ui.js), so it is no window that can get behind another (2026-11-18).
  // A page PRISM does not run on (the browser's own pages, the store, a PDF) cannot draw it: there the window below opens.
  var asked = false, viaWindow = function () { if (asked) return; asked = true; openSettingsWindow(tab, done); };
  try {
    // Safari (0.9.45, 2026-11-21): the page's process crashed as the panel's frame was put in it (msn.com, Safari on a Mac), so
    // there the settings open in a window of their own, which never puts an extension page inside a web page.
    if (SAFARI) { viaWindow(); return; }
    if (!tab || tab.id == null) { viaWindow(); return; }
    var late = setTimeout(viaWindow, 700);
    chrome.tabs.sendMessage(tab.id, { type: "prism-settings-open", tab: tab.id, pass: settingsPass(tab.id) }, { frameId: 0 }, function (r) {
      var bad = !!chrome.runtime.lastError;
      if (asked) return;
      clearTimeout(late);
      if (bad || !(r && r.ok)) { viaWindow(); return; }
      asked = true; done && done(true);
    });
  } catch (e) { viaWindow(); }
}
function openSettingsWindow(tab, done) {
  var base = chrome.runtime.getURL("popup.html"), tid = tab ? tab.id : null;
  var url = base + "?window=1" + (tid != null ? "&tab=" + tid : ""), W = 400, H = 330;
  var went = false, late = 0, fin = done;
  // in a tab the settings are a page like any other: it scrolls, and its Close closes the tab (popup.js, page=1)
  var tabUrl = base + "?page=1" + (tid != null ? "&tab=" + tid : "");
  var inTab = function () { if (went) return; went = true; clearTimeout(late); try { chrome.tabs.create({ url: tabUrl }, function () { var bad = !!chrome.runtime.lastError; fin && fin(!bad); }); } catch (e) { fin && fin(false); } };
  // An iPhone or iPad has no windows (2026-11-24, Safari on an iPhone: the Settings button of the panel in the page opened nothing;
  // the toolbar icon opens the settings as its own sheet, which a press in the page cannot ask for). There the settings open in a
  // tab. Anywhere else, a window that has not come after 1.5 s is given up for a tab too, so the button is never without an answer.
  if (IOS || !chrome.windows) {
    // The same sheet the toolbar icon opens, where the browser will open it for a press in the page (2026-11-24, asked that the
    // settings open one way on an iPhone). Whether Safari does is not known ahead: the sheet is asked for, and it says so itself
    // as it loads (popup.js, prism-popup-up). A refusal, or no word from the sheet in 1.2 s, and the settings open in a tab.
    var asked = false;
    try {
      if (IOS && chrome.action && typeof chrome.action.openPopup === "function") {
        var from = Date.now(), judged = false;
        var judge = function (ok) {
          if (judged) return; judged = true; clearTimeout(wait);
          if (ok) { if (!went) { went = true; fin && fin(true); } } else inTab();
        };
        var wait = setTimeout(function () { judge(popupUpAt >= from); }, 1200);
        popupUpTold = function () { judge(true); };
        asked = true;
        var pr = chrome.action.openPopup();
        if (pr && typeof pr.catch === "function") pr.catch(function () { judge(false); });
      }
    } catch (eP) { asked = false; }
    if (!asked) inTab();
    return;
  }
  done = function (ok) { if (went) return; went = true; clearTimeout(late); fin && fin(ok); };
  late = setTimeout(inTab, 1500);
  try {
    chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }, function (ws) {
      void chrome.runtime.lastError;
      var have = null;
      (ws || []).forEach(function (w) { (w.tabs || []).forEach(function (t) { if (!have && (t.url || t.pendingUrl || "").indexOf(base) === 0) have = { win: w.id, tab: t.id }; }); });
      if (have) {
        try { chrome.tabs.update(have.tab, { url: url }, function () { void chrome.runtime.lastError; }); chrome.windows.get(tab.windowId, function (bw) { var u = { focused: true }; if (!chrome.runtime.lastError && bw && bw.width != null) { var pl = settingsPlace(bw, W); u.left = pl.left; u.top = pl.top; } chrome.windows.update(have.win, u, function () { void chrome.runtime.lastError; done && done(true); }); }); } catch (e1) { inTab(); }
        return;
      }
      var make = function (pos) {
        var o = { url: url, type: "popup", width: W, height: H, focused: true };
        if (pos) { o.left = pos.left; o.top = pos.top; }
        chrome.windows.create(o, function (w) { if (chrome.runtime.lastError || !w) { inTab(); return; } done && done(true); });
      };
      try {
        chrome.windows.get(tab.windowId, function (bw) {
          if (chrome.runtime.lastError || !bw || bw.width == null) { make(null); return; }
          make(settingsPlace(bw, W));
        });
      } catch (e2) { make(null); }
    });
  } catch (e0) { inTab(); }
}
// A press on the icon while the settings are open closes them: the window closes itself as it loses the focus to that press, and the
// press that follows within a moment does not open it again.
var settingsBlurAt = 0;
// Safari on an iPhone or iPad has no windows (2026-11-21, first run through TestFlight: a tap on the icon opened nothing): there
// the icon opens the settings as the toolbar's own popup, a sheet on the phone, and the press never comes to onClicked.
var popupUpAt = 0, popupUpTold = null;   // the toolbar's own sheet said it is up (popup.js)
var IOS = false; try { IOS = /iPhone|iPad|iPod/.test(navigator.userAgent); } catch (eI) {}
function iosPopup() { IOS = true; try { chrome.action.setPopup({ popup: "popup.html" }); } catch (e) {} }
if (SAFARI) {
  try {
    chrome.runtime.getPlatformInfo(function (info) {
      void chrome.runtime.lastError;
      if ((info && info.os === "ios") || /iPhone|iPad|iPod/.test(navigator.userAgent) || !chrome.windows) iosPopup();
    });
  } catch (eP) { if (/iPhone|iPad|iPod/.test(navigator.userAgent) || !chrome.windows) iosPopup(); }
}
try { chrome.action.onClicked.addListener(function (tab) { if (Date.now() - settingsBlurAt < 800) { settingsBlurAt = 0; return; } openSettings(tab, null); }); } catch (eA) {}
var DEV = false;
try {
  chrome.management.getSelf(function (info) {
    void chrome.runtime.lastError;
    DEV = !!(info && info.installType === "development");
    try { chrome.storage.local.set({ "pv:dev": DEV }); } catch (e) {}
  });
} catch (e0) {}
// The break watch pack (docs/features/break-watch-packs.md; first cut 2026-11-07): with the one opt-in (pv:ui.packUpdates) the extension
// fetches pack.json and pack.sig once a day from prism.entangled.world (a host its manifest already names; no cookie, no query string,
// nothing about the person), verifies the signature with the pack key (its own key, never the update key) and keeps the parts it reads
// - the extension's model (veil) and the picture network - in storage when the pack is newer than the bundled one. The offscreen page
// reads them at a channel's start, never mid-break. In Firefox the same reader runs on the background page (2026-11-18).
var PACK_HOST = "https://prism.entangled.world/breakwatch/";
var PACK_PUBKEY = {"kty":"EC","x":"LrWgoxu5PyGer3kYoG6IbqfUUy9enje0FZFh5JaBaFA","y":"1OHpA5kQ0lZfWNgrtEeo1s-6rOGjSy-kqiSiEcf9T5Y","crv":"P-256"};
var PACK_ALARM = "pv-pack";
function packNewer(x, y) {   // "YYYY-MM-DD.N": later day, then higher count
  function split(s) { s = String(s || ""); var i = s.lastIndexOf("."); return i < 0 ? [s, 0] : [s.slice(0, i), +s.slice(i + 1) || 0]; }
  var a = split(x), b = split(y);
  return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];
}
function versionAtLeast(have, need) {
  var h = String(have || "").split("-")[0].split(".").map(Number), n = String(need || "").split("-")[0].split(".").map(Number);
  for (var i = 0; i < Math.max(h.length, n.length); i++) { var x = h[i] || 0, y = n[i] || 0; if (x !== y) return x > y; }
  return true;
}
function sha256Hex(buf) { return crypto.subtle.digest("SHA-256", buf).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }); }
var packInflight = null;
function packCheck(cb) {
  if (packInflight) return packInflight.then(cb, cb);
  var opts = { referrerPolicy: "no-referrer", cache: "no-cache", credentials: "omit" };
  packInflight = Promise.all([
    fetch(PACK_HOST + "pack.json", opts).then(function (r) { if (!r.ok) throw new Error("pack.json " + r.status); return r.arrayBuffer(); }),
    fetch(PACK_HOST + "pack.sig", opts).then(function (r) { if (!r.ok) throw new Error("pack.sig " + r.status); return r.text(); }),
    crypto.subtle.importKey("jwk", PACK_PUBKEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  ]).then(function (x) {
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, x[2], b64ToBuf(x[1]), x[0]).then(function (ok) {
      if (!ok) throw new Error("the signature does not match the pack key");
      var pack = JSON.parse(new TextDecoder().decode(x[0]));
      if (!pack || pack.format !== 1 || !pack.pack) throw new Error("a format this build does not read");
      var mine = chrome.runtime.getManifest().version;
      if (pack.minVeil && !versionAtLeast(mine, pack.minVeil)) throw new Error("needs the extension " + pack.minVeil);
      return new Promise(function (res) { chrome.storage.local.get(["pv:pack"], function (r) { res([pack, (r && r["pv:pack"]) || null]); }); });
    });
  }).then(function (pr) {
    var pack = pr[0], held = pr[1];
    return fetch(chrome.runtime.getURL("src/breakwatch/model.json")).then(function (r) { return r.json(); }).then(function (bundled) {
      var heldSerial = held && held.pack, bundledSerial = bundled && bundled.pack;
      if ((heldSerial && !packNewer(pack.pack, heldSerial)) || (bundledSerial && !packNewer(pack.pack, bundledSerial))) return { ok: true, pack: pack.pack, same: true };
      var parts = [];
      if (pack.models && pack.models.veil) parts.push(["pv:pack:veil", pack.models.veil]);
      if (pack.pictureNet) parts.push(["pv:pack:picnet", pack.pictureNet]);
      return Promise.all(parts.map(function (p) {
        var file = String(p[1].file || "");
        if (file.indexOf("..") >= 0 || file.indexOf("files/") !== 0) throw new Error("a file path outside the pack");
        return fetch(PACK_HOST + file, opts).then(function (r) { if (!r.ok) throw new Error(file + " " + r.status); return r.arrayBuffer(); }).then(function (buf) {
          return sha256Hex(buf).then(function (h) {
            if (h !== String(p[1].sha256 || "").toLowerCase()) throw new Error(file + " does not match its hash");
            var text = new TextDecoder().decode(buf); JSON.parse(text);   // the parts this build reads are JSON; one that does not parse is refused
            return [p[0], text];
          });
        });
      })).then(function (kv) {
        var o = {}; kv.forEach(function (x) { o[x[0]] = x[1]; });
        o["pv:pack"] = { pack: pack.pack, date: pack.date || "", notes: pack.notes || "", at: Date.now(), parts: kv.map(function (x) { return x[0]; }) };
        return new Promise(function (res, rej) { chrome.storage.local.set(o, function () { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res({ ok: true, pack: pack.pack, parts: kv.length }); }); });
      });
    });
  }).catch(function (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; })
    .then(function (r) { packInflight = null; try { var s = {}; s["pv:pack:last"] = { at: Date.now(), ok: !!r.ok, error: r.error || "", pack: r.pack || "", same: !!r.same }; chrome.storage.local.set(s); } catch (e2) {} return r; });
  return packInflight.then(cb, cb);
}
// Rule updates (docs/features/rule-updates.md, 0.9.0): with the same opt-in (pv:ui.packUpdates) the extension fetches rules.json and
// rules.sig from prism.entangled.world (a host its manifest already names; no cookie, no query string, nothing about the person).
// src/rules-pack.js checks the size, the signature (the pack key, or the spare key kept offline; either one verifies a file), the
// schema and the versions; a file that fails any of them changes nothing. What is kept is DATA (selectors, words, hostnames) that
// src/rules.js reads at a page's start: nothing in it is ever run. Only pv:rules and pv:rules:last are written here; the person's
// own rules (pv:rules:mine) are never touched. Switching the opt-in off removes the kept file, and a page loaded after that uses
// the packaged rules alone.
var RULES_HOST = "https://prism.entangled.world/veil/rules/";
var RULES_SPARE_PUBKEY = {"kty":"EC","x":"3uiKUa0BkEC6fVOfryxiVtByp18YQ0qPQltKEDuEEDk","y":"UtNrvMWc6fU9GHw1zpRCFpgkoGdLE_0gQ-Mtck-OrVg","crv":"P-256"};
var RULES_KEYS = [PACK_PUBKEY, RULES_SPARE_PUBKEY];
var UPDATES_RETRY_MS = 15 * 60 * 1000;
var UPDATES_EVERY_MS = 23 * 3600 * 1000;   // a check that was not asked for by a press waits this long after the last one
var rulesInflight = null;
function rulesCheck(cb) {
  if (rulesInflight) return rulesInflight.then(cb, cb);
  var RP = typeof PrismRulesPack !== "undefined" ? PrismRulesPack : null;
  if (!RP) { cb({ ok: false, error: "the rules reader did not load" }); return; }
  var opts = { referrerPolicy: "no-referrer", cache: "no-cache", credentials: "omit" };
  rulesInflight = Promise.all([
    fetch(RULES_HOST + "rules.json", opts).then(function (r) { if (!r.ok) throw new Error("rules.json " + r.status); return r.arrayBuffer(); }),
    fetch(RULES_HOST + "rules.sig", opts).then(function (r) { if (!r.ok) throw new Error("rules.sig " + r.status); return r.text(); }),
    new Promise(function (res) { chrome.storage.local.get(["pv:rules"], function (r) { res((r && r["pv:rules"]) || null); }); })
  ]).then(function (x) {
    return RP.accept({ bytes: x[0], sig: x[1], keys: RULES_KEYS, ownVersion: chrome.runtime.getManifest().version, heldSerial: x[2] && x[2].serial, subtle: crypto.subtle });
  }).then(function (r) {
    if (!r.ok || r.same) return r;
    return new Promise(function (res, rej) {
      chrome.storage.local.set({ "pv:rules": { serial: r.rules.serial, date: r.rules.date, notes: r.rules.notes, at: Date.now(), file: r.file } },
        function () { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res({ ok: true, serial: r.rules.serial }); });
    });
  }).catch(function (e) { return { ok: false, error: String(e && e.message || e).slice(0, 200) }; })
    .then(function (r) { rulesInflight = null; try { chrome.storage.local.set({ "pv:rules:last": { at: Date.now(), ok: !!r.ok, error: r.error || "", serial: r.serial || "", same: !!r.same } }); } catch (e2) {} return r; });
  return rulesInflight.then(cb, cb);
}
// One check of everything the opt-in covers: the rules in every browser, the live TV pack where an offscreen page can read it.
// `force` = the person just switched it on or pressed for a check; without it a check waits a day after the last one, however
// often the background starts.
function updatesCheck(force, cb) {
  cb = cb || function () {};
  chrome.storage.local.get(["pv:rules:last", "pv:pack:last"], function (r) {
    var last = r && r["pv:rules:last"], pl = r && r["pv:pack:last"];
    // a check that failed is tried again after a quarter of an hour, not a day (2026-11-18: one failed fetch stood in the settings as
    // the last word until the next day's check)
    var failed = (last && !last.ok) || (liveCan() && pl && !pl.ok);
    if (!force && last && Date.now() - (last.at || 0) < (failed ? UPDATES_RETRY_MS : UPDATES_EVERY_MS)) { cb({ ok: true, waited: true }); return; }
    rulesCheck(function (rr) {
      if (!liveCan()) { cb({ ok: !!(rr && rr.ok), rules: rr }); return; }
      packCheck(function (pr) { cb({ ok: !!(rr && rr.ok) && !!(pr && pr.ok), rules: rr, pack: pr }); });
    });
  });
}
function packApply(on, force) {
  try {
    if (on) { chrome.alarms.get(PACK_ALARM, function (a) { if (!a) chrome.alarms.create(PACK_ALARM, { periodInMinutes: 24 * 60 }); }); updatesCheck(!!force); }
    else { chrome.alarms.clear(PACK_ALARM); chrome.storage.local.remove(["pv:rules", "pv:rules:last"]); }
  } catch (e) {}
}
try {
  chrome.alarms.onAlarm.addListener(function (a) { if (a && a.name === PACK_ALARM) updatesCheck(false); });
  chrome.storage.local.get(["pv:ui", "pv:rules"], function (r) {
    var ui = (r && r["pv:ui"]) || {}, held = r && r["pv:rules"];
    // a kept file no newer than this package's own rules (after an update of the extension) is of no use: gone
    try { if (held && typeof PrismRulesPack !== "undefined" && !PrismRulesPack.newer(held.serial, PrismRulesPack.BASE_SERIAL)) chrome.storage.local.remove(["pv:rules"]); } catch (eH) {}
    if (ui.packUpdates) packApply(true, false);
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local" || !ch["pv:ui"]) return;
    var o = ch["pv:ui"].oldValue || {}, n = ch["pv:ui"].newValue || {};
    if (!!o.packUpdates !== !!n.packUpdates) packApply(!!n.packUpdates, true);
  });
} catch (e) {}
var veilLogQ = Promise.resolve();
function veilLogAppend(rec) {
  veilLogQ = veilLogQ.then(function () {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get("pv:veil-log", function (r) {
          var a = (r && Array.isArray(r["pv:veil-log"])) ? r["pv:veil-log"] : [];
          a.push(rec); if (a.length > 1000) a = a.slice(a.length - 1000);
          var o = {}; o["pv:veil-log"] = a; chrome.storage.local.set(o, function () { void chrome.runtime.lastError; res(); });
        });
      } catch (e) { res(); }
    });
  }).catch(function () {});
}
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "pv:live-stream") { liveStreamId(sender, sendResponse); return true; }
  if (msg && msg.type === "pv:offscreen-idle") { closeOffscreen(); return; }
  // the share route (the page reads its own picture): the offscreen page judges its frames, and the toolbar line says it is reading
  if (msg && msg.type === "pv:live-model") { if (!chrome.offscreen) { sendResponse({ error: "no offscreen" }); return; } ensureOffscreen().then(function () { sendResponse({ ok: true }); }, function (e) { sendResponse({ error: String(e && e.message || e) }); }); return true; }
  // a channel's learned logo for the live TV picture, kept in the extension's storage (the offscreen page has no storage of its own)
  if (msg && msg.type === "pv:live-save") { var sk = "pv:bw:" + String(msg.key || "?").slice(0, 80), so = {}; so[sk] = msg.state; try { chrome.storage.local.set(so); } catch (e) {} return; }   // a channel's logo, or __prints: the known ads learned here
  if (msg && msg.type === "pv:live-load") { var lk = "pv:bw:" + String(msg.key || "?").slice(0, 80); try { chrome.storage.local.get(lk, function (r) { sendResponse((r && r[lk]) || null); }); } catch (e) { sendResponse(null); } return true; }
  // the veil log (2026-11-07): every video veil over an ad break, up and down, from every tab, as the PRISM app keeps its calls.log;
  // the newest 1000 records stay, the panel copies or clears them. Appends are queued so two tabs' records never overwrite each other.
  if (msg && msg.type === "pv:veil-log") { if (msg.rec && typeof msg.rec === "object") veilLogAppend(msg.rec); return; }
  if (msg && msg.type === "pv:pack-check") { updatesCheck(true, function (r) { try { sendResponse(r); } catch (e) {} }); return true; }   // the panel's Check now
  // a veil's way to the options (2026-11-07): the panel's page opened as a tab with the named rows lit (popup.html?highlight=live)
  if (msg && msg.type === "pv:open-options") { try { chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") + "?highlight=" + encodeURIComponent(String(msg.highlight || "").slice(0, 20)) }); } catch (e) {} return; }
  if (msg && msg.type === "pv:veil-log-get") { veilLogQ = veilLogQ.then(function () { return new Promise(function (res) { chrome.storage.local.get("pv:veil-log", function (r) { sendResponse((r && r["pv:veil-log"]) || []); res(); }); }); }); return true; }
  if (msg && msg.type === "pv:veil-log-clear") { veilLogQ = veilLogQ.then(function () { return new Promise(function (res) { chrome.storage.local.remove("pv:veil-log", function () { sendResponse({ ok: true }); res(); }); }); }); return true; }
  // the soundscape for a veiled ad break (the person's choice; the tab is muted, so it plays from the offscreen page)
  if (msg && msg.type === "pv:ambient") {
    ambientTab = msg.on && sender && sender.tab ? sender.tab.id : null;
    if (!chrome.offscreen) { ambientHere(!!msg.on, String(msg.sound || "")); return; }
    var amb = { type: "pv:ambient-play", target: "offscreen", on: !!msg.on, sound: String(msg.sound || "") };
    if (!amb.on) { try { chrome.runtime.sendMessage(amb, function () { void chrome.runtime.lastError; }); } catch (e) {} return; }
    ensureOffscreen().then(function () { try { chrome.runtime.sendMessage(amb, function () { void chrome.runtime.lastError; }); } catch (e) {} }, function () {});
    return;
  }
  if (msg && msg.type === "pv:live-reading") { if (sender && sender.tab) liveTitle(sender.tab.id, !!msg.on); return; }
  if (msg && msg.type === "pv:live-ended") { liveTitle(msg.tabId, false); return; }
  if (msg && msg.type === "prism-report-consent") { reportConsentNeeded(function (need) { sendResponse({ need: need }); }); return true; }
  if (msg && msg.type === "prism-report-send") { sendReport(msg.report || {}, sendResponse); return true; }
  if (msg && msg.type === "prism-settings-pass") { sendResponse({ ok: settingsPassGood(String(msg.pass || ""), sender) }); return; }
  if (msg && msg.type === "prism-settings-blur") { settingsBlurAt = Date.now(); return; }
  // The settings panel in its frame over a web page: Firefox gives that frame no tabs calls, so they are made here (popup.js TABS).
  // Only for the settings page in a tab, and only on that tab: the tab the page names is never trusted.
  if (msg && msg.type === "prism-tabs-relay") {
    var rTab = sender && sender.tab, rArgs = msg.args || [];
    if (!rTab || rTab.id == null || sender.id !== chrome.runtime.id || String(sender.url || "").indexOf(chrome.runtime.getURL("popup.html")) !== 0) { sendResponse({}); return; }
    try {
      if (msg.fn === "sendMessage") chrome.tabs.sendMessage(rTab.id, rArgs[1], function (v) { void chrome.runtime.lastError; sendResponse({ value: v }); });
      else if (msg.fn === "get") chrome.tabs.get(rTab.id, function (t) { void chrome.runtime.lastError; sendResponse({ value: t }); });
      else if (msg.fn === "create" && /^https?:\/\//i.test(String((rArgs[0] || {}).url || ""))) chrome.tabs.create({ url: String(rArgs[0].url), active: true }, function () { void chrome.runtime.lastError; sendResponse({ value: null }); });
      else sendResponse({});
    } catch (eR) { sendResponse({}); }
    return true;
  }
  if (msg && msg.type === "prism-popup-up") { popupUpAt = Date.now(); if (popupUpTold) { var told = popupUpTold; popupUpTold = null; try { told(); } catch (eT) {} } return; }
  if (msg && msg.type === "prism-open-settings") { openSettings(sender && sender.tab, function (ok) { sendResponse({ ok: ok }); }); return true; }
  if (msg && msg.type === "prism-art-refresh") { try { artRefresh(sendResponse); } catch (eA) { sendResponse({ ok: false, error: "threw: " + eA }); } return true; }
  if (msg && msg.type === "prism-art-reset") { artClear(); chrome.storage.local.remove("pv:art", function () { sendResponse({ ok: true }); }); return true; }
  // a page asks for a stored picture's bytes; only an address of the pictures' own server is looked up
  if (msg && msg.type === "prism-art-bytes") {
    var au = String(msg.url || "");
    if (au.indexOf(ART_HOST) !== 0) { sendResponse({ ok: false }); return; }
    artGet(au).then(function (buf) { sendResponse(buf ? { ok: true, b64: bufToB64(buf) } : { ok: false }); }).catch(function () { sendResponse({ ok: false }); });
    return true;
  }
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
  // One tab's mutes are done IN ORDER (2026-09-29, a YouTube report): each is several async steps, and
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
    (titleParts[id] = titleParts[id] || {}).cred = String(msg.text || ""); paintTitle(id);
  } else if (msg.type === "pv:live-close") {
    liveTitle(id, false);   // the page stopped reading its picture (the offscreen page answers the message itself)
  } else if (msg.type === "prism-popup-badge") {
    var n = msg.count | 0;
    try {
      chrome.action.setBadgeText({ tabId: id, text: n ? String(n) : "" });
      chrome.action.setBadgeBackgroundColor({ tabId: id, color: "#2A2F38" });
      if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId: id, color: "#F0A83C" });
    } catch (e) {}
  } else if (msg.type === "prism-dev-reload") {
    // only src/popups-guard.js sends this, and only from 127.0.0.1 / localhost pages, and only an unpacked (development) install answers
    try { if (DEV && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(sender.tab.url || "")) chrome.runtime.reload(); } catch (e) {}
  } else if (msg.type === "prism-popup-deliberate") {
    (deliberate[id] = deliberate[id] || []).push(String(msg.url || ""));
    setTimeout(function () { var l = deliberate[id]; if (l) { var i = l.indexOf(String(msg.url || "")); if (i >= 0) l.splice(i, 1); } }, 15000);
    sendResponse && sendResponse(true);
  }
});
// (An older listener here opened the button's panel on the page at a press on the toolbar icon. It never ran while the icon had a
// popup of its own; with the settings window it opened both, 2026-11-18. The icon opens the settings alone: openSettings above.)

// A web popup is a web address. A tab on a local file, or on the browser's own pages, came from the browser itself - Edge's downloads menu opens a
// PDF as a new tab and names the tab you were on as its opener; that page saw no click, called it a popup, and the tab closed as it opened
// (2026-09-25). Web pages cannot open file:// at all.
function isWeb(url) { return !!url && /^(https?:|blob:|data:)/i.test(url); }
function isReal(url) { return !!url && !/^(about:|chrome:|edge:|chrome-extension:|extension:|file:|devtools:|view-source:)/i.test(url); }
function wasDeliberate(opener, url) {
  var l = deliberate[opener]; if (!l) return false;
  for (var i = 0; i < l.length; i++) { if (l[i] === url || (l[i] && url.indexOf(l[i].split("#")[0]) === 0)) { l.splice(i, 1); return true; } }
  return false;
}
// The browser's menu for this extension has the extension's name as its first item, and that opens this extension's store page in a new tab
// with the tab you were on as its opener. That page saw no click, called it a popup, and the tab closed as it opened (2026-11-17). A store
// page that carries this extension's own id is the browser's doing, or harmless: it is left alone.
function isOwnListing(url) {
  try { return /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)\//i.test(url) && url.indexOf(chrome.runtime.id) >= 0; } catch (e) { return false; }
}
function evaluateNewTab(opener, tabId, url) {
  if (!isWeb(url)) return;   // only a web address can be a web popup
  if (isOwnListing(url)) return;
  // Edge draws its New tab page from this one address. The first new tab after the extension is loaded was closed as it opened
  // (2026-11-18, seen at every load and not again after): that tab can be born empty and go straight here, so the page the person
  // was on was asked and had seen no press. A tab that lands on the browser's New tab content is left alone.
  if (/^https:\/\/ntp\.msn\.com\//i.test(url)) return;
  if (wasDeliberate(opener, url)) return;
  try {
    chrome.tabs.sendMessage(opener, { type: "prism-popup-evaluate", url: url, tabId: tabId }, function (decision) {
      if (chrome.runtime.lastError || !decision) return;   // no PRISM on the opener (edge:// etc.): leave it alone
      if (decision.action === "intercept") { try { chrome.tabs.remove(tabId); } catch (e) {} }
    });
  } catch (e) {}
}
// A bounce starts EMPTY: a page's popup is born on about:blank (or nothing yet) and its opener navigates it a moment later. A tab born on
// the browser's own pages (edge://newtab, chrome://downloads, an extension page) is the browser's - no web page can open one - and must not
// wait for a "real URL": Edge's Ctrl+T / + tab is born on edge://newtab with the tab you were on as its opener, and its New Tab page then
// loads from https://ntp.msn.com within the bounce window, so the page you were on was asked, saw no click, and the new tab closed as it
// opened (2026-10-20).
// Addresses no web page can send a tab to: the browser's own scheme, and Firefox's New tab and home pages. Not about:blank in any form,
// not about:srcdoc, not an extension's page: a page can reach those, and a tab there keeps waiting to be judged.
function isBrowsersOwn(url) { return /^(?:chrome|edge|brave|opera|vivaldi):\/\//i.test(url || "") || /^about:(?:newtab|home)$/i.test(url || ""); }
function isEmptyStart(url) { return !url || /^about:blank$/i.test(url); }
chrome.tabs.onCreated.addListener(function (tab) {
  if (tab.openerTabId == null || tab.id == null) return;
  var url = tab.pendingUrl || tab.url || "";
  if (isReal(url)) { evaluateNewTab(tab.openerTabId, tab.id, url); return; }
  if (!isEmptyStart(url)) return;   // the browser's own page: never a popup
  // about:blank now, navigated by the opener a moment later (a bounce): wait for the real URL
  (pendingByOpener[tab.openerTabId] = pendingByOpener[tab.openerTabId] || []).push({ tabId: tab.id, opener: tab.openerTabId, at: Date.now(), activeAtCreate: !!tab.active });
});
chrome.tabs.onUpdated.addListener(function (tabId, change, tab) {
  var url = change.url || (change.status === "loading" && tab && tab.url) || "";
  // A tab that was born empty and then shows one of the browser's own pages (its New tab page) is the browser's: no web page can
  // send a tab there. It stops waiting, so the page that New tab page loads next is not judged as a popup (2026-11-18).
  if (isBrowsersOwn(url)) { for (var o in pendingByOpener) pendingByOpener[o] = pendingByOpener[o].filter(function (q) { return q.tabId !== tabId; }); return; }
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

// Live TV (2026-11-06). YouTube TV's own ad slots (pv:ui.ytvVeil, on by default since 2026-11-07, src/ytv-cues.js) are read on YouTube TV
// alone: the marks are its format. The live TV picture (opt-in pv:ui.livePicture, src/live-picture.js) is read on the sites in the
// person's list of live TV sites (pv:ui.liveTvSites, tv.youtube.com to start with), so the ad detection can be tried on another one.
// Each file is registered only while its switch is on, and put into matching tabs already open when it is turned on (or the list
// changes); off, it is unregistered and the open pages stop at once (each listens to its switch itself).
var LIVE_TV_DEFAULT = ["tv.youtube.com"];
function liveTvSites(ui) { var l = ui && ui.liveTvSites; return Array.isArray(l) ? l : LIVE_TV_DEFAULT; }
function siteMatches(sites) {
  var out = [];
  sites.forEach(function (h) { if (/^[a-z0-9.-]+$/i.test(h)) out.push("*://" + h + "/*", "*://*." + h + "/*"); });
  return out;
}
function onLiveTvList(url, ui) {
  var host = ""; try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
  return liveTvSites(ui).some(function (h) { return host === h || host.slice(-(h.length + 1)) === "." + h; });
}
var YTV_SCRIPTS = [
  { key: "ytvVeil", id: "pv-ytv-cues", file: "src/ytv-cues.js", world: "MAIN", runAt: "document_start", matches: function () { return ["*://tv.youtube.com/*"]; } },
  { key: "livePicture", id: "pv-live-picture", file: "src/live-picture.js", files: ["src/breakwatch/cs.js", "src/breakwatch/break-model.js", "src/live-picture.js"], world: "ISOLATED", runAt: "document_idle", needs: ["tabCapture", "offscreen"],
    matches: function (ui) { return siteMatches(liveTvSites(ui)); }, list: true }
];
function ytvInjectOpen(sc, ui) {
  try {
    chrome.tabs.query({ url: sc.matches(ui) }, function (tabs) {
      void chrome.runtime.lastError;
      (tabs || []).forEach(function (t) {
        try { chrome.scripting.executeScript({ target: { tabId: t.id }, files: sc.files || [sc.file], world: sc.world }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      });
    });
  } catch (e) {}
}
// a reader's switch: the safe detection (the service's own marks, ytvVeil) is on unless switched off, the picture reading off unless
// switched on (decision 2026-11-07)
function scOn(sc, ui) { var v = ui && ui[sc.key]; return sc.key === "ytvVeil" ? v !== false : !!v; }
function ytvApply(sc, on, ui, again) {
  // no tab stream and no snapshot reader (Firefox for Android): the picture option is shown disabled there
  if (sc.needs && sc.needs.some(function (k) { return !chrome[k]; }) && !liveSnap()) on = false;
  var m = sc.matches(ui);
  if (!m.length) on = false;
  try {
    chrome.scripting.getRegisteredContentScripts({ ids: [sc.id] }, function (rs) {
      void chrome.runtime.lastError;
      var has = !!(rs && rs.length);
      function register() {
        chrome.scripting.registerContentScripts([{ id: sc.id, matches: m, js: sc.files || [sc.file], runAt: sc.runAt,
          world: sc.world, allFrames: false, persistAcrossSessions: true }], function () { void chrome.runtime.lastError; ytvInjectOpen(sc, ui); });
      }
      // a registration kept from an earlier version with another file list is renewed (a reload keeps registrations)
      var stale = has && JSON.stringify((rs[0] && rs[0].js) || []) !== JSON.stringify(sc.files || [sc.file]);
      if (on && has && (again || stale)) chrome.scripting.unregisterContentScripts({ ids: [sc.id] }, function () { void chrome.runtime.lastError; register(); });
      else if (on && !has) register();
      else if (!on && has) chrome.scripting.unregisterContentScripts({ ids: [sc.id] }, function () { void chrome.runtime.lastError; });
    });
  } catch (e) {}
}
// The tab's own stream for the live TV picture (2026-11-06): asked for with Veil's own pages as its user (no consumer tab), and held by
// Where there is no offscreen page (Firefox) the background page has a document of its own and plays the soundscape itself
// (src/ambient.js, listed before this file in that build's background scripts). A background page is put to sleep after half a
// minute without an event, which would cut the sound in the middle of a break: while a loop plays, a call to the extension's own
// API every twenty seconds keeps it awake, and stops with the sound. A break lasts minutes; ten minutes is the most it is held.
var ambientTab = null, ambientAwake = 0, ambientSince = 0;
function ambientHere(on, sound) {
  if (typeof PrismAmbient === "undefined") return;
  var rest = function () { if (ambientAwake) { clearInterval(ambientAwake); ambientAwake = 0; } };
  PrismAmbient.play(on, sound, rest);
  if (on && PrismAmbient.playing() && !ambientAwake) {
    ambientSince = Date.now();
    ambientAwake = setInterval(function () {
      if (Date.now() - ambientSince > 600000) { ambientHere(false, ""); return; }
      try { chrome.runtime.getPlatformInfo(function () { void chrome.runtime.lastError; }); } catch (e) {}
    }, 20000);
  }
}
// the tab that asked for the sound closed or went to another page in the middle of a break: nothing will say the break is over
function ambientGone(tid) {
  if (ambientTab === null || tid !== ambientTab) return;
  ambientTab = null;
  if (!chrome.offscreen) { ambientHere(false, ""); return; }
  try { chrome.runtime.sendMessage({ type: "pv:ambient-play", target: "offscreen", on: false, sound: "" }, function () { void chrome.runtime.lastError; }); } catch (e) {}
}
try { chrome.tabs.onRemoved.addListener(ambientGone); } catch (e) {}
try { chrome.tabs.onUpdated.addListener(function (tid, info) { if (info && info.status === "loading") ambientGone(tid); }); } catch (e) {}

// Veil's offscreen page (offscreen.html), so the browser's sharing notice names the extension rather than the site. The tab's page asks
// that page for its frames. Chromium hands a tab's stream only once Veil was invoked on the tab (its toolbar button); the panel then asks
// the page to start again.
var OFFSCREEN_URL = "offscreen.html", offscreenOpening = null;
function ensureOffscreen() {
  if (offscreenOpening) return offscreenOpening;
  offscreenOpening = (chrome.runtime.getContexts ? chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }) : Promise.resolve([]))
    .then(function (have) {
      if (have && have.length) return;
      return chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
        justification: "Reads the live TV picture of a tab the person chose, for spotting commercial breaks, and plays the soundscape the person chose for ad breaks. Nothing leaves the browser." });
    })
    .then(function () { offscreenOpening = null; }, function (e) { offscreenOpening = null; throw e; });
  return offscreenOpening;
}
// Firefox (2026-11-18): no tab stream and no offscreen page. There the reader (offscreen.js) is one of this background page's own
// scripts and reads the tab by snapshots; it names itself PrismLiveSnap.
function liveSnap() { return (typeof PrismLiveSnap !== "undefined" && PrismLiveSnap) || null; }
function liveCan() { return !!chrome.offscreen || !!liveSnap(); }
function liveStreamId(sender, sendResponse) {
  try {
    var t = sender && sender.tab, snap = liveSnap();
    if (!t || !(snap || (chrome.tabCapture && chrome.offscreen))) { sendResponse({ error: "not available here" }); return; }
    chrome.storage.local.get("pv:ui", function (r) {
      var ui = (r && r["pv:ui"]) || {};
      if (!ui.livePicture) { sendResponse({ error: "switched off" }); return; }
      if (!onLiveTvList(t.url || "", ui)) { sendResponse({ error: "not on the list of live TV sites" }); return; }
      if (snap) { snap.open(t.id, function (res) { if (res && res.ok) liveTitle(t.id, true); sendResponse(res || { error: "no reader" }); }); return; }
      chrome.tabCapture.getMediaStreamId({ targetTabId: t.id }, function (id) {
        var err = chrome.runtime.lastError;
        if (err || !id) { sendResponse({ error: err ? err.message : "no stream id" }); return; }
        ensureOffscreen().then(function () {
          chrome.runtime.sendMessage({ type: "pv:live-open", target: "offscreen", tabId: t.id, streamId: id }, function (res) {
            var e2 = chrome.runtime.lastError;
            if (!e2 && res && res.ok) liveTitle(t.id, true);
            sendResponse(e2 || !res ? { error: e2 ? e2.message : "the offscreen page did not answer" } : res);
          });
        }, function (e) { sendResponse({ error: "offscreen: " + String(e && e.message || e) }); });
      });
    });
  } catch (e) { sendResponse({ error: String(e && e.message || e) }); }
}
// a closed tab's stream ends with it; the offscreen page goes when it holds none (pv:offscreen-idle, in the one message listener above)
function closeOffscreen() {
  if (!chrome.offscreen) return;
  try { chrome.offscreen.closeDocument(function () { void chrome.runtime.lastError; }); } catch (e) {}
}
try {
  chrome.tabs.onRemoved.addListener(function (tabId) {
    delete titleParts[tabId];
    if (liveSnap()) { try { liveSnap().shut(tabId); } catch (e) {} return; }
    try { chrome.runtime.sendMessage({ type: "pv:live-shut", target: "offscreen", tabId: tabId }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  });
} catch (e) {}
try {
  chrome.scripting.unregisterContentScripts({ ids: ["pv-ytv-picture"] }, function () { void chrome.runtime.lastError; });   // its name until 0.7.222
  chrome.storage.local.get("pv:ui", function (r) { var ui = (r && r["pv:ui"]) || {}; YTV_SCRIPTS.forEach(function (sc) { ytvApply(sc, scOn(sc, ui), ui); }); });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local" || !ch["pv:ui"]) return;
    var o = ch["pv:ui"].oldValue || {}, n = ch["pv:ui"].newValue || {};
    YTV_SCRIPTS.forEach(function (sc) {
      var listChanged = sc.list && JSON.stringify(liveTvSites(o)) !== JSON.stringify(liveTvSites(n));
      if (scOn(sc, o) !== scOn(sc, n) || (listChanged && scOn(sc, n))) ytvApply(sc, scOn(sc, n), n, listChanged);
    });
  });
} catch (e) {}
