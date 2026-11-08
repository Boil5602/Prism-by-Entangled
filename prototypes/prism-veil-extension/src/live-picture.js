/*
  Prism - the live TV picture, read for the break watch (opt-in pv:ui.livePicture, off by default; 2026-11-06). ISOLATED world, top frame.
  Read on the sites in the person's list of live TV sites (pv:ui.liveTvSites; tv.youtube.com to start with, the only one tried so far).
  The frame the break model scores: once a second the channel's picture as 320x180 grey, the same frame Prism for Windows hands its model
  (SurfaceManager.CaptureForWatchAsync): the middle 16:9 of the video's area, scaled with linear filtering, grey = (B*29 + G*150 + R*77) >> 8.
  It comes from the tab's own live stream (chrome.tabCapture), never from snapshots (2026-11-06 decision): the page cannot read the
  protected <video> itself, and a snapshot a second costs ~15% of a core. The stream is held by Veil's offscreen page (offscreen.js), so the
  browser's sharing notice names the extension, not the site; this page tells it where the video is and gets the frame back. Nothing
  leaves the browser. Where the stream is unavailable (Firefox) this file is never registered and the option is shown disabled.
  The stream is what is on screen, Veil's own cover included (Element Capture, which could leave it out, gives no frames for a protected
  video or any box around one: Edge, 2026-11-06), so a frame taken under a Veil cover is marked covered: true.
  Listeners: PrismBreak.picture.onFrame(fn) -> fn({ t, gray, covered, restricted: false }). State on <html data-prism-live-picture>.
  Pure ASCII.
*/
(function (root) {
  "use strict";
  var ns = root.PrismBreak || (root.PrismBreak = {});
  var W = 320, H = 180;

  // The middle w:h of a sw x sh picture, as a source rect (VideoArea in SurfaceManager.cs: wider keeps the middle columns, taller the
  // middle rows; within 1% of the shape the whole picture).
  function videoArea(sw, sh, w, h) {
    w = w || W; h = h || H;
    if (!(sw > 0 && sh > 0)) return { x: 0, y: 0, w: sw || 0, h: sh || 0 };
    var r = sw / sh, want = w / h;
    if (Math.abs(r - want) < 0.01) return { x: 0, y: 0, w: sw, h: sh };
    if (r > want) { var cw = sh * want; return { x: (sw - cw) / 2, y: 0, w: cw, h: sh }; }
    var ch = sw / want; return { x: 0, y: (sh - ch) / 2, w: sw, h: ch };
  }
  // RGBA (a canvas's ImageData) to the host's grey: its BGRA weights, B*29 + G*150 + R*77, shifted by 8.
  function grey(rgba, out) {
    var n = rgba.length >> 2; out = out || new Uint8Array(n);
    for (var i = 0, j = 0; j < n; i += 4, j++) out[j] = (rgba[i + 2] * 29 + rgba[i + 1] * 150 + rgba[i] * 77) >> 8;
    return out;
  }
  // Where the tab's viewport lands in a stream frame: scaled to fit, centred (a stream may letterbox the tab to its own shape).
  function viewportInFrame(fw, fh, vw, vh) {
    var s = Math.min(fw / vw, fh / vh);
    return { s: s, ox: (fw - vw * s) / 2, oy: (fh - vh * s) / 2 };
  }
  var picture = ns.picture = ns.picture || {};
  // The person's list of live TV sites: a host on it, or under one (www.example.com is under example.com).
  var DEFAULT_SITES = ["tv.youtube.com"];
  function sitesOf(ui) { var l = ui && ui.liveTvSites; return Array.isArray(l) ? l : DEFAULT_SITES; }
  function onList(host, sites) {
    host = String(host || "").toLowerCase();
    return sites.some(function (h) { return host === h || host.slice(-(h.length + 1)) === "." + h; });
  }
  picture.W = W; picture.H = H; picture.videoArea = videoArea; picture.grey = grey; picture.viewportInFrame = viewportInFrame;
  picture.sitesOf = sitesOf; picture.onList = onList;

  // One frame from a stream of the tab: the video's place in the tab (rect, in the page's CSS pixels, of a vw x vh viewport), its middle
  // 16:9, scaled to W x H with linear filtering, as grey. g is a W x H canvas's 2d context. Used by Veil's offscreen page (offscreen.js).
  function cut(sv, rect, vw, vh, g) { return cutTo(sv, rect, vw, vh, g, W, H); }
  function cutTo(sv, rect, vw, vh, g, W, H) {
    var fw = sv.videoWidth || sv.width, fh = sv.videoHeight || sv.height;
    if (!fw || !fh || !(vw > 0 && vh > 0)) return null;
    var m = viewportInFrame(fw, fh, vw, vh);
    var x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
    var src = { x: m.ox + x0 * m.s, y: m.oy + y0 * m.s, w: Math.min(rect.w, vw - x0) * m.s, h: Math.min(rect.h, vh - y0) * m.s };
    if (!(src.w > 8 && src.h > 8)) return null;
    var a = videoArea(src.w, src.h, W, H);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "low";   // bilinear, as the host's BitmapInterpolationMode.Linear
    g.drawImage(sv, src.x + a.x, src.y + a.y, a.w, a.h, 0, 0, W, H);
    return grey(g.getImageData(0, 0, W, H).data);
  }
  picture.cut = cut; picture.cutTo = cutTo;
  // a frame between Veil's pages: grey bytes as base64 and back
  picture.toB64 = function (u8) { var s = ""; for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
  picture.fromB64 = function (b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id || typeof document === "undefined") return;   // tests
  if (!/^https?:$/.test(location.protocol)) return;   // Veil's own offscreen page loads this file for the helpers above
  if (window !== window.top) return;
  if (picture.__running) return;   // injected again into an open tab
  picture.__running = true;

  // The page's side (2026-11-06): the tab's stream is held by Veil's offscreen page, not this page, so the browser's sharing notice
  // names the extension, not the site. Once a second this page says where its video is; the offscreen page answers with the frame.
  var listeners = [];
  picture.onFrame = function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; };
  var state = "off", frames = 0, timer = 0, ccTimer = 0, asking = false;
  function note(s) {
    if (s) state = s;
    if (devMode) { try { document.documentElement.setAttribute("data-prism-live-picture", state + "|" + frames + "|" + (share ? "video|shared" : "tab|offscreen") + "|" + (spotted.p || 0).toFixed(2) + "|" + (spotted.up ? "up" : "down") + "|" + (spotted.noise == null ? "" : spotted.noise)); } catch (e) {} }
  }
  picture.state = function () { return { state: state, frames: frames }; };

  function mainVideo() {
    var vs = [].slice.call(document.querySelectorAll("video")).filter(function (v) { return v.videoWidth > 0 && v.readyState >= 2; });
    vs.sort(function (a, b) { return b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight; });
    return vs[0] || null;
  }
  // a Veil cover over the video: an element of its own with an area that meets the video's (the page keeps empty 0x0 ones too). The tab's
  // stream shows what is on screen, so a frame under a cover is the cover, not the picture.
  function veilCoverUp(v) {
    var r = v.getBoundingClientRect(), els = document.querySelectorAll("[data-prism-veil]");
    for (var i = 0; i < els.length; i++) {
      var c = els[i].getBoundingClientRect();
      if (c.width > 1 && c.height > 1 && c.right > r.left && c.left < r.right && c.bottom > r.top && c.top < r.bottom) return true;
    }
    return false;
  }

  // The captions, when the person has them on (Veil never switches them on): the words new since the last look, as Prism's YouTube TV
  // adapter reads them (the caption window's text, less what it already showed)
  var ccLast = "", ccBuf = [], ccAt = 0;
  function ccRead() {
    try {
      var c = document.querySelector(".ytp-caption-window-container");
      var tx = c ? (c.textContent || "").replace(/\s+/g, " ").trim() : "";
      if (!tx || tx === ccLast) return;
      var add = tx;
      if (ccLast && tx.indexOf(ccLast) === 0) add = tx.slice(ccLast.length);
      else { for (var n = Math.min(ccLast.length, tx.length); n > 0; n--) { if (tx.indexOf(ccLast.slice(ccLast.length - n)) === 0) { add = tx.slice(n); break; } } }
      ccLast = tx; ccAt = Date.now();
      if (add.trim()) { ccBuf.push(add.trim()); if (ccBuf.length > 40) ccBuf.shift(); }
    } catch (e) {}
  }
  // the channel: the network logo the watch page shows (its name, as the Prism app's break watch names a channel; read 2026-11-06:
  // ytu-icon-button.ypc-network-logo, Food Network), else the watch address; its learned logo is kept per channel
  function channelKey() {
    try {
      var e = document.querySelector(".ypc-network-logo");
      var n = e ? ((e.textContent || e.getAttribute("aria-label") || "").replace(/[\s]+/g, " ").trim()) : "";
      if (n) return "name:" + n.slice(0, 60);
    } catch (x) {}
    var m = /^[\/]watch[\/]([A-Za-z0-9_-]+)/.exec(location.pathname); return m ? m[1] : location.pathname;
  }
  // what else the page says, as the Prism app's break watch is told it: the network's name, the programme on now (the watch page's
  // title), and YouTube TV's own marks (src/ytv-cues.js announces each one, read and as it plays)
  function channelName() { try { var e = document.querySelector(".ypc-network-logo"); return e ? (e.textContent || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60) : ""; } catch (x) { return ""; } }
  function showTitle() { try { var e = document.querySelector("h1.ypc-video-title, .ypc-video-title-text"); return e ? (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : ""; } catch (x) { return ""; } }
  // the programme's edges, as the app reads them from the guide: YouTube TV's scrub bar gives the position in the programme and its
  // length (the slider that is not a volume's), so its start and end are known to the second (2026-11-06)
  function programmeEdges() {
    try {
      var sl = [].slice.call(document.querySelectorAll("[role=slider]")).filter(function (e) { return +e.getAttribute("aria-valuemax") > 100; })[0];
      if (!sl) return null;
      var into = +sl.getAttribute("aria-valuenow"), len = +sl.getAttribute("aria-valuemax");
      if (!(len > 0) || !(into >= 0) || into > len + 60) return null;
      var start = Date.now() - into * 1000;
      return { start: Math.round(start), end: Math.round(start + len * 1000) };
    } catch (e) { return null; }
  }
  var cues = [];
  document.addEventListener("prism-ytv-cue", function (e) { try { var q = JSON.parse(e.detail); if (q && q.ev) { cues.push(q); if (cues.length > 40) cues.shift(); } } catch (x) {} });
  function takeCues() { var q = cues; cues = []; return q; }

  // Captions as the Prism app keeps them (2026-11-06): on YouTube TV, while the picture is read, the captions are switched on if the
  // person has them off, and kept hidden; the person's own press of the CC button shows them (they asked for captions); reading stops
  // and they are switched back off and shown as before. The words feed the break watch either way.
  var CC_BTN = ".ypc-captions-button", ccOurs = false, ccStyle = null;
  function ccHide(on) {
    if (on && !ccStyle) { ccStyle = document.createElement("style"); ccStyle.setAttribute("data-prism-ui", "1"); ccStyle.textContent = "html.prism-cc-hidden .ytp-caption-window-container{visibility:hidden !important}"; (document.head || document.documentElement).appendChild(ccStyle); }
    document.documentElement.classList.toggle("prism-cc-hidden", !!on);
  }
  // YouTube TV remembers CC across reloads, so captions Prism turned on come back on with the next page (2026-11-06: after a reload they
  // were taken for the person's and shown). Prism keeps a mark that the captions are its own until it turns them off or the person
  // presses CC.
  var CC_MARK = "pv:cc-ours", ccMarked = null;
  try { chrome.storage.local.get(CC_MARK, function (r) { ccMarked = !!(r && r[CC_MARK] && Date.now() - r[CC_MARK] < 7 * 86400000); }); } catch (e) { ccMarked = false; }
  function ccMark(on) { try { if (on) { var o = {}; o[CC_MARK] = Date.now(); chrome.storage.local.set(o); } else chrome.storage.local.remove(CC_MARK); } catch (e) {} ccMarked = !!on; }
  function ccOn() {
    if (!/(^|\.)tv\.youtube\.com$/i.test(location.hostname)) return;
    var b = document.querySelector(CC_BTN);
    if (!b || ccMarked === null) return;   // not there yet, or the mark not read yet
    var pressed = b.getAttribute("aria-pressed");
    if (pressed === "true") { if (ccMarked && !ccOurs) { ccOurs = true; ccHide(true); } return; }   // on: Prism's from before, or the person's
    if (pressed !== "false") return;
    ccOurs = true; ccHide(true); ccMark(true);
    try { b.click(); } catch (e) {}
  }
  function ccOff() {
    if (!ccOurs) return;
    ccOurs = false; ccMark(false);
    var b = document.querySelector(CC_BTN);
    if (b && b.getAttribute("aria-pressed") === "true") { try { b.click(); } catch (e) {} }
    setTimeout(function () { ccHide(false); }, 300);
  }
  document.addEventListener("click", function (e) {
    if (!ccOurs || !e.isTrusted || !e.target || !e.target.closest || !e.target.closest(CC_BTN)) return;
    // the person pressed CC while we kept the captions on and hidden: they want captions, so they stay on and show
    ccOurs = false; ccHide(false); ccMark(false);
    setTimeout(function () { var b = document.querySelector(CC_BTN); if (b && b.getAttribute("aria-pressed") === "false") { try { b.click(); } catch (x) {} } }, 200);
  }, true);

  var PV = root.__prismVeilNS || (root.__prismVeilNS = {});
  var spotted = { up: false, p: 0, at: 0, noise: null, why: "" };
  // the state attributes on <html> (data-prism-live-picture, data-prism-live-text) are development diagnostics: written for an unpacked
  // install alone (bg.js keeps pv:dev), never on a store install, where a page would read what the extension reads
  var devMode = false;
  try { chrome.storage.local.get("pv:dev", function (r) { devMode = !!(r && r["pv:dev"]); }); } catch (eD) {}
  // a spotted break, as video.js reads it: the break watch's last word, while it is fresh
  PV.spottedNow = function () { return spotted.up && Date.now() - spotted.at < 3500; };
  // for the veil log (2026-11-07): the break watch's chance and the rule that called the break, and the channel's name
  PV.spottedInfo = function () { return { p: spotted.p, why: spotted.why || "" }; };
  PV.liveChannelName = channelName;
  PV.spottedDismiss = function () {
    spotted.up = false;
    try { chrome.runtime.sendMessage({ type: "pv:live-notabreak", chan: channelKey() }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  };

  function look() {
    if (asking || state !== "on") return;
    var v = mainVideo();
    if (!v || v.paused) return;
    var r = v.getBoundingClientRect(), covered = veilCoverUp(v);
    var art = covered && PV.spottedCoverInfo ? PV.spottedCoverInfo() : null;
    var behind = false; try { behind = !!(PV.ytvBehindLive && PV.ytvBehindLive(v)); } catch (e) {}
    var cc = ccBuf.join(" "); ccBuf = [];
    asking = true;
    try {
      chrome.runtime.sendMessage({ type: "pv:live-look", rect: { x: r.left, y: r.top, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight,
        chan: channelKey(), name: channelName(), title: showTitle(), edges: programmeEdges(), mode: channelMode(), cues: takeCues(), live: !behind, covered: covered, art: art, cc: cc, ccQuietMs: ccAt ? Date.now() - ccAt : -1 }, function (res) {
        asking = false;
        var err = chrome.runtime.lastError;
        if (err || !res) return;
        if (res.error) { if (/no stream/.test(res.error)) stop("ended"); return; }
        if (typeof res.noise === "number") spotted.noise = res.noise;
        if (typeof res.up === "boolean") { var was = spotted.up; spotted.up = res.up; spotted.p = res.p || 0; spotted.why = res.why || ""; spotted.at = Date.now(); if (was !== res.up) note(); }
        if (!res.b64) return;
        frames++; if (frames % 10 === 1) note();
        var f = { t: Date.now(), gray: picture.fromB64(res.b64), covered: covered, restricted: false, p: res.p, up: res.up };
        listeners.slice().forEach(function (fn) { try { fn(f); } catch (e) {} });
      });
    } catch (e) { asking = false; note("error: " + (e && e.message)); }
  }

  // The share route (2026-11-06, Edge): the tab shared through the browser's own dialog and restricted to the player's box (Element
  // Capture), so what is drawn over the box - the extension's veil above all - is left out and the break watch reads the real picture
  // under an opaque veil. It needs the box made a stacking context of its own (isolation: isolate, the one style that sufficed on
  // div.ypl-video; nothing else of the page is changed, and it is put back when reading stops), a click on the page (the browser asks
  // only after one) and the person's Allow, once a visit. Sites without a known box use the tab-stream route below.
  // The sound, measured as the Prism app's YouTube TV meter measures it (2026-11-06): the video's sound runs through Web Audio (it still
  // plays as before), and every 50 ms its level is read: the mean dB of a look, its peak, and silences under -60 dB of 250 ms or more
  // (the model's cuts). Started on the button's click (a page may start audio only after one); the context is never closed while the
  // page lives, since the video's sound now runs through it. The share route only.
  var au = { ctx: null, src: new WeakMap(), an: null, buf: null, cur: null, sumDb: 0, nDb: 0, peak: -120, quietFrom: 0, sil: [], started: 0, iv: 0,
    fan: null, fbuf: null, prevE: null, bands: null, fps: [] };
  // The sound's fingerprint, as the app's YouTube TV meter makes it (2026-11-06): a 16384-point spectrum every 50 ms, 33 bands spaced
  // evenly in pitch from 300 to 2000 Hz, and one 32-bit word saying for each pair of neighbouring bands whether their difference rose
  // since the last; twenty words a second, matched against the ads heard before (AdSounds)
  function fpBands() {
    if (au.bands) return au.bands;
    var r = au.ctx.sampleRate, n = au.fan.frequencyBinCount, hz = r / 2 / n, b = [];
    for (var i = 0; i <= 33; i++) { var f = 300 * Math.pow(2000 / 300, i / 33); b.push(Math.max(1, Math.round(f / hz))); }
    return (au.bands = b);
  }
  function fpTick() {
    if (!au.fan) return;
    if (!au.fbuf) au.fbuf = new Float32Array(au.fan.frequencyBinCount);
    au.fan.getFloatFrequencyData(au.fbuf);
    var b = fpBands(), E = [];
    for (var i = 0; i < 33; i++) { var s = 0, k = 0; for (var j = b[i]; j < Math.max(b[i] + 1, b[i + 1]); j++) { s += Math.pow(10, au.fbuf[j] / 10); k++; } E.push(s / k); }
    if (au.prevE) {
      var w = 0;
      for (var m = 0; m < 32; m++) if ((E[m] - E[m + 1]) - (au.prevE[m] - au.prevE[m + 1]) > 0) w |= (1 << m);
      au.fps.push(w >>> 0); if (au.fps.length > 400) au.fps.shift();
    }
    au.prevE = E;
  }
  function soundStart() {
    try { if (!au.ctx) au.ctx = new AudioContext({ sampleRate: 48000 }); if (au.ctx.state !== "running") au.ctx.resume(); } catch (e) {}
    if (!au.iv) au.iv = setInterval(soundTick, 50);
  }
  function soundAttach() {
    var v = mainVideo();
    if (!v || v === au.cur || !au.ctx || au.ctx.state !== "running") return;
    try {
      var src = au.src.get(v);
      if (!src) { src = au.ctx.createMediaElementSource(v); src.connect(au.ctx.destination); au.src.set(v, src); }
      if (!au.an) { au.an = au.ctx.createAnalyser(); au.an.fftSize = 2048; au.buf = new Float32Array(au.an.fftSize); }
      if (!au.fan) { au.fan = au.ctx.createAnalyser(); au.fan.fftSize = 16384; au.fan.smoothingTimeConstant = 0; au.bands = null; }
      if (au.cur && au.src.get(au.cur)) { try { au.src.get(au.cur).disconnect(au.an); } catch (e) {} try { au.src.get(au.cur).disconnect(au.fan); } catch (e) {} }
      src.connect(au.an); src.connect(au.fan); au.cur = v; au.started = Date.now(); au.prevE = null;
    } catch (e) { au.err = String(e); }
  }
  function soundTick() {
    soundAttach();
    if (!au.an || !au.cur || au.cur.paused) { au.prevE = null; return; }
    try { fpTick(); } catch (e) {}
    au.an.getFloatTimeDomainData(au.buf);
    var s2 = 0; for (var i = 0; i < au.buf.length; i++) s2 += au.buf[i] * au.buf[i];
    var db = 10 * Math.log(s2 / au.buf.length + 1e-12) / Math.LN10, now = Date.now();
    au.sumDb += db; au.nDb++; if (db > au.peak) au.peak = db;
    if (db < -60) { if (!au.quietFrom) au.quietFrom = now; }
    else { if (au.quietFrom && now - au.quietFrom >= 250 && now - au.started > 3000) au.sil.push({ at: au.quietFrom, ms: now - au.quietFrom }); au.quietFrom = 0; if (au.sil.length > 20) au.sil.shift(); }
  }
  function soundTake() {
    if (!au.nDb) return null;
    var now = Date.now(), r = { db: Math.round(au.sumDb / au.nDb), peak: Math.round(au.peak), silences: au.sil.map(function (x) { return { ago: now - x.at, ms: x.ms }; }), afp: au.fps };
    au.sumDb = 0; au.nDb = 0; au.peak = -120; au.sil = []; au.fps = [];
    return r;
  }
  function soundStop() {
    if (au.iv) clearInterval(au.iv); au.iv = 0;
    if (au.cur && au.an && au.src.get(au.cur)) { try { au.src.get(au.cur).disconnect(au.an); } catch (e) {} try { if (au.fan) au.src.get(au.cur).disconnect(au.fan); } catch (e) {} }
    au.cur = null; au.sumDb = 0; au.nDb = 0; au.sil = []; au.fps = []; au.prevE = null;
  }

  var BOXES = { "tv.youtube.com": "div.ypl-video" };
  function boxSelector() { var h = location.hostname.toLowerCase(); for (var k in BOXES) if (h === k || h.slice(-(k.length + 1)) === "." + k) return BOXES[k]; return null; }
  function shareAble() { return !!(boxSelector() && typeof RestrictionTarget !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); }
  var share = null, chip = null, shareCanvas = null, shareG = null, bigCanvas = null, bigG = null, qrTick = 0, qrNow = false, screenNow = null;
  // the app's QR finder (BreakModel.Qr) on a 960x540 picture of the video, every other look, as the app reads it with its text reader
  function qrLook(sv, rect, vw, vh) {
    var BM = root.PrismBreak && root.PrismBreak.BreakModel;
    if (!BM || !BM.prototype.Qr || (qrTick++ % 2)) return;
    if (!bigCanvas) { bigCanvas = document.createElement("canvas"); bigCanvas.width = 960; bigCanvas.height = 540; bigG = bigCanvas.getContext("2d", { willReadFrequently: true }); }
    try {
      var big = cutTo(sv, rect, vw, vh, bigG, 960, 540);
      if (big && BM.prototype.Qr.call({}, big, 960, 540, 0)) qrNow = true;
      if (big) screenNow = bigCanvas.toDataURL("image/jpeg", 0.85);   // for the text reader in the offscreen page
    } catch (e) {}
  }
  function showChip(on) {
    if (!on) { if (chip) chip.style.display = "none"; return; }
    if (!chip) {
      chip = document.createElement("button");
      chip.setAttribute("data-prism-ui", "1"); chip.type = "button";
      chip.textContent = "Prism: read the picture";
      chip.title = "Prism reads this channel's picture to spot commercial breaks. The browser asks to share this tab; nothing leaves the browser.";
      chip.style.cssText = "position:fixed;z-index:2147483600;top:76px;right:20px;padding:8px 14px;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#0A0C0F;background:#F0A83C;border:0;border-radius:9px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)";
      chip.addEventListener("click", function (ev) { ev.stopPropagation(); shareStart(); }, true);
      document.documentElement.appendChild(chip);
    }
    if (!chip.isConnected) document.documentElement.appendChild(chip);   // the page may drop what is added to it
    chip.style.display = "block";
  }
  function restrictBox() {
    var box = document.querySelector(boxSelector() || "#none");
    if (!share || !box || share.box === box) return box;
    if (share.box) { try { share.box.style.isolation = share.was; } catch (e) {} }
    share.box = box; share.was = box.style.isolation; box.style.isolation = "isolate";
    RestrictionTarget.fromElement(box).then(function (t) { return share.track.restrictTo(t); })
      .catch(function (e) { stop("error: restrict " + (e && e.name)); });
    return box;
  }
  function shareStart() {
    if (share) return;
    soundStart();   // inside the click, while the page may still start audio
    note("asking");
    navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2, width: { max: 1280 }, height: { max: 720 } }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" })
      .then(function (s) {
        if (!wanted) { s.getTracks().forEach(function (t) { t.stop(); }); note("off"); return; }
        var sv = document.createElement("video"); sv.muted = true; sv.srcObject = s;   // never put on the page
        share = { stream: s, track: s.getVideoTracks()[0], sv: sv, box: null, was: "" };
        share.track.addEventListener("ended", function () { stop("ended"); });   // the person stopped sharing from the browser's bar
        restrictBox();
        return sv.play().then(function () {
          showChip(false);
          chrome.runtime.sendMessage({ type: "pv:live-model" }, function () { void chrome.runtime.lastError; });
          chrome.runtime.sendMessage({ type: "pv:live-reading", on: true }, function () { void chrome.runtime.lastError; });
          note("on");
          if (!timer) timer = setInterval(function () { lookShare(); if (!ccOurs) ccOn(); }, 1000);
          if (!ccTimer) ccTimer = setInterval(ccRead, 500);
          ccOn();
        });
      })
      .catch(function (e) {
        // the browser's own reason, on the page for the panel and for checks (2026-11-06: a press that showed no Allow said nothing)
        try { document.documentElement.setAttribute("data-prism-share-error", ((e && e.name) || "Error") + ": " + String((e && e.message) || "").slice(0, 160) + " @" + new Date().toTimeString().slice(0, 8)); } catch (x) {}
        share = null; note("needs-click"); showChip(wanted);
      });
  }
  function lookShare() {
    if (asking || state !== "on" || !share) return;
    var v = mainVideo(), box = restrictBox();
    if (!v || v.paused || !box || !share.sv.videoWidth) return;
    var br = box.getBoundingClientRect(), vr = v.getBoundingClientRect();
    if (!shareCanvas) { shareCanvas = document.createElement("canvas"); shareCanvas.width = W; shareCanvas.height = H; shareG = shareCanvas.getContext("2d", { willReadFrequently: true }); }
    var gray = null;
    try { gray = picture.cut(share.sv, { x: vr.left - br.left, y: vr.top - br.top, w: vr.width, h: vr.height }, br.width, br.height, shareG); } catch (e) {}
    if (!gray) return;
    qrLook(share.sv, { x: vr.left - br.left, y: vr.top - br.top, w: vr.width, h: vr.height }, br.width, br.height);
    var qr = qrNow, screen = screenNow; qrNow = false; screenNow = null;
    // the veil is left out of the picture unless it was drawn inside the box (full screen can put it there)
    var inside = [].some.call(document.querySelectorAll("[data-prism-veil]"), function (e) { var r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && box.contains(e); });
    var art = inside && PV.spottedCoverInfo ? PV.spottedCoverInfo() : null;
    var behind = false; try { behind = !!(PV.ytvBehindLive && PV.ytvBehindLive(v)); } catch (e) {}
    var cc = ccBuf.join(" "); ccBuf = [];
    asking = true;
    try {
      chrome.runtime.sendMessage({ type: "pv:live-gray", b64: picture.toB64(gray), chan: channelKey(), name: channelName(), title: showTitle(), edges: programmeEdges(), mode: channelMode(), cues: takeCues(), sound: soundTake(), qr: qr, screen: screen, ccNow: screen ? ccLast : "", live: !behind, covered: inside, art: art, cc: cc,
        ccQuietMs: ccAt ? Date.now() - ccAt : -1 }, function (res) {
        asking = false;
        var err = chrome.runtime.lastError;
        if (err || !res || res.error) return;
        if (typeof res.noise === "number") spotted.noise = res.noise;
        if (devMode && typeof res.ocr === "string") { try { document.documentElement.setAttribute("data-prism-live-text", (res.diag ? res.diag + " | " : "") + res.ocr); } catch (e) {} }
        if (typeof res.up === "boolean") { var was = spotted.up; spotted.up = res.up; spotted.p = res.p || 0; spotted.why = res.why || ""; spotted.at = Date.now(); if (was !== res.up) note(); }
        frames++; if (frames % 10 === 1) note();
        var f = { t: Date.now(), gray: gray, covered: inside, restricted: true, p: res.p, up: res.up };
        listeners.slice().forEach(function (fn) { try { fn(f); } catch (e) {} });
      });
    } catch (e) { asking = false; }
  }

  function start() {
    if (state === "on" || state === "starting" || state === "asking") return;
    if (shareAble()) { note("needs-click"); showChip(true); return; }
    note("starting");
    try {
      chrome.runtime.sendMessage({ type: "pv:live-stream" }, function (res) {
        var err = chrome.runtime.lastError;
        if (err || !res || !res.ok) {
          var why = err ? err.message : (res && res.error) || "no stream";
          // Chromium hands a tab's stream only after the extension was invoked on that tab (its toolbar button); the panel asks again
          note(/invoked|activeTab|permission/i.test(why) ? "needs-panel" : "unavailable: " + why);
          return;
        }
        if (!wanted) { try { chrome.runtime.sendMessage({ type: "pv:live-close" }); } catch (e) {} note("off"); return; }
        note("on");
        if (!timer) timer = setInterval(function () { look(); if (!ccOurs) ccOn(); }, 1000);
        if (!ccTimer) ccTimer = setInterval(ccRead, 500);
        ccOn();
      });
    } catch (e) { note("error: " + (e && e.message)); }
  }
  function stop(why) {
    if (timer) clearInterval(timer); timer = 0;
    if (ccTimer) clearInterval(ccTimer); ccTimer = 0;
    ccOff();
    spotted.up = false;
    if (share) {
      soundStop();
      try { share.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      if (share.box) { try { share.box.style.isolation = share.was; } catch (e) {} }
      share = null;
      try { chrome.runtime.sendMessage({ type: "pv:live-reading", on: false }, function () { void chrome.runtime.lastError; }); } catch (e) {}
    }
    if (state === "on" || state === "starting") { try { chrome.runtime.sendMessage({ type: "pv:live-close" }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
    note(why || "off");
    // stopped by the person or the page while the option is on: offer the button again (the browser asks again)
    showChip(wanted && shareAble() && why !== "off");
    if (wanted && shareAble() && why !== "off") note("needs-click");
  }
  picture.start = start; picture.stop = stop;

  // the switch, live: off stops the stream at once (bg.js also unregisters this file); the panel's "start" retries after an invocation
  var wanted = false;
  // the person's choice for this channel (2026-11-06, as the Prism app's ChannelCovers): all breaks, sure breaks only, or none
  var lastUi = {};
  function channelMode() { var n = channelName(), c = (lastUi && lastUi.liveChannels) || {}; return n && (c[n] === "sure" || c[n] === "off") ? c[n] : "all"; }
  function apply(ui) { lastUi = ui || {}; wanted = !!(ui && ui.livePicture) && onList(location.hostname, sitesOf(ui)); if (wanted) start(); else { showChip(false); if (state !== "off") stop("off"); } }
  chrome.storage.local.get("pv:ui", function (r) { apply(r && r["pv:ui"]); });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && ch["pv:ui"]) apply(ch["pv:ui"].newValue); });
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (msg && msg.type === "pv:live-picture-start") { if (wanted && state !== "on") { state = "off"; start(); } var st = picture.state(); st.channel = channelName(); st.mode = channelMode(); reply(st); }
  });
  note("off");
})(typeof globalThis !== "undefined" ? globalThis : this);
