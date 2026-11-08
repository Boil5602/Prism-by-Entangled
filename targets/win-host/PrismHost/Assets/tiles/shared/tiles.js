/*
  The micro-facet ↔ host bridge (docs/concept-scenes.md §6).

  These pages hold no document logic of their own. They render whatever core
  hands them and send back ONE human edit at a time; core (packages/core/src/
  tiles-data.ts) owns the shape, applies the edit and persists it through the
  Store driver (§10 — written, never wiped). That is what lets the phone remote
  (§6 GET/POST /chores) and this page edit the same list without two answers to
  "what is on it".

  Wire format, both ways over the WebView2 message channel the host already
  reads (Surfaces/SurfaceManager.cs; PrismHost.Core/TilesBridge.cs parses it):

    page → host  {"prism-tiles":"get",   "key":"tiles:chores"}
                 {"prism-tiles":"apply", "key":"tiles:chores", "intent":"{...}"}
    host → page  {"prism-tiles":"doc",   "key":"tiles:chores", "doc":{...}}
                 {"prism-tiles":"error", "key":"tiles:chores", "message":"..."}

  No fetch, no XHR, no WebSocket, no import from anywhere: the only channel out
  of this page is the host's own, and the host will not answer for any key but
  the two micro-facet documents.
*/
(function () {
  "use strict";

  var bridged = !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);
  var docHandlers = [];
  var errHandlers = [];

  function post(message) {
    if (!bridged) return false;
    try { window.chrome.webview.postMessage(JSON.stringify(message)); return true; }
    catch (e) { return false; }
  }

  if (bridged) {
    window.chrome.webview.addEventListener("message", function (ev) {
      var m = ev.data;
      if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { return; } }
      if (!m || typeof m !== "object") return;
      var kind = m["prism-tiles"];
      if (kind === "doc") {
        for (var i = 0; i < docHandlers.length; i++) {
          try { docHandlers[i](m.key, m.doc); } catch (e) { /* one bad renderer must not stop the rest */ }
        }
      } else if (kind === "error") {
        for (var j = 0; j < errHandlers.length; j++) {
          try { errHandlers[j](m.key, m.message || ""); } catch (e) { /* as above */ }
        }
      }
    });
  }

  window.PrismTiles = {
    /** True when this page is running inside Prism; false in a plain browser (the page then says so and edits nothing). */
    connected: bridged,
    /** Ask the host for the current document. The answer arrives on onDoc. */
    get: function (key) { return post({ "prism-tiles": "get", key: key }); },
    /** Send ONE edit. `intent` is a tiles-data.ts TilesIntent; the new document comes back on onDoc. */
    apply: function (key, intent) { return post({ "prism-tiles": "apply", key: key, intent: JSON.stringify(intent) }); },
    onDoc: function (fn) { docHandlers.push(fn); },
    onError: function (fn) { errHandlers.push(fn); },
  };

  /** Escape text before it reaches innerHTML. Chore text is typed by a household; it is a label, never markup. */
  window.PrismTiles.text = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  /** "0:07" · "12:34" · "1:02:03" — what a wall panel shows, from milliseconds. */
  window.PrismTiles.clock = function (msLeft) {
    var total = Math.max(0, Math.ceil(msLeft / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  };

  /** Local wall-clock time of an epoch ms, as a household reads it. */
  window.PrismTiles.at = function (epochMs) {
    try { return new Date(epochMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return ""; }
  };
})();
