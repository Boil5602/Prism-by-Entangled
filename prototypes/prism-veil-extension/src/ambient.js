/*
  PRISM - the soundscape for a veiled ad break (2026-11-06; one module for every browser since 2026-11-15).

  One of the extension's three CC0 loops (sounds/CREDITS.txt), faded in over two seconds while a veil covers a video's ad break and
  out over one when it lifts. The tab itself is muted then, so the sound plays from one of the extension's own pages: the offscreen
  page in Chromium (offscreen.js), the background page in Firefox (bg.js), which has a document of its own.

  PrismAmbient.play(on, sound, onSilent)  start or stop; onSilent runs when a fade out has ended and nothing plays
  PrismAmbient.playing()                  true while a loop is held (playing or fading)
*/
(function (root) {
  "use strict";
  var SOUNDS = { river: "sounds/river.mp3", chimes: "sounds/wind-chimes.mp3", stars: "sounds/star-walk.mp3" };
  var el = null, fadeIv = 0;
  function fadeTo(a, target, ms, done) {
    if (fadeIv) clearInterval(fadeIv);
    var steps = Math.max(1, Math.round(ms / 50)), start = a.volume, n = 0;
    fadeIv = setInterval(function () { n++; a.volume = Math.max(0, Math.min(1, start + (target - start) * n / steps)); if (n >= steps) { clearInterval(fadeIv); fadeIv = 0; if (done) done(); } }, 50);
  }
  function play(on, sound, onSilent) {
    var src = SOUNDS[sound];
    if (on && src) {
      if (!el || el.getAttribute("data-src") !== src) {
        if (el) { try { el.pause(); } catch (e) {} }
        el = new Audio(chrome.runtime.getURL(src)); el.setAttribute("data-src", src); el.loop = true; el.volume = 0;
      }
      el.play().catch(function () {});
      fadeTo(el, 0.35, 2000);
    } else if (el) {
      var was = el;
      fadeTo(was, 0, 1000, function () { try { was.pause(); } catch (e) {} if (el === was) el = null; if (onSilent) onSilent(); });
    } else if (onSilent) onSilent();
  }
  root.PrismAmbient = { play: play, playing: function () { return !!el; },
    // for the tests: what the held loop is doing
    state: function () { return el ? { src: el.getAttribute("data-src"), paused: el.paused, time: el.currentTime, volume: el.volume } : null; } };
})(typeof self !== "undefined" ? self : this);
