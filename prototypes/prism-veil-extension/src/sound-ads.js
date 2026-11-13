/*
  PRISM extension - sound ads (2026-11-12, asked for the PRISM app's handling of a music service's ads in the extension).

  A music service plays an ad between songs through the same element that plays the music. When the ad has a video, the video veil
  (src/video.js) covers it and turns the tab's sound off. When it has none - a still picture and a voice - there is nothing for the
  video veil to see: the picture is covered as any display ad is, and the ad was heard. This file turns the tab's sound off for
  such an ad, and gives it back the moment the ad is over.

  The signs are the service's own marks of an ad on its page, the ones the PRISM app's adapters read (prism-adapters/adapters/
  pandora.json, spotify.json, amazon-music.json; traceable source: each service's player page). Observe-only: nothing is pressed,
  nothing is kept from loading, and the page cannot see a tab mute. Rows are by host: a service not listed here gets nothing.

  The tab mute is the video veil's (bg.js "prism-tab-mute"): one record of the tab's own state, put back at the end. Two holders
  share it: the video veil does not give the sound back while a sound ad is on (PV.soundAdOn), and this file does not while a video
  veil is up (PV.vidVeil).
*/
(function () {
  "use strict";
  var PV = window.__prismVeilNS || (window.__prismVeilNS = {});
  if (PV.soundAdSigns) return;

  function vis(e) { try { if (!e) return false; var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (x) { return false; } }
  function wide(e) { try { return e.getBoundingClientRect().width; } catch (x) { return 0; } }
  function clock(t) { var m = (t || "").match(/(\d{1,2}):(\d{2})/); return m ? 60 * +m[1] + +m[2] : -1; }

  var ROWS = [
    {
      // Pandora. The tuner's own track title reads "Advertisement" the moment the ad's sound starts, seconds before the
      // "Why ads?" button; a visible ad frame of Google's ad kit or a visible video 300 px or wider (the music has none) each
      // count twice; "Why ads?", a video in the tuner bar and a disabled Skip count once. Two make an ad.
      source: "Pandora's player", host: /(^|\.)pandora\.com$/,
      read: function (doc) {
        var n = 0, video = null, q = function (s) { return doc.querySelector(s); };
        if (vis(q('[data-qa="why_ads_button"]'))) n++;
        var tuner = q('[data-qa="tuner_bar"]'), tv = tuner ? tuner.querySelector("video") : null;
        if (vis(tv)) { n++; video = tv; }
        var rv = q("#adContainer video, .Video__Container video");
        if (vis(rv) && !rv.paused) { n += 2; video = video || rv; }
        var mt = q('[data-qa="mini_track_title"]');
        if (mt && /^advertisement$/i.test((mt.textContent || "").trim())) n += 2;
        var ima = q('iframe[src*="imasdk.googleapis"]');
        if (vis(ima) && wide(ima) >= 200) n += 2;
        var vids = doc.querySelectorAll("video");
        for (var i = 0; i < vids.length; i++) if (vis(vids[i]) && wide(vids[i]) >= 300) { n += 2; video = video || vids[i]; break; }
        var skip = q('[data-qa="skip_button"]');
        if (skip && (skip.disabled || skip.getAttribute("aria-disabled") === "true")) n++;
        var rem = -1;
        try { if (video && isFinite(video.duration) && video.duration > 0 && video.duration < 600) rem = Math.max(0, video.duration - video.currentTime); } catch (e) {}
        return { ad: n >= 2, remaining: rem, count: null };
      }
    },
    {
      // Spotify's web player: four now-playing marks of an ad; two at once make an ad. The countdown is the time left, and the
      // ad's subtitle carries "N of M".
      source: "Spotify's player", host: /^open\.spotify\.com$/,
      read: function (doc) {
        var S = ['[data-testid="context-item-info-ad-subtitle"]', '[data-testid="ad-countdown-timer"]', '[data-testid="context-ad-logo"]', '[data-testid="ad-controls"]'];
        var n = 0, timer = null, sub = null;
        for (var i = 0; i < S.length; i++) { var e = doc.querySelector(S[i]); if (vis(e)) { n++; if (i === 0) sub = e; if (i === 1) timer = e; } }
        var c = sub && (sub.textContent || "").match(/(\d+)\s*of\s*(\d+)/i);
        return { ad: n >= 2, remaining: timer ? clock(timer.textContent) : -1, count: c ? c[1] + " of " + c[2] : null };
      }
    },
    {
      // Amazon Music: the songs come from the service's stream; an ad is a playing media element whose file is on the service's
      // picture host.
      source: "Amazon Music's player", host: /^music\.amazon\.[a-z.]+$/,
      read: function (doc) {
        var ms = doc.querySelectorAll("audio,video");
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i], src = m.currentSrc || m.src || "";
          if (!m.paused && !m.ended && src.indexOf("https://m.media-amazon.com/images/") === 0) {
            var rem = (isFinite(m.duration) && m.duration > 0) ? Math.max(0, Math.round(m.duration - m.currentTime)) : -1;
            return { ad: true, remaining: rem, count: null };
          }
        }
        return { ad: false, remaining: -1, count: null };
      }
    }
  ];

  // What the page says now: null on a host with no row, else { ad, remaining (seconds, -1 unknown), count ("1 of 2" or null), source }.
  PV.soundAdSigns = function (host, doc) {
    host = String(host || "").toLowerCase();
    for (var i = 0; i < ROWS.length; i++) {
      if (!ROWS[i].host.test(host)) continue;
      var r; try { r = ROWS[i].read(doc || document); } catch (e) { r = { ad: false, remaining: -1, count: null }; }
      r.source = ROWS[i].source; return r;
    }
    return null;
  };

  // ---- the sound, and the small note that says why it went quiet
  var on = false, heard = false, held = false, tabOk = false, seq = 0, note = null, noteRoot = null, last = null;
  PV.soundAdOn = function () { return held; };
  function trace(m) { try { if (PV.recordError) PV.recordError("sound ad " + m); } catch (e) {} }
  function videoUp() { try { return !!(PV.vidVeil && PV.vidVeil()); } catch (e) { return false; } }
  function send(muted, cb) {
    var s = ++seq;
    try {
      chrome.runtime.sendMessage({ type: "prism-tab-mute", muted: muted }, function (r) {
        var ok = !!(r && r.ok); try { if (chrome.runtime.lastError) ok = false; } catch (e0) {}
        if (cb && s === seq) cb(ok);
      });
    } catch (e) { if (cb) cb(false); }
  }
  // The elements are muted first, in the same turn, so no ad sound gets out while the background answers; they get their own state
  // back the moment the tab is silent, and stay muted only when the background does not answer (as under the video veil).
  function elementsMute() { document.querySelectorAll("audio,video").forEach(function (o) { try { if (o.__prismSoundWas === undefined) { o.__prismSoundWas = o.muted; o.muted = true; } } catch (e) {} }); }
  function elementsBack() { document.querySelectorAll("audio,video").forEach(function (o) { if (o.__prismSoundWas !== undefined) { try { o.muted = o.__prismSoundWas; } catch (e) {} delete o.__prismSoundWas; } }); }
  function hold() {
    if (held) return;
    held = true; tabOk = false; elementsMute();
    send(true, function (ok) { if (!held) return; tabOk = ok; if (ok) elementsBack(); trace(ok ? "tab muted" : "tab mute not answered: the elements stay muted"); });
  }
  function release() {
    if (!held) return;
    held = false; tabOk = false; elementsBack();
    if (videoUp()) { seq++; return; }   // the video veil holds the same mute and gives it back at its own end
    send(false, null);
  }

  function mmss(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  PV.soundAdLine = function (r) {
    var t = "Ad" + (r && r.count ? " " + r.count : "") + " \u00B7 sound off";
    if (r && r.remaining >= 0) t += " \u00B7 " + mmss(r.remaining) + " left";
    return t;
  };
  function noteShow(r) {
    try {
      if (!note) {
        note = document.createElement("div"); note.setAttribute("data-prism-ui", "1");
        noteRoot = note.attachShadow({ mode: "closed" });
        noteRoot.innerHTML = "<style>:host{all:initial}.n{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;display:inline-flex;align-items:center;gap:12px;"
          + "height:34px;padding:0 6px 0 14px;border-radius:17px;background:rgba(20,23,28,.86);color:#E8ECF2;border:1px solid rgba(255,255,255,.14);"
          + "font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;white-space:nowrap;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}"
          + ".d{width:8px;height:8px;border-radius:50%;background:#F2B14C}"
          + "button{all:unset;cursor:pointer;height:24px;padding:0 11px;border-radius:12px;background:#F2B14C;color:#14171C;font:700 12px/24px -apple-system,Segoe UI,Roboto,sans-serif}"
          + "button:hover{background:#F6C36F}</style><div class=\"n\" role=\"status\"><span class=\"d\"></span><span class=\"t\"></span><button type=\"button\" title=\"Turn the sound back on for this ad\">Hear it</button></div>";
        noteRoot.querySelector("button").addEventListener("click", function (ev) { ev.stopPropagation(); heard = true; trace("heard on request"); release(); noteHide(); });
      }
      if (!note.isConnected) { (document.fullscreenElement || document.documentElement).appendChild(note); if (PV.keepOnTop) PV.keepOnTop(note); }
      var line = PV.soundAdLine(r), t = noteRoot.querySelector(".t"); if (t.textContent !== line) t.textContent = line;
    } catch (e) {}
  }
  function noteHide() { try { if (note && note.isConnected) note.remove(); } catch (e) {} }

  function tick() {
    var r = null;
    try { r = PV.soundAdSigns(location.hostname, document); } catch (e) {}
    if (!r) return false;                      // no row for this host: the timer stops
    var off = false; try { off = !!(PV.suppressed && PV.suppressed()); } catch (e2) {}
    if (r.ad && off && on) heard = true;       // Escape, or PRISM switched off, during an ad: that ad stays heard
    var ad = r.ad;
    if (ad !== on) { on = ad; if (!ad) heard = false; trace(ad ? "on (" + r.source + ")" : "over"); }
    if (off && !on) return true;
    if (off) heard = true;
    last = r;
    if (on && !heard) {
      hold();
      if (videoUp()) noteHide(); else noteShow(r);   // the video veil's card says it under a video
    } else { release(); noteHide(); }
    return true;
  }
  PV.__soundAdTick = tick;   // tests

  function start() {
    if (!PV.soundAdSigns(location.hostname, document)) return;
    var pend = 0, soon = function () { if (pend) return; pend = setTimeout(function () { pend = 0; tick(); }, 40); };
    try { new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); } catch (e) {}
    setInterval(tick, 250);
    addEventListener("pagehide", function () { release(); });
    tick();
  }
  try { if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage && !PV.__noSoundAdStart) start(); } catch (e) {}
})();
