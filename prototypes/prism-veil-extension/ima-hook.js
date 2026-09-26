/*
  Observe-only hook for Google IMA / IMA-DAI ad-break events. Installed at
  document_start (main world) so it wraps the SDK before the player subscribes.
  Logs PRISMAD start/end — covers nothing — to validate the signal is exactly
  the ad boundary. Sets window.__prismAdActive as the reliable flag for later.
*/
(function () {
  if (window.__prismImaHook) return;
  window.__prismImaHook = true;
  window.__prismAdActive = false;

  // Ad-state watchdog. Some players (notably server-stitched / SSAI ones like
  // CNN) fire an ad STARTED but never a matching end event, which would leave
  // the flag stuck "active" forever and the veil covering real content. So
  // every "active" is armed with a timer sized to the ad's own duration; a
  // missing end auto-clears it. A real end event cancels the timer first.
  var MAX_BREAK_MS = 300000;      // absolute ceiling: no break is trusted past 5 min
  var DEFAULT_BREAK_MS = 75000;   // when the ad duration is unknown
  var adWatchdog = 0;
  function clearWatchdog() { if (adWatchdog) { clearTimeout(adWatchdog); adWatchdog = 0; } }
  function armWatchdog(ms) {
    clearWatchdog();
    ms = Math.min(ms || DEFAULT_BREAK_MS, MAX_BREAK_MS);
    adWatchdog = setTimeout(function () {
      adWatchdog = 0;
      if (window.__prismAdActive) { setAdRaw(false); log("watchdog cleared stuck ad-active after " + Math.round(ms / 1000) + "s"); }
    }, ms);
  }
  function setAdRaw(on) {
    window.__prismAdActive = on;
    try { document.documentElement.setAttribute("data-prism-ad", on ? "active" : "idle"); } catch (e) {}
    if (!on) { try { document.documentElement.removeAttribute("data-prism-adpod"); document.documentElement.removeAttribute("data-prism-adrem"); } catch (e) {} }
  }
  // Publish the current ad's position in the pod ("2/3", or "2/-1" if the total
  // is unknown) so the veil can show "Ad 2 of 3". Cleared when the break ends.
  function setPod(pos, tot) {
    try {
      if (pos > 0) document.documentElement.setAttribute("data-prism-adpod", pos + "/" + tot);
      else document.documentElement.removeAttribute("data-prism-adpod");
    } catch (e) {}
  }
  // Publish the CURRENT AD's remaining seconds from the SDK's own progress
  // clock (AD_PROGRESS: currentTime/duration) - the same clock the player's
  // top-left countdown runs on, so the card's "left" matches it exactly.
  // Scraping the player's elapsed/total readout instead drifts (Paramount+).
  function setRemaining(cur, dur) {
    try {
      if (dur > 0 && cur >= 0) document.documentElement.setAttribute("data-prism-adrem", String(Math.max(0, dur - cur)));
      else document.documentElement.removeAttribute("data-prism-adrem");
    } catch (e) {}
  }
  // setAd(on, durMs?) - durMs is the ad's reported duration when known, so the
  // watchdog matches the real break length plus a small grace.
  function setAd(on, durMs) {
    setAdRaw(on);
    if (on) armWatchdog(durMs ? durMs + 8000 : DEFAULT_BREAK_MS);
    else clearWatchdog();
  }

  function log() {
    try { console.error("PRISMAD " + Array.prototype.join.call(arguments, " ") + " @video=" + (function () { var v = document.querySelector("video"); return v ? Math.round(v.currentTime) : "?"; })()); } catch (e) {}
  }

  function hookDai(ima) {
    var dai = ima.dai && ima.dai.api;
    if (!dai || !dai.StreamManager || dai.StreamManager.__prismHooked) return;
    var proto = dai.StreamManager.prototype;
    var origAdd = proto.addEventListener;
    proto.addEventListener = function (type, listener, opts) {
      if (!this.__prismAttached) {
        this.__prismAttached = true;
        try {
          var T = dai.StreamEvent.Type;
          var self = this;
          origAdd.call(self, T.AD_BREAK_STARTED, function () { log("DAI AD_BREAK_STARTED"); });
          origAdd.call(self, T.AD_BREAK_ENDED, function () { setAd(false); log("DAI AD_BREAK_ENDED"); });
          origAdd.call(self, T.STARTED, function (e) {
            var title = "", dur = 0, pos = 0, tot = 0;
            try {
              var ad = e.getAd && e.getAd();
              if (ad) {
                if (ad.getTitle) title = ad.getTitle() || "";
                if (ad.getDuration) dur = (ad.getDuration() || 0) * 1000;
                var pi = ad.getAdPodInfo && ad.getAdPodInfo();
                if (pi) { pos = pi.getAdPosition ? pi.getAdPosition() : 0; tot = pi.getTotalAds ? pi.getTotalAds() : 0; }
              }
            } catch (x) {}
            // House bumpers / brand intros are not commercials - do not veil them.
            var house = /bumper|paramount\s*\+?\s*original|^\s*intro|brand\s*bumper|preview\s*bumper/i.test(title);
            setAd(!house, dur);
            setPod(house ? 0 : pos, tot);
            log("DAI ad STARTED " + pos + "/" + tot + " house=" + house + " title='" + title + "'");
          });
          origAdd.call(self, T.COMPLETE, function () { setRemaining(-1, 0); log("DAI ad COMPLETE"); });
          origAdd.call(self, T.AD_PROGRESS, function (e) {
            try {
              var sd = e.getStreamData && e.getStreamData();
              var ap = sd && sd.adProgressData;
              if (ap) setRemaining(+ap.currentTime, +ap.duration);
            } catch (x) {}
          });
          log("DAI StreamManager hooked");
        } catch (e) { log("DAI hook error " + e); }
      }
      return origAdd.call(this, type, listener, opts);
    };
    dai.StreamManager.__prismHooked = true;
    log("DAI prototype patched");
  }

  // Classify a per-ad title: house bumpers/intros are NOT ad breaks.
  function isHouse(title) {
    return /bumper|paramount[ ]*[+]?[ ]*original|^[ ]*intro|brand[ ]*bumper|preview[ ]*bumper/i.test(title || "");
  }

  // Client-side IMA (CNN, most web players). google.ima.AdsManager is NOT
  // exposed on the namespace, and the real break boundaries are
  // CONTENT_PAUSE_REQUESTED / CONTENT_RESUME_REQUESTED (there is no
  // AD_BREAK_STARTED here). We hook the EXPOSED AdsLoader, intercept the
  // site's own getAdsManager() call on ADS_MANAGER_LOADED, and attach our
  // listeners to the real manager it returns.
  function attachManager(ima, mgr) {
    if (!mgr || mgr.__prismAttached) return;
    mgr.__prismAttached = true;
    try {
      var T = ima.AdEvent.Type;
      mgr.addEventListener(T.CONTENT_PAUSE_REQUESTED, function () { setAd(true); log("IMA CONTENT_PAUSE_REQUESTED cover"); });
      mgr.addEventListener(T.STARTED, function (e) {
        var title = "", dur = 0, pos = 0, tot = 0;
        try {
          var ad = e && e.getAd && e.getAd();
          if (ad) {
            title = ((ad.getTitle && ad.getTitle()) || "") + " | " + ((ad.getAdSystem && ad.getAdSystem()) || "");
            if (ad.getDuration) dur = (ad.getDuration() || 0) * 1000;
            var pi = ad.getAdPodInfo && ad.getAdPodInfo();
            if (pi) { pos = pi.getAdPosition ? pi.getAdPosition() : 0; tot = pi.getTotalAds ? pi.getTotalAds() : 0; }
          }
        } catch (x) {}
        var house = isHouse(title);
        setAd(!house, dur);
        setPod(house ? 0 : pos, tot);
        log("IMA STARTED " + pos + "/" + tot + " title='" + title + "' house=" + house);
      });
      mgr.addEventListener(T.CONTENT_RESUME_REQUESTED, function () { setAd(false); log("IMA CONTENT_RESUME_REQUESTED uncover"); });
      mgr.addEventListener(T.ALL_ADS_COMPLETED, function () { setAd(false); log("IMA ALL_ADS_COMPLETED"); });
      mgr.addEventListener(T.AD_PROGRESS, function (e) {
        try { var d = e && e.getAdData && e.getAdData(); if (d) setRemaining(+d.currentTime, +d.duration); } catch (x) {}
      });
      mgr.addEventListener(T.COMPLETE, function () { setRemaining(-1, 0); });
      log("IMA AdsManager attached");
    } catch (e) { log("IMA attach error " + e); }
  }

  function hookIma(ima) {
    if (!ima.AdsLoader || ima.AdsLoader.__prismHooked) return;
    var proto = ima.AdsLoader.prototype;
    var origAdd = proto.addEventListener;
    if (!origAdd) return;
    var LT = null;
    try { LT = ima.AdsManagerLoadedEvent && ima.AdsManagerLoadedEvent.Type && ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED; } catch (e) {}
    proto.addEventListener = function (type, listener, opts) {
      var use = listener;
      try {
        if (LT && type === LT && typeof listener === "function") {
          use = function (e) {
            try {
              if (e && e.getAdsManager && !e.__prismWrapped) {
                e.__prismWrapped = true;
                var origGet = e.getAdsManager;
                e.getAdsManager = function () { var mgr = origGet.apply(this, arguments); try { attachManager(ima, mgr); } catch (x) {} return mgr; };
              }
            } catch (x) {}
            return listener.apply(this, arguments);
          };
        }
      } catch (e) {}
      return origAdd.call(this, type, use, opts);
    };
    ima.AdsLoader.__prismHooked = true;
    log("IMA AdsLoader hooked");
  }

  // Keep watching for the IMA SDK for the whole session. A user may browse
  // for minutes before clicking a video, at which point google.ima loads;
  // a 30s poll would have given up and the ad break would go uncovered.
  // Re-runs are cheap and idempotent (each hook guards with __prismHooked).
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (window.google && window.google.ima) {
      try { hookDai(window.google.ima); } catch (e) {}
      try { hookIma(window.google.ima); } catch (e) {}
    }
    // stop only once BOTH paths are hooked; otherwise keep watching up to ~20 min
    var g = window.google && window.google.ima;
    var daiDone = g && g.dai && g.dai.api && g.dai.api.StreamManager && g.dai.api.StreamManager.__prismHooked;
    var imaDone = g && g.AdsLoader && g.AdsLoader.__prismHooked;
    if ((daiDone && imaDone) || tries > 4000) clearInterval(iv);
  }, 300);
})();
