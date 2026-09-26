/*
  Prism - the time-reclaimed ledger (spec §26) in the extension. Records time
  spent behind a veil and exposes the three windows (this week / this month /
  all time) to the Prism pill's panel. Local only (§19/§22) - the store never
  leaves this browser.

  Counting rules (§26):
    - a video ad break adds its MEASURED duration, once, when it ends
    - a display/banner veil adds a flat 30 s ESTIMATE per slot, once per page
      visit (a set of already-counted targets guards the "once")
    - popups add nothing (that is the §30 ledger; blocked code isn't reclaimed)
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  var core = (typeof PrismReclaimed !== "undefined" && PrismReclaimed) || window.PrismReclaimed;   // see popups-ui.js: Chromium 151 top-level var
  if (!core) return;

  var cache = {};
  var store = {
    get: function (k) { return Promise.resolve(cache[k] == null ? null : cache[k]); },
    set: function (k, v) { cache[k] = v; try { var o = {}; o["pv:" + k] = v; chrome.storage.local.set(o); } catch (e) {} },
  };
  var ledger = new core.ReclaimedLedger(store);
  var ready = false, pendingSeconds = 0;
  var DISPLAY_ESTIMATE = 30;   // §26: flat per-slot estimate
  var countedSlots = null;     // WeakSet of display targets already counted this visit

  function addSeconds(s) {
    if (!(s > 0)) return;
    if (!ready) { pendingSeconds += s; return; }
    ledger.add(s);
  }

  // Video break: measure wall-clock from cover to uncover.
  PV.reclaimVideoStart = function () { return Date.now(); };
  PV.reclaimVideoEnd = function (startedAt) {
    if (!startedAt) return;
    addSeconds((Date.now() - startedAt) / 1000);
  };
  // Display slot: 30 s once per newly-covered target this page visit.
  PV.reclaimDisplaySlot = function (target) {
    try {
      if (!countedSlots) countedSlots = (typeof WeakSet !== "undefined") ? new WeakSet() : null;
      if (countedSlots) { if (countedSlots.has(target)) return; countedSlots.add(target); }
      addSeconds(DISPLAY_ESTIMATE);
    } catch (e) {}
  };
  PV.reclaimWindows = function () { return ledger.windows(); };
  PV.reclaimReset = function () { ledger.reset(); if (PV.onReclaimChange) PV.onReclaimChange(); };

  try {
    chrome.storage.local.get("pv:reclaimed:days", function (r) {
      if (r && r["pv:reclaimed:days"] != null) cache["reclaimed:days"] = r["pv:reclaimed:days"];
      ledger.load().then(function () {
        ready = true;
        if (pendingSeconds > 0) { ledger.add(pendingSeconds); pendingSeconds = 0; }
        if (PV.onReclaimChange) PV.onReclaimChange();
      });
    });
  } catch (e) { ready = true; }
})();
