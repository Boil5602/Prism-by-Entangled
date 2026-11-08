/*
  Prism - YouTube TV's own ad slots (pv:ui.ytvVeil, on by default since 2026-11-07; built 2026-11-06). PAGE world.

  YouTube TV marks the ad slots it inserts into a live channel in the stream data its page hands the player: "Cuepoint-Event:" with
  the slot's total length and the playhead in it (EVENT_PREDICT_START / EVENT_START / EVENT_CONTINUE / EVENT_STOP). Prism for Windows
  reads the same marks (its YouTube TV adapter, verified 2026-10-07/08); this is that reader for the extension. The network's own
  commercials carry no such mark and are not seen here.

  The data is appended 14 to 31 s ahead of the picture, so a mark is held until the playhead reaches the point it was buffered at,
  then the slot is on for its announced remaining length (+2 s), the same rule as Prism's break model (CueSeen). While a slot is on,
  <html data-prism-ad="active"> and data-prism-adrem (seconds left) are set - the flag the video veil already follows for an SDK ad.

  Runs only while the switch is on: bg.js registers this file then, and the isolated world mirrors the switch onto
  <html data-prism-ytv="on|off">, so turning it off stops it at once in a page that is already open. Observe-only: the page's data
  is read on its way to the player and passed on unchanged. Nothing is sent anywhere.
*/
(function () {
  "use strict";
  if (window.__prismYtvCues) return;
  window.__prismYtvCues = 1;
  if (!/(^|\.)tv\.youtube\.com$/i.test(location.hostname) || window !== window.top) return;
  if (typeof SourceBuffer === "undefined" || !SourceBuffer.prototype.appendBuffer) return;

  var K = "Cuepoint-Event: ", kc = [];
  for (var i = 0; i < K.length; i++) kc.push(K.charCodeAt(i));
  var MAX_SLOT_S = 300, HOLD_MAX_MS = 150000;
  var held = [], last = "", until = 0, owned = false, nAppend = 0, nMark = 0, lastMark = "-";
  function note() { try { root.setAttribute("data-prism-ytv-seen", nAppend + "|" + nMark + "|" + lastMark); } catch (e) {} }
  var root = document.documentElement;

  function gateOn() { return root.getAttribute("data-prism-ytv") === "on"; }
  function field(s, name) {
    var a = s.indexOf(name); if (a < 0) return "";
    a += name.length; var e = a;
    while (e < s.length && s.charCodeAt(e) >= 32) e++;
    return s.slice(a, e);
  }
  function mainV() {
    var b = null, vs = document.querySelectorAll("video");
    for (var z = 0; z < vs.length; z++) if (vs[z].readyState > 1 && (!b || vs[z].offsetWidth > b.offsetWidth)) b = vs[z];
    return b;
  }
  // each mark told to the extension's live TV picture (src/live-picture.js), as the Prism app's model takes them: read from the buffer
  // (CueRead) and as the playhead reaches it (CueSeen)
  function tell(m, read, plays) { try { document.dispatchEvent(new CustomEvent("prism-ytv-cue", { detail: JSON.stringify({ ev: m.ev, dur: m.dur, pos: m.pos, read: read, plays: plays }) })); } catch (e) {} }
  // the mark as the playhead reaches it (Prism: BreakModel.CueSeen)
  function seen(m) {
    var now = Date.now();
    if (m.ev === "EVENT_START" || m.ev === "EVENT_CONTINUE") until = now + Math.min(MAX_SLOT_S, Math.max(4, m.dur - m.pos) + 2) * 1000;
    // a STOP marks the piece of the stream the slot ends in, not the end: the slot runs out its announced length (a piece is ~5 s)
    else if (m.ev === "EVENT_STOP") until = now + Math.min(8, Math.max(0, m.dur - m.pos)) * 1000;
  }

  var orig = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (d) {
    try {
      if (gateOn()) {
        nAppend++; if (nAppend % 50 === 1) note();
        var u = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
        for (var i = 0; i + kc.length <= u.length; i++) {
          if (u[i] !== 67) continue;
          var k = 1; while (k < kc.length && u[i + k] === kc[k]) k++;
          if (k < kc.length) continue;
          var a = Math.max(0, i - 60), b = Math.min(u.length, i + 260), s = "";
          for (var q = a; q < b; q++) s += String.fromCharCode(u[q]);
          var ev = field(s, "Cuepoint-Event: ");
          var dur = parseFloat(field(s, "Cuepoint-Total-Duration-Sec: ")) || 0, pos = parseFloat(field(s, "Cuepoint-Playhead-Time-Sec: ")) || 0;
          var key = ev + "|" + Math.round(pos);
          if (key !== last) {
            last = key;
            nMark++; lastMark = ev + " " + Math.round(dur) + "s@" + Math.round(pos) + " " + new Date().toLocaleTimeString(); note();
            var m = { ev: ev, dur: dur, pos: pos }, mt = null;
            try {
              var bn = this.buffered.length, mv = mainV();
              if (bn && mv) { mt = this.buffered.end(bn - 1); var ld = mt - mv.currentTime; if (!(ld >= 0.5 && ld <= 120)) mt = null; }
            } catch (e) { mt = null; }
            if (mt === null) { seen(m); tell(m, true, true); } else { held.push({ mt: mt, m: m, at: Date.now() }); if (held.length > 600) held.shift(); tell(m, true, false); }
          }
          i += kc.length;
        }
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };

  // a channel change empties the player: what was held or on belongs to the old stream
  document.addEventListener("emptied", function (e) { if (e.target && e.target.tagName === "VIDEO") { held = []; until = 0; last = ""; } }, true);

  setInterval(function () {
    var now = Date.now();
    if (held.length) {
      var v = mainV(), ct = v ? v.currentTime : -1, keep = [];
      for (var z = 0; z < held.length; z++) {
        var h = held[z];
        if (now - h.at > HOLD_MAX_MS) continue;
        if (ct >= 0 && h.mt <= ct) { seen(h.m); tell(h.m, false, true); } else keep.push(h);
      }
      held = keep;
    }
    var on = gateOn() && now < until;
    if (on) {
      if (root.getAttribute("data-prism-ad") !== "active") root.setAttribute("data-prism-ad", "active");
      root.setAttribute("data-prism-adrem", String(Math.max(0, Math.round((until - now) / 1000))));
      owned = true;
    } else if (owned) {
      owned = false;
      root.setAttribute("data-prism-ad", "idle");
      root.removeAttribute("data-prism-adrem");
    }
    if (!gateOn()) { held = []; until = 0; }
  }, 250);
})();
