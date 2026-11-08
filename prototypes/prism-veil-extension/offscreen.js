/*
  Prism - Veil's offscreen page (2026-11-06): holds each live TV tab's own stream, so the browser's sharing notice names the extension,
  not the site the tab is on, and runs Prism's break watch on it (the browser port in src/breakwatch). bg.js opens it and hands it a
  stream id for a tab (pv:live-open); the tab's page (src/live-picture.js) then sends once a second where its video is, its channel,
  whether it is at the live edge, any new caption words and whether a spotted veil is up (pv:live-look); the answer is the
  frame (320x180 grey, base64) and the break watch's word: its chance and whether a spotted veil is up. pv:live-notabreak is the
  person's "Not a break"; pv:live-close ends a tab. Nothing here touches the network: the model is the extension's own file.
  Requires src/breakwatch (cs.js, break-model.js, learned-break.js) and src/live-picture.js first. Pure ASCII.
*/
(function () {
  "use strict";
  var NS = globalThis.PrismBreak, P = NS && NS.picture;
  NS.BreakModel.BandLogo = true; NS.BreakModel.BandStrict = false;   // as the model was judged on the bench (BANDLOGO=1 BANDSTRICT=0)
  var tabs = {};   // tab id -> { stream, sv, chans: { key: { m, lst, lastT } } }
  var canvas = document.createElement("canvas"); canvas.width = P.W; canvas.height = P.H;
  var g = canvas.getContext("2d", { willReadFrequently: true });
  var learned = null;
  // Known ads (2026-11-06, as the Prism app keeps them): the pictures of breaks the watch is sure of are learned on this PC and a picture
  // seen again is a known ad (the model's print_seen); the library is kept in the extension's storage through bg.js and never leaves it.
  var prints = new NS.AdPrints(null), printsSavedAt = 0;
  // ... and their sounds (AdSounds, the app's sounds.bin format), learned from a sure break's sound all but its last twenty seconds
  var sounds = new NS.AdSounds(null), soundsSavedAt = 0;
  try {
    chrome.runtime.sendMessage({ type: "pv:live-load", key: "__sounds" }, function (b64) {
      void chrome.runtime.lastError;
      if (typeof b64 === "string" && b64.length > 16) { try { sounds = new NS.AdSounds(P.fromB64(b64).buffer); } catch (e) {} }
    });
  } catch (e) {}
  function keepSounds(now) {
    if (!sounds._dirty || now - soundsSavedAt < 300) return;
    soundsSavedAt = now; sounds._dirty = false;
    try { chrome.runtime.sendMessage({ type: "pv:live-save", key: "__sounds", state: P.toB64(new Uint8Array(sounds.save())) }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  try {
    chrome.runtime.sendMessage({ type: "pv:live-load", key: "__prints" }, function (b64) {
      void chrome.runtime.lastError;
      if (typeof b64 === "string" && b64.length > 16) { try { prints = new NS.AdPrints(P.fromB64(b64).buffer); } catch (e) {} }
    });
  } catch (e) {}
  function keepPrints(now) {
    if (!prints._dirty || now - printsSavedAt < 300) return;
    printsSavedAt = now; prints._dirty = false;
    try { chrome.runtime.sendMessage({ type: "pv:live-save", key: "__prints", state: P.toB64(new Uint8Array(prints.save())) }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  // the picture network (2026-11-06, scripts/breakwatch/cnn.py): its chance is added in logit to the learned one at the model's
  // policy.picture weight; a model without that weight, or a package without picture-net.json, leaves it out
  var picNet = null, picW = 0;
  // policy.agree (2026-11-07, the pop-ups): a cover may begin only when the trees' own chance and the network's are both at least
  // policy.treeMin / policy.netMin (0.5 each); up, the blend alone holds it. As the bench's AGREE=1. Off unless the model says so.
  var agree = false, treeMin = 0.5, netMin = 0.5;
  // The model and the network: the bundled files, or the downloaded pack's when it is newer by serial (bg.js keeps pv:pack and its parts
  // in storage; docs/features/break-watch-packs.md, 2026-11-07). Read once, when this page starts: a new pack is picked up at the next
  // channel's start, never in the middle of a break.
  function packNewer(x, y) { function split(s) { s = String(s || ""); var i = s.lastIndexOf("."); return i < 0 ? [s, 0] : [s.slice(0, i), +s.slice(i + 1) || 0]; } var a = split(x), b = split(y); return a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]; }
  function loadModel(j, netText) {
    learned = NS.LearnedBreak.fromJson(j);
    var w = j && j.policy && +j.policy.picture;
    agree = !!(j && j.policy && j.policy.agree);
    if (j && j.policy && typeof j.policy.treeMin === "number") treeMin = j.policy.treeMin;
    if (j && j.policy && typeof j.policy.netMin === "number") netMin = j.policy.netMin;
    if (!(w > 0 && NS.PictureNet)) return;
    var net = netText ? Promise.resolve(JSON.parse(netText)) : fetch(chrome.runtime.getURL("src/breakwatch/picture-net.json")).then(function (r) { return r.json(); });
    net.then(function (s) { picNet = new NS.PictureNet(s); picW = w; }, function () { picNet = null; });
  }
  fetch(chrome.runtime.getURL("src/breakwatch/model.json")).then(function (r) { return r.json(); })
    .then(function (bundled) {
      chrome.storage.local.get(["pv:pack", "pv:pack:veil", "pv:pack:picnet"], function (r) {
        try {
          var meta = r && r["pv:pack"], text = r && r["pv:pack:veil"];
          if (meta && text && packNewer(meta.pack, bundled && bundled.pack)) { loadModel(JSON.parse(text), r["pv:pack:picnet"] || null); return; }
        } catch (e) {}
        loadModel(bundled, null);
      });
    }, function () { learned = null; });

  function close(id, quiet) {
    // reopening (quiet): the tab's old stream goes without telling bg.js the page is idle, which would close this page mid-open
    var t = tabs[id]; if (!t) return;
    delete tabs[id];
    if (!quiet) { try { chrome.runtime.sendMessage({ type: "pv:live-ended", tabId: id }); } catch (e) {} }   // bg.js takes the toolbar button's line down
    try { if (t.stream) t.stream.getTracks().forEach(function (x) { x.stop(); }); } catch (e) {}
    try { if (t.sv) t.sv.srcObject = null; } catch (e) {}
    if (!quiet && !Object.keys(tabs).length && !ambientEl) { try { chrome.runtime.sendMessage({ type: "pv:offscreen-idle" }); } catch (e) {} }
  }
  function open(id, streamId, reply) {
    var keep = tabs[id] && tabs[id].chans;   // a reopened tab keeps what its channels have learned
    close(id, true);
    navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId,
      maxWidth: 1280, maxHeight: 720, maxFrameRate: 2 } } })
      .then(function (s) {
        var sv = document.createElement("video"); sv.muted = true; sv.srcObject = s;
        tabs[id] = { stream: s, sv: sv, chans: keep || {} };
        s.getVideoTracks()[0].addEventListener("ended", function () { close(id); });
        return sv.play().then(function () { reply({ ok: true }); });
      })
      .catch(function (e) { close(id, true); reply({ error: String((e && e.name) || "") + " " + String((e && e.message) || "") }); });
  }

  // The stream's own noise (2026-11-06; measured for the record, as the bench models it):
  // two looks in a row compared in 8x8 blocks of the 320x180 frame; the quietest tenth of the blocks are still picture, where what
  // differs is the stream's noise; their mean difference over 1.038 is the noise of one frame in grey levels (as the bench's
  // COVERSIGHT noise). The median of the last two minutes' readings, so a scene cut does not count.
  function noiseOf(a, b) {
    var W = P.W, H = P.H, k = 8, blocks = [];
    for (var by = 0; by + k <= H; by += k) for (var bx = 0; bx + k <= W; bx += k) {
      var s = 0;
      for (var y = by; y < by + k; y++) for (var x = bx; x < bx + k; x++) { var d = a[y * W + x] - b[y * W + x]; s += d < 0 ? -d : d; }
      blocks.push(s / (k * k));
    }
    blocks.sort(function (x, y) { return x - y; });
    return blocks[Math.floor(blocks.length * 0.1)] / 1.038;   // 1.128 for one block's mean, less the quietest tenth's own lean (checked on known noise)
  }
  function noiseNow(t) {
    if (!t.noise || !t.noise.length) return null;
    var v = t.noise.slice().sort(function (x, y) { return x - y; });
    return Math.round(v[Math.floor(v.length / 2)] * 100) / 100;
  }

  function chanState(t, key) {
    var c = t.chans[key];
    if (!c) {
      c = t.chans[key] = { m: new NS.BreakModel(), lst: learned ? learned.NewState() : null, lastT: 0, p: 0, learnedFrom: -1, covered: false,
        coveredAt: -999, savedAt: 0, paidUntil: 0, paidCardSeen: -9999, paidOpenSeen: -9999, paidCloseSeen: -9999, paidLogoSince: -1,
        pending: [], recent: [], runs: new NS.PrintRuns(), backfilled: false, clip: 0, clipStart: 0, sound: [], breakSound: [], recentSound: [] };
      // the logo learned before, if this channel has one saved: taken while the new model has not learned its own
      try {
        chrome.runtime.sendMessage({ type: "pv:live-load", key: key }, function (st) {
          void chrome.runtime.lastError;
          if (st && st.v === 3 && !c.m.HasLogo) { var mm = NS.BreakModel.loadState(st, Math.floor(Date.now() / 1000)); mm.ChannelName = c.m.ChannelName; mm.AdFreeChannel = c.m.AdFreeChannel; mm.ShowTitle = c.m.ShowTitle; c.m = mm; c.savedAt = performance.now() / 1000; }
        });
      } catch (e) {}
    }
    if (!c.lst && learned) c.lst = learned.NewState();
    return c;
  }
  // The screen's words (2026-11-06): the Prism app reads them with Windows' own text reader every other look; a browser has none, so the
  // extension carries Tesseract.js (Apache-2.0, vendor/tesseract: its worker, its SIMD core and the English data, nothing fetched from
  // the web) and reads the same 960x540 picture every other look, one reading at a time. Lines Tesseract is unsure of (under 55) are
  // left out: on a picture without text it makes letters up. The words go to the model as the app's (BreakModel.Text).
  var ocr = null, ocrBusy = false, ocrFailed = false, ocrLast = "", ocrReads = 0, ocrSeen = 0, ocrAsked = 0, ocrErr = "", ocrRaw = "";
  function ocrWorker() {
    if (ocr || ocrFailed || typeof Tesseract === "undefined") return ocr;
    var base = chrome.runtime.getURL("vendor/tesseract/");
    ocr = Tesseract.createWorker("eng", 1, { workerPath: base + "worker.min.js", corePath: base + "core", langPath: base + "lang",
      workerBlobURL: false, gzip: true, cacheMethod: "none", logger: function () {} })
      .catch(function (e) { ocrFailed = true; ocrErr = "start: " + String((e && (e.message || e)) || "").slice(0, 80); ocr = null; return null; });
    return ocr;
  }
  function readScreen(src, done) {
    ocrAsked++;
    if (ocrBusy) return;
    var w = ocrWorker(); if (!w) return;
    ocrBusy = true;
    // Tesseract.js 6 gives the lines only when asked for its blocks (2026-11-06: 160 readings came back with no lines at all)
    w.then(function (wk) { return wk ? wk.recognize(src, {}, { text: true, blocks: true }) : null; })
      .then(function (r) {
        ocrBusy = false;
        if (!r || !r.data) { ocrErr = "no data"; return; }
        ocrRaw = "conf " + Math.round(r.data.confidence || 0) + " blocks " + (r.data.blocks ? r.data.blocks.length : "none") + " text '" + String(r.data.text || "").replace(/\s+/g, " ").trim().slice(0, 40) + "'";
        var all = [];
        (r.data.blocks || []).forEach(function (bk) { (bk.paragraphs || []).forEach(function (pg) { (pg.lines || []).forEach(function (ln) { all.push(ln); }); }); });
        ocrSeen = all.length;
        var lines = all.filter(function (l) { return l.confidence >= 55; }).map(function (l) { return String(l.text || "").trim(); }).filter(Boolean);
        ocrReads++; if (lines.length) { ocrLast = lines.join(" | ").slice(0, 80); }
        if (lines.length) done(lines.join("\n"));
      }, function (e) { ocrBusy = false; ocrErr = String((e && (e.message || e)) || "error").slice(0, 80); });
  }
  function words(s) { return String(s || "").toLowerCase().split(/[^a-z0-9']+/).filter(function (x) { return x.length >= 3; }); }
  var bigCanvas = document.createElement("canvas"); bigCanvas.width = 960; bigCanvas.height = 540;
  var bigG = bigCanvas.getContext("2d", { willReadFrequently: true });
  function watch(t, msg) {
    var seen = P.cut(t.sv, msg.rect, msg.vw, msg.vh, g);
    if (!seen) return {};
    // the tab-stream route: the app's QR finder on a 960x540 picture every other look (the share route runs it in the page)
    if (!msg.covered && (t.looks = (t.looks || 0) + 1) % 2 === 0) {
      try { var big = P.cutTo(t.sv, msg.rect, msg.vw, msg.vh, bigG, 960, 540); if (big && NS.BreakModel.prototype.Qr.call({}, big, 960, 540, 0)) msg.qr = true; if (big) msg.screen = bigCanvas; } catch (e) {}
    }
    return judge(t, seen, msg);
  }
  // one frame judged, whichever route brought it: the tab's stream cut here, or the page's own restricted picture (pv:live-gray)
  function judge(t, seen, msg) {
    var c = chanState(t, String(msg.chan || "?")), now = performance.now() / 1000;
    if (!msg.covered && t.prev) { t.noise = t.noise || []; t.noise.push(noiseOf(seen, t.prev)); if (t.noise.length > 120) t.noise.shift(); }
    t.prev = msg.covered ? null : seen;
    var gray = seen, coverUp = 0;
    if (msg.covered) {
      // under the extension's own veil the stream shows the veil: under a spotted one the break watch reads it (its still picture) and
      // the captions, told the look was covered, as the bench replays it (COVERSIGHT=art); under a marked veil, or while one fades,
      // nothing is read (a marked veil ends on the service's own word)
      if (!(msg.art && msg.art.spotted)) return { b64: P.toB64(seen), p: c.p, up: !!(c.lst && c.lst.up) && !!msg.live, held: true, noise: noiseNow(t) };
      coverUp = 1;
    }
    var m = c.m;
    // what the page knows of the channel: its name (an ad-free channel is never covered, as the app's AdFree list) and the programme
    // on now (paid programming covers its slot)
    if (typeof msg.name === "string" && msg.name !== m.ChannelName) { m.ChannelName = msg.name; m.AdFreeChannel = AD_FREE.test(msg.name); }
    if (typeof msg.title === "string") m.ShowTitle = msg.title;
    if (msg.qr) m.QrSeen(now);   // a QR code on screen (the app's finder)
    // the screen's words, read from this look's big picture (the page's JPEG on the share route, the stream's on the other)
    if (msg.screen) {
      var at = now, mm = m, capWords = words(msg.ccNow);
      readScreen(msg.screen, function (said) {
        // captions the person has on are drawn inside the player's box: the reader would take the show's spoken words for its screen's
        // (the app keeps them hidden), so a line that is mostly the caption window's words is left out (2026-11-06)
        var kept = said.split("\n").filter(function (ln) {
          var w = words(ln); if (!w.length || !capWords.length) return true;
          var hit = w.filter(function (x) { return capWords.indexOf(x) >= 0; }).length;
          return hit / w.length < 0.5;
        });
        if (kept.length) { try { mm.Text(kept.join("\n"), at); } catch (e) {} }
      });
    }
    // near a programme's edge (its first three minutes, its last 75 s: the credits) only an ad's own words or a QR code cover, as the
    // app's guide rule; a ticker channel (NFL Network) is told so, its inset picture being the break
    if (msg.edges && msg.edges.start > 0) {
      var wall = Date.now();
      m.NearEdge = wall - msg.edges.start < 180000 || (msg.edges.end > 0 && msg.edges.end - wall < 75000);
      m.EdgeKnown = true;
    }
    m.TickerChannel = String(m.ChannelName || "").trim().toLowerCase() === "nfl network";
    // YouTube TV's own marks, as the app feeds them: read from the buffer (the learned inputs) and as they play (the sure rule)
    // the sound, as the app's meter gives it: the look's level and peak, and the silences since the last look (the model's cuts)
    // the sound's fingerprint words, as MainWindow.BreakWatch reads them: heard in a break before says a known ad; in a break the watch is
    // sure of they are kept, and back to where the logo went away, and learned when it ends
    if (msg.sound && msg.sound.afp && msg.sound.afp.length) {
      msg.sound.afp.forEach(function (w) {
        w = w >>> 0;
        c.sound.push(w); if (m.LearnableAt(now)) c.breakSound.push({ at: now, w: w });
        c.recentSound.push({ at: now, w: w, away: m.LogoAwayNow });
      });
      if (c.sound.length > 400) c.sound.splice(0, c.sound.length - 400);
      if (sounds.Heard(c.sound)) m.SoundSeen(now);
    }
    while (c.recentSound.length && now - c.recentSound[0].at > 120) c.recentSound.shift();
    if (msg.sound && typeof msg.sound.db === "number") {
      m.Level(msg.sound.db, typeof msg.sound.peak === "number" ? msg.sound.peak : msg.sound.db, now);
      (msg.sound.silences || []).forEach(function (x) { if (typeof x.ago === "number") m.Silence(now - x.ago / 1000); });
    }
    (msg.cues || []).forEach(function (q) { try { if (q.read) m.CueRead(q.ev, +q.dur || 0, +q.pos || 0, now); if (q.plays) m.CueSeen(q.ev, +q.dur || 0, +q.pos || 0, now); } catch (e) {} });
    if (msg.cc) {
      m.Captions(msg.cc, msg.ccQuietMs, now);
      if (c.lst && learned) learned.Caption(c.lst, msg.cc, now);
      m.Text(msg.cc, now, true);
    }
    m.Step(gray, now, c.lastT > 0 ? Math.min(6, Math.max(0.5, now - c.lastT)) : 1);
    c.lastT = now;
    keep(c, msg.chan, now);
    // known ads, as MainWindow.BreakWatch reads and learns them: a picture seen before (or a run of a known break's pictures, matched
    // loosely) says a known ad; in a break the watch is sure of, its pictures are learned once the break has gone on twenty seconds past
    // them, and the break's opening is learned back to where the logo went away (less its first three seconds)
    var printSeen = 0;
    if (!coverUp) {
      var fp = NS.AdPrints.Of(gray, P.W, P.H);
      if (fp) {
        if (prints.Seen(fp)) { m.PrintSeen(now); printSeen = 1; }
        else if (m.LearnableAt(now)) c.pending.push({ at: now, fp: fp });
        if (c.runs.Look(now, prints.Places(fp, NS.PrintRuns.Loose))) { m.PrintSeen(now); m.PrintSeen(now); }
        c.recent.push({ at: now, fp: fp, away: m.LogoAwayNow });
      }
    }
    while (c.recent.length && now - c.recent[0].at > 120) c.recent.shift();
    if (m.LearnableAt(now) && !c.backfilled) {
      c.backfilled = true;
      var i = c.recent.length - 1;
      while (i >= 0 && c.recent[i].away) i--;
      var runStart = i + 1 < c.recent.length ? c.recent[i + 1].at : now;
      c.clip = prints.NextClip(); c.clipStart = runStart;
      c.recent.forEach(function (pic) { if (pic.away && pic.at >= runStart + 3 && pic.at < now - 1 && !prints.Seen(pic.fp)) prints.Learn(pic.fp, c.clip, pic.at - runStart); });
      var j = c.recentSound.length - 1;
      while (j >= 0 && c.recentSound[j].away) j--;
      var sRun = j + 1 < c.recentSound.length ? c.recentSound[j + 1].at : now;
      var early = c.recentSound.filter(function (x) { return x.away && x.at >= sRun + 3 && !c.breakSound.some(function (bb) { return bb.at === x.at && bb.w === x.w; }); });
      c.breakSound = early.map(function (x) { return { at: x.at, w: x.w }; }).concat(c.breakSound);
    }
    if (!m.Active) {
      c.backfilled = false; c.clip = 0; c.pending = [];
      if (c.breakSound.length) {
        var end = c.breakSound[c.breakSound.length - 1].at;
        var keepW = c.breakSound.filter(function (x) { return x.at <= end - 20; }).map(function (x) { return x.w; });
        if (keepW.length >= 64) sounds.Learn(Uint32Array.from(keepW));
        c.breakSound = [];
      }
    }
    else while (c.pending.length && now - c.pending[0].at >= 20) { var pp = c.pending.shift(); prints.Learn(pp.fp, c.clip, c.clip === 0 ? 0 : pp.at - c.clipStart); }
    keepPrints(now); keepSounds(now);
    if (!learned || !c.lst) return { b64: P.toB64(gray), noise: noiseNow(t) };
    // The Prism app's cover, as MainWindow.BreakWatch composes it (2026-11-06): the learned call, held to its guards, joined with the
    // rules that do not guess
    var dn = new Date(), clockSec = dn.getHours() * 3600 + dn.getMinutes() * 60 + dn.getSeconds() + dn.getMilliseconds() / 1000;
    var p = learned.Score(c.lst, m.Features(now), printSeen, now, coverUp, clockSec);
    if (picNet && picW > 0) {
      var q = Math.min(0.999, Math.max(0.001, picNet.Chance(gray, c.picPrev && now - c.picPrevAt < 3 ? c.picPrev : null))), l0 = Math.min(0.999, Math.max(0.001, p));
      var blended = 1 / (1 + Math.exp(-(Math.log(l0 / (1 - l0)) + picW * Math.log(q / (1 - q)))));
      if (agree && !(c.lst && c.lst.up) && (p < treeMin || q < netMin)) blended = 0;   // no start unless both lean to a break
      p = blended;
      c.picQ = q;
    }
    c.picPrev = gray; c.picPrevAt = now;
    var lup = learned.Decide(c.lst, p, now, m.LogoInBand);
    if (c.learnedFrom < 0) c.learnedFrom = now;
    if (now - c.learnedFrom < 45) { lup = m.Active; c.lst.up = lup; }   // its first 45 s on a channel the learned detector has no history
    else if (lup && !c.covered && m.PlainShow(now)) { lup = false; c.lst.up = false; }   // no cover begun while every rule says the show is on
    else if (lup && !c.covered && !m.Active && m.DarkScene(now)) { lup = false; c.lst.up = false; }   // nor on a dark scene alone
    var adLine = now - c.coveredAt <= 20 && m.AdLineAt(now);          // a phone number or web address standing with the logo away
    var cueComing = now - c.coveredAt <= 20 && m.CueComingAt(now);    // a marked slot read and not yet on the screen
    var up = !m.AdFreeChannel && !m.DismissedAt(now) && (lup || m.CueOnAt(now) || m.InfomercialAt(now) || adLine || cueComing);
    // which rule called it, for the veil log (2026-11-07): the first that holds, in the order the cover is composed
    var why = !up ? "" : lup ? "learned" : m.CueOnAt(now) ? "marked slot" : m.InfomercialAt(now) ? "infomercial" : adLine ? "ad line" : "slot coming";
    var clock = Date.now();
    if (!up && !m.AdFreeChannel && !m.DismissedAt(now) && String(m.ShowTitle || "").trim().toLowerCase() === "paid programming") { up = true; why = "paid programming"; }
    // a paid programme that says so on the screen or as its half hour begins holds to the end of its half hour; it says it has ended,
    // or the channel's logo stands a minute, and the hold ends
    if (m.PaidCardAt > c.paidCardSeen) { c.paidCardSeen = m.PaidCardAt; c.paidUntil = NS.BreakModel.PaidSlotEnd(new Date(), m.PaidCardFollowing).getTime(); }
    if (m.PaidOpenAt > c.paidOpenSeen) {
      c.paidOpenSeen = m.PaidOpenAt;
      var d = new Date(), into = d.getMinutes() % 30 * 60 + d.getSeconds();
      if (into <= 300 || into >= 1500) c.paidUntil = NS.BreakModel.PaidSlotEnd(d, true).getTime();
    }
    if (m.PaidCloseAt > c.paidCloseSeen) { c.paidCloseSeen = m.PaidCloseAt; if (clock < c.paidUntil) c.paidUntil = 0; }
    if (clock < c.paidUntil && m.LogoUpNow) { if (c.paidLogoSince < 0) c.paidLogoSince = now; else if (now - c.paidLogoSince >= 60) { c.paidUntil = 0; c.paidLogoSince = -1; } }
    else c.paidLogoSince = -1;
    if (!up && !m.AdFreeChannel && !m.DismissedAt(now) && clock < c.paidUntil) { up = true; why = "paid programming"; }
    // a ticker channel's inset picture is a break (NFL Network)
    if (!up && (m.InsetBreakAt(now) || m.InsetTailAt(now)) && !m.AdFreeChannel && !m.DismissedAt(now)) { up = true; why = "inset picture"; }
    // the person's choice for this channel, as the app's: off never covers; sure breaks only covers what does not guess (YouTube TV's own
    // slot as it plays, one coming while a cover is up, a paid programme the title or the screen names), the watch reading on as ever
    if (msg.mode === "off") { up = false; why = ""; }
    else if (msg.mode === "sure") {
      var paidNow = String(m.ShowTitle || "").trim().toLowerCase() === "paid programming" || clock < c.paidUntil;
      up = !m.DismissedAt(now) && (m.CueOnAt(now) || (c.covered && m.CueComingAt(now)) || paidNow);
      why = !up ? "" : m.CueOnAt(now) ? "marked slot" : paidNow ? "paid programming" : "slot coming";
    }
    if (up) c.coveredAt = now;
    c.covered = up; c.p = p; c.why = why;
    // the cover goes up only at the live edge (2026-11-06); rewound or a recording, the watch keeps reading and learning
    var diag = (m.HasLogo ? "logo " + (m.LogoScore == null ? "-" : (m.LogoScore / (m._level || 1)).toFixed(2)) + (m.LogoUpNow ? " up" : m.LogoAwayNow ? " away" : "") : "no logo yet") +
      ", rules " + (m.Active ? "break" : "show") + " " + Math.round(m.Chance * 100) + "%" + (m.NearEdge ? ", near an edge" : "") + (m.AdFreeChannel ? ", ad-free" : "");
    return { b64: P.toB64(gray), p: p, up: up && !!msg.live, why: why, noise: noiseNow(t), diag: diag, ocr: ocrFailed ? "(text reader failed to start: " + ocrErr + ")" : ocrAsked + " asked, " + ocrReads + " read, " + ocrSeen + " lines in the last (" + ocrRaw + ")" + (ocrErr ? ", error: " + ocrErr : "") + ", last kept: " + ocrLast };
  }
  // the channels the Prism app never covers (MainWindow.BreakWatch.AdFree)
  var AD_FREE = /^(C-SPAN\d?|PBS( Kids)?|PBS .*)$/i;
  // A channel's learned logo kept across restarts (2026-11-06; the app keeps its .logo files): saved through bg.js into the extension's
  // storage when it is learned and every ten minutes after, and asked for when the channel is first seen.
  function keep(c, key, now) {
    if (!c.m.HasLogo) return;
    if (c.savedAt > 0 && now - c.savedAt < 600) return;
    c.savedAt = now;
    var st = c.m.saveState(Math.floor(Date.now() / 1000));
    if (st) { try { chrome.runtime.sendMessage({ type: "pv:live-save", key: String(key || "?"), state: st }, function () { void chrome.runtime.lastError; }); } catch (e) {} }
  }

  // The soundscape (2026-11-06): one of the extension's three CC0 loops (sounds/CREDITS.txt), faded in over two seconds while a veil
  // covers an ad break and out over one when it lifts
  var SOUNDS = { river: "sounds/river.mp3", chimes: "sounds/wind-chimes.mp3", stars: "sounds/star-walk.mp3" };
  var ambientEl = null, fadeIv = 0;
  function fadeTo(el, target, ms, done) {
    if (fadeIv) clearInterval(fadeIv);
    var steps = Math.max(1, Math.round(ms / 50)), start = el.volume, n = 0;
    fadeIv = setInterval(function () { n++; el.volume = Math.max(0, Math.min(1, start + (target - start) * n / steps)); if (n >= steps) { clearInterval(fadeIv); fadeIv = 0; if (done) done(); } }, 50);
  }
  function ambientPlay(on, sound) {
    var src = SOUNDS[sound];
    if (on && src) {
      if (!ambientEl || ambientEl.getAttribute("data-src") !== src) {
        if (ambientEl) { try { ambientEl.pause(); } catch (e) {} }
        ambientEl = new Audio(chrome.runtime.getURL(src)); ambientEl.setAttribute("data-src", src); ambientEl.loop = true; ambientEl.volume = 0;
      }
      ambientEl.play().catch(function () {});
      fadeTo(ambientEl, 0.35, 2000);
    } else if (ambientEl) {
      var el = ambientEl;
      fadeTo(el, 0, 1000, function () { try { el.pause(); } catch (e) {} if (ambientEl === el) ambientEl = null; if (!Object.keys(tabs).length) { try { chrome.runtime.sendMessage({ type: "pv:offscreen-idle" }); } catch (e) {} } });
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "pv:ambient-play" && msg.target === "offscreen") { ambientPlay(!!msg.on, String(msg.sound || "")); return; }
    if (msg.type === "pv:live-open" && msg.target === "offscreen") { open(msg.tabId, msg.streamId, reply); return true; }
    if (msg.type === "pv:live-shut" && msg.target === "offscreen") { close(msg.tabId); reply({ ok: true }); return; }
    var tid = sender && sender.tab && sender.tab.id;
    if (tid == null) return;
    if (msg.type === "pv:live-look") {
      var t = tabs[tid];
      if (!t) { reply({ error: "no stream" }); return; }
      try { reply(watch(t, msg)); } catch (e) { reply({ error: String(e && (e.name + " " + e.message)) }); }
      return;
    }
    if (msg.type === "pv:live-notabreak") {
      var t2 = tabs[tid], c = t2 && t2.chans[String(msg.chan || "?")];
      if (c) { c.m.Dismiss(performance.now() / 1000); if (c.lst) { c.lst.up = false; c.lst.run = 0; } }
      reply({ ok: true }); return;
    }
    if (msg.type === "pv:live-gray") {
      // the share route: the page reads its own picture (the player's box, the veil left out) and sends the frame to be judged
      var tg = tabs[tid] || (tabs[tid] = { stream: null, sv: null, chans: {} });
      try { reply(judge(tg, P.fromB64(msg.b64), msg)); } catch (e) { reply({ error: String(e && (e.name + " " + e.message)) }); }
      return;
    }
    if (msg.type === "pv:live-close") { close(tid); reply({ ok: true }); }
  });
})();
