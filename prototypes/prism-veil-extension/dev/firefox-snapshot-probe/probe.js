/*
  PRISM snapshot probe (2026-11-15), a test tool that is never published or packaged.

  The question: can a Firefox extension read a live TV tab's picture with small tab snapshots (tabs.captureTab with a rectangle and
  a scale), where Chromium uses the tab's stream? Protected video could come back black. Pressed on a tab with a playing video, it
  takes 20 snapshots of the video's rectangle at 320 pixels wide, two a second, and says: is there a picture, does it move, and
  what does one snapshot cost. Everything stays in this window.

  ?tab=<id> in the address (the automated check) reads that tab and brings it to the front first.
*/
(async function () {
  "use strict";
  var verdict = document.getElementById("verdict"), numbers = document.getElementById("numbers"), g = document.getElementById("shot").getContext("2d");
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function say(cls, text) { verdict.className = cls; verdict.textContent = text; }
  var out = { browser: navigator.userAgent.replace(/^.*(Firefox\/[\d.]+).*$/, "$1") };
  try {
    var asked = /[?&]tab=(\d+)/.exec(location.search), tab;
    if (asked) { tab = await browser.tabs.get(Number(asked[1])); await browser.tabs.update(tab.id, { active: true }); await wait(1500); }
    else tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    out.site = new URL(tab.url).hostname;
    // the largest playing video, in this frame or one inside it (its rectangle is then within that frame, which is good enough here
    // only for the top frame; a video in a frame is reported and the whole tab is read)
    var found = await browser.tabs.executeScript(tab.id, { allFrames: true, code: "(function () { var best = null; Array.prototype.forEach.call(document.querySelectorAll('video'), function (v) { var r = v.getBoundingClientRect(); if (r.width < 160 || r.height < 90) return; if (!best || r.width * r.height > best.w * best.h) best = { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, paused: v.paused, t: v.currentTime, keys: !!v.mediaKeys, top: window === top, dpr: devicePixelRatio }; }); return best; })()" });
    var vids = (found || []).filter(Boolean).sort(function (a, b) { return b.w * b.h - a.w * a.h; }), v = vids[0];
    if (!v) { say("bad", "No video on this tab"); numbers.textContent = "Open a live channel, let it play, then press the button again."; return; }
    out.video = Math.round(v.w) + "x" + Math.round(v.h) + (v.top ? "" : " (in a frame)"); out.protected = v.keys; out.paused = v.paused;
    var opts = { format: "jpeg", quality: 70 };
    if (v.top) { opts.rect = { x: v.x, y: v.y, width: v.w, height: v.h }; opts.scale = 320 / v.w / (v.dpr || 1); }
    function grey(url) {
      return new Promise(function (ok, no) {
        var im = new Image();
        im.onload = function () { g.drawImage(im, 0, 0, 320, 180); var d = g.getImageData(0, 0, 320, 180).data, a = new Float32Array(320 * 180); for (var i = 0; i < a.length; i++) a[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; ok({ a: a, w: im.naturalWidth, h: im.naturalHeight }); };
        im.onerror = function () { no(new Error("the snapshot is not a picture")); }; im.src = url;
      });
    }
    var N = 20, costs = [], means = [], spreads = [], moves = [], last = null, size = "";
    for (var n = 0; n < N; n++) {
      var t0 = performance.now(), url = await browser.tabs.captureTab(tab.id, opts); costs.push(performance.now() - t0);
      var f = await grey(url); size = f.w + "x" + f.h;
      var m = 0, s = 0, i; for (i = 0; i < f.a.length; i++) m += f.a[i]; m /= f.a.length; for (i = 0; i < f.a.length; i++) s += (f.a[i] - m) * (f.a[i] - m);
      means.push(m); spreads.push(Math.sqrt(s / f.a.length));
      if (last) { var d = 0; for (i = 0; i < f.a.length; i++) d += Math.abs(f.a[i] - last[i]); moves.push(d / f.a.length); }
      last = f.a;
      say("wait", "Reading " + (n + 1) + " of " + N);
      await wait(Math.max(0, 500 - (performance.now() - t0)));
    }
    var avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / (a.length || 1); }, r1 = function (x) { return Math.round(x * 10) / 10; };
    costs.sort(function (a, b) { return a - b; });
    out.snapshot = size; out.msMedian = r1(costs[costs.length >> 1]); out.msWorst = r1(costs[costs.length - 1]);
    out.brightness = r1(avg(means)); out.detail = r1(avg(spreads)); out.movement = r1(avg(moves));
    out.readable = out.detail >= 8; out.moving = out.movement >= 0.5;
    if (out.readable && out.moving) say("good", "READABLE: the picture is there");
    else if (out.readable) say("wait", "A picture, but it does not move");
    else say("bad", "BLACK: no picture");
  } catch (e) { out.error = String(e && e.message || e); say("bad", "The probe failed"); }
  numbers.textContent = JSON.stringify(out, null, 1);
  document.documentElement.setAttribute("data-probe", JSON.stringify(out));
})();
